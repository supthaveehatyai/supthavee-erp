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

export async function pushLineMessages(
  token: string,
  targetId: string,
  messages: Array<Record<string, string>>,
): Promise<{ ok: boolean; error: string | null }> {
  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to: targetId, messages }),
  });
  if (response.ok) return { ok: true, error: null };
  const detail = await response.text();
  return { ok: false, error: detail.slice(0, 400) || `LINE ตอบกลับ ${response.status}` };
}
