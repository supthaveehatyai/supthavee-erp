"use server";

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
}): Promise<{ success: boolean; error: string | null }> {
  const owner = await requireSessionUserId();
  if (!owner.ok) return { success: false, error: owner.error };

  const messageText = input.messageText?.trim() ?? "";
  if (!messageText) return { success: false, error: "กรุณาระบุข้อความแจ้งโอน" };

  const lineTargetId =
    extractLineTargetId(input.lineTargetId) ||
    extractLineTargetId(input.lineOaChatUrl) ||
    (isH3Contact(input.contactName) ? H3_LINE_GROUP_ID : null);
  if (!lineTargetId) {
    return { success: false, error: "กรุณาเลือกกลุ่ม หรือวางลิงก์ห้องแชท LINE OA" };
  }

  const token = await loadLineChannelAccessToken();
  if (!token) return { success: false, error: "ไม่พบ LINE Channel Access Token ในระบบ" };

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
  const messages: Array<Record<string, string>> = [{ type: "text", text: messageText }];
  if (slipPublicUrl.startsWith("https://")) {
    messages.push({
      type: "image",
      originalContentUrl: slipPublicUrl,
      previewImageUrl: slipPublicUrl,
    });
  }

  const pushed = await pushLineMessages(token, lineTargetId, messages);
  await writeLineLog({
    contactId,
    lineTargetId,
    messageText,
    slipUrl: slipPublicUrl || null,
    billingNoteNo: input.billingNoteNo?.trim() || null,
    paymentDocNo: input.paymentDocNo?.trim() || null,
    sentBy: owner.userId,
    status: pushed.ok ? "SENT" : "FAILED",
    errorMessage: pushed.error,
  });
  if (!pushed.ok) {
    return { success: false, error: pushed.error ?? "ส่งข้อความเข้า LINE ไม่สำเร็จ" };
  }
  return { success: true, error: null };
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
