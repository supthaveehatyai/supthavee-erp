"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { LiveWatermarkCamera } from "@/components/fnb/live-watermark-camera";
import { closeWipBatchAction, issueWipBatchAction, listWipBoardAction } from "@/lib/actions/fnb-wip";
import { uploadFnbEvidenceAction } from "@/lib/actions/fnb-sop";
import type { FnbBrandCode, FnbWipBatchRow, FnbWipBoard } from "@/types/fnb";

function clock(iso: string): string {
  return new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function badge(expiresAt: string): { label: string; className: string } {
  const hours = (new Date(expiresAt).getTime() - Date.now()) / 3600000;
  if (hours < 0) return { label: "เลยเวลาหมดอายุ — ต้องเคลียร์ทิ้งทันที!", className: "bg-red-100 text-red-800" };
  if (hours < 24) return { label: "ครบอายุวันนี้", className: "bg-amber-100 text-amber-900" };
  return { label: "ปกติ", className: "bg-emerald-100 text-emerald-800" };
}

export function WipPanel({
  branch,
  workDate,
  brand,
  actorSource,
  actorName,
  enableShift3,
}: {
  branch: string;
  workDate: string;
  brand: FnbBrandCode;
  actorSource: "desktop" | "liff";
  actorName: string;
  enableShift3: boolean;
}) {
  const [board, setBoard] = useState<FnbWipBoard | null>(null);
  const [sticker, setSticker] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [, start] = useTransition();

  function reload() {
    void listWipBoardAction({ branch_code: branch, work_date: workDate, brand_lock: brand, actor_source: actorSource }).then((loaded) => {
      setBoard(loaded.data);
      if (loaded.error) setMessage(loaded.error);
    });
  }

  useEffect(() => { reload(); }, [branch, workDate, brand, actorSource]);

  async function capture(file: File, live: boolean, target: (url: string) => void) {
    const body = new FormData();
    body.set("actor_source", actorSource);
    body.set("brand_lock", brand);
    body.set("branch_code", branch);
    body.set("work_date", workDate);
    body.set("stage_instance", "WIP");
    body.set("live_capture", live ? "true" : "false");
    body.set("file", file);
    setBusy(true);
    const uploaded = await uploadFnbEvidenceAction(body);
    setBusy(false);
    if (uploaded.error || !uploaded.data.url) {
      toast.error(uploaded.error || "อัปโหลดรูปไม่สำเร็จ");
      return;
    }
    target(uploaded.data.url);
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">ต้มเบสเพิ่มและเบิกเปิดของขึ้นบาร์</h2>
      <p className="text-sm text-slate-600">ผู้ปฏิบัติงาน: {actorName || "บัญชีที่ล็อกอิน"} · เปิดได้ทุกช่วงกะ ไม่ล็อกวันละครั้ง</p>
      {message ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{message}</p> : null}
      {sticker ? <p className="rounded-lg bg-slate-900 px-3 py-3 text-sm font-semibold text-white">🏷️ เขียนป้ายติดภาชนะ: {sticker}</p> : null}
      <section className="space-y-2 rounded-xl border bg-white p-4">
        <h3 className="font-semibold">รอบที่ต้มวันนี้</h3>
        {(board?.brews ?? []).length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีรอบต้มของวันนี้</p> : board?.brews.map((row, index) => (
          <p key={row.id} className="text-sm">รอบที่ {index + 1} ({clock(row.opened_at)} น.): {row.item_label} {row.actual_usable_qty.toFixed(0)} {row.recipe_uom} · {row.brew_portion_mode === "HALF_LIQUID_FULL_PACK" ? "ครึ่งหม้อ" : "เต็มหม้อ"} · {row.opened_by_name}</p>
        ))}
        <BrewForm brand={brand} actorSource={actorSource} branch={branch} workDate={workDate} actorName={actorName} enableShift3={enableShift3} bases={board?.bases ?? []} busy={busy} capture={capture} onDone={(label) => { setSticker(label); toast.success(`🏷️ เขียนป้ายติดภาชนะ: ${label}`); reload(); }} onError={(note) => { toast.error(note); setMessage(note); }} />
      </section>
      <section className="space-y-2 rounded-xl border bg-white p-4">
        <h3 className="font-semibold">เบิกแกะกล่อง กระป๋อง หรือหั่นเลมอนขึ้นบาร์</h3>
        <OpenItemForm brand={brand} actorSource={actorSource} branch={branch} workDate={workDate} actorName={actorName} enableShift3={enableShift3} items={board?.items ?? []} busy={busy} capture={capture} onDone={(label) => { setSticker(label); toast.success(`🏷️ ป้ายวันหมดอายุหลังเปิด: ${label}`); reload(); }} onError={(note) => { toast.error(note); setMessage(note); }} />
      </section>
      <section className="space-y-3 rounded-xl border bg-white p-4">
        <h3 className="font-semibold">ขวดและกระป๋องที่เปิดค้างหน้าบาร์</h3>
        {(board?.containers ?? []).slice().sort((left, right) => left.expires_at.localeCompare(right.expires_at)).map((row) => (
          <ContainerCard key={row.id} row={row} brand={brand} actorSource={actorSource} branch={branch} workDate={workDate} actorName={actorName} busy={busy} start={start} capture={capture} onDone={(note) => { toast.success(note); setMessage(note); reload(); }} onError={(note) => { toast.error(note); setMessage(note); }} />
        ))}
        {(board?.containers ?? []).length === 0 ? <p className="text-sm text-slate-500">ไม่มีภาชนะหลายวันที่ยังเปิดอยู่</p> : null}
      </section>
    </div>
  );
}

function BrewForm(props: {
  brand: FnbBrandCode;
  actorSource: "desktop" | "liff";
  branch: string;
  workDate: string;
  actorName: string;
  enableShift3: boolean;
  bases: FnbWipBoard["bases"];
  busy: boolean;
  capture: (file: File, live: boolean, target: (url: string) => void) => Promise<void>;
  onDone: (label: string) => void;
  onError: (note: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [urls, setUrls] = useState<string[]>([]);
  const [portion, setPortion] = useState<"FULL_RECIPE" | "HALF_LIQUID_FULL_PACK">("FULL_RECIPE");
  if (!open) return <button type="button" className="rounded-md bg-red-700 px-3 py-2 text-sm text-white" onClick={() => setOpen(true)}>➕ ต้มเบสเพิ่ม</button>;
  return (
    <form className="space-y-2 rounded-lg bg-red-50 p-3" onSubmit={(event) => {
      event.preventDefault();
      const body = new FormData(event.currentTarget);
      body.set("actor_source", props.actorSource);
      body.set("brand_lock", props.brand);
      body.set("branch_code", props.branch);
      body.set("work_date", props.workDate);
      body.set("batch_kind", "PREP_BASE");
      body.set("brew_portion_mode", portion);
      body.set("photo_urls", urls.join("|"));
      void issueWipBatchAction(body).then((saved) => {
        if (saved.error || !saved.data.ok) props.onError(saved.error || saved.data.message || "ต้มเบสไม่สำเร็จ");
        else { setOpen(false); props.onDone(saved.data.sticker || "ติดป้ายตามเวลาที่ระบบคำนวณ"); }
      });
    }}>
      <select className="h-10 w-full rounded-md border px-3 text-sm" name="prep_base_code">{props.bases.map((base) => <option key={base.base_code} value={base.base_code}>{base.base_code} {base.base_name_th} · {base.yield_qty_ml.toFixed(0)} ml</option>)}</select>
      <select className="h-10 w-full rounded-md border px-3 text-sm" name="shift_instance"><option value="SHIFT_1">กะแรก</option><option value="SHIFT_2">กะสอง</option>{props.enableShift3 ? <option value="SHIFT_3">กะสาม</option> : null}</select>
      <label className="flex gap-2 text-sm"><input type="radio" checked={portion === "FULL_RECIPE"} onChange={() => setPortion("FULL_RECIPE")} />ต้มเต็มสูตรมาตรฐาน (1 ถุงเต็ม ได้น้ำเบสเต็มหม้อ)</label>
      <label className="flex gap-2 text-sm"><input type="radio" checked={portion === "HALF_LIQUID_FULL_PACK"} onChange={() => setPortion("HALF_LIQUID_FULL_PACK")} />ต้มครึ่งสูตรช่วงเย็นใกล้ปิดร้าน (ได้น้ำเบสครึ่งหม้อ — ระบบตัดสต็อกเต็ม 1 ถุงตามมาตรฐานแฟรนไชส์)</label>
      {portion === "HALF_LIQUID_FULL_PACK" ? <p className="text-sm text-amber-900">เหมาะสำหรับช่วงเย็น เช่น 16:00 น. ก่อนร้านปิด 20:00 น. เพื่อลดน้ำชาเหลือทิ้ง โดยระบบยังคงตัดสต็อกใบชาเต็ม 1 ถุงตามเกณฑ์แฟรนไชส์</p> : null}
      <LiveWatermarkCamera branchCode={props.branch} stage="WIP" staffName={props.actorName} taskTitle="ต้มเบสเพิ่ม" liveCameraOnly onCapture={(file, live) => void props.capture(file, live, (url) => setUrls((current) => [...current, url]))} />
      <button className="rounded-md bg-red-700 px-3 py-2 text-sm text-white" disabled={props.busy}>{props.busy ? "กำลังบันทึก..." : "บันทึกต้มเบสเพิ่ม"}</button>
    </form>
  );
}

function OpenItemForm(props: {
  brand: FnbBrandCode;
  actorSource: "desktop" | "liff";
  branch: string;
  workDate: string;
  actorName: string;
  enableShift3: boolean;
  items: FnbWipBoard["items"];
  busy: boolean;
  capture: (file: File, live: boolean, target: (url: string) => void) => Promise<void>;
  onDone: (label: string) => void;
  onError: (note: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [urls, setUrls] = useState<string[]>([]);
  const visible = props.items.filter((item) => `${item.short_code} ${item.name_th}`.toLowerCase().includes(query.toLowerCase())).slice(0, 80);
  return (
    <form className="space-y-2" onSubmit={(event) => {
      event.preventDefault();
      const body = new FormData(event.currentTarget);
      body.set("actor_source", props.actorSource);
      body.set("brand_lock", props.brand);
      body.set("branch_code", props.branch);
      body.set("work_date", props.workDate);
      body.set("batch_kind", "OPEN_ITEM");
      body.set("brew_portion_mode", "FULL_RECIPE");
      body.set("photo_urls", urls.join("|"));
      void issueWipBatchAction(body).then((saved) => {
        if (saved.error || !saved.data.ok) props.onError(saved.error || saved.data.message || "เบิกเปิดของไม่สำเร็จ");
        else props.onDone(saved.data.sticker || "ติดป้ายวันหมดอายุ");
      });
    }}>
      <input className="h-10 w-full rounded-md border px-3 text-sm" value={query} placeholder="ค้นหา LEM MK CMK WMK SB MB CJ ไซรัป" onChange={(event) => setQuery(event.target.value)} />
      <select className="h-10 w-full rounded-md border px-3 text-sm" name="item_id">{visible.map((item) => <option key={item.id} value={item.id}>{item.short_code} {item.name_th}</option>)}</select>
      <input className="h-10 w-full rounded-md border px-3 text-sm" name="pack_qty" type="number" min="0.1" step="0.1" defaultValue={1} placeholder="จำนวนที่แกะขึ้นบาร์" />
      <select className="h-10 w-full rounded-md border px-3 text-sm" name="shift_instance"><option value="SHIFT_1">กะแรก</option><option value="SHIFT_2">กะสอง</option>{props.enableShift3 ? <option value="SHIFT_3">กะสาม</option> : null}</select>
      <LiveWatermarkCamera branchCode={props.branch} stage="WIP" staffName={props.actorName} taskTitle="เบิกเปิดของขึ้นบาร์" liveCameraOnly onCapture={(file, live) => void props.capture(file, live, (url) => setUrls((current) => [...current, url]))} />
      <button className="rounded-md bg-red-700 px-3 py-2 text-sm text-white" disabled={props.busy}>{props.busy ? "กำลังบันทึก..." : "เบิกขึ้นบาร์"}</button>
    </form>
  );
}

function ContainerCard(props: {
  row: FnbWipBatchRow;
  brand: FnbBrandCode;
  actorSource: "desktop" | "liff";
  branch: string;
  workDate: string;
  actorName: string;
  busy: boolean;
  start: (task: () => void) => void;
  capture: (file: File, live: boolean, target: (url: string) => void) => Promise<void>;
  onDone: (note: string) => void;
  onError: (note: string) => void;
}) {
  const [dump, setDump] = useState(false);
  const [urls, setUrls] = useState<string[]>([]);
  const state = badge(props.row.expires_at);
  function close(mode: "CONSUMED_EMPTY" | "EXPIRED_DUMPED", wasteQty: number) {
    const body = new FormData();
    body.set("actor_source", props.actorSource);
    body.set("brand_lock", props.brand);
    body.set("branch_code", props.branch);
    body.set("batch_id", props.row.id);
    body.set("close_mode", mode);
    body.set("waste_qty", String(wasteQty));
    body.set("photo_urls", urls.join("|"));
    props.start(() => {
      void closeWipBatchAction(body).then((saved) => {
        if (saved.error || !saved.data.ok) props.onError(saved.error || saved.data.message || "ปิดภาชนะไม่สำเร็จ");
        else if (mode === "EXPIRED_DUMPED") props.onDone(`เคลียร์ทิ้งแล้ว ทุนของเสีย ${saved.data.waste_cost_thb.toFixed(2)} บาท (${saved.data.loss_pct.toFixed(1)}% สูญเสียต่อกระป๋อง)`);
        else props.onDone("ใช้หมดเกลี้ยงแล้ว ไม่มีของเสีย");
      });
    });
  }
  return (
    <article className="space-y-2 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{props.row.item_label} · เปิดโดย {props.row.opened_by_name}</p>
        <span className={`rounded-full px-2 py-1 text-xs ${state.className}`}>{state.label}</span>
      </div>
      <p>หมดอายุ {new Date(props.row.expires_at).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })} · {props.row.sticker_label_text}</p>
      <button type="button" className="rounded-md border px-3 py-1" onClick={() => close("CONSUMED_EMPTY", 0)}>ใช้หมดเกลี้ยงแล้ว (0 ของเสีย)</button>
      <button type="button" className="ml-2 rounded-md border px-3 py-1" onClick={() => setDump(true)}>ครบอายุ — ชั่งของเหลือเคลียร์ทิ้ง</button>
      {dump ? (
        <form className="space-y-2" onSubmit={(event) => {
          event.preventDefault();
          close("EXPIRED_DUMPED", Number(new FormData(event.currentTarget).get("waste_qty") ?? 0));
        }}>
          <input className="h-10 w-full rounded-md border px-3" name="waste_qty" type="number" min="0" step="0.01" placeholder={`ของเหลือ ${props.row.recipe_uom}`} required />
          <LiveWatermarkCamera branchCode={props.branch} stage="WIP" staffName={props.actorName} taskTitle={props.row.item_label} liveCameraOnly onCapture={(file, live) => void props.capture(file, live, (url) => setUrls((current) => [...current, url]))} />
          <button className="rounded-md bg-red-700 px-3 py-2 text-white" disabled={props.busy}>{props.busy ? "กำลังบันทึก..." : "บันทึกของเสีย"}</button>
        </form>
      ) : null}
    </article>
  );
}
