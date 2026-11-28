"use client";

import type { FnbStageConfirmation } from "@/types/fnb";

export function findSection(rows: FnbStageConfirmation[], keys: string[]): FnbStageConfirmation | null {
  return rows.find((row) => keys.includes(row.sectionKey)) ?? null;
}

export function hhmm(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date)} น.`;
}

export function UnsavedDraftBar({ sectionNo }: { sectionNo: number }) {
  return (
    <p className="sticky bottom-2 z-10 rounded-lg bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-950 ring-1 ring-amber-300">
      ⚠️ เลือกข้อมูลไว้แล้ว (ยังไม่บันทึกเข้าระบบ) — กดปุ่ม &quot;💾 บันทึกยืนยันหมวดที่ {sectionNo}&quot; เพื่อส่งให้เพื่อนร่วมกะและผู้บริหารเห็น
    </p>
  );
}

export function LockedSectionCard({ row, summary }: { row: FnbStageConfirmation; summary: string }) {
  const overrideName = typeof row.payload.override_by_name === "string" ? row.payload.override_by_name : "";
  const overrideReason = typeof row.payload.override_reason === "string" ? row.payload.override_reason : row.lastEditReason || "";
  return (
    <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-950">
      <p className="font-semibold">{row.sectionTitle}</p>
      <p className="mt-1">{summary}</p>
      {row.photoUrls.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {row.photoUrls.map((url) => (
            <a key={url} href={url} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="h-16 w-16 rounded object-cover" />
            </a>
          ))}
        </div>
      ) : null}
      <p className="mt-2">✅ บันทึกยืนยันแล้วโดย: {row.confirmedByName} · {hhmm(row.confirmedAt)}</p>
      {overrideName ? <p>🛠️ ช่วยเหลือ/แก้ไขโดย: {overrideName} (เหตุผล: {overrideReason})</p> : null}
    </div>
  );
}
