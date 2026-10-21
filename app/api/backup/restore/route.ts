/**
 * POST /api/backup/restore
 * mode=preview อ่านไฟล์แล้วคืนจำนวนแถว
 * mode=execute กู้คืนเฉพาะตารางที่เลือก หลังตรวจ PIN ของ Admin
 */

import { gunzipSync } from "node:zlib";
import { NextRequest, NextResponse } from "next/server";
import { isAdminRoleCode } from "@/lib/auth/module-access";
import {
  tablesForModule,
  upsertConflictColumn,
} from "@/lib/backup/backup-modules";
import { isMissingSchemaTableError } from "@/lib/backup/schema-cache";
import { createClient as createSupabaseAdmin } from "@/lib/supabase/server-admin";
import { createSupabaseSSRClient } from "@/lib/supabase/ssr-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UPSERT_BATCH = 500;
const PIN_RE = /^\d{6}$/;
const TABLE_NAME_RE = /^[a-z][a-z0-9_]*$/;

type Row = Record<string, unknown>;

type SkippedTable = {
  table: string;
  reason: string;
};

type BackupPayload = {
  module?: string;
  data?: Record<string, unknown>;
};

function pinAsString(value: unknown): string {
  return String(value ?? "").trim();
}

async function requireAdmin() {
  const supabaseAuth = await createSupabaseSSRClient();
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();
  if (!user?.id) return { ok: false as const, error: "Forbidden" };

  const supabaseAdmin = createSupabaseAdmin();
  const { data: profile, error } = await supabaseAdmin
    .from("user_profiles")
    .select("id, role_code, is_active, pin_code")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !profile || profile.is_active === false) {
    return { ok: false as const, error: "Forbidden" };
  }
  if (!isAdminRoleCode(profile.role_code)) {
    return { ok: false as const, error: "Forbidden" };
  }

  return { ok: true as const, userId: user.id, pinCode: profile.pin_code, supabaseAdmin };
}

function readBackupFile(bytes: Buffer, filename: string): BackupPayload {
  const text = filename.toLowerCase().endsWith(".gz")
    ? gunzipSync(bytes).toString("utf8")
    : bytes.toString("utf8");
  const parsed = JSON.parse(text) as BackupPayload;
  if (!parsed || typeof parsed !== "object" || !parsed.data || typeof parsed.data !== "object") {
    throw new Error("ไฟล์ Backup ต้องมีอ็อบเจ็กต์ data");
  }
  return parsed;
}

function tablesInFile(payload: BackupPayload): { table: string; rows: number }[] {
  const data = payload.data ?? {};
  const present = Object.entries(data)
    .filter((entry): entry is [string, Row[]] => Array.isArray(entry[1]))
    .map(([table, rows]) => ({ table, rows: rows.length }));
  const catalog = tablesForModule("all");
  const ordered = catalog
    .map((table) => present.find((item) => item.table === table))
    .filter((item): item is { table: string; rows: number } => Boolean(item));
  const extras = present.filter((item) => !catalog.includes(item.table));
  return [...ordered, ...extras];
}

function orderSelected(selected: string[], present: Set<string>): string[] {
  const catalog = tablesForModule("all");
  const ordered = catalog.filter(
    (table) => selected.includes(table) && present.has(table),
  );
  const extras = selected.filter(
    (table) => present.has(table) && !ordered.includes(table) && TABLE_NAME_RE.test(table),
  );
  return [...ordered, ...extras];
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const form = await request.formData();
    const mode = String(form.get("mode") ?? "").trim();
    const uploaded = form.get("file");
    if (!(uploaded instanceof File)) {
      return NextResponse.json({ error: "ต้องแนบไฟล์ .json หรือ .json.gz" }, { status: 400 });
    }

    const filename = uploaded.name || "backup.json";
    const lower = filename.toLowerCase();
    if (!lower.endsWith(".json") && !lower.endsWith(".json.gz") && !lower.endsWith(".gz")) {
      return NextResponse.json(
        { error: "รองรับเฉพาะไฟล์ .json หรือ .json.gz" },
        { status: 400 },
      );
    }

    let payload: BackupPayload;
    try {
      payload = readBackupFile(Buffer.from(await uploaded.arrayBuffer()), filename);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "อ่านไฟล์ Backup ไม่ได้";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const listed = tablesInFile(payload);
    if (mode === "preview") {
      return NextResponse.json({
        module: typeof payload.module === "string" ? payload.module : null,
        tables: listed,
        rowCounts: Object.fromEntries(listed.map((item) => [item.table, item.rows])),
      });
    }

    if (mode !== "execute") {
      return NextResponse.json(
        { error: "mode ต้องเป็น preview หรือ execute" },
        { status: 400 },
      );
    }

    const pin = pinAsString(form.get("pin"));
    if (!PIN_RE.test(pin) || pin !== pinAsString(auth.pinCode)) {
      return NextResponse.json({ error: "รหัส PIN ไม่ถูกต้อง" }, { status: 403 });
    }

    let requested: unknown;
    try {
      requested = JSON.parse(String(form.get("selectedTables") ?? "[]"));
    } catch {
      return NextResponse.json({ error: "selectedTables ไม่ถูกต้อง" }, { status: 400 });
    }
    if (!Array.isArray(requested) || requested.some((item) => typeof item !== "string")) {
      return NextResponse.json({ error: "selectedTables ต้องเป็นรายชื่อตาราง" }, { status: 400 });
    }

    const present = new Set(listed.map((item) => item.table));
    const selected = orderSelected(requested, present);
    if (selected.length === 0) {
      return NextResponse.json({ error: "ยังไม่ได้เลือกตารางที่จะกู้คืน" }, { status: 400 });
    }

    const data = payload.data ?? {};
    const dynamic = auth.supabaseAdmin as unknown as {
      from: (table: string) => {
        upsert: (
          values: Row[],
          options: { onConflict: string; ignoreDuplicates?: boolean },
        ) => PromiseLike<{ error: { message: string; code?: string } | null }>;
      };
    };

    const restored: { table: string; rows: number }[] = [];
    const skippedTables: SkippedTable[] = [];

    for (const table of selected) {
      const rows = Array.isArray(data[table]) ? (data[table] as Row[]) : [];
      if (rows.length === 0) {
        restored.push({ table, rows: 0 });
        continue;
      }
      const options =
        table === "audit_logs"
          ? { onConflict: "id", ignoreDuplicates: true }
          : { onConflict: upsertConflictColumn(table) };
      let skipped = false;
      for (let index = 0; index < rows.length; index += UPSERT_BATCH) {
        const batch = rows.slice(index, index + UPSERT_BATCH);
        const { error } = await dynamic.from(table).upsert(batch, options);
        if (error && isMissingSchemaTableError(error)) {
          skippedTables.push({ table, reason: error.message });
          skipped = true;
          break;
        }
        if (error) {
          return NextResponse.json(
            { error: `${table}: ${error.message}`, restored, skipped_tables: skippedTables },
            { status: 500 },
          );
        }
      }
      if (!skipped) restored.push({ table, rows: rows.length });
    }

    const { error: auditError } = await auth.supabaseAdmin.from("audit_logs").insert({
      action: "INSERT",
      table_name: "system",
      record_id: "N/A",
      changed_by: auth.userId,
      new_data: {
        action: "MANUAL_RESTORE_EXECUTED",
        module: typeof payload.module === "string" ? payload.module : null,
        selectedTables: selected,
        restored,
        skipped_tables: skippedTables,
        timestamp: new Date().toISOString(),
      },
    });
    if (auditError && !isMissingSchemaTableError(auditError)) {
      console.error("Restore audit error:", auditError);
    }

    return NextResponse.json({
      success: true,
      restored,
      skipped_tables: skippedTables,
    });
  } catch (error: unknown) {
    console.error("Backup restore error:", error);
    const message = error instanceof Error ? error.message : "กู้คืนข้อมูลไม่สำเร็จ";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
