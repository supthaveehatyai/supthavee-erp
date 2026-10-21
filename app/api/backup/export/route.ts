/**
 * GET /api/backup/export?module=all|settings_rbac|master|sales_inventory|finance_audit
 * ดาวน์โหลด JSON ของตารางในโมดูล (Admin หรือสิทธิ์ settings)
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchAllPages } from "@/lib/supabase/fetch-all-pages";
import {
  isBackupModuleSelection,
  tablesForModule,
  type BackupModuleSelection,
} from "@/lib/backup/backup-modules";
import { resolveManualBackupAuth } from "@/lib/backup/manual-backup-auth";
import { createClient as createSupabaseAdmin } from "@/lib/supabase/server-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Row = Record<string, unknown>;

function backupTimestamp(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

async function fetchTable(
  supabase: ReturnType<typeof createSupabaseAdmin>,
  table: string,
): Promise<Row[]> {
  const page = await fetchAllPages<Row>((from, to) => {
    const query = supabase.from(table as "audit_logs").select("*").range(from, to);
    return query as PromiseLike<{
      data: Row[] | null;
      error: { message: string; code?: string } | null;
    }>;
  });
  if (page.error) {
    throw new Error(`${table}: ${page.error.message}`);
  }
  return page.data;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await resolveManualBackupAuth();
    if (!auth.ok) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const moduleName = (request.nextUrl.searchParams.get("module") ?? "").trim();
    if (!moduleName || !isBackupModuleSelection(moduleName)) {
      return NextResponse.json(
        {
          error:
            "module ต้องเป็น all, settings_rbac, master, sales_inventory หรือ finance_audit",
        },
        { status: 400 },
      );
    }

    const selection = moduleName as BackupModuleSelection;
    const tables = tablesForModule(selection);
    const supabaseAdmin = createSupabaseAdmin();
    const data: Record<string, Row[]> = {};
    const rowCounts: Record<string, number> = {};

    for (const table of tables) {
      const rows = await fetchTable(supabaseAdmin, table);
      data[table] = rows;
      rowCounts[table] = rows.length;
    }

    const exportedAt = new Date().toISOString();
    const { error: auditError } = await supabaseAdmin.from("audit_logs").insert({
      action: "INSERT",
      table_name: "system",
      record_id: "N/A",
      changed_by: auth.userId,
      new_data: {
        action: "MANUAL_BACKUP_EXPORT",
        module: selection,
        tables,
        rowCounts,
        timestamp: exportedAt,
      },
    });

    if (auditError) {
      console.error("Audit Log Error:", auditError);
      return NextResponse.json({ error: auditError.message }, { status: 500 });
    }

    const filename = `supthavee_backup_${selection}_${backupTimestamp()}.json`;
    const body = JSON.stringify({
      exportedAt,
      module: selection,
      tables,
      rowCounts,
      data,
    });

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    console.error("Backup export error:", error);
    const message = error instanceof Error ? error.message : "Backup export failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
