"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { listHoldingBackupLogsAction } from "@/lib/actions/holding-backup";
import { buildStoreZip } from "@/lib/holding/store-zip";
import type { HoldingBackupLogRow } from "@/types/holding";

export function BackupCenter() {
  const [logs, setLogs] = useState<HoldingBackupLogRow[]>([]);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void listHoldingBackupLogsAction().then((loaded) => {
      setLogs(loaded.data.logs);
      setStale(loaded.data.stale);
      if (loaded.error && !loaded.error.includes("NEXT_REDIRECT")) toast.error(loaded.error);
    });
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold tracking-wide text-slate-500">HD</p>
        <h1 className="text-2xl font-bold text-slate-900">💾 สำรองข้อมูลทั้งเครือ (5 Schemas Backup)</h1>
        <p className="text-sm text-slate-500">อ่านอย่างเดียวจาก public, holding, fnb, prop และ agri</p>
      </div>
      <section className="rounded-xl border bg-white p-4">
        <h2 className="font-semibold">สถานะ Cloud Auto-Backup (Supabase Pro Daily DB)</h2>
        <p className="mt-1 text-sm text-slate-600">Supabase Pro สำรองฐานข้อมูลบนคลาวด์ทุกวัน ปุ่มด้านล่างคือชุดที่ดาวน์โหลดออกนอกคลาวด์ไว้เอง</p>
        {stale ? <p className="mt-2 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-950">ยังไม่มีการดาวน์โหลดออกนอกคลาวด์ใน 30 วันที่ผ่านมา</p> : <p className="mt-2 text-sm text-emerald-800">มีการดาวน์โหลดออกนอกคลาวด์ภายใน 30 วัน</p>}
      </section>
      <button type="button" className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white" disabled={busy} onClick={() => {
        setBusy(true);
        void fetch("/api/holding/backup/snapshot").then(async (response) => {
          if (!response.ok) throw new Error("ดาวน์โหลดไม่สำเร็จ");
          const payload = await response.json() as { rowCounts?: Record<string, number>; manifest?: { bucket: string; path: string }[]; tables?: unknown };
          const XLSX = await import("xlsx");
          const book = XLSX.utils.book_new();
          const counts = Object.entries(payload.rowCounts ?? {}).map(([table, rows]) => ({ table, rows }));
          XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(counts), "row_counts");
          XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(payload.manifest ?? []), "manifest");
          const sheet = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
          const csv = ["bucket,path", ...(payload.manifest ?? []).map((row) => `${row.bucket},${row.path}`)].join("\n");
          const zip = buildStoreZip([
            { name: "snapshot.json", data: new TextEncoder().encode(JSON.stringify(payload)) },
            { name: "storage-manifest.csv", data: new TextEncoder().encode(csv) },
            { name: "summary.xlsx", data: new Uint8Array(sheet) },
          ]);
          const url = URL.createObjectURL(zip);
          const link = document.createElement("a");
          link.href = url;
          link.download = "holding-5-schema-snapshot.zip";
          link.click();
          URL.revokeObjectURL(url);
          toast.success("ดาวน์โหลดชุดสำรองแล้ว");
          const listed = await listHoldingBackupLogsAction();
          setLogs(listed.data.logs);
          setStale(listed.data.stale);
        }).catch((error: Error) => toast.error(error.message)).finally(() => setBusy(false));
      }}>{busy ? "กำลังรวบรวม..." : "⬇️ ดาวน์โหลดฐานข้อมูลสำรองทั้ง 5 ห้องธุรกิจ (Full Snapshot Excel/JSON)"}</button>
      <p className="text-xs text-slate-500">ไฟล์ JSON มีตารางหลักแบบแบ่งหน้าเกิน 1,000 แถว และ Storage Manifest ของ corporate_vault, hr_private_docs, payment_qr_codes, fnb_operations อยู่ในคีย์ manifest พร้อมนำไปวาง Google Drive หรือ SSD</p>
      <section className="overflow-x-auto rounded-xl border bg-white">
        <table className="min-w-full text-left text-sm">
          <thead><tr className="border-b"><th className="px-3 py-2">เวลา</th><th>ขอบเขต</th><th>ไฟล์</th><th>ผู้ทำ</th></tr></thead>
          <tbody>
            {logs.map((row) => (
              <tr key={row.id} className="border-b">
                <td className="px-3 py-2">{row.createdAt.slice(0, 16)}</td>
                <td>{row.backupScope} {row.brandCode}</td>
                <td>{row.fileName}</td>
                <td>{row.triggeredByName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
