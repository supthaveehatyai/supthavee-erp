"use client";

/**
 * ปุ่มสำรอง / กู้คืนบน Executive Dashboard
 * Backup ดาวน์โหลด JSON, Restore อัปโหลดไฟล์แล้วเลือกตารางก่อนยืนยันด้วย PIN
 */

import { useState } from "react";
import { Database, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  BACKUP_MODULE_KEYS,
  BACKUP_MODULE_LABELS,
  DEFAULT_GOOGLE_DRIVE_BACKUP_DIR,
  tablesForModule,
  type BackupModuleKey,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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

export function ManualBackupButton() {
  const [open, setOpen] = useState(false);
  const [moduleName, setModuleName] = useState<BackupModuleSelection>("all");
  const [isDownloading, setIsDownloading] = useState(false);
  const [backupFile, setBackupFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewTable[] | null>(null);
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [pin, setPin] = useState("");
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
    setSelectedTables([]);
    if (!file) return;

    setIsPreviewing(true);
    try {
      const body = new FormData();
      body.set("mode", "preview");
      body.set("file", file);
      const response = await fetch("/api/backup/restore", { method: "POST", body });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        tables?: PreviewTable[];
      } | null;
      if (!response.ok) {
        const err = payload?.error ?? "อ่านไฟล์ Backup ไม่สำเร็จ";
        toast.error(
          err === "Forbidden"
            ? "Forbidden: กู้คืนข้อมูลได้เฉพาะ Admin"
            : err,
        );
        return;
      }
      setPreview(payload?.tables ?? []);
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
    try {
      const body = new FormData();
      body.set("mode", "execute");
      body.set("file", backupFile);
      body.set("pin", pin);
      body.set("selectedTables", JSON.stringify(selectedTables));
      const response = await fetch("/api/backup/restore", { method: "POST", body });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        restored?: { table: string; rows: number }[];
        skipped_tables?: { table: string }[];
      } | null;
      if (!response.ok) {
        toast.error(payload?.error ?? "กู้คืนข้อมูลไม่สำเร็จ");
        return;
      }
      const restoredCount = payload?.restored?.length ?? 0;
      const skippedCount = payload?.skipped_tables?.length ?? 0;
      toast.success(
        `กู้คืน ${restoredCount.toLocaleString("th-TH")} ตารางแล้ว` +
          (skippedCount > 0
            ? ` (ข้าม ${skippedCount.toLocaleString("th-TH")} ตารางที่ไม่มีใน schema)`
            : ""),
      );
      setPin("");
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
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>สำรองและกู้คืนข้อมูล</DialogTitle>
            <DialogDescription>
              ดาวน์โหลด JSON หรือเลือกไฟล์จาก {DEFAULT_GOOGLE_DRIVE_BACKUP_DIR} เพื่อกู้คืนเฉพาะตารางที่ต้องการ
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="backup">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="backup">สำรองข้อมูล (Backup)</TabsTrigger>
              <TabsTrigger value="restore">กู้คืนข้อมูล (Restore)</TabsTrigger>
            </TabsList>

            <TabsContent value="backup">
              <fieldset className="space-y-2" disabled={busy}>
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
            </TabsContent>

            <TabsContent value="restore">
              <div className="space-y-4">
                <label className="flex cursor-pointer flex-col gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm hover:bg-slate-50">
                  <span className="inline-flex items-center gap-2 font-medium text-slate-800">
                    <Upload className="size-4" />
                    เลือกไฟล์ .json หรือ .json.gz
                  </span>
                  <span className="text-xs text-slate-500">
                    เปิดจากเครื่องหรือโฟลเดอร์ {DEFAULT_GOOGLE_DRIVE_BACKUP_DIR}
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
                  <p className="inline-flex items-center gap-2 text-sm text-slate-500">
                    <Loader2 className="size-4 animate-spin" />
                    กำลังอ่านจำนวนแถว…
                  </p>
                ) : null}

                {preview ? (
                  <>
                    <div className="flex flex-wrap gap-2">
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

                    <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-200">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-500">
                          <tr>
                            <th className="px-3 py-2 font-medium">เลือก</th>
                            <th className="px-3 py-2 font-medium">ตาราง</th>
                            <th className="px-3 py-2 text-right font-medium">จำนวนแถว</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.map((item) => (
                            <tr key={item.table} className="border-t border-slate-100">
                              <td className="px-3 py-2">
                                <input
                                  type="checkbox"
                                  checked={selectedTables.includes(item.table)}
                                  disabled={busy}
                                  onChange={() => toggleTable(item.table)}
                                />
                              </td>
                              <td className="px-3 py-2 font-mono text-xs text-slate-800">
                                {item.table}
                              </td>
                              <td className="px-3 py-2 text-right text-slate-600">
                                {item.rows.toLocaleString("th-TH")}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-xs text-slate-500">
                      เลือกเฉพาะตารางที่ต้องการ จะไม่เขียนทับบิลที่พนักงานเพิ่งคีย์ถ้าไม่ได้ติ๊กตารางเอกสาร
                    </p>
                  </>
                ) : null}

                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-slate-700">
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
                    className="h-10 w-40 rounded-lg border border-slate-200 px-3 font-mono tracking-[0.3em]"
                  />
                </label>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  className="gap-2"
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
                  {isRestoring ? "กำลังกู้คืน…" : "กู้คืนตารางที่เลือก"}
                </Button>
              </DialogFooter>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}
