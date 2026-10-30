import { createHmac, timingSafeEqual } from "crypto";
import { createClient } from "@/lib/supabase/server-admin";
import { LINE_OA_ACCOUNT_UID } from "@/lib/line/line-target";

type LineSettings = {
  line_channel_access_token?: string | null;
  line_channel_secret?: string | null;
  line_oa_account_uid?: string | null;
};

type SettingsQuery = {
  from: (table: "system_settings") => {
    select: (columns: string) => {
      limit: (count: number) => {
        single: () => Promise<{ data: LineSettings | null; error: { message?: string } | null }>;
      };
    };
  };
};

export async function loadLineSettings(): Promise<LineSettings> {
  const supabase = createClient() as unknown as SettingsQuery;
  const { data } = await supabase
    .from("system_settings")
    .select("line_channel_access_token, line_channel_secret, line_oa_account_uid")
    .limit(1)
    .single();
  return data ?? {};
}

export async function loadLineChannelAccessToken(): Promise<string | null> {
  const fromEnv = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const settings = await loadLineSettings();
  return settings.line_channel_access_token?.trim() || null;
}

export async function loadLineChannelSecret(): Promise<string | null> {
  const fromEnv = process.env.LINE_CHANNEL_SECRET?.trim();
  if (fromEnv) return fromEnv;
  const settings = await loadLineSettings();
  return settings.line_channel_secret?.trim() || null;
}

export async function loadLineOaAccountUid(): Promise<string> {
  const settings = await loadLineSettings();
  return settings.line_oa_account_uid?.trim() || LINE_OA_ACCOUNT_UID;
}

export function lineSignatureValid(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  const digest = createHmac("sha256", secret).update(rawBody).digest("base64");
  const left = Buffer.from(digest);
  const right = Buffer.from(signature);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function fetchLineGroupSummary(
  groupId: string,
  token: string,
): Promise<{ groupName: string | null; pictureUrl: string | null }> {
  const response = await fetch(`https://api.line.me/v2/bot/group/${encodeURIComponent(groupId)}/summary`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) return { groupName: null, pictureUrl: null };
  const body = (await response.json()) as { groupName?: string; pictureUrl?: string };
  return {
    groupName: body.groupName?.trim() || null,
    pictureUrl: body.pictureUrl?.trim() || null,
  };
}

export async function replyLineMessages(
  token: string,
  replyToken: string,
  messages: Array<Record<string, string>>,
): Promise<{
  ok: boolean;
  error: string | null;
  errorMessage: string | null;
  errorDetails: string | null;
}> {
  return postLineMessages(
    "https://api.line.me/v2/bot/message/reply",
    token,
    { replyToken, messages },
  );
}

export async function pushLineMessages(
  token: string,
  targetId: string,
  messages: Array<Record<string, string>>,
): Promise<{
  ok: boolean;
  error: string | null;
  errorMessage: string | null;
  errorDetails: string | null;
}> {
  return postLineMessages("https://api.line.me/v2/bot/message/push", token, { to: targetId, messages });
}

async function postLineMessages(
  url: string,
  token: string,
  body: Record<string, unknown>,
): Promise<{
  ok: boolean;
  error: string | null;
  errorMessage: string | null;
  errorDetails: string | null;
}> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (response.ok) {
    return { ok: true, error: null, errorMessage: null, errorDetails: null };
  }
  const raw = (await response.text()).slice(0, 1200);
  const parsed = parseLineErrorBody(raw);
  const error =
    [parsed.message, parsed.details ? `รายละเอียด: ${parsed.details}` : ""]
      .filter(Boolean)
      .join("\n") || `LINE ตอบกลับ ${response.status}`;
  return {
    ok: false,
    error,
    errorMessage: parsed.message || `LINE ตอบกลับ ${response.status}`,
    errorDetails: parsed.details,
  };
}

function parseLineErrorBody(raw: string): { message: string; details: string | null } {
  try {
    const parsed = JSON.parse(raw) as { message?: string; details?: unknown };
    const message = parsed.message?.trim() || raw;
    if (parsed.details == null) return { message, details: null };
    const details =
      typeof parsed.details === "string" ? parsed.details : JSON.stringify(parsed.details);
    return { message, details };
  } catch {
    return { message: raw || "ส่งข้อความเข้า LINE ไม่สำเร็จ", details: null };
  }
}
