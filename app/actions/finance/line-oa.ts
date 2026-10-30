"use server";

import { headers } from "next/headers";
import { requireSessionUserId } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server-admin";
import { loadLineChannelAccessToken, loadLineOaAccountUid, pushLineMessages } from "@/lib/line/line-oa";
import { extractLineTargetId, H3_LINE_GROUP_ID, isH3Contact } from "@/lib/line/line-target";

type KnownGroup = {
  group_id: string;
  group_name: string | null;
  picture_url: string | null;
};

export async function listLineKnownGroupsAction(): Promise<{
  groups: KnownGroup[];
  oaAccountUid: string;
  error: string | null;
}> {
  const owner = await requireSessionUserId();
  if (!owner.ok) return { groups: [], oaAccountUid: "", error: owner.error };
  const supabase = createClient() as unknown as {
    from: (table: "line_known_groups") => {
      select: (columns: string) => {
        order: (
          column: string,
          options: { ascending: boolean },
        ) => Promise<{ data: KnownGroup[] | null; error: { message?: string } | null }>;
      };
    };
  };
  const [oaAccountUid, listed] = await Promise.all([
    loadLineOaAccountUid(),
    supabase
      .from("line_known_groups")
      .select("group_id, group_name, picture_url")
      .order("last_active_at", { ascending: false }),
  ]);
  if (listed.error) return { groups: [], oaAccountUid, error: null };
  return { groups: listed.data ?? [], oaAccountUid, error: null };
}

export async function loadContactLineTargetAction(
  contactId: string,
  contactName?: string | null,
): Promise<{ lineTargetId: string | null; error: string | null }> {
  const owner = await requireSessionUserId();
  if (!owner.ok) return { lineTargetId: null, error: owner.error };
  const id = contactId.trim();
  if (!id) {
    return {
      lineTargetId: isH3Contact(contactName) ? H3_LINE_GROUP_ID : null,
      error: null,
    };
  }
  const supabase = createClient() as unknown as {
    from: (table: "contacts") => {
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          maybeSingle: () => Promise<{
            data: { line_target_id?: string | null; company_name?: string | null } | null;
            error: { message?: string } | null;
          }>;
        };
      };
    };
  };
  const { data } = await supabase
    .from("contacts")
    .select("line_target_id, company_name")
    .eq("id", id)
    .maybeSingle();
  const saved = data?.line_target_id?.trim() || null;
  if (saved) return { lineTargetId: saved, error: null };
  const name = data?.company_name || contactName;
  if (isH3Contact(name)) return { lineTargetId: H3_LINE_GROUP_ID, error: null };
  return { lineTargetId: null, error: null };
}

export async function sendVendorPaymentSlipLineAction(input: {
  contactId: string;
  contactName?: string | null;
  lineOaChatUrl?: string | null;
  lineTargetId?: string | null;
  messageText: string;
  slipPublicUrl?: string | null;
  billingNoteNo?: string | null;
  paymentDocNo?: string | null;
}): Promise<{ success: boolean; error: string | null; imageSent: boolean }> {
  const owner = await requireSessionUserId();
  if (!owner.ok) return { success: false, error: owner.error, imageSent: false };

  const messageText = input.messageText?.trim() ?? "";
  if (!messageText) return { success: false, error: "กรุณาระบุข้อความแจ้งโอน", imageSent: false };

  const lineTargetId =
    extractLineTargetId(input.lineTargetId) ||
    extractLineTargetId(input.lineOaChatUrl) ||
    (isH3Contact(input.contactName) ? H3_LINE_GROUP_ID : null);
  if (!lineTargetId) {
    return { success: false, error: "กรุณาเลือกกลุ่ม หรือวางลิงก์ห้องแชท LINE OA", imageSent: false };
  }

  const token = await loadLineChannelAccessToken();
  if (!token) {
    return { success: false, error: "ไม่พบ LINE Channel Access Token ในระบบ", imageSent: false };
  }

  const contactId = input.contactId?.trim() ?? "";
  if (contactId && (input.lineOaChatUrl?.trim() || input.lineTargetId?.trim())) {
    const supabase = createClient() as unknown as {
      from: (table: "contacts") => {
        update: (values: { line_target_id: string }) => {
          eq: (
            column: string,
            value: string,
          ) => Promise<{ error: { message?: string } | null }>;
        };
      };
    };
    await supabase.from("contacts").update({ line_target_id: lineTargetId }).eq("id", contactId);
  }

  const slipPublicUrl = input.slipPublicUrl?.trim() ?? "";
  const jpegSlipUrl = await lineJpegSlipUrl(slipPublicUrl);
  const textOnly: Array<Record<string, string>> = [{ type: "text", text: messageText }];
  const withImage: Array<Record<string, string>> = jpegSlipUrl
    ? [
        ...textOnly,
        { type: "image", originalContentUrl: jpegSlipUrl, previewImageUrl: jpegSlipUrl },
      ]
    : textOnly;

  let pushed = await pushLineMessages(token, lineTargetId, withImage);
  let imageSent = Boolean(jpegSlipUrl) && pushed.ok;
  if (!pushed.ok && jpegSlipUrl) {
    pushed = await pushLineMessages(token, lineTargetId, textOnly);
    imageSent = false;
  }

  await writeLineLog({
    contactId,
    lineTargetId,
    messageText,
    slipUrl: imageSent ? jpegSlipUrl : slipPublicUrl || null,
    billingNoteNo: input.billingNoteNo?.trim() || null,
    paymentDocNo: input.paymentDocNo?.trim() || null,
    sentBy: owner.userId,
    status: pushed.ok ? "SENT" : "FAILED",
    errorMessage: pushed.ok ? null : pushed.error,
  });
  if (!pushed.ok) {
    return { success: false, error: explainLineFailure(pushed.errorMessage, pushed.errorDetails), imageSent: false };
  }
  return { success: true, error: null, imageSent };
}

async function lineJpegSlipUrl(slipPublicUrl: string): Promise<string> {
  if (!slipPublicUrl.startsWith("https://")) return "";
  if (/\.pdf($|\?)/i.test(slipPublicUrl)) return "";
  const origin = await publicAppOrigin();
  if (origin.startsWith("https://")) {
    return `${origin}/api/line/slip-image?url=${encodeURIComponent(slipPublicUrl)}`;
  }
  if (/\.(jpe?g|png)($|\?)/i.test(slipPublicUrl)) return slipPublicUrl;
  return "";
}

async function publicAppOrigin(): Promise<string> {
  try {
    const h = await headers();
    const host = (h.get("x-forwarded-host") || h.get("host") || "").split(",")[0]?.trim() ?? "";
    if (!host) return "";
    const forwarded = (h.get("x-forwarded-proto") || "").split(",")[0]?.trim() ?? "";
    const proto = forwarded || (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
    return `${proto}://${host}`;
  } catch {
    return "";
  }
}

function explainLineFailure(message: string | null, details: string | null): string {
  const headline = message?.trim() || "ส่งข้อความเข้า LINE ไม่สำเร็จ";
  const detailLine = details?.trim() ? `รายละเอียด: ${details.trim()}` : "";
  const blob = `${headline}\n${details ?? ""}`.toLowerCase();
  let advice =
    "แนะนำ: ตรวจ Group ID จากลิงก์ chat.line.biz (รหัสหลัง /chat/), สิทธิ์ของ OA ในกลุ่ม และโควตา Push API";
  if (/quota|monthly limit|rate limit|too many requests|429/.test(blob)) {
    advice =
      "แนะนำ: โควตา Push API ของแพ็กเกจฟรีอาจเต็มแล้ว รอรีเซ็ตต้นเดือน หรืออัปเกรดแพ็กเกจ LINE Official Account";
  } else if (/failed to send messages|not a friend|not found|invalid|group|member|haven't added|has not added/.test(blob)) {
    advice =
      "แนะนำ: ให้สมาชิกทักในกลุ่ม LINE ที่มีบัญชี OA อยู่อย่างน้อย 1 ข้อความก่อน แล้วตรวจว่าเลือกกลุ่มถูก (รหัสหลัง /chat/) จากนั้นส่งใหม่ หากข้อความธรรมดาก็ไม่ผ่าน โควตา Push API ของแพ็กเกจฟรีอาจเต็ม";
  }
  return [headline, detailLine, advice].filter(Boolean).join("\n");
}

async function writeLineLog(entry: {
  contactId: string;
  lineTargetId: string;
  messageText: string;
  slipUrl: string | null;
  billingNoteNo: string | null;
  paymentDocNo: string | null;
  sentBy: string;
  status: "SENT" | "FAILED";
  errorMessage: string | null;
}) {
  const supabase = createClient() as unknown as {
    from: (table: "line_notification_logs") => {
      insert: (row: Record<string, string | null>) => Promise<{ error: { message?: string } | null }>;
    };
  };
  await supabase.from("line_notification_logs").insert({
    contact_id: entry.contactId || null,
    line_target_id: entry.lineTargetId,
    message_text: entry.messageText,
    slip_url: entry.slipUrl,
    billing_note_no: entry.billingNoteNo,
    payment_doc_no: entry.paymentDocNo,
    status: entry.status,
    error_message: entry.errorMessage,
    sent_by: entry.sentBy,
  });
}
