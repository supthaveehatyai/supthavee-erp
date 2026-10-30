import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server-admin";
import {
  fetchLineGroupSummary,
  lineSignatureValid,
  loadLineChannelAccessToken,
  loadLineChannelSecret,
} from "@/lib/line/line-oa";

export const dynamic = "force-dynamic";

type LineWebhookEvent = {
  type?: string;
  source?: { type?: string; groupId?: string };
  message?: { type?: string; text?: string };
  timestamp?: number;
};

type GroupRow = {
  group_id: string;
  group_name: string | null;
  picture_url: string | null;
  last_message_preview: string | null;
  last_active_at: string;
};

export async function GET() {
  return NextResponse.json(
    { status: "ok", message: "Supthavee LINE OA Webhook Active" },
    { status: 200 },
  );
}

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    const secret = await loadLineChannelSecret();
    const signature = request.headers.get("x-line-signature");
    const trusted = Boolean(secret && lineSignatureValid(raw, signature, secret));
    if (trusted && raw) {
      const body = JSON.parse(raw) as { events?: LineWebhookEvent[] };
      await rememberLineGroups(body.events ?? []);
    }
  } catch {
    // LINE Verify ต้องได้ 200 เสมอ
  }
  return NextResponse.json({ status: "ok" }, { status: 200 });
}

async function rememberLineGroups(events: LineWebhookEvent[]) {
  const token = await loadLineChannelAccessToken();
  if (!token) return;
  const supabase = createClient() as unknown as {
    from: (table: "line_known_groups") => {
      upsert: (
        row: GroupRow,
        options: { onConflict: string },
      ) => Promise<{ error: { message?: string } | null }>;
    };
  };

  for (const event of events) {
    if (event.source?.type !== "group" || !event.source.groupId) continue;
    const groupId = event.source.groupId;
    const summary = await fetchLineGroupSummary(groupId, token);
    const preview =
      event.message?.type === "text"
        ? (event.message.text ?? "").trim().slice(0, 180)
        : event.message?.type
          ? `[${event.message.type}]`
          : event.type ?? null;
    await supabase.from("line_known_groups").upsert(
      {
        group_id: groupId,
        group_name: summary.groupName,
        picture_url: summary.pictureUrl,
        last_message_preview: preview,
        last_active_at: new Date(event.timestamp ?? Date.now()).toISOString(),
      },
      { onConflict: "group_id" },
    );
  }
}
