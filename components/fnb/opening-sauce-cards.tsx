"use client";

import { useState } from "react";
import { toast } from "sonner";
import { LiveWatermarkCamera } from "@/components/fnb/live-watermark-camera";
import { FnbQtyInput } from "@/components/fnb/fnb-qty-input";
import { closeWipBatchAction, issueWipBatchAction, registerExistingOpenBarItemAction } from "@/lib/actions/fnb-wip";
import { addDays } from "@/lib/fnb/stage-progress";
import type { FnbSauceWatch } from "@/types/fnb";

function thaiDate(iso: string): string {
  const date = new Date(iso.length <= 10 ? `${iso}T12:00:00+07:00` : iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function expired(iso: string | null, today: string): boolean {
  if (!iso) return false;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date(iso));
  return day < today || new Date(iso).getTime() <= Date.now();
}

export function OpeningSauceCards(props: {
  sauces: FnbSauceWatch[];
  branch: string;
  workDate: string;
  actorSource: "desktop" | "liff";
  brand: string;
  staffName: string;
  onDone: () => void;
}) {
  return (
    <div className="grid gap-2 md:grid-cols-2">
      {props.sauces.map((sauce) => (
        <SauceCard key={sauce.code} sauce={sauce} branch={props.branch} workDate={props.workDate} actorSource={props.actorSource} brand={props.brand} staffName={props.staffName} onDone={props.onDone} />
      ))}
    </div>
  );
}

function SauceCard(props: {
  sauce: FnbSauceWatch;
  branch: string;
  workDate: string;
  actorSource: "desktop" | "liff";
  brand: string;
  staffName: string;
  onDone: () => void;
}) {
  const [panel, setPanel] = useState<"existing" | "fresh" | null>(null);
  const [dumpId, setDumpId] = useState("");
  const [openQty, setOpenQty] = useState("1");
  const [freshQty, setFreshQty] = useState("1");
  const [waste, setWaste] = useState("");
  const [expiry, setExpiry] = useState(addDays(props.workDate, props.sauce.openDays || 1));
  const [photo, setPhoto] = useState("");
  const [sticker, setSticker] = useState("");
  const [pending, setPending] = useState(false);
  const unit = props.sauce.countUom || "ชิ้น";
  const preview = thaiDate(addDays(props.workDate, props.sauce.openDays || 1));

  function closeBatch(batchId: string, mode: "CONSUMED_EMPTY" | "EXPIRED_DUMPED") {
    if (pending) return;
    if (mode === "EXPIRED_DUMPED" && !photo) {
      toast.error("ถ่ายรูปสดของที่เททิ้งก่อนบันทึก");
      return;
    }
    const body = new FormData();
    body.set("batch_id", batchId);
    body.set("close_mode", mode);
    body.set("branch_code", props.branch);
    body.set("actor_source", props.actorSource);
    body.set("brand_lock", props.brand);
    body.set("waste_qty", mode === "EXPIRED_DUMPED" ? waste || "0" : "0");
    body.set("photo_urls", photo);
    body.set("notes", mode === "EXPIRED_DUMPED" ? "ครบอายุเททิ้งตอนเปิดร้าน" : "ใช้หมดเกลี้ยงตอนเปิดร้าน");
    setPending(true);
    void closeWipBatchAction(body).then((saved) => {
      setPending(false);
      if (saved.error || !saved.data.ok) toast.error(saved.error || saved.data.message || "ปิดภาชนะไม่สำเร็จ");
      else {
        toast.success(mode === "EXPIRED_DUMPED" ? "บันทึกเททิ้งแล้ว" : "ใช้หมดเกลี้ยงแล้ว");
        setDumpId("");
        setPhoto("");
        props.onDone();
      }
    });
  }

  function saveExisting() {
    if (pending) return;
    if (!props.sauce.itemId) {
      toast.error("ไม่พบรหัสวัตถุดิบนี้ในแบรนด์");
      return;
    }
    const qty = Math.trunc(Number(openQty) || 0);
    if (qty < 1) {
      toast.error("ระบุจำนวนที่เปิดใช้อยู่");
      return;
    }
    const body = new FormData();
    body.set("actor_source", props.actorSource);
    body.set("brand_lock", props.brand);
    body.set("branch_code", props.branch);
    body.set("work_date", props.workDate);
    body.set("item_id", props.sauce.itemId);
    body.set("open_count_qty", String(qty));
    body.set("expiry_date", expiry);
    body.set("notes", "ระบุขวดที่เปิดใช้อยู่แล้วหน้าบาร์");
    setPending(true);
    void registerExistingOpenBarItemAction(body).then((saved) => {
      setPending(false);
      if (saved.error || !saved.data.ok) toast.error(saved.error || saved.data.message || "บันทึกไม่สำเร็จ");
      else {
        toast.success(saved.data.sticker || "บันทึกยอดที่เปิดใช้อยู่แล้ว");
        setPanel(null);
        props.onDone();
      }
    });
  }

  function issueFresh() {
    if (pending) return;
    if (!props.sauce.itemId) {
      toast.error("ไม่พบรหัสวัตถุดิบนี้ในแบรนด์");
      return;
    }
    if (!photo) {
      toast.error("ถ่ายรูปขวดติดป้ายก่อนยืนยันเบิก");
      return;
    }
    const qty = Math.trunc(Number(freshQty) || 0);
    if (qty < 1) {
      toast.error("ระบุจำนวนเบิกใหม่");
      return;
    }
    const body = new FormData();
    body.set("actor_source", props.actorSource);
    body.set("brand_lock", props.brand);
    body.set("branch_code", props.branch);
    body.set("work_date", props.workDate);
    body.set("batch_kind", "OPEN_ITEM");
    body.set("item_id", props.sauce.itemId);
    body.set("pack_qty", String(qty));
    body.set("photo_urls", photo);
    body.set("brew_portion_mode", "FULL_RECIPE");
    body.set("shift_instance", "SHIFT_1");
    body.set("notes", "เบิกคลังเทขวดใหม่ตอนเปิดร้าน");
    setPending(true);
    void issueWipBatchAction(body).then((saved) => {
      setPending(false);
      if (saved.error || !saved.data.ok) toast.error(saved.error || saved.data.message || "เบิกเทใหม่ไม่สำเร็จ");
      else {
        const label = saved.data.sticker || `หมดอายุ ${preview}`;
        setSticker(label);
        toast.success(`เขียนป้าย: ${label}`);
        setPanel(null);
        setPhoto("");
        props.onDone();
      }
    });
  }

  return (
    <article className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
      <p className="font-semibold">{props.sauce.code} · {props.sauce.nameTh}</p>
      <p className="text-xs text-slate-500">อายุเปิด {props.sauce.openDays} วัน</p>
      {props.sauce.batches.length === 0 ? <p>ยังไม่มีขวดที่เปิดอยู่</p> : props.sauce.batches.map((batch) => {
        const late = expired(batch.expiresAt, props.workDate);
        return (
          <div key={batch.id} className="space-y-1">
            <p className={late ? "font-medium text-red-700" : "text-emerald-800"}>
              {late ? `🔴 เลยกำหนดหมดอายุ! ${batch.qty} ${batch.uom}` : `🟢 เปิดใช้อยู่: ${batch.qty} ${batch.uom}`}
              {batch.expiresAt ? ` · หมดอายุ ${thaiDate(batch.expiresAt)}` : ""}
            </p>
            <div className="flex flex-wrap gap-1">
              <button type="button" className="rounded-md border bg-white px-2 py-1 text-xs" onClick={() => closeBatch(batch.id, "CONSUMED_EMPTY")}>🏁 ใช้หมดเกลี้ยง</button>
              <button type="button" className="rounded-md border bg-white px-2 py-1 text-xs" onClick={() => { setDumpId(batch.id); setPanel(null); setPhoto(""); }}>🗑️ ครบอายุเททิ้ง</button>
            </div>
            {dumpId === batch.id ? (
              <div className="space-y-2 rounded-md border border-red-100 bg-white p-2">
                <label className="text-xs">น้ำหนักของเหลือ
                  <span className="mt-1 block"><FnbQtyInput className="h-10 w-20" value={waste} onChange={setWaste} unit={batch.uom} allowDecimal /></span>
                </label>
                <LiveWatermarkCamera branchCode={props.branch} stage="OPENING" staffName={props.staffName} taskTitle={`${props.sauce.code} เททิ้ง`} liveCameraOnly onUploaded={setPhoto} />
                <button type="button" className="rounded-md bg-[var(--fnb-brand)] px-2 py-1 text-xs text-white disabled:opacity-60" disabled={pending} onClick={() => closeBatch(batch.id, "EXPIRED_DUMPED")}>{pending ? "กำลังบันทึก..." : "บันทึกเททิ้ง"}</button>
              </div>
            ) : null}
          </div>
        );
      })}
      <div className="flex flex-wrap gap-1">
        <button type="button" className="rounded-md border bg-white px-2 py-1 text-xs" onClick={() => { setPanel(panel === "existing" ? null : "existing"); setDumpId(""); setExpiry(addDays(props.workDate, props.sauce.openDays || 1)); }}>📌 ระบุที่เปิดใช้อยู่</button>
        <button type="button" className="rounded-md border bg-white px-2 py-1 text-xs" onClick={() => { setPanel(panel === "fresh" ? null : "fresh"); setDumpId(""); setPhoto(""); }}>➕ เบิกคลังเทขวดใหม่</button>
      </div>
      {panel === "existing" ? (
        <div className="space-y-2 rounded-md border bg-white p-2">
          <label className="text-xs">จำนวนที่เปิดใช้อยู่
            <span className="mt-1 block"><FnbQtyInput className="h-10 w-20" value={openQty} onChange={setOpenQty} unit={unit} /></span>
          </label>
          <label className="block text-xs">วันหมดอายุตามป้ายข้างขวด
            <input className="mt-1 h-10 rounded-md border px-2 text-sm" type="date" value={expiry} onChange={(event) => setExpiry(event.target.value)} />
          </label>
          <button type="button" className="rounded-md bg-[var(--fnb-brand)] px-3 py-1 text-xs text-white disabled:opacity-60" disabled={pending} onClick={saveExisting}>{pending ? "กำลังบันทึก..." : "บันทึก"}</button>
        </div>
      ) : null}
      {panel === "fresh" ? (
        <div className="space-y-2 rounded-md border bg-white p-2">
          <label className="text-xs">จำนวนเบิกใหม่
            <span className="mt-1 block"><FnbQtyInput className="h-10 w-20" value={freshQty} onChange={setFreshQty} unit={unit} /></span>
          </label>
          <p className="text-xs text-slate-600">ป้ายหมดอายุที่จะเขียน: {preview}</p>
          {sticker ? <p className="text-xs font-medium">เขียนป้าย: {sticker}</p> : null}
          <LiveWatermarkCamera branchCode={props.branch} stage="OPENING" staffName={props.staffName} taskTitle={`${props.sauce.code} ถ่ายรูปขวดติดป้าย`} liveCameraOnly onUploaded={setPhoto} />
          <button type="button" className="rounded-md bg-[var(--fnb-brand)] px-3 py-1 text-xs text-white disabled:opacity-60" disabled={pending} onClick={issueFresh}>{pending ? "กำลังบันทึก..." : "ยืนยันเบิกเทใหม่"}</button>
        </div>
      ) : null}
    </article>
  );
}
