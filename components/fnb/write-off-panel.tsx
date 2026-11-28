"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { LiveWatermarkCamera } from "@/components/fnb/live-watermark-camera";
import { FnbQtyInput } from "@/components/fnb/fnb-qty-input";
import { uploadFnbEvidenceAction } from "@/lib/actions/fnb-sop";
import { listVendorClaimsAction, recordItemWriteOffAction, settleVendorClaimAction } from "@/lib/actions/fnb-stage";
import { listBranchZonesAction } from "@/lib/actions/fnb-store-day";
import { listWipBoardAction } from "@/lib/actions/fnb-wip";
import { FNB_WRITE_OFF_REASONS, type FnbBrandCode } from "@/types/fnb";

const field = "h-10 w-full rounded-md border border-slate-200 px-3 text-sm";

export function WriteOffButton(props: {
  branch: string;
  workDate: string;
  actorSource: "desktop" | "liff";
  brand: FnbBrandCode;
  staffName: string;
  locations: { locationCode: string; locationNameTh: string }[];
  shiftType?: "MORNING" | "AFTERNOON";
  label?: string;
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" className="rounded-md border border-red-300 bg-white px-3 py-2 text-sm" onClick={() => setOpen(true)}>{props.label || "🗑️ แจ้งตัดของเสีย / ขนส่งแตกหัก / ขึ้นรา / หมดอายุ"}</button>;
  return <WriteOffForm {...props} onClose={() => setOpen(false)} />;
}

function WriteOffForm(props: {
  branch: string;
  workDate: string;
  actorSource: "desktop" | "liff";
  brand: FnbBrandCode;
  staffName: string;
  locations: { locationCode: string; locationNameTh: string }[];
  shiftType?: "MORNING" | "AFTERNOON";
  onDone?: () => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("EXPIRED_DISPLAY");
  const [items, setItems] = useState<{ id: string; short_code: string; name_th: string; count_uom: string }[]>([]);
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("1");
  const [location, setLocation] = useState(props.locations[0]?.locationCode ?? "");
  const [zones, setZones] = useState(props.locations);
  const [destroyed, setDestroyed] = useState(false);
  const [claim, setClaim] = useState(false);
  const [expiry, setExpiry] = useState("");
  const [notes, setNotes] = useState("");
  const [photo, setPhoto] = useState("");
  useEffect(() => {
    void listWipBoardAction({ branch_code: props.branch, work_date: props.workDate, actor_source: props.actorSource, brand_lock: props.brand }).then((loaded) => {
      const rows = (loaded.data?.items ?? []).map((item) => ({ id: item.id, short_code: item.short_code, name_th: item.name_th, count_uom: item.count_uom }));
      setItems(rows);
      setItemId(rows[0]?.id ?? "");
    });
  }, [props.branch, props.workDate, props.actorSource, props.brand]);
  useEffect(() => { setClaim(reason === "TRANSIT_BROKEN"); }, [reason]);
  useEffect(() => {
    if (props.locations.length > 0) { setZones(props.locations); setLocation(props.locations[0]?.locationCode ?? ""); return; }
    if (!props.branch) return;
    void listBranchZonesAction(props.branch).then((loaded) => {
      const next = loaded.data.map((row) => ({ locationCode: row.locationCode, locationNameTh: row.locationNameTh }));
      setZones(next);
      setLocation(next[0]?.locationCode ?? "");
    });
  }, [props.branch, props.locations]);
  const unit = items.find((item) => item.id === itemId)?.count_uom || "ชิ้น";
  return (
    <form className="space-y-2 rounded-xl border bg-white p-3" onSubmit={(event) => {
      event.preventDefault();
      if (!photo) { toast.error("ถ่ายรูปสดก่อนบันทึกของเสีย"); return; }
      if (reason === "EXPIRED_DISPLAY" && !destroyed) { toast.error("ยืนยันว่าแกะซองและทำลายสภาพแล้ว"); return; }
      if (reason === "MOLD_SPOILED" && !expiry) { toast.error("กรอกวันหมดอายุที่พิมพ์บนซอง"); return; }
      void recordItemWriteOffAction({
        branchCode: props.branch,
        locationCode: location,
        workDate: props.workDate,
        itemId,
        reason,
        qty: Math.trunc(Number(qty) || 0),
        observedExpiryDate: expiry,
        destroyedVerified: destroyed,
        vendorClaimable: claim,
        photoUrls: [photo],
        notes,
        shiftType: props.shiftType,
        actorSource: props.actorSource,
        brandLock: props.brand,
      }).then((saved) => {
        if (saved.error || !saved.data.ok) toast.error(saved.error || "บันทึกตัดของเสียไม่สำเร็จ");
        else { toast.success(saved.data.writeOffNo || "บันทึกตัดของเสียแล้ว"); props.onDone?.(); props.onClose(); }
      });
    }}>
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">ตัดของเสีย</h3>
        <button type="button" className="text-sm" onClick={props.onClose}>ปิด</button>
      </div>
      <select className={field} value={reason} onChange={(event) => setReason(event.target.value)}>{FNB_WRITE_OFF_REASONS.map((row) => <option key={row.code} value={row.code}>{row.label}</option>)}</select>
      {reason === "EXPIRED_DISPLAY" ? (
        <div className="rounded-lg bg-red-50 p-2 text-sm text-red-900">
          <p>⚠️ กฎเหล็กป้องกันทุจริต: ต้องแกะขนมออกจากซอง และหั่นครึ่ง/บิทำลายสภาพใส่ถาดทิ้งให้เห็นชัดเจนก่อนถ่ายรูปสด (ห้ามถ่ายรูปขนมที่ยังอยู่ในซองสมบูรณ์)</p>
          <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={destroyed} onChange={(event) => setDestroyed(event.target.checked)} />ยืนยันว่าแกะซองและหั่น/บิทำลายสภาพเรียบร้อยแล้ว</label>
        </div>
      ) : null}
      <select className={field} value={itemId} onChange={(event) => setItemId(event.target.value)}>{items.map((item) => <option key={item.id} value={item.id}>{item.short_code} {item.name_th}</option>)}</select>
      <label className="text-sm">จำนวน<FnbQtyInput value={qty} onChange={setQty} unit={unit} /></label>
      <label className="text-sm">จุดจัดเก็บ<select className={field} value={location} onChange={(event) => setLocation(event.target.value)}>{zones.map((row) => <option key={row.locationCode} value={row.locationCode}>{row.locationNameTh}</option>)}</select></label>
      {reason === "MOLD_SPOILED" ? <label className="text-sm">วันหมดอายุที่พิมพ์บนซอง<input className={field} type="date" value={expiry} onChange={(event) => setExpiry(event.target.value)} /></label> : null}
      {reason === "TRANSIT_BROKEN" || reason === "MOLD_SPOILED" ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={claim} onChange={(event) => setClaim(event.target.checked)} />📌 ตั้งเรื่องเคลมซัพพลายเออร์/ขนส่ง (รอรับของชดเชยหรือใบลดหนี้)</label> : null}
      <input className={field} value={notes} placeholder="หมายเหตุ" onChange={(event) => setNotes(event.target.value)} />
      <LiveWatermarkCamera branchCode={props.branch} stage="OPENING" staffName={props.staffName} taskTitle="หลักฐานของเสีย" liveCameraOnly onCapture={(file, live) => {
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
      <button className="rounded-md bg-[var(--fnb-brand)] px-3 py-2 text-sm text-white">บันทึกตัดของเสีย</button>
    </form>
  );
}

const CLAIM_LABEL: Record<string, string> = {
  PENDING_CLAIM: "รอเคลม",
  CLAIMED_REPLACED: "ได้รับของชดเชยแล้ว",
  CLAIMED_CREDIT_NOTE: "ได้รับส่วนลด/ใบลดหนี้แล้ว",
  CLAIM_REJECTED: "เคลมไม่ผ่าน",
  NOT_CLAIMABLE: "ไม่เคลม",
};

export function VendorClaimPanel({ brand }: { brand: FnbBrandCode }) {
  const [rows, setRows] = useState<{ id: string; writeOffNo: string; branchCode: string; itemLabel: string; reason: string; qty: number; uom: string; status: string }[]>([]);
  function reload() {
    void listVendorClaimsAction(brand).then((loaded) => setRows(loaded.data));
  }
  useEffect(() => { reload(); }, [brand]);
  return (
    <section className="space-y-2 rounded-xl border bg-white p-4">
      <h2 className="font-semibold">📋 รายการรอเคลมของเสียกับซัพพลายเออร์ (แตกหัก/ขึ้นรา)</h2>
      {rows.length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีรายการเคลมของแบรนด์นี้</p> : null}
      {rows.map((row) => (
        <article key={row.id} className="rounded-lg bg-slate-50 p-3 text-sm">
          <p className="font-medium">{row.writeOffNo} · {row.branchCode} · {row.itemLabel}</p>
          <p>{row.reason} · {row.qty} {row.uom} · {CLAIM_LABEL[row.status] || row.status}</p>
          {row.status === "PENDING_CLAIM" ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className="rounded-md border px-2 py-1" onClick={() => void settleVendorClaimAction(row.id, "CLAIMED_REPLACED").then((saved) => { if (saved.error) toast.error(saved.error); else { toast.success("ได้รับของชดเชยแล้ว"); reload(); } })}>ได้รับของชดเชยแล้ว</button>
              <button type="button" className="rounded-md border px-2 py-1" onClick={() => void settleVendorClaimAction(row.id, "CLAIMED_CREDIT_NOTE").then((saved) => { if (saved.error) toast.error(saved.error); else { toast.success("ได้รับส่วนลด/ใบลดหนี้แล้ว"); reload(); } })}>ได้รับส่วนลด/ใบลดหนี้แล้ว</button>
            </div>
          ) : null}
        </article>
      ))}
    </section>
  );
}
