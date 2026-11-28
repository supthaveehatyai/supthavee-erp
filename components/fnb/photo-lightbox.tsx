"use client";

import { useState } from "react";
import { toast } from "sonner";
import { flagInspectionRetakeAction } from "@/lib/actions/fnb-audit";
import { requestSopRetakeAction } from "@/lib/actions/fnb-sop";
import { bangkokClock } from "@/lib/fnb/stage-progress";
import type { FnbAuditPhoto } from "@/types/fnb";

export function PhotoLightbox({ photos }: { photos: FnbAuditPhoto[] }) {
  const [index, setIndex] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const photo = index == null ? null : photos[index];
  if (photos.length === 0) return <p className="text-sm text-slate-500">ยังไม่มีรูปในช่วงนี้</p>;
  return (
    <>
      <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
        {photos.map((item, photoIndex) => (
          <button key={`${item.url}-${photoIndex}`} type="button" className="overflow-hidden rounded-md border" onClick={() => { setIndex(photoIndex); setZoom(1); }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.url} alt={item.caption} className="h-20 w-full object-cover" />
          </button>
        ))}
      </div>
      {photo && index != null ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setIndex(null)}>
          <div className="max-h-full max-w-5xl space-y-3" onClick={(event) => event.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.url} alt={photo.caption} className="max-h-[70vh] w-full object-contain" style={{ transform: `scale(${zoom})` }} />
            <p className="text-center text-sm text-white">{photo.caption} · {photo.staff || "ไม่ระบุชื่อ"} · {bangkokClock(photo.at)}</p>
            <div className="flex flex-wrap justify-center gap-2">
              <button type="button" className="rounded-md bg-white px-3 py-1 text-sm" onClick={() => setIndex((index + photos.length - 1) % photos.length)}>ก่อนหน้า</button>
              <button type="button" className="rounded-md bg-white px-3 py-1 text-sm" onClick={() => setIndex((index + 1) % photos.length)}>ถัดไป</button>
              <button type="button" className="rounded-md bg-white px-3 py-1 text-sm" onClick={() => setZoom((value) => value === 1 ? 1.8 : 1)}>{zoom === 1 ? "ขยาย" : "ขนาดปกติ"}</button>
              <button type="button" className="rounded-md bg-amber-400 px-3 py-1 text-sm" onClick={() => {
                const task = photo.submissionId
                  ? requestSopRetakeAction(photo.submissionId)
                  : photo.confirmationId
                    ? flagInspectionRetakeAction(photo.confirmationId)
                    : Promise.resolve({ error: "รูปนี้ไม่มีเลขรายการให้สั่งถ่ายซ่อม", data: { ok: false } });
                void task.then((saved) => {
                  if (saved.error || !saved.data.ok) toast.error(saved.error || "สั่งถ่ายซ่อมไม่สำเร็จ");
                  else toast.success("สั่งถ่ายซ่อมแล้ว");
                });
              }}>⚠️ สั่งถ่ายซ่อม</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
