/**
 * POST /api/backup/restore
 * mode=preview อ่านไฟล์แล้วคืนจำนวนแถว
 * mode=execute กู้คืนเฉพาะตารางที่เลือก หลังตรวจ PIN ของ Admin
 * ส่งความคืบหน้าเป็น NDJSON ทีละตาราง
 */

import { gunzipSync } from "node:zlib";
import { NextRequest, NextResponse } from "next/server";
import { isAdminRoleCode } from "@/lib/auth/module-access";
import { parseBackupText, type BackupRow, type NormalizedBackup } from "@/lib/backup/backup-file";
import {
  orderTablesForRestore,
  resolveUpsertOptions,
  sortRowsForRestore,
} from "@/lib/backup/restore-rows";
import { isMissingSchemaTableError } from "@/lib/backup/schema-cache";
import { createClient as createSupabaseAdmin } from "@/lib/supabase/server-admin";
import { createSupabaseSSRClient } from "@/lib/supabase/ssr-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UPSERT_BATCH = 500;
const PIN_RE = /^\d{6}$/;
const TABLE_NAME_RE = /^[a-z][a-z0-9_]*$/;

type SkippedTable = {
  table: string;
  reason: string;
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

  return {
    ok: true as const,
    userId: user.id,
    pinCode: profile.pin_code,
    supabaseAdmin,
  };
}

function decodeUpload(bytes: Buffer, filename: string): NormalizedBackup {
  const text = filename.toLowerCase().endsWith(".gz")
    ? gunzipSync(bytes).toString("utf8")
    : bytes.toString("utf8");
  return parseBackupText(text);
}

function presentTables(payload: NormalizedBackup): { table: string; rows: number }[] {
  const withRows = payload.tables
    .filter((table) => Array.isArray(payload.data[table]))
    .map((table) => ({ table, rows: payload.data[table].length }));
  const orderedNames = orderTablesForRestore(withRows.map((item) => item.table));
  return orderedNames.map(
    (table) => withRows.find((item) => item.table === table) ?? { table, rows: 0 },
  );
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
    if (
      !uploaded ||
      typeof uploaded === "string" ||
      typeof uploaded.arrayBuffer !== "function"
    ) {
      return NextResponse.json({ error: "ต้องแนบไฟล์ .json หรือ .json.gz" }, { status: 400 });
    }

    const filename =
      "name" in uploaded && typeof uploaded.name === "string" && uploaded.name
        ? uploaded.name
        : "backup.json";
    const lower = filename.toLowerCase();
    if (!lower.endsWith(".json") && !lower.endsWith(".json.gz") && !lower.endsWith(".gz")) {
      return NextResponse.json(
        { error: "รองรับเฉพาะไฟล์ .json หรือ .json.gz" },
        { status: 400 },
      );
    }

    let payload: NormalizedBackup;
    try {
      payload = decodeUpload(Buffer.from(await uploaded.arrayBuffer()), filename);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "อ่านไฟล์ Backup ไม่ได้";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const listed = presentTables(payload);
    const populated = listed.filter((item) => item.rows > 0);
    if (mode === "preview") {
      return NextResponse.json({
        filename,
        exportedAt: payload.exportedAt,
        module: payload.module,
        tables: listed,
        tableCount: populated.length,
        totalRows: populated.reduce((sum, item) => sum + item.rows, 0),
        rowCounts: payload.rowCounts,
        skipped_tables: payload.skippedTables,
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
    const selected = orderTablesForRestore(
      requested.filter(
        (table): table is string =>
          typeof table === "string" && present.has(table) && TABLE_NAME_RE.test(table),
      ),
    );
    if (selected.length === 0) {
      return NextResponse.json({ error: "ยังไม่ได้เลือกตารางที่จะกู้คืน" }, { status: 400 });
    }

    const dynamic = auth.supabaseAdmin as unknown as {
      from: (table: string) => {
        upsert: (
          values: BackupRow[],
          options?: { onConflict?: string; ignoreDuplicates?: boolean },
        ) => PromiseLike<{ error: { message: string; code?: string } | null }>;
      };
    };

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: unknown) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        };
        const restored: { table: string; rows: number }[] = [];
        const skippedTables: SkippedTable[] = [];

        try {
          for (let index = 0; index < selected.length; index += 1) {
            const table = selected[index];
            send({
              type: "progress",
              table,
              index: index + 1,
              total: selected.length,
            });

            const rows = sortRowsForRestore(
              table,
              Array.isArray(payload.data[table]) ? payload.data[table] : [],
            );
            if (rows.length === 0) {
              restored.push({ table, rows: 0 });
              continue;
            }

            const options = resolveUpsertOptions(table, rows[0]);
            let skipped = false;
            for (let offset = 0; offset < rows.length; offset += UPSERT_BATCH) {
              const batch = rows.slice(offset, offset + UPSERT_BATCH);
              const { error } = options.onConflict
                ? await dynamic.from(table).upsert(batch, options)
                : await dynamic.from(table).upsert(batch);
              if (error && isMissingSchemaTableError(error)) {
                skippedTables.push({ table, reason: error.message });
                skipped = true;
                break;
              }
              if (error) {
                send({
                  type: "error",
                  error: `${table}: ${error.message}`,
                  restored,
                  skipped_tables: skippedTables,
                });
                controller.close();
                return;
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
              module: payload.module,
              selectedTables: selected,
              restored,
              skipped_tables: skippedTables,
              timestamp: new Date().toISOString(),
            },
          });
          if (auditError && !isMissingSchemaTableError(auditError)) {
            console.error("Restore audit error:", auditError);
          }

          send({ type: "done", restored, skipped_tables: skippedTables });
          controller.close();
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "กู้คืนข้อมูลไม่สำเร็จ";
          send({ type: "error", error: message });
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    console.error("Backup restore error:", error);
    const message = error instanceof Error ? error.message : "กู้คืนข้อมูลไม่สำเร็จ";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
