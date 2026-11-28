import { NextResponse } from "next/server";
import { requireSessionUserId } from "@/lib/auth/current-user";
import { getSuperAdminStatus } from "@/lib/holding/workspace-access";
import { createClient } from "@/lib/supabase/server-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Row = Record<string, unknown>;
type PageError = { message?: string; code?: string } | null;

const SECRET = /password|pin|secret|token|service_role|api_key/i;

const TABLES: { schema: "public" | "holding" | "fnb" | "prop" | "agri"; table: string; maxPages: number }[] = [
  { schema: "public", table: "contacts", maxPages: 10 },
  { schema: "public", table: "products", maxPages: 10 },
  { schema: "public", table: "mst_bank_accounts", maxPages: 2 },
  { schema: "public", table: "documents", maxPages: 8 },
  { schema: "public", table: "expenses", maxPages: 8 },
  { schema: "holding", table: "legal_entities", maxPages: 2 },
  { schema: "holding", table: "business_units", maxPages: 2 },
  { schema: "holding", table: "bank_accounts", maxPages: 2 },
  { schema: "holding", table: "corporate_documents", maxPages: 4 },
  { schema: "holding", table: "backup_logs", maxPages: 4 },
  { schema: "holding", table: "user_workspace_grants", maxPages: 4 },
  { schema: "fnb", table: "branches", maxPages: 1 },
  { schema: "fnb", table: "items", maxPages: 8 },
  { schema: "fnb", table: "prep_bases", maxPages: 1 },
  { schema: "fnb", table: "menus", maxPages: 4 },
  { schema: "fnb", table: "employees", maxPages: 2 },
  { schema: "fnb", table: "storage_locations", maxPages: 2 },
  { schema: "fnb", table: "shift_closings", maxPages: 8 },
  { schema: "fnb", table: "daily_stage_section_confirmations", maxPages: 8 },
  { schema: "fnb", table: "item_write_offs", maxPages: 4 },
  { schema: "fnb", table: "display_chiller_lots", maxPages: 4 },
  { schema: "fnb", table: "goods_receipts", maxPages: 4 },
  { schema: "fnb", table: "accounting_audit_periods", maxPages: 2 },
  { schema: "prop", table: "land_estates", maxPages: 4 },
  { schema: "agri", table: "plantation_zones", maxPages: 2 },
];

const BUCKETS = ["corporate_vault", "hr_private_docs", "payment_qr_codes", "fnb_operations"];

function clean(row: Row): Row {
  const next: Row = {};
  for (const [key, value] of Object.entries(row)) {
    if (!SECRET.test(key)) next[key] = value;
  }
  return next;
}

async function pull(query: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: PageError }>, maxPages: number) {
  const rows: Row[] = [];
  for (let page = 0; page < maxPages; page += 1) {
    const from = page * 1000;
    const loaded = await query(from, from + 999);
    if (loaded.error) return { rows, error: loaded.error.message || "อ่านตารางไม่สำเร็จ", truncated: false };
    const chunk = loaded.data ?? [];
    rows.push(...chunk.map(clean));
    if (chunk.length < 1000) return { rows, error: null, truncated: false };
  }
  return { rows, error: null, truncated: true };
}

export async function GET() {
  const session = await requireSessionUserId();
  if (!session.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const allowed = await getSuperAdminStatus(session.userId);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createClient() as unknown as {
    schema: (name: string) => { from: (table: string) => { select: (columns: string) => { range: (from: number, to: number) => Promise<{ data: Row[] | null; error: PageError }> } } };
    from: (table: string) => { select: (columns: string) => { range: (from: number, to: number) => Promise<{ data: Row[] | null; error: PageError }> } };
    storage: { from: (bucket: string) => { list: (path: string, options: { limit: number; offset: number }) => Promise<{ data: { name: string; id: string | null }[] | null; error: { message?: string } | null }> } };
  };

  const tables: Record<string, Row[]> = {};
  const rowCounts: Record<string, number> = {};
  const skipped: { table: string; reason: string }[] = [];
  const truncated: string[] = [];

  for (const item of TABLES) {
    const key = `${item.schema}.${item.table}`;
    const loaded = await pull((from, to) => {
      const source = item.schema === "public" ? admin.from(item.table) : admin.schema(item.schema).from(item.table);
      return source.select("*").range(from, to);
    }, item.maxPages);
    if (loaded.error) {
      skipped.push({ table: key, reason: loaded.error });
      continue;
    }
    tables[key] = loaded.rows;
    rowCounts[key] = loaded.rows.length;
    if (loaded.truncated) truncated.push(key);
  }

  const manifest: { bucket: string; path: string }[] = [];
  for (const bucket of BUCKETS) {
    let offset = 0;
    for (let page = 0; page < 20; page += 1) {
      const listed = await admin.storage.from(bucket).list("", { limit: 100, offset });
      if (listed.error || !listed.data?.length) break;
      for (const entry of listed.data) manifest.push({ bucket, path: entry.name });
      if (listed.data.length < 100) break;
      offset += 100;
    }
  }

  const now = new Date();
  const fileName = `holding-snapshot-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}.json`;
  const writer = createClient() as unknown as { schema: (name: "holding") => { from: (table: string) => { insert: (row: Row) => Promise<{ error: PageError }> } } };
  await writer.schema("holding").from("backup_logs").insert({
    backup_scope: "HOLDING_ALL_5_SCHEMAS",
    brand_code: "HOLDING",
    period_year: now.getFullYear(),
    period_month: now.getMonth() + 1,
    file_name: fileName,
    included_photos: false,
    row_counts_json: rowCounts,
    triggered_by_user_id: session.userId,
    triggered_by_name: "Super Admin",
    notes: "สำรองอ่านอย่างเดียว 5 สคีมา พร้อมรายการไฟล์",
  });

  return new NextResponse(JSON.stringify({ exportedAt: now.toISOString(), rowCounts, truncated, skipped, tables, manifest }), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
