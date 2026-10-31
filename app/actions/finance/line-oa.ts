"use server";

import { requireSessionUserId } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server-admin";
import {
  loadLineChannelAccessToken,
  loadLineOaAccountUid,
  loadLineSettings,
  pushLineMessages,
  replyLineMessages,
} from "@/lib/line/line-oa";

type KnownGroup = {
  group_id: string;
  group_name: string | null;
  picture_url: string | null;
  linkedContactId: string | null;
  replyReady: boolean;
  replyExpiresAt: string | null;
};

type KnownGroupRow = {
  group_id: string;
  group_name: string | null;
  picture_url: string | null;
  linked_contact_id?: string | null;
  last_reply_token?: string | null;
  reply_token_expires_at?: string | null;
};

function mapKnownGroup(row: KnownGroupRow): KnownGroup {
  const expiresAt = row.reply_token_expires_at ?? null;
  const replyReady = Boolean(
    row.last_reply_token && expiresAt && new Date(expiresAt).getTime() > Date.now(),
  );
  return {
    group_id: row.group_id,
    group_name: row.group_name,
    picture_url: row.picture_url,
    linkedContactId: row.linked_contact_id ?? null,
    replyReady,
    replyExpiresAt: replyReady ? expiresAt : null,
  };
}

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
        ) => Promise<{ data: KnownGroupRow[] | null; error: { message?: string } | null }>;
      };
    };
  };
  const [oaAccountUid, listed] = await Promise.all([
    loadLineOaAccountUid(),
    supabase
      .from("line_known_groups")
      .select("group_id, group_name, picture_url, linked_contact_id, last_reply_token, reply_token_expires_at")
      .order("last_active_at", { ascending: false }),
  ]);
  if (listed.error) return { groups: [], oaAccountUid, error: null };
  return { groups: (listed.data ?? []).map(mapKnownGroup), oaAccountUid, error: null };
}

export async function loadContactLineTargetAction(
  contactId: string,
  contactName?: string | null,
): Promise<{ lineTargetId: string | null; lineOaChatUrl: string | null; error: string | null }> {
  const owner = await requireSessionUserId();
  if (!owner.ok) return { lineTargetId: null, lineOaChatUrl: null, error: owner.error };
  const id = contactId.trim();
  void contactName;
  if (!id) {
    return { lineTargetId: null, lineOaChatUrl: null, error: null };
  }
  const saved = await readContactLineFields(id);
  return {
    lineTargetId: saved.lineTargetId,
    lineOaChatUrl: saved.lineOaChatUrl,
    error: null,
  };
}

export async function saveContactLineOaChatUrlAction(
  contactId: string,
  lineOaChatUrl: string,
): Promise<{ success: boolean; error: string | null }> {
  const owner = await requireSessionUserId();
  if (!owner.ok) return { success: false, error: owner.error };
  const id = contactId.trim();
  const url = lineOaChatUrl.trim();
  if (!id || !url) return { success: false, error: "ไม่พบคู่ค้าหรือลิงก์ห้องแชท" };
  try {
    const supabase = createClient() as unknown as {
      from: (table: "contacts") => {
        update: (values: { line_oa_chat_url: string }) => {
          eq: (column: string, value: string) => Promise<{ error: { message?: string } | null }>;
        };
      };
    };
    const { error } = await supabase.from("contacts").update({ line_oa_chat_url: url }).eq("id", id);
    if (error) {
      console.error("[saveContactLineOaChatUrl]", error.message);
      return { success: false, error: error.message ?? "บันทึกลิงก์ห้องแชทไม่สำเร็จ" };
    }
    return { success: true, error: null };
  } catch (err) {
    console.error("[saveContactLineOaChatUrl]", err);
    return { success: false, error: "บันทึกลิงก์ห้องแชทไม่สำเร็จ" };
  }
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
}): Promise<{ success: boolean; error: string | null; imageSent: boolean; channel: "reply" | "push" | null }> {
  const owner = await requireSessionUserId();
  if (!owner.ok) return { success: false, error: owner.error, imageSent: false, channel: null };

  const messageText = input.messageText?.trim() ?? "";
  if (!messageText) return { success: false, error: "กรุณาระบุข้อความแจ้งโอน", imageSent: false, channel: null };

  const lineTargetId = messagingGroupId(input.lineTargetId);
  if (!lineTargetId) {
    return {
      success: false,
      error:
        "Push API ใช้ได้เมื่อเลือกหรือวาง API Group ID (ขึ้นต้นด้วย C) ที่ได้จาก Webhook แล้วเท่านั้น รหัสหลัง /chat/ ของ chat.line.biz เป็นรหัสห้องในหน้าจัดการ ไม่ใช่ groupId",
      imageSent: false,
      channel: null,
    };
  }

  const token = await loadLineChannelAccessToken();
  if (!token) {
    return { success: false, error: "ไม่พบ LINE Channel Access Token ในระบบ", imageSent: false, channel: null };
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

  const slipPublicUrl = cleanSupabaseSlipUrl(input.slipPublicUrl ?? "");
  const textOnly: Array<Record<string, string>> = [{ type: "text", text: messageText }];
  const withImage: Array<Record<string, string>> = slipPublicUrl
    ? [
        ...textOnly,
        { type: "image", originalContentUrl: slipPublicUrl, previewImageUrl: slipPublicUrl },
      ]
    : textOnly;

  const replyToken = await loadFreshReplyToken(lineTargetId);
  let imageSent = false;
  let channel: "reply" | "push" = "push";
  let pushed: {
    ok: boolean;
    error: string | null;
    errorMessage: string | null;
    errorDetails: string | null;
  } = { ok: false, error: null, errorMessage: null, errorDetails: null };

  if (replyToken) {
    const replied = await replyLineMessages(token, replyToken, withImage);
    await clearReplyToken(lineTargetId);
    if (replied.ok) {
      channel = "reply";
      imageSent = Boolean(slipPublicUrl);
      pushed = replied;
    }
  }
  if (!pushed.ok) {
    const pushedResult = await sendWithImageFallback(
      (messages) => pushLineMessages(token, lineTargetId, messages),
      withImage,
      textOnly,
      slipPublicUrl,
    );
    channel = "push";
    imageSent = pushedResult.imageSent;
    pushed = pushedResult;
  }

  await writeLineLog({
    contactId,
    lineTargetId,
    messageText,
    slipUrl: imageSent ? slipPublicUrl : input.slipPublicUrl?.trim() || null,
    billingNoteNo: input.billingNoteNo?.trim() || null,
    paymentDocNo: input.paymentDocNo?.trim() || null,
    sentBy: owner.userId,
    status: pushed.ok ? "SENT" : "FAILED",
    errorMessage: pushed.ok ? null : pushed.error,
  });
  if (!pushed.ok) {
    return {
      success: false,
      error: explainLineFailure(pushed.errorMessage, pushed.errorDetails),
      imageSent: false,
      channel: null,
    };
  }
  return { success: true, error: null, imageSent, channel };
}

function cleanSupabaseSlipUrl(value: string): string {
  let direct = value.trim();
  if (!direct) return "";
  if (direct.includes("/api/line/slip-image")) {
    try {
      const parsed = new URL(direct, "https://placeholder.local");
      direct = decodeURIComponent(parsed.searchParams.get("url")?.trim() ?? "");
    } catch {
      return "";
    }
  }
  if (!direct.startsWith("https://") || direct.includes("/api/line/slip-image")) return "";
  const path = direct.split("?")[0] ?? "";
  if (!/\.(jpe?g|png)$/i.test(path)) return "";
  return direct;
}

async function sendWithImageFallback(
  send: (messages: Array<Record<string, string>>) => Promise<{
    ok: boolean;
    error: string | null;
    errorMessage: string | null;
    errorDetails: string | null;
  }>,
  withImage: Array<Record<string, string>>,
  textOnly: Array<Record<string, string>>,
  jpegSlipUrl: string,
) {
  let result = await send(withImage);
  if (result.ok) return { ...result, imageSent: Boolean(jpegSlipUrl) };
  if (!jpegSlipUrl) return { ...result, imageSent: false };
  const textResult = await send(textOnly);
  if (!textResult.ok) return { ...textResult, imageSent: false };
  const imageResult = await send([
    { type: "image", originalContentUrl: jpegSlipUrl, previewImageUrl: jpegSlipUrl },
  ]);
  if (imageResult.ok) return { ...imageResult, imageSent: true };
  return { ...textResult, imageSent: false };
}

function messagingGroupId(value: string | null | undefined): string | null {
  const raw = value?.trim() ?? "";
  if (!raw || /chat\.line\.biz/i.test(raw) || raw.includes("/")) return null;
  if (!/^C[A-Za-z0-9]{10,}$/.test(raw)) return null;
  return raw;
}

async function readContactLineFields(contactId: string): Promise<{
  lineTargetId: string | null;
  lineOaChatUrl: string | null;
}> {
  const supabase = createClient() as unknown as {
    from: (table: "contacts") => {
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          maybeSingle: () => Promise<{
            data: {
              line_target_id?: string | null;
              line_oa_chat_url?: string | null;
            } | null;
            error: { message?: string } | null;
          }>;
        };
      };
    };
  };
  const full = await supabase
    .from("contacts")
    .select("line_oa_chat_url, line_target_id")
    .eq("id", contactId)
    .maybeSingle();
  if (!full.error) {
    return {
      lineTargetId: messagingGroupId(full.data?.line_target_id),
      lineOaChatUrl: full.data?.line_oa_chat_url?.trim() || null,
    };
  }
  console.error("[readContactLineFields]", full.error.message);
  const legacy = await supabase
    .from("contacts")
    .select("line_target_id")
    .eq("id", contactId)
    .maybeSingle();
  return {
    lineTargetId: messagingGroupId(legacy.data?.line_target_id),
    lineOaChatUrl: null,
  };
}

async function loadFreshReplyToken(groupId: string): Promise<string | null> {
  const supabase = createClient() as unknown as {
    from: (table: "line_known_groups") => {
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          maybeSingle: () => Promise<{
            data: { last_reply_token?: string | null; reply_token_expires_at?: string | null } | null;
            error: { message?: string } | null;
          }>;
        };
      };
    };
  };
  const row = await supabase
    .from("line_known_groups")
    .select("last_reply_token, reply_token_expires_at")
    .eq("group_id", groupId)
    .maybeSingle();
  if (row.error || !row.data?.last_reply_token || !row.data.reply_token_expires_at) return null;
  if (new Date(row.data.reply_token_expires_at).getTime() <= Date.now()) return null;
  return row.data.last_reply_token;
}

async function clearReplyToken(groupId: string) {
  const supabase = createClient() as unknown as {
    from: (table: "line_known_groups") => {
      update: (values: { last_reply_token: null; reply_token_expires_at: null; updated_at: string }) => {
        eq: (column: string, value: string) => Promise<{ error: { message?: string } | null }>;
      };
    };
  };
  await supabase
    .from("line_known_groups")
    .update({
      last_reply_token: null,
      reply_token_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("group_id", groupId);
}

export async function diagnoseAndSyncLineWebhookAction(currentOrigin: string) {
  const owner = await requireSessionUserId();
  const origin = currentOrigin.trim();
  const empty = emptyLineDiagnosis(origin);
  if (!owner.ok) return { ...empty, success: false, error: owner.error };

  const token = await loadLineChannelAccessToken();
  const [groups, recentEvents] = await Promise.all([loadKnownGroups(), loadRecentWebhookEvents()]);
  if (!token) {
    return {
      ...empty,
      success: false,
      error: "ไม่พบ LINE Channel Access Token ในระบบ",
      groups,
      recentEvents,
    };
  }

  const auth = { Authorization: `Bearer ${token}` };
  const [endpointRes, testRes, quotaRes, usageRes] = await Promise.all([
    fetch("https://api.line.me/v2/bot/channel/webhook/endpoint", { headers: auth, cache: "no-store" }),
    fetch("https://api.line.me/v2/bot/channel/webhook/test", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
    }),
    fetch("https://api.line.me/v2/bot/message/quota", { headers: auth, cache: "no-store" }),
    fetch("https://api.line.me/v2/bot/message/quota/consumption", { headers: auth, cache: "no-store" }),
  ]);
  const [endpointBody, testBody, quotaBody, usageBody] = await Promise.all([
    readLineJson(endpointRes),
    readLineJson(testRes),
    readLineJson(quotaRes),
    readLineJson(usageRes),
  ]);

  const endpoint = textField(endpointBody.body, "endpoint");
  const active = typeof endpointBody.body.active === "boolean" ? endpointBody.body.active : null;
  const testStatus = numberField(testBody.body, "statusCode");
  const quotaType = textField(quotaBody.body, "type");
  const quotaLimit = quotaType === "limited" ? numberField(quotaBody.body, "value") : quotaType === "none" ? null : numberField(quotaBody.body, "value");

  return {
    success: endpointBody.ok || testBody.ok || quotaBody.ok,
    error: null,
    currentOrigin: origin,
    webhook: {
      endpoint,
      active,
      httpStatus: endpointBody.status,
      error: endpointBody.ok ? null : lineApiError(endpointBody),
    },
    test: {
      success: typeof testBody.body.success === "boolean" ? testBody.body.success : null,
      statusCode: testStatus,
      reason: textField(testBody.body, "reason"),
      detail: textField(testBody.body, "detail"),
      httpStatus: testBody.status,
      error: testBody.ok ? null : lineApiError(testBody),
    },
    quota: {
      used: numberField(usageBody.body, "totalUsage"),
      limit: quotaLimit,
      error: quotaBody.ok && usageBody.ok ? null : lineApiError(quotaBody.ok ? usageBody : quotaBody),
    },
    groups,
    recentEvents,
  };
}

export async function registerAndVerifyLineWebhookUrlAction(webhookUrl: string) {
  const owner = await requireSessionUserId();
  const groups = owner.ok ? await loadGroupsForDropdown() : [];
  if (!owner.ok) {
    return {
      success: false,
      error: owner.error,
      statusCode: null as number | null,
      active: null as boolean | null,
      endpoint: null as string | null,
      reason: null as string | null,
      detail: null as string | null,
      saved: false,
      groups,
    };
  }

  const endpoint = publicWebhookUrl(webhookUrl);
  if (!endpoint) {
    return {
      success: false,
      error: "กดปุ่มนี้จากเว็บที่ Deploy แล้ว (https://.../api/line/webhook) LINE ไม่รับ localhost",
      statusCode: null,
      active: null,
      endpoint: null,
      reason: null,
      detail: null,
      saved: false,
      groups,
    };
  }

  const settings = await loadLineSettings();
  const token = settings.line_channel_access_token?.trim() || (await loadLineChannelAccessToken());
  if (!token) {
    return {
      success: false,
      error: "ไม่พบ LINE Channel Access Token ในระบบ",
      statusCode: null,
      active: null,
      endpoint,
      reason: null,
      detail: null,
      saved: false,
      groups,
    };
  }

  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const savedEndpoint = await readLineJson(
    await fetch("https://api.line.me/v2/bot/channel/webhook/endpoint", {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ endpoint }),
      cache: "no-store",
    }),
  );
  if (!savedEndpoint.ok) {
    return {
      success: false,
      error: lineApiError(savedEndpoint),
      statusCode: null,
      active: null,
      endpoint,
      reason: null,
      detail: null,
      saved: false,
      groups,
    };
  }

  const tested = await readLineJson(
    await fetch("https://api.line.me/v2/bot/channel/webhook/test", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ endpoint }),
      cache: "no-store",
    }),
  );
  const statusCode = numberField(tested.body, "statusCode");
  const reason = textField(tested.body, "reason");
  const detail = textField(tested.body, "detail");
  const current = await readLineJson(
    await fetch("https://api.line.me/v2/bot/channel/webhook/endpoint", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    }),
  );
  const active = typeof current.body.active === "boolean" ? current.body.active : null;
  const verified = tested.ok && statusCode === 200;
  const saved = verified ? await saveLineWebhookRegistration(endpoint, new Date().toISOString()) : false;
  const connected = verified && active === true;
  const locked = statusCode === 401 || statusCode === 403;
  return {
    success: connected,
    error: connected
      ? null
      : locked
        ? `อัปเดต Webhook แล้ว แต่ติดล็อก Vercel Preview (HTTP ${statusCode}) — แนะนำให้ปิด Vercel Authentication ในหน้า Settings -> Deployment Protection`
        : !verified
          ? [reason, detail].filter(Boolean).join(" — ") || lineApiError(tested)
          : active === false
            ? "อัปเดตลิงก์ Webhook แล้ว แต่สวิตช์บน LINE OA ยังปิดอยู่ (ตั้งค่าการตอบกลับ -> เปิดสวิตช์ Webhook)"
            : saved
              ? null
              : "LINE รับลิงก์แล้ว แต่บันทึก system_settings ไม่สำเร็จ",
    statusCode,
    active,
    endpoint: textField(current.body, "endpoint") ?? endpoint,
    reason,
    detail,
    saved,
    groups,
  };
}

async function loadGroupsForDropdown(): Promise<KnownGroup[]> {
  const [stored, summary] = await Promise.all([loadKnownGroups(), loadWebhookSummaryGroups()]);
  if (summary.length === 0) return stored;
  const byId = new Map(stored.map((group) => [group.group_id, group]));
  const merged = summary.map((group) => {
    const known = byId.get(group.group_id);
    byId.delete(group.group_id);
    return {
      group_id: group.group_id,
      group_name: group.group_name || known?.group_name || null,
      picture_url: known?.picture_url ?? null,
      linkedContactId: group.linkedContactId || known?.linkedContactId || null,
      replyReady: known?.replyReady ?? false,
      replyExpiresAt: known?.replyExpiresAt ?? null,
    };
  });
  return [...merged, ...byId.values()];
}

async function loadWebhookSummaryGroups(): Promise<KnownGroup[]> {
  const supabase = createClient() as unknown as {
    rpc: (fn: "get_line_webhook_status_summary") => Promise<{
      data: unknown;
      error: { message?: string; code?: string } | null;
    }>;
  };
  const listed = await supabase.rpc("get_line_webhook_status_summary");
  if (listed.error) {
    console.error("[get_line_webhook_status_summary]", listed.error.message);
    return [];
  }
  const body = asJsonRecord(listed.data);
  const rows = body?.known_groups;
  if (!Array.isArray(rows)) return [];
  const groups: KnownGroup[] = [];
  for (const row of rows) {
    const item = asJsonRecord(row);
    const groupId = typeof item?.group_id === "string" ? item.group_id.trim() : "";
    if (!groupId) continue;
    const groupName = typeof item?.group_name === "string" ? item.group_name.trim() : "";
    const companyName = typeof item?.linked_company_name === "string" ? item.linked_company_name.trim() : "";
    const linkedContactId = typeof item?.linked_contact_id === "string" ? item.linked_contact_id : null;
    groups.push({
      group_id: groupId,
      group_name: groupName || companyName || null,
      picture_url: null,
      linkedContactId,
      replyReady: false,
      replyExpiresAt: null,
    });
  }
  return groups;
}

function asJsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return asJsonRecord(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return null;
}

function publicWebhookUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") return null;
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return null;
    if (url.pathname !== "/api/line/webhook" || url.search || url.hash) return null;
    return `${url.origin}/api/line/webhook`;
  } catch {
    return null;
  }
}

async function saveLineWebhookRegistration(webhookUrl: string, verifiedAt: string): Promise<boolean> {
  const supabase = createClient() as unknown as {
    from: (table: "system_settings") => {
      update: (values: { line_webhook_url: string; line_webhook_last_verified_at: string }) => {
        eq: (column: string, value: number) => Promise<{ error: { message?: string } | null }>;
      };
    };
  };
  const saved = await supabase
    .from("system_settings")
    .update({ line_webhook_url: webhookUrl, line_webhook_last_verified_at: verifiedAt })
    .eq("id", 1);
  if (saved.error) console.error("[registerLineWebhook]", saved.error.message);
  return !saved.error;
}

function emptyLineDiagnosis(currentOrigin: string) {
  return {
    success: false,
    error: null as string | null,
    currentOrigin,
    webhook: { endpoint: null as string | null, active: null as boolean | null, httpStatus: null as number | null, error: null as string | null },
    test: {
      success: null as boolean | null,
      statusCode: null as number | null,
      reason: null as string | null,
      detail: null as string | null,
      httpStatus: null as number | null,
      error: null as string | null,
    },
    quota: { used: null as number | null, limit: null as number | null, error: null as string | null },
    groups: [] as KnownGroup[],
    recentEvents: [] as RecentLineEvent[],
  };
}

type RecentLineEvent = {
  event_type: string;
  source_type: string | null;
  source_group_id: string | null;
  message_text: string | null;
  received_at: string;
};

async function loadKnownGroups(): Promise<KnownGroup[]> {
  const listed = await listLineKnownGroupsAction();
  return listed.groups;
}

async function loadRecentWebhookEvents(): Promise<RecentLineEvent[]> {
  const supabase = createClient() as unknown as {
    from: (table: "line_webhook_events_log") => {
      select: (columns: string) => {
        order: (
          column: string,
          options: { ascending: boolean },
        ) => {
          limit: (count: number) => Promise<{
            data: RecentLineEvent[] | null;
            error: { message?: string } | null;
          }>;
        };
      };
    };
  };
  const listed = await supabase
    .from("line_webhook_events_log")
    .select("event_type, source_type, source_group_id, message_text, received_at")
    .order("received_at", { ascending: false })
    .limit(3);
  if (listed.error) return [];
  return listed.data ?? [];
}

async function readLineJson(response: Response): Promise<{
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}> {
  const raw = await response.text();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ok: response.ok, status: response.status, body: parsed as Record<string, unknown> };
    }
  } catch {
    // ข้อความที่ไม่ใช่ JSON
  }
  return { ok: response.ok, status: response.status, body: { message: raw.slice(0, 300) } };
}

function textField(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberField(body: Record<string, unknown>, key: string): number | null {
  const value = body[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function lineApiError(result: { status: number; body: Record<string, unknown> }): string {
  return textField(result.body, "message") ?? textField(result.body, "error") ?? `LINE ตอบกลับ HTTP ${result.status}`;
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
