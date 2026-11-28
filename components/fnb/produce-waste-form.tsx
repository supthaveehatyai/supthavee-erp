"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { LiveWatermarkCamera } from "@/components/fnb/live-watermark-camera";
import { FnbQtyInput } from "@/components/fnb/fnb-qty-input";
import { previewProduceWasteAction, saveProduceWasteSummaryAction } from "@/lib/actions/fnb-produce";
import { uploadFnbEvidenceAction } from "@/lib/actions/fnb-sop";
import { listWipBoardAction } from "@/lib/actions/fnb-wip";
import { produceProfile } from "@/lib/utils/fnb-format";
import type { FnbBrandCode } from "@/types/fnb";

export function ProduceWasteForm(props: {
  branch: string;
  workDate: string;
  actorSource: "desktop" | "liff";
  brand: FnbBrandCode;
  staffName: string;
}) {
  const [items, setItems] = useState<{ id: string; short_code: string; name_th: string; piece_uom_label?: string; avg_gross_grams_per_piece?: number; prep_yield_pct?: number }[]>([]);
  const [grams, setGrams] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Record<string, string>>({});
  const [photo, setPhoto] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void listWipBoardAction({ branch_code: props.branch, work_date: props.workDate, actor_source: props.actorSource, brand_lock: props.brand }).then((loaded) => {
      setItems((loaded.data?.items ?? []).filter((item) => item.is_catch_weight_produce === true));
    });
  }, [props.actorSource, props.branch, props.brand, props.workDate]);
  useEffect(() => {
    const handle = window.setTimeout(() => {
      for (const item of items) {
        const amount = Number(grams[item.id] || 0);
        if (amount <= 0) continue;
        void previewProduceWasteAction({ branch_code: props.branch, item_id: item.id, leftover_sliced_grams: amount }).then((loaded) => {
          if (loaded.data.ok) setPreview((current) => ({ ...current, [item.id]: loaded.data.sentence }));
        });
      }
    }, 350);
    return () => window.clearTimeout(handle);
  }, [grams, items, props.branch]);
  if (items.length === 0) return null;
  return (
    <div className="space-y-3 rounded-lg bg-amber-50 p-3">
      <p className="font-medium">เนื้อผลไม้หั่นเหลือ ชั่งทิ้งเป็นกรัม</p>
      {items.map((item) => {
        const profile = produceProfile(item);
        return (
          <div key={item.id} className="space-y-1">
            <label className="text-sm">{item.short_code} · {item.name_th}
              <span className="mt-1 flex items-center gap-2">
                <FnbQtyInput className="h-10 w-28" value={grams[item.id] ?? ""} onChange={(value) => setGrams((current) => ({ ...current, [item.id]: value }))} />
                <strong>g</strong>
              </span>
            </label>
            {preview[item.id] ? <p className="text-sm text-amber-950">{preview[item.id]}</p> : <p className="text-xs text-slate-500">เช่น 150 g คิดกลับเป็น {profile.label} ตามเปอร์เซ็นต์เนื้อ {profile.yieldPct}%</p>}
          </div>
        );
      })}
      <LiveWatermarkCamera branchCode={props.branch} stage="CLOSING" staffName={props.staffName} taskTitle="เททิ้งเนื้อผลไม้หั่น" liveCameraOnly onCapture={(file, live) => {
        const body = new FormData();
        body.set("file", file);
        body.set("live_capture", String(live));
        body.set("branch_code", props.branch);
        body.set("actor_source", props.actorSource);
        body.set("brand_lock", props.brand);
        void uploadFnbEvidenceAction(body).then((saved) => {
          if (saved.error || !saved.data.url) toast.error(saved.error || "อัปโหลดรูปไม่สำเร็จ");
          else setPhoto(saved.data.url);
        });
      }} />
      <button type="button" className="rounded-md bg-[var(--fnb-brand)] px-3 py-2 text-sm text-white disabled:opacity-60" disabled={busy} onClick={() => {
        setBusy(true);
        void saveProduceWasteSummaryAction({
          branch_code: props.branch,
          work_date: props.workDate,
          brand_lock: props.brand,
          photo_urls: photo ? [photo] : [],
          lines: items.map((item) => ({ item_id: item.id, leftover_sliced_grams: Number(grams[item.id] || 0) })),
        }).then((saved) => {
          setBusy(false);
          if (saved.error || !saved.data.ok) toast.error(saved.error || "บันทึกเททิ้งผลไม้ไม่สำเร็จ");
          else toast.success(saved.data.sentence || "บันทึกเททิ้งเนื้อหั่นแล้ว");
        });
      }}>{busy ? "กำลังบันทึก..." : "บันทึกเททิ้งเนื้อหั่น"}</button>
    </div>
  );
}
