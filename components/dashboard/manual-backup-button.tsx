"use client";

/**
 * ปุ่มสำรอง / กู้คืนบน Executive Dashboard
 * Backup ดาวน์โหลด JSON, Restore ส่งแถวขึ้นเซิร์ฟเวอร์ทีละ 500 แถว
 */

import { useRef, useState } from "react";
import { Database, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  parseBackupText,
  readBackupFileText,
  type BackupRow,
} from "@/lib/backup/backup-file";
import {
  BACKUP_MODULE_KEYS,
  BACKUP_MODULE_LABELS,
  DEFAULT_GOOGLE_DRIVE_BACKUP_DIR,
  tablesForModule,
  type BackupModuleKey,
  type BackupModuleSelection,
} from "@/lib/backup/backup-modules";
import {
  RESTORE_UPSERT_BATCH,
  orderTablesForRestore,
  sortRowsForRestore,
} from "@/lib/backup/restore-rows";
import { formatThaiDate } from "@/lib/utils/date-formatter";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const MODULE_OPTIONS: BackupModuleSelection[] = ["all", ...BACKUP_MODULE_KEYS];

const NAS_CLI = `พาธ Google Drive:
${DEFAULT_GOOGLE_DRIVE_BACKUP_DIR}

PowerShell บนเครื่องที่แมปไดรฟ์ H:
npm run backup:all
npm run backup:module -- --module=master --retention-days=30
npm run backup:storage
npm run backup:storage -- --bucket=product_assets
npm run restore:db -- --file="${DEFAULT_GOOGLE_DRIVE_BACKUP_DIR}\\db\\full\\<file>.json.gz" --module=all --dry-run
npm run restore:db -- --file="${DEFAULT_GOOGLE_DRIVE_BACKUP_DIR}\\db\\modules\\master\\<file>.json.gz" --module=master --confirm-restore`;

type PreviewTable = {
  table: string;
  rows: number;
};

type BackupSummary = {
  filename: string;
  exportedAt: string | null;
  tableCount: number;
  totalRows: number;
};

type RestoreProgress = {
  table: string;
  index: number;
  total: number;
};

type RestoreResult = {
  table: string;
  rows: number;
};

type SkippedTable = {
  table: string;
  reason: string;
};

function populatedNames(tables: PreviewTable[]): string[] {
  return tables.filter((item) => item.rows > 0).map((item) => item.table);
}

export function ManualBackupButton() {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"backup" | "restore">("backup");
  const [moduleName, setModuleName] = useState<BackupModuleSelection>("all");
  const [isDownloading, setIsDownloading] = useState(false);
  const [preview, setPreview] = useState<PreviewTable[] | null>(null);
  const [summary, setSummary] = useState<BackupSummary | null>(null);
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [progress, setProgress] = useState<RestoreProgress | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const rowsRef = useRef<Record<string, BackupRow[]>>({});
  const moduleRef = useRef<string | null>(null);

  async function handleDownload() {
    if (isDownloading) return;
    setIsDownloading(true);
    try {
      const response = await fetch(
        `/api/backup/export?module=${encodeURIComponent(moduleName)}`,
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        const err = payload?.error ?? "ดาวน์โหลด Backup ไม่สำเร็จ";
        toast.error(
          err === "Forbidden"
            ? "Forbidden: ไม่มีสิทธิ์สำรองข้อมูล (ต้องเป็น Admin หรือมีโมดูล settings)"
            : err,
        );
        return;
      }

      const header = response.headers.get("Content-Disposition") ?? "";
      const matched = /filename="([^"]+)"/.exec(header);
      const filename = matched?.[1] ?? `supthavee_backup_${moduleName}.json`;
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      toast.success(`ดาวน์โหลด ${filename} แล้ว`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "ดาวน์โหลด Backup ไม่สำเร็จ";
      toast.error(msg);
    } finally {
      setIsDownloading(false);
    }
  }

  async function handleFile(file: File | null) {
    setPreview(null);
    setSummary(null);
    setSelectedTables([]);
    setConfirmed(false);
    setProgress(null);
    setRestoreError(null);
    rowsRef.current = {};
    moduleRef.current = null;
    if (!file) return;

    setIsPreviewing(true);
    try {
      const payload = parseBackupText(await readBackupFileText(file));
      rowsRef.current = payload.data;
      moduleRef.current = payload.module;
      const tables = orderTablesForRestore(
        Object.keys(payload.data).filter((table) => Array.isArray(payload.data[table])),
      ).map((table) => ({
        table,
        rows: payload.data[table]?.length ?? payload.rowCounts[table] ?? 0,
      }));
      const populated = tables.filter((item) => item.rows > 0);
      setPreview(tables);
      setSelectedTables(populated.map((item) => item.table));
      setSummary({
        filename: file.name,
        exportedAt: payload.exportedAt,
        tableCount: populated.length,
        totalRows: populated.reduce((sum, item) => sum + item.rows, 0),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "อ่านไฟล์ Backup ไม่สำเร็จ";
      toast.error(msg);
    } finally {
      setIsPreviewing(false);
    }
  }

  function selectModule(option: BackupModuleSelection) {
    if (!preview) return;
    const allowed = new Set(tablesForModule(option));
    setSelectedTables(
      populatedNames(preview).filter((table) => option === "all" || allowed.has(table)),
    );
  }

  function toggleTable(table: string) {
    setSelectedTables((current) =>
      current.includes(table)
        ? current.filter((item) => item !== table)
        : [...current, table],
    );
  }

  async function readRestorePayload(response: Response): Promise<{
    error?: string;
    skipped?: boolean;
    reason?: string;
    excludedColumns?: string[];
  } | null> {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text) as {
        error?: string;
        skipped?: boolean;
        reason?: string;
        excludedColumns?: string[];
      };
    } catch {
      return { error: text.slice(0, 300) || `HTTP ${response.status}` };
    }
  }

  function dropExcludedColumns(table: string, columns: string[] | undefined) {
    if (!columns || columns.length === 0) return;
    const rows = rowsRef.current[table];
    if (!rows) return;
    for (const row of rows) {
      for (const column of columns) delete row[column];
    }
  }

  async function handleRestore() {
    if (isRestoring || !preview || !confirmed || selectedTables.length === 0) return;
    const ordered = orderTablesForRestore(selectedTables);
    setIsRestoring(true);
    setRestoreError(null);
    setProgress({ table: ordered[0] ?? "", index: 1, total: ordered.length });

    const restored: RestoreResult[] = [];
    const skipped: SkippedTable[] = [];

    try {
      for (let index = 0; index < ordered.length; index += 1) {
        const table = ordered[index];
        setProgress({ table, index: index + 1, total: ordered.length });
        const rows = sortRowsForRestore(table, rowsRef.current[table] ?? []);
        if (rows.length === 0) {
          restored.push({ table, rows: 0 });
          continue;
        }

        let tableSkipped = false;
        for (let offset = 0; offset < rows.length; offset += RESTORE_UPSERT_BATCH) {
          const batch = rows.slice(offset, offset + RESTORE_UPSERT_BATCH);
          const response = await fetch("/api/backup/restore", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ table, rows: batch }),
          });
          const payload = await readRestorePayload(response);
          if (!response.ok || payload?.error) {
            const raw = payload?.error || `HTTP ${response.status}`;
            const detail =
              raw === "Forbidden" ? "ต้องล็อกอินด้วยสิทธิ์ Admin" : raw;
            const message = detail.startsWith("กู้คืนข้อมูลไม่สำเร็จที่ตาราง")
              ? detail
              : `กู้คืนข้อมูลไม่สำเร็จที่ตาราง ${table}: ${detail}`;
            throw new Error(message);
          }
          dropExcludedColumns(table, payload?.excludedColumns);
          if (payload?.skipped) {
            skipped.push({ table, reason: payload.reason ?? "ไม่มีตารางใน schema" });
            tableSkipped = true;
            break;
          }
        }
        if (!tableSkipped) restored.push({ table, rows: rows.length });
      }

      await fetch("/api/backup/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "audit",
          module: moduleRef.current,
          restored,
          skipped_tables: skipped,
        }),
      });

      toast.success(
        `กู้คืน ${restored.length.toLocaleString("th-TH")} ตารางแล้ว` +
          (skipped.length > 0
            ? ` (ข้าม ${skipped.length.toLocaleString("th-TH")} ตารางที่ไม่มีใน schema)`
            : ""),
      );
      setProgress(null);
      setConfirmed(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "กู้คืนข้อมูลไม่สำเร็จ";
      setRestoreError(msg);
      toast.error(msg);
    } finally {
      setIsRestoring(false);
    }
  }

  const busy = isDownloading || isPreviewing || isRestoring;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="h-10 gap-2"
        onClick={() => setOpen(true)}
      >
        <Database className="size-4" />
        สำรองข้อมูล (Backup)
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[90vh] w-full max-w-2xl flex-col gap-0 overflow-hidden p-0">
          <div className="flex shrink-0 items-start justify-between border-b border-slate-100 px-6 pb-3 pt-5">
            <DialogHeader className="mb-0 pr-8">
              <DialogTitle className="text-lg font-bold text-slate-800">
                สำรองและกู้คืนข้อมูล (Backup & Restore)
              </DialogTitle>
              <DialogDescription className="mt-0.5 text-xs text-slate-500">
                ดาวน์โหลดไฟล์ JSON เพื่อสำรองข้อมูล หรืออัปโหลดไฟล์เพื่อกู้คืนข้อมูลเฉพาะตารางที่ต้องการ
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="shrink-0 border-b border-slate-100 bg-slate-50/50 px-6 pb-3 pt-3">
            <div className="grid grid-cols-2 rounded-xl bg-slate-200/70 p-1">
              <button
                type="button"
                onClick={() => setActiveTab("backup")}
                className={`flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  activeTab === "backup"
                    ? "bg-white text-blue-600 shadow-sm"
                    : "text-slate-600 hover:text-slate-800"
                }`}
              >
                สำรองข้อมูล (Backup)
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("restore")}
                className={`flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  activeTab === "restore"
                    ? "bg-white text-blue-600 shadow-sm"
                    : "text-slate-600 hover:text-slate-800"
                }`}
              >
                กู้คืนข้อมูล (Restore)
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            {activeTab === "backup" ? (
              <div className="space-y-4">
                <fieldset className="space-y-1.5" disabled={busy}>
                  {MODULE_OPTIONS.map((option) => (
                    <label
                      key={option}
                      className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50"
                    >
                      <input
                        type="radio"
                        name="backup-module"
                        checked={moduleName === option}
                        onChange={() => setModuleName(option)}
                      />
                      <span className="font-medium text-slate-800">
                        {BACKUP_MODULE_LABELS[option]}
                      </span>
                      <span className="text-xs text-slate-500">
                        {tablesForModule(option).length.toLocaleString("th-TH")} ตาราง
                      </span>
                    </label>
                  ))}
                </fieldset>
                <details className="text-xs text-slate-500">
                  <summary className="cursor-pointer select-none">
                    คำสั่ง CLI สำหรับนักพัฒนา
                  </summary>
                  <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] leading-snug">
                    {NAS_CLI}
                  </pre>
                </details>
                <Button
                  type="button"
                  className="w-full gap-2"
                  disabled={isDownloading}
                  onClick={handleDownload}
                >
                  {isDownloading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Database className="size-4" />
                  )}
                  {isDownloading ? "กำลังเตรียมไฟล์…" : "ดาวน์โหลดไฟล์ Backup (.json)"}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <label className="flex cursor-pointer flex-col gap-1 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">
                  <span className="inline-flex items-center gap-2 font-medium text-slate-800">
                    <Upload className="size-4" />
                    เลือกไฟล์ .json หรือ .json.gz
                  </span>
                  <input
                    type="file"
                    accept=".json,.gz,application/json,application/gzip"
                    className="text-xs"
                    disabled={busy}
                    onChange={(event) => {
                      void handleFile(event.target.files?.[0] ?? null);
                    }}
                  />
                </label>

                {isPreviewing ? (
                  <p className="inline-flex items-center gap-2 text-xs text-slate-500">
                    <Loader2 className="size-3.5 animate-spin" />
                    กำลังอ่านไฟล์…
                  </p>
                ) : null}

                {summary ? (
                  <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    <p className="font-medium text-slate-800">{summary.filename}</p>
                    <p>
                      สำรองเมื่อ{" "}
                      {summary.exportedAt
                        ? formatThaiDate(summary.exportedAt, "long")
                        : "—"}
                    </p>
                    <p>
                      {summary.tableCount.toLocaleString("th-TH")} ตารางที่มีข้อมูล ·{" "}
                      {summary.totalRows.toLocaleString("th-TH")} แถว
                    </p>
                  </div>
                ) : null}

                {preview ? (
                  <>
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => selectModule("all")}
                      >
                        ทั้งระบบ
                      </Button>
                      {BACKUP_MODULE_KEYS.map((key: BackupModuleKey) => (
                        <Button
                          key={key}
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => selectModule(key)}
                        >
                          {BACKUP_MODULE_LABELS[key]}
                        </Button>
                      ))}
                    </div>
                    <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/60 p-2.5">
                      {preview.map((item) => {
                        const empty = item.rows === 0;
                        return (
                          <label
                            key={item.table}
                            className={`flex items-center gap-2 text-xs ${
                              empty ? "text-slate-400" : "text-slate-700"
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="shrink-0"
                              checked={selectedTables.includes(item.table)}
                              disabled={busy}
                              onChange={() => toggleTable(item.table)}
                            />
                            <span className="font-mono">{item.table}</span>
                            <span className={empty ? "text-slate-300" : "text-slate-400"}>
                              {item.rows.toLocaleString("th-TH")}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </>
                ) : null}

                <label className="flex items-start gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={confirmed}
                    disabled={busy || !preview}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  <span>ยืนยันการเขียนทับข้อมูลเดิมในตารางที่เลือก</span>
                </label>

                {progress ? (
                  <div className="space-y-1">
                    <p className="text-xs text-slate-600">
                      กำลังกู้คืน {progress.table} ({progress.index}/{progress.total})
                    </p>
                    <div className="h-1.5 rounded-full bg-slate-100">
                      <div
                        className="h-1.5 rounded-full bg-blue-600"
                        style={{
                          width: `${
                            progress.total > 0
                              ? Math.round((progress.index / progress.total) * 100)
                              : 0
                          }%`,
                        }}
                      />
                    </div>
                  </div>
                ) : null}

                {restoreError ? (
                  <p className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700">
                    {restoreError}
                  </p>
                ) : null}

                <Button
                  type="button"
                  className="w-full gap-2"
                  disabled={
                    isRestoring || !preview || selectedTables.length === 0 || !confirmed
                  }
                  onClick={handleRestore}
                >
                  {isRestoring ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Database className="size-4" />
                  )}
                  {isRestoring ? "กำลังกู้คืน…" : "เริ่มกู้คืนข้อมูล"}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
