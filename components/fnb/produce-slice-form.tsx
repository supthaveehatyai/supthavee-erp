"use client";

import { useState } from "react";
import { toast } from "sonner";
import { LiveWatermarkCamera } from "@/components/fnb/live-watermark-camera";
import { FnbQtyInput } from "@/components/fnb/fnb-qty-input";
import { issueCatchWeightProduceSliceAction } from "@/lib/actions/fnb-produce";
import { produceProfile } from "@/lib/utils/fnb-format";

export function ProduceSliceFields(props: {
  label: string;
  usablePerPiece: number;
  pieces: string;
  grams: string;
  onPieces: (value: string) => void;
  onGrams: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm">จำนวนที่หยิบมาหั่น *
        <span className="mt-1 flex items-center gap-2">
          <FnbQtyInput className="h-10 w-24" min={1} value={props.pieces} onChange={props.onPieces} />
          <strong>{props.label}</strong>
        </span>
      </label>
      <label className="text-sm">น้ำหนักเนื้อหลังหั่น (ถ้าสะดวกชั่ง)
        <span className="mt-1 flex items-center gap-2">
          <FnbQtyInput className="h-10 w-28" value={props.grams} onChange={props.onGrams} />
          <strong>g</strong>
        </span>
        <span className="mt-1 block text-xs text-slate-500">เว้นว่างได้ — หากไม่กรอก ระบบใช้ค่าเฉลี่ย ~{props.usablePerPiece} g/{props.label} แทนอัตโนมัติ</span>
      </label>
    </div>
  );
}

export function ProduceSliceForm(props: {
  items: { id: string; short_code: string; name_th: string; is_catch_weight_produce?: boolean; piece_uom_label?: string; avg_gross_grams_per_piece?: number; prep_yield_pct?: number }[];
  branch: string;
  workDate: string;
  actorSource: string;
  brand: string;
  staffName: string;
  shiftInstance: string;
  upload: (file: File, live: boolean) => Promise<string>;
  onSaved: () => void;
}) {
  const fruits = props.items.filter((item) => item.is_catch_weight_produce === true);
  const [itemId, setItemId] = useState(fruits[0]?.id ?? "");
  const [pieces, setPieces] = useState("1");
  const [grams, setGrams] = useState("");
  const [photo, setPhoto] = useState("");
  const [busy, setBusy] = useState(false);
  const item = fruits.find((row) => row.id === itemId) ?? fruits[0];
  const profile = produceProfile(item);
  if (!item) return <p className="text-sm text-slate-600">ยังไม่มีผลไม้สดที่เปิดโหมดนับคู่ในแบรนด์นี้</p>;
  return (
    <div className="space-y-3 rounded-lg bg-white p-3">
      <label className="block text-sm">ผลไม้สด
        <select className="mt-1 h-10 w-full rounded-md border px-3 text-sm" value={item.id} onChange={(event) => setItemId(event.target.value)}>
          {fruits.map((row) => <option key={row.id} value={row.id}>{row.short_code} · {row.name_th}</option>)}
        </select>
      </label>
      <ProduceSliceFields label={profile.label} usablePerPiece={profile.usablePerPiece} pieces={pieces} grams={grams} onPieces={setPieces} onGrams={setGrams} />
      <LiveWatermarkCamera branchCode={props.branch} stage="WIP" staffName={props.staffName} taskTitle={`หั่น${item.name_th}`} liveCameraOnly onCapture={(file, live) => void props.upload(file, live).then(setPhoto).catch((reason: Error) => toast.error(reason.message))} />
      <button type="button" className="rounded-md bg-[var(--fnb-brand)] px-3 py-2 text-sm text-white disabled:opacity-60" disabled={busy} onClick={() => {
        setBusy(true);
        void issueCatchWeightProduceSliceAction({
          branch_code: props.branch,
          work_date: props.workDate,
          shift_instance: props.shiftInstance,
          item_id: item.id,
          piece_count: Math.trunc(Number(pieces) || 0),
          actual_sliced_grams: grams === "" ? null : Number(grams),
          photo_urls: photo ? [photo] : [],
          notes: `หั่น${item.name_th}`,
          actor_source: props.actorSource,
          brand_lock: props.brand,
        }).then((saved) => {
          setBusy(false);
          if (saved.error || !saved.data.ok) toast.error(saved.error || saved.data.message || "บันทึกหั่นผลไม้ไม่สำเร็จ");
          else { toast.success(saved.data.sticker || `บันทึกหั่น${item.name_th}แล้ว`); props.onSaved(); }
        });
      }}>{busy ? "กำลังบันทึก..." : `💾 บันทึกหั่น${item.name_th}`}</button>
    </div>
  );
}
