"use server";

import { asRows, text } from "@/lib/fnb/rows";
import { schemaAdmin } from "@/lib/holding/schema-db";
import { requireSuperAdmin } from "@/lib/holding/workspace-access";
import type { HoldingActionResult, HoldingBackupLogRow } from "@/types/holding";

export async function listHoldingBackupLogsAction(): Promise<HoldingActionResult<{ logs: HoldingBackupLogRow[]; stale: boolean }>> {
  try {
    await requireSuperAdmin();
    const listed = await schemaAdmin().schema("holding").from("backup_logs").select("id,backup_scope,brand_code,period_year,period_month,file_name,included_photos,row_counts_json,triggered_by_name,notes,created_at").order("created_at", { ascending: false }).limit(40);
    const logs = asRows(listed.data).map((row) => ({
      id: text(row.id),
      backupScope: text(row.backup_scope),
      brandCode: text(row.brand_code),
      periodYear: row.period_year == null ? null : Number(row.period_year),
      periodMonth: row.period_month == null ? null : Number(row.period_month),
      fileName: text(row.file_name),
      includedPhotos: row.included_photos === true,
      rowCounts: row.row_counts_json && typeof row.row_counts_json === "object" ? row.row_counts_json as Record<string, number> : {},
      triggeredByName: text(row.triggered_by_name),
      notes: text(row.notes),
      createdAt: text(row.created_at),
    }));
    const latest = logs.map((row) => new Date(row.createdAt).getTime()).filter((value) => Number.isFinite(value)).sort((left, right) => right - left)[0] ?? 0;
    const stale = !latest || Date.now() - latest > 30 * 24 * 60 * 60 * 1000;
    return { data: { logs, stale }, error: listed.error?.message ?? null, schemaReady: true };
  } catch (error) {
    if (typeof error === "object" && error && "digest" in error && String((error as { digest?: string }).digest).includes("NEXT_REDIRECT")) throw error;
    const message = error instanceof Error ? error.message : "อ่านประวัติสำรองไม่สำเร็จ";
    return { data: { logs: [], stale: true }, error: message, schemaReady: true };
  }
}
