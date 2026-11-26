"use client";

import { useEffect, useState } from "react";
import { getClosingWipContextAction } from "@/lib/actions/fnb-wip";
import type { FnbClosingWipContext } from "@/types/fnb";

export function ClosingWipBanner({ branch, workDate }: { branch: string; workDate: string }) {
  const [context, setContext] = useState<FnbClosingWipContext | null>(null);
  useEffect(() => {
    void getClosingWipContextAction(branch, workDate).then((loaded) => setContext(loaded.data));
  }, [branch, workDate]);
  if (!context) return null;
  return (
    <div className="space-y-2">
      {context.brews.map((row) => (
        <p key={row.code} className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white">
          {row.code} ต้มรวมวันนี้ {row.usable.toFixed(0)} ml [เต็มหม้อ {row.full_qty.toFixed(0)} + ครึ่งหม้อ {row.half_qty.toFixed(0)} | ตัดสต็อก {row.packs.toFixed(0)} ถุงเต็ม {row.cost.toFixed(2)}฿]
        </p>
      ))}
      {context.expired.length > 0 ? (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900">
          <p className="font-semibold">ภาชนะหลายวันครบอายุ ต้องเคลียร์ก่อนปิดร้าน</p>
          {context.expired.map((row) => <p key={row.id}>{row.item_label} · {row.sticker_label_text}</p>)}
        </div>
      ) : null}
    </div>
  );
}
