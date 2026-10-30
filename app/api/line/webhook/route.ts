import { NextResponse } from "next/server";
import { createClient as createSupabaseJsClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server-admin";
import { fetchAllPages } from "@/lib/supabase/fetch-all-pages";
import {
  fetchLineGroupSummary,
  lineSignatureValid,
  loadLineChannelAccessToken,
  loadLineChannelSecret,
} from "@/lib/line/line-oa";

export const dynamic = "force-dynamic";

type LineSource = {
  type?: string;
  groupId?: string;
  userId?: string;
};

type LineWebhookEvent = {
  type?: string;
  replyToken?: string;
  source?: LineSource;
  message?: { type?: string; text?: string };
  timestamp?: number;
};

type LineDb = {
  from: (table: string) => {
    insert: (rows: Record<string, unknown> | Record<string, unknown>[]) => Promise<{
      error: { message?: string } | null;
    }>;
    upsert: (
      row: Record<string, unknown>,
      options: { onConflict: string },
    ) => Promise<{ error: { message?: string } | null }>;
    update: (values: Record<string, unknown>) => {
      eq: (column: string, value: string) => {
        is: (column: string, value: null) => Promise<{ error: { message?: string } | null }>;
      };
    };
    select: (columns: string) => {
      eq: (column: string, value: boolean) => {
        range: (
          from: number,
          to: number,
        ) => Promise<{
          data: { id?: string; company_name?: string | null }[] | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
};

function ok() {
  return NextResponse.json({ status: "ok" }, { status: 200 });
}

export function GET() {
  return ok();
}

export function HEAD() {
  return ok();
}

export function OPTIONS() {
  return ok();
}

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    const secret = await loadLineChannelSecret();
    const signature = request.headers.get("x-line-signature");
    const trusted = Boolean(secret && lineSignatureValid(raw, signature, secret));
    if (!trusted) {
      console.error("[line-webhook] ลายเซ็นไม่ผ่านหรือยังไม่มี Channel Secret — ยังประมวลผลและตอบ 200");
    }
    if (raw) {
      const body = JSON.parse(raw) as { events?: LineWebhookEvent[] };
      if (Array.isArray(body.events)) await recordLineWebhook(body, body.events);
    }
  } catch (error) {
    console.error("[line-webhook]", error);
  }
  return ok();
}

function lineAdmin(): LineDb | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (url && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      return createClient() as unknown as LineDb;
    } catch (error) {
      console.error("[line-webhook] service role", error);
    }
  }
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createSupabaseJsClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }) as unknown as LineDb;
}

async function recordLineWebhook(
  body: { events?: LineWebhookEvent[] },
  events: LineWebhookEvent[],
) {
  const supabase = lineAdmin();
  if (!supabase) return;
  const receivedAt = new Date().toISOString();
  if (events.length === 0) {
    await supabase.from("line_webhook_events_log").insert({
      event_type: "VERIFY_PING",
      source_type: null,
      source_group_id: null,
      source_user_id: null,
      reply_token: null,
      message_text: null,
      raw_payload: body,
      received_at: receivedAt,
    });
    return;
  }

  await supabase.from("line_webhook_events_log").insert(
    events.map((event) => ({
      event_type: String(event.type ?? "unknown").slice(0, 50),
      source_type: event.source?.type?.slice(0, 30) ?? null,
      source_group_id: event.source?.groupId?.slice(0, 100) ?? null,
      source_user_id: event.source?.userId?.slice(0, 100) ?? null,
      reply_token: event.replyToken?.slice(0, 200) ?? null,
      message_text: event.message?.type === "text" ? event.message.text ?? null : null,
      raw_payload: event,
      received_at: receivedAt,
    })),
  );

  const token = await loadLineChannelAccessToken();
  const now = new Date();
  for (const event of events) {
    const groupId = event.source?.groupId?.trim();
    if (!groupId) continue;
    const summary = token
      ? await fetchLineGroupSummary(groupId, token)
      : { groupName: null, pictureUrl: null };
    const groupName = (summary.groupName || groupId).slice(0, 200);
    const preview =
      event.message?.type === "text"
        ? (event.message.text ?? "").trim().slice(0, 180)
        : event.message?.type
          ? `[${event.message.type}]`
          : event.type ?? null;
    const row: Record<string, unknown> = {
      group_id: groupId,
      last_message_preview: preview,
      last_active_at: now.toISOString(),
      updated_at: now.toISOString(),
    };
    if (summary.groupName) row.group_name = summary.groupName.slice(0, 200);
    if (summary.pictureUrl) row.picture_url = summary.pictureUrl;
    if (event.replyToken) {
      row.last_reply_token = event.replyToken.slice(0, 200);
      row.reply_token_expires_at = new Date(now.getTime() + 55000).toISOString();
    }
    const saved = await supabase.from("line_known_groups").upsert(row, { onConflict: "group_id" });
    if (saved.error) console.error("[line-webhook] group", saved.error.message);
    if (!summary.groupName) {
      await supabase
        .from("line_known_groups")
        .update({ group_name: groupName, updated_at: now.toISOString() })
        .eq("group_id", groupId)
        .is("group_name", null);
    }
    if (summary.groupName) {
      const contactId = await matchContactId(supabase, summary.groupName);
      if (contactId) {
        await supabase
          .from("line_known_groups")
          .update({ linked_contact_id: contactId, updated_at: now.toISOString() })
          .eq("group_id", groupId)
          .is("linked_contact_id", null);
      }
    }
  }
}

function compactName(value: string): string {
  return value.toLocaleLowerCase("th").replace(/[\s._\-–—]+/g, "").trim();
}

async function matchContactId(supabase: LineDb, groupName: string): Promise<string | null> {
  const groupKey = compactName(groupName);
  if (groupKey.length < 4) return null;
  const page = await fetchAllPages((from, to) =>
    supabase.from("contacts").select("id, company_name").eq("is_active", true).range(from, to),
  );
  if (page.error || !page.data) return null;
  let best: { id: string; length: number } | null = null;
  for (const contact of page.data) {
    const name = compactName(String(contact.company_name ?? ""));
    const id = String(contact.id ?? "");
    if (!id || name.length < 4) continue;
    const matched = groupKey.includes(name) || name.includes(groupKey);
    if (!matched) continue;
    if (!best || name.length > best.length) best = { id, length: name.length };
  }
  return best?.id ?? null;
}
