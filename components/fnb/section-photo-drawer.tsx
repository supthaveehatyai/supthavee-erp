"use client";

import { useState } from "react";
import { listBrandStagePhotosAction } from "@/lib/actions/fnb-stage";
import { bangkokClock } from "@/lib/fnb/stage-progress";
import type { FnbBrandCode } from "@/types/fnb";

export function SectionPhotoDrawer({ workDate, brand }: { workDate: string; brand: FnbBrandCode }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<{ branchCode: string; sectionTitle: string; staff: string; at: string; urls: string[] }[]>([]);
  const [zoom, setZoom] = useState<string | null>(null);
  return (
    <details className="rounded-xl border bg-white p-4" onToggle={(event) => {
      const next = (event.currentTarget as HTMLDetailsElement).open;
      setOpen(next);
      if (next) void listBrandStagePhotosAction(workDate, brand).then((loaded) => setRows(loaded.data));
    }}>
      <summary className="cursor-pointer font-semibold">📸 กระดานตรวจรูปแกลเลอรีแยกหัวข้อเทียบสาขา</summary>
      {open ? (
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {rows.map((row) => (
            <article key={`${row.branchCode}-${row.sectionTitle}-${row.at}`} className="rounded-lg border p-2 text-sm">
              <p className="font-semibold">{row.branchCode} · {row.sectionTitle}</p>
              <p>{row.staff} · {bangkokClock(row.at)}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {row.urls.map((url) => <button type="button" key={url} onClick={() => setZoom(url)}><img src={url} alt="" className="h-16 w-16 rounded object-cover" /></button>)}
              </div>
            </article>
          ))}
        </div>
      ) : null}
      {zoom ? <button type="button" className="fixed inset-0 z-50 bg-black/80 p-6" onClick={() => setZoom(null)}><img src={zoom} alt="" className="mx-auto max-h-full max-w-full object-contain" /></button> : null}
    </details>
  );
}
