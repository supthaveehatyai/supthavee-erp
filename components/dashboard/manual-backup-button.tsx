"use client";

/**
 * ปุ่มสำรอง / กู้คืนบน Executive Dashboard
 * Backup ดาวน์โหลด JSON, Restore อัปโหลดไฟล์แล้วเลือกตารางก่อนยืนยันด้วย PIN
 */

import { useState } from "react";
import { Database, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { parseBackupText, readBackupFileText } from "@/lib/backup/backup-file";
import {
  BACKUP_MODULE_KEYS,
  BACKUP_MODULE_LABELS,
  DEFAULT_GOOGLE_DRIVE_BACKUP_DIR,
  tablesForModule,
  type BackupModuleKey,
  type BackupModuleSelection,
} from "@/lib/backup/backup-modules";
import { orderTablesForRestore } from "@/lib/backup/restore-rows";
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

export function ManualBackupButton() {
  const [open, setOpen] = useState(false);
  const [moduleName, setModuleName] = useState<BackupModuleSelection>("all");
  const [isDownloading, setIsDownloading] = useState(false);
  const [backupFile, setBackupFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewTable[] | null>(null);
  const [summary, setSummary] = useState<BackupSummary | null>(null);
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [pin, setPin] = useState("");
  const [progress, setProgress] = useState<RestoreProgress | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

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
    setBackupFile(file);
    setPreview(null);
    setSummary(null);
    setSelectedTables([]);
    setProgress(null);
    if (!file) return;

    setIsPreviewing(true);
    try {
      const payload = parseBackupText(await readBackupFileText(file));
      const tables = orderTablesForRestore(
        Object.keys(payload.data).filter((table) => Array.isArray(payload.data[table])),
      ).map((table) => ({
        table,
        rows: payload.data[table]?.length ?? payload.rowCounts[table] ?? 0,
      }));
      const populated = tables.filter((item) => item.rows > 0);
      setPreview(tables);
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
      preview
        .map((item) => item.table)
        .filter((table) => option === "all" || allowed.has(table)),
    );
  }

  function toggleTable(table: string) {
    setSelectedTables((current) =>
      current.includes(table)
        ? current.filter((item) => item !== table)
        : [...current, table],
    );
  }

  async function handleRestore() {
    if (!backupFile || isRestoring || selectedTables.length === 0) return;
    setIsRestoring(true);
    setProgress({ table: "กำลังเริ่ม", index: 0, total: selectedTables.length });
    try {
      const body = new FormData();
      body.set("mode", "execute");
      body.set("file", backupFile);
      body.set("pin", pin);
      body.set("selectedTables", JSON.stringify(selectedTables));
      const response = await fetch("/api/backup/restore", { method: "POST", body });
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || !contentType.includes("ndjson")) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        toast.error(payload?.error ?? "กู้คืนข้อมูลไม่สำเร็จ");
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        toast.error("กู้คืนข้อมูลไม่สำเร็จ");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let restoredCount = 0;
      let skippedCount = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as {
            type?: string;
            table?: string;
            index?: number;
            total?: number;
            error?: string;
            restored?: { table: string }[];
            skipped_tables?: { table: string }[];
          };
          if (event.type === "progress" && event.table) {
            setProgress({
              table: event.table,
              index: event.index ?? 0,
              total: event.total ?? selectedTables.length,
            });
          }
          if (event.type === "error") {
            throw new Error(event.error || "กู้คืนข้อมูลไม่สำเร็จ");
          }
          if (event.type === "done") {
            restoredCount = event.restored?.length ?? 0;
            skippedCount = event.skipped_tables?.length ?? 0;
          }
        }
      }

      toast.success(
        `กู้คืน ${restoredCount.toLocaleString("th-TH")} ตารางแล้ว` +
          (skippedCount > 0
            ? ` (ข้าม ${skippedCount.toLocaleString("th-TH")} ตารางที่ไม่มีใน schema)`
            : ""),
      );
      setPin("");
      setProgress(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "กู้คืนข้อมูลไม่สำเร็จ";
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
        <DialogContent className="max-w-5xl gap-3 p-5">
          <DialogHeader className="mb-2">
            <DialogTitle>สำรองและกู้คืนข้อมูล (Backup & Restore)</DialogTitle>
            <DialogDescription>
              เลือกไฟล์จาก {DEFAULT_GOOGLE_DRIVE_BACKUP_DIR} แล้วกู้คืนเฉพาะตารางที่ต้องการ
            </DialogDescription>
          </DialogHeader>

          <div className="grid items-stretch gap-3 md:grid-cols-2">
            <section className="flex h-full flex-col justify-between space-y-3 rounded-xl border border-slate-200 p-4">
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-800">
                  สำรองข้อมูล (Backup)
                </h3>
                <fieldset className="space-y-1.5" disabled={busy}>
                  {MODULE_OPTIONS.map((option) => (
                    <label
                      key={option}
                      className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm hover:bg-slate-50"
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
                <pre className="whitespace-pre-wrap font-mono text-[11px] leading-snug text-slate-500">
                  {NAS_CLI}
                </pre>
              </div>
              <Button
                type="button"
                className="mt-3 w-full gap-2"
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
            </section>

            <section className="flex h-full flex-col justify-between space-y-3 rounded-xl border border-slate-200 p-4">
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-800">
                  กู้คืนข้อมูล (Restore)
                </h3>
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
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                      {preview.map((item) => (
                        <label
                          key={item.table}
                          className="flex items-center gap-1.5 text-xs text-slate-700"
                        >
                          <input
                            type="checkbox"
                            checked={selectedTables.includes(item.table)}
                            disabled={busy}
                            onChange={() => toggleTable(item.table)}
                          />
                          <span className="truncate font-mono">{item.table}</span>
                          <span className="text-slate-400">
                            {item.rows.toLocaleString("th-TH")}
                          </span>
                        </label>
                      ))}
                    </div>
                  </>
                ) : null}

                <label className="block text-sm">
                  <span className="mb-1 block text-xs font-medium text-slate-700">
                    รหัส PIN 6 หลักของ Admin
                  </span>
                  <input
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={6}
                    value={pin}
                    disabled={busy}
                    onChange={(event) =>
                      setPin(event.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    className="h-9 w-36 rounded-lg border border-slate-200 px-3 font-mono tracking-[0.3em]"
                  />
                </label>

                {progress ? (
                  <div className="space-y-1">
                    <p className="text-xs text-slate-600">
                      กำลังกู้คืน {progress.table} ({progress.index}/
                      {progress.total})
                    </p>
                    <div className="h-1.5 rounded-full bg-slate-100">
                      <div
                        className="h-1.5 rounded-full bg-blue-600"
                        style={{
                          width: `${progress.total > 0 ? Math.round((progress.index / progress.total) * 100) : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
              <Button
                type="button"
                className="mt-3 w-full gap-2"
                disabled={
                  isRestoring ||
                  !backupFile ||
                  !preview ||
                  selectedTables.length === 0 ||
                  pin.length !== 6
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
            </section>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
