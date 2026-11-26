import { NextResponse } from "next/server";
import { lineSignatureValid } from "@/lib/line/line-oa";
import { replyHoldingBankQr } from "@/lib/line/bank-qr-reply";
import { isSchemaUnavailable, schemaAdmin } from "@/lib/holding/schema-db";
import type { WorkspaceKey } from "@/types/holding";

export const dynamic = "force-dynamic";

const BANK_COMMAND = /^#(เลขบัญชี|บัญชี|qr)\b/i;
const WORKSPACES = new Set<WorkspaceKey>(["supthavee", "fnb", "agri", "prop", "holding"]);

type ChannelRow = {
  workspace_key?: string | null;
  channel_secret?: string | null;
  channel_access_token?: string | null;
  default_bank_account_id?: string | null;
  is_active?: boolean | null;
};

type LineEvent = {
  type?: string;
  replyToken?: string;
  message?: { type?: string; text?: string };
};

function ok() {
  return NextResponse.json({ status: "ok" }, { status: 200 });
}

export function GET() {
  return ok();
}

export async function POST(
  request: Request,
  context: { params: Promise<{ channel_code: string }> },
) {
  const { channel_code } = await context.params;
  const rawBody = await request.text();
  const admin = schemaAdmin();
  const channel = await admin
    .schema("holding")
    .from("line_channels")
    .select("workspace_key, channel_secret, channel_access_token, default_bank_account_id, is_active")
    .eq("channel_code", channel_code)
    .maybeSingle();

  if (channel.error && isSchemaUnavailable(channel.error)) return ok();
  const row = (channel.data ?? null) as ChannelRow | null;
  if (!row || row.is_active === false) return ok();

  if (row.channel_secret) {
    const valid = lineSignatureValid(rawBody, request.headers.get("x-line-signature"), row.channel_secret);
    if (!valid) return NextResponse.json({ status: "invalid-signature" }, { status: 401 });
  }

  let events: LineEvent[] = [];
  try {
    const body = JSON.parse(rawBody) as { events?: LineEvent[] };
    events = Array.isArray(body.events) ? body.events : [];
  } catch {
    events = [];
  }

  const workspace = WORKSPACES.has(row.workspace_key as WorkspaceKey)
    ? (row.workspace_key as WorkspaceKey)
    : "holding";

  for (const event of events) {
    const text = String(event.message?.text ?? "").trim();
    let replyStatus = "SKIPPED";
    let replyError: string | null = null;
    if (event.type === "message" && event.replyToken && row.channel_access_token && BANK_COMMAND.test(text)) {
      const reply = await replyHoldingBankQr({
        token: row.channel_access_token,
        replyToken: event.replyToken,
        workspaceKey: workspace,
        bankAccountId: row.default_bank_account_id,
      });
      replyStatus = reply.status;
      replyError = reply.error;
    }
    await admin.schema("holding").from("line_webhook_logs").insert({
      channel_code,
      event_type: event.type ?? "unknown",
      reply_status: replyStatus,
      error_message: replyError,
      payload: event,
    });
  }

  return ok();
}
