"use client";

/**
 * ปุ่มสำรองข้อมูลบน Executive Dashboard
 * เปิด Dialog เลือกโมดูล แล้วดาวน์โหลด JSON จาก GET /api/backup/export
 */

import { useState } from "react";
import { Database, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  BACKUP_MODULE_KEYS,
  BACKUP_MODULE_LABELS,
  DEFAULT_GOOGLE_DRIVE_BACKUP_DIR,
  tablesForModule,
  type BackupModuleSelection,
} from "@/lib/backup/backup-modules";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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

export function ManualBackupButton() {
  const [open, setOpen] = useState(false);
  const [moduleName, setModuleName] = useState<BackupModuleSelection>("all");
  const [isDownloading, setIsDownloading] = useState(false);

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
      const filename =
        matched?.[1] ?? `supthavee_backup_${moduleName}.json`;
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      toast.success(`ดาวน์โหลด ${filename} แล้ว`);
      setOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "ดาวน์โหลด Backup ไม่สำเร็จ";
      toast.error(msg);
    } finally {
      setIsDownloading(false);
    }
  }

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
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>สำรองข้อมูล (Backup)</DialogTitle>
            <DialogDescription>
              ดาวน์โหลด JSON ของทั้งระบบหรือแยกโมดูลลงเครื่องนี้ได้ในคลิกเดียว
              คำสั่ง CLI ด้านล่างเขียนไฟล์ลง {DEFAULT_GOOGLE_DRIVE_BACKUP_DIR}
            </DialogDescription>
          </DialogHeader>

          <fieldset className="space-y-2" disabled={isDownloading}>
            <legend className="mb-2 text-sm font-medium text-slate-700">
              เลือกโมดูล
            </legend>
            {MODULE_OPTIONS.map((option) => (
              <label
                key={option}
                className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 px-3 py-2.5 text-sm hover:bg-slate-50"
              >
                <input
                  type="radio"
                  name="backup-module"
                  className="mt-1"
                  checked={moduleName === option}
                  onChange={() => setModuleName(option)}
                />
                <span>
                  <span className="block font-medium text-slate-800">
                    {BACKUP_MODULE_LABELS[option]}
                  </span>
                  <span className="text-xs text-slate-500">
                    {tablesForModule(option).length.toLocaleString("th-TH")} ตาราง
                    {option === "all" ? " · รวมทุกโมดูล" : ""}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="mt-4 rounded-xl bg-slate-50 p-3">
            <p className="mb-2 text-xs font-semibold text-slate-600">
              คำสั่ง PowerShell สำหรับสำรองฐานข้อมูลและไฟล์แนบลง Google Drive
            </p>
            <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-700">
              {NAS_CLI}
            </pre>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isDownloading}
              onClick={() => setOpen(false)}
            >
              ปิด
            </Button>
            <Button
              type="button"
              className="gap-2"
              disabled={isDownloading}
              onClick={handleDownload}
            >
              {isDownloading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Database className="size-4" />
              )}
              {isDownloading ? "กำลังเตรียมไฟล์…" : "ดาวน์โหลด JSON"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
