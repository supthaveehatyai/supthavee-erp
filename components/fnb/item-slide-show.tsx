"use client";

import { useState } from "react";

export function ItemSlideShowPreview(props: { title: string; urls: string[]; captions: string[] }) {
  const [index, setIndex] = useState(0);
  const urls = props.urls.filter(Boolean);
  if (urls.length === 0) return <p className="text-xs text-slate-400">ยังไม่มีรูปตัวอย่าง</p>;
  const current = urls[Math.min(index, urls.length - 1)];
  const caption = props.captions[Math.min(index, urls.length - 1)] || "";
  return (
    <div className="w-36 space-y-1">
      <button type="button" className="block" onClick={() => setIndex((value) => (value + 1) % urls.length)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={current} alt={caption || props.title} className="h-24 w-36 rounded-md border object-cover" />
      </button>
      <p className="text-xs text-slate-600">{caption || "เลื่อนดูรูปตัวอย่างหลายมุมมองสำหรับพนักงานใหม่"}</p>
      {urls.length > 1 ? (
        <div className="flex gap-1">
          <button type="button" className="rounded border px-2 text-xs" onClick={() => setIndex((value) => (value - 1 + urls.length) % urls.length)}>ก่อนหน้า</button>
          <button type="button" className="rounded border px-2 text-xs" onClick={() => setIndex((value) => (value + 1) % urls.length)}>{index + 1}/{urls.length}</button>
        </div>
      ) : null}
    </div>
  );
}
