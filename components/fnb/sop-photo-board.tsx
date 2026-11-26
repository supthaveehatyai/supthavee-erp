"use client";

import { useState } from "react";
import { listSopPhotoBoardAction, listSopTemplatesAction } from "@/lib/actions/fnb-sop";
import type { FnbSopTemplate } from "@/types/fnb";

export function SopPhotoBoard({ workDate }: { workDate: string }) {
  const [templates, setTemplates] = useState<FnbSopTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [rows, setRows] = useState<{ branch_code: string; staff: string; at: string; urls: string[] }[]>([]);
  const [zoom, setZoom] = useState<string | null>(null);

  return (
    <section className="space-y-3 rounded-xl border bg-white p-4">
      <h2 className="font-semibold">📸 กระดานตรวจรูป SOP แยกหัวข้อเทียบ 5 สาขา</h2>
      <button type="button" className="text-sm text-red-700" onClick={() => void listSopTemplatesAction().then((listed) => setTemplates(listed.data.filter((row) => row.is_active)))}>โหลดหัวข้อ</button>
      <select className="h-10 w-full rounded-md border px-3 text-sm" value={templateId} onChange={(event) => {
        const id = event.target.value;
        setTemplateId(id);
        void listSopPhotoBoardAction(id, workDate).then((listed) => setRows(listed.data));
      }}>
        <option value="">เลือกหัวข้อ เช่น ห้องน้ำ / บ่อดักไขมัน / เช็คช็อตกาแฟ</option>
        {templates.map((row) => <option key={row.id} value={row.id}>{row.title_th}</option>)}
      </select>
      <div className="grid gap-3 md:grid-cols-5">
        {rows.map((row) => (
          <article key={`${row.branch_code}-${row.at}`} className="rounded-lg border p-2 text-sm">
            <p className="font-semibold">{row.branch_code}</p>
            <p>{row.staff}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {row.urls.map((url) => <button type="button" key={url} onClick={() => setZoom(url)}><img src={url} alt="" className="h-20 w-20 rounded object-cover" /></button>)}
            </div>
          </article>
        ))}
      </div>
      {zoom ? <button type="button" className="fixed inset-0 z-50 bg-black/80 p-6" onClick={() => setZoom(null)}><img src={zoom} alt="" className="mx-auto max-h-full max-w-full object-contain" /></button> : null}
    </section>
  );
}
