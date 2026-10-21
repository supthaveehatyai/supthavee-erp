/**
 * POST /api/backup/restore
 * รับแถวทีละชุด (สูงสุด 500) ของหนึ่งตาราง แล้ว upsert ด้วย service role
 * ผู้ใช้ต้องเป็น Admin ที่ล็อกอินแล้ว ไม่ตรวจ PIN
 */

import { NextRequest, NextResponse } from "next/server";
import { isAdminRoleCode } from "@/lib/auth/module-access";
import type { BackupRow } from "@/lib/backup/backup-file";
import { tablesForModule } from "@/lib/backup/backup-modules";
import {
  RESTORE_UPSERT_BATCH,
  resolveUpsertOptions,
  sortRowsForRestore,
  upsertChunkWithAutoStrip,
} from "@/lib/backup/restore-rows";
import { isMissingSchemaTableError } from "@/lib/backup/schema-cache";
import { createClient as createSupabaseAdmin } from "@/lib/supabase/server-admin";
import { createSupabaseSSRClient } from "@/lib/supabase/ssr-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TABLE_NAME_RE = /^[a-z][a-z0-9_]*$/;

type ChunkBody = {
  action?: string;
  table?: string;
  rows?: BackupRow[];
  module?: string | null;
  restored?: { table: string; rows: number }[];
  skipped_tables?: { table: string; reason: string }[];
};

function failure(table: string, message: string, status = 500) {
  return NextResponse.json(
    { error: `กู้คืนข้อมูลไม่สำเร็จที่ตาราง ${table}: ${message}` },
    { status },
  );
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
    .select("id, role_code, is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !profile || profile.is_active === false) {
    return { ok: false as const, error: "Forbidden" };
  }
  if (!isAdminRoleCode(profile.role_code)) {
    return { ok: false as const, error: "Forbidden" };
  }

  return { ok: true as const, userId: user.id, supabaseAdmin };
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: ChunkBody;
    try {
      body = (await request.json()) as ChunkBody;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "อ่านคำขอไม่สำเร็จ";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    if (body.action === "audit") {
      const { error: auditError } = await auth.supabaseAdmin.from("audit_logs").insert({
        action: "INSERT",
        table_name: "system",
        record_id: "N/A",
        changed_by: auth.userId,
        new_data: {
          action: "MANUAL_RESTORE_EXECUTED",
          module: body.module ?? null,
          restored: body.restored ?? [],
          skipped_tables: body.skipped_tables ?? [],
          timestamp: new Date().toISOString(),
        },
      });
      if (auditError && !isMissingSchemaTableError(auditError)) {
        console.error("Restore audit error:", auditError);
      }
      return NextResponse.json({ ok: true });
    }

    const table = typeof body.table === "string" ? body.table.trim() : "";
    if (!TABLE_NAME_RE.test(table) || !tablesForModule("all").includes(table)) {
      return NextResponse.json({ error: "ชื่อตารางไม่ถูกต้อง" }, { status: 400 });
    }
    if (!Array.isArray(body.rows)) {
      return failure(table, "rows ต้องเป็นรายการแถว", 400);
    }
    if (body.rows.length > RESTORE_UPSERT_BATCH) {
      return failure(table, `ส่งได้ครั้งละไม่เกิน ${RESTORE_UPSERT_BATCH} แถว`, 400);
    }
    if (body.rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
      return failure(table, "แต่ละแถวต้องเป็นอ็อบเจ็กต์", 400);
    }
    if (body.rows.length === 0) {
      return NextResponse.json({ ok: true, table, rows: 0 });
    }

    const rows = sortRowsForRestore(table, body.rows);
    const options = resolveUpsertOptions(table, rows[0]);
    const dynamic = auth.supabaseAdmin as unknown as {
      from: (name: string) => {
        upsert: (
          values: BackupRow[],
          upsertOptions?: { onConflict?: string; ignoreDuplicates?: boolean },
        ) => PromiseLike<{ error: { message: string; code?: string } | null }>;
      };
    };

    try {
      const result = await upsertChunkWithAutoStrip(table, rows, options, (chunk, upsertOptions) =>
        upsertOptions?.onConflict
          ? dynamic.from(table).upsert(chunk, upsertOptions)
          : dynamic.from(table).upsert(chunk),
      );
      if (result.skipped) {
        return NextResponse.json({
          ok: true,
          table,
          skipped: true,
          reason: result.reason,
          excludedColumns: result.excludedColumns,
        });
      }
      return NextResponse.json({
        ok: true,
        table,
        rows: result.rows,
        excludedColumns: result.excludedColumns,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "กู้คืนข้อมูลไม่สำเร็จ";
      return failure(table, message);
    }
  } catch (error: unknown) {
    console.error("Backup restore error:", error);
    const message = error instanceof Error ? error.message : "กู้คืนข้อมูลไม่สำเร็จ";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
