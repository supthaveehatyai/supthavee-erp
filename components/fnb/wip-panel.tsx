"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { LiveWatermarkCamera } from "@/components/fnb/live-watermark-camera";
import { issueCatchWeightProduceSliceAction } from "@/lib/actions/fnb-produce";
import { closeWipBatchAction, issueWipBatchAction, listWipBoardAction } from "@/lib/actions/fnb-wip";
import { produceProfile } from "@/lib/utils/fnb-format";
import { ProduceSliceFields } from "@/components/fnb/produce-slice-form";
import { barItemLabel, barOpenItems, itemMatches, prepBaseLabel } from "@/lib/fnb/item-search";
import { FnbQtyInput } from "@/components/fnb/fnb-qty-input";
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
        <BrewForm brand={brand} actorSource={actorSource} branch={branch} workDate={workDate} actorName={actorName} enableShift3={enableShift3} bases={board?.bases ?? []} busy={busy} onDone={(label) => { setSticker(label); toast.success(`🏷️ เขียนป้ายติดภาชนะ: ${label}`); reload(); }} onError={(note) => { toast.error(note); setMessage(note); }} />
      </section>
      <section className="space-y-2 rounded-xl border bg-white p-4">
        <h3 className="font-semibold">เบิกแกะกล่อง กระป๋อง หรือหั่นเลมอนขึ้นบาร์</h3>
        <OpenItemForm brand={brand} actorSource={actorSource} branch={branch} workDate={workDate} actorName={actorName} enableShift3={enableShift3} items={board?.items ?? []} busy={busy} onDone={(label) => { setSticker(label); toast.success(`🏷️ ป้ายวันหมดอายุหลังเปิด: ${label}`); reload(); }} onError={(note) => { toast.error(note); setMessage(note); }} />
      </section>
      <section className="space-y-3 rounded-xl border bg-white p-4">
        <h3 className="font-semibold">ขวดและกระป๋องที่เปิดค้างหน้าบาร์</h3>
        {(board?.containers ?? []).slice().sort((left, right) => left.expires_at.localeCompare(right.expires_at)).map((row) => (
          <ContainerCard key={row.id} row={row} brand={brand} actorSource={actorSource} branch={branch} workDate={workDate} actorName={actorName} busy={busy} start={start} onDone={(note) => { toast.success(note); setMessage(note); reload(); }} onError={(note) => { toast.error(note); setMessage(note); }} />
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
  onDone: (label: string) => void;
  onError: (note: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [urls, setUrls] = useState<string[]>([]);
  const [portion, setPortion] = useState<"FULL_RECIPE" | "HALF_LIQUID_FULL_PACK">("FULL_RECIPE");
  const [pct, setPct] = useState(1);
  const [baseCode, setBaseCode] = useState(props.bases[0]?.base_code ?? "BT");
  const selected = props.bases.find((base) => base.base_code === baseCode) ?? props.bases[0];
  if (!open) return <button type="button" className="rounded-md bg-[var(--fnb-brand)] px-3 py-2 text-sm text-white" onClick={() => setOpen(true)}>➕ ต้มเบสเพิ่ม</button>;
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
      body.set("pack_qty", portion === "FULL_RECIPE" ? String(pct) : "1");
      body.set("photo_urls", urls.join("|"));
      void issueWipBatchAction(body).then((saved) => {
        if (saved.error || !saved.data.ok) props.onError(saved.error || saved.data.message || "ต้มเบสไม่สำเร็จ");
        else { setOpen(false); props.onDone(saved.data.sticker || "ติดป้ายตามเวลาที่ระบบคำนวณ"); }
      });
    }}>
      <select className="h-10 w-full rounded-md border px-3 text-sm" name="prep_base_code" value={baseCode} onChange={(event) => setBaseCode(event.target.value)}>{[...props.bases].sort((left, right) => left.sort_order - right.sort_order || left.base_code.localeCompare(right.base_code)).map((base) => <option key={base.base_code} value={base.base_code}>{prepBaseLabel(base)}</option>)}</select>
      {portion === "FULL_RECIPE" ? <div className="flex flex-wrap gap-2">{[0.25, 0.5, 0.75, 1].map((part) => <button key={part} type="button" className={`rounded-full px-3 py-1 text-sm ${pct === part ? "bg-[var(--fnb-brand)] text-white" : "bg-white"}`} onClick={() => setPct(part)}>{Math.round(part * 100)}% ({Math.round((selected?.yield_qty_ml ?? 0) * part)} ml)</button>)}</div> : null}
      <select className="h-10 w-full rounded-md border px-3 text-sm" name="shift_instance"><option value="SHIFT_1">กะแรก</option><option value="SHIFT_2">กะสอง</option>{props.enableShift3 ? <option value="SHIFT_3">กะสาม</option> : null}</select>
      <label className="flex gap-2 text-sm"><input type="radio" checked={portion === "FULL_RECIPE"} onChange={() => setPortion("FULL_RECIPE")} />ต้มเต็มสูตรมาตรฐาน (1 ถุงเต็ม ได้น้ำเบสเต็มหม้อ)</label>
      <label className="flex gap-2 text-sm"><input type="radio" checked={portion === "HALF_LIQUID_FULL_PACK"} onChange={() => setPortion("HALF_LIQUID_FULL_PACK")} />ต้มครึ่งสูตรช่วงเย็นใกล้ปิดร้าน (ได้น้ำเบสครึ่งหม้อ — ระบบตัดสต็อกเต็ม 1 ถุงตามมาตรฐานแฟรนไชส์)</label>
      {portion === "HALF_LIQUID_FULL_PACK" ? <p className="text-sm text-amber-900">เหมาะสำหรับช่วงเย็น เช่น 16:00 น. ก่อนร้านปิด 20:00 น. เพื่อลดน้ำชาเหลือทิ้ง โดยระบบยังคงตัดสต็อกใบชาเต็ม 1 ถุงตามเกณฑ์แฟรนไชส์</p> : null}
      <LiveWatermarkCamera branchCode={props.branch} stage="WIP" staffName={props.actorName} taskTitle="ต้มเบสเพิ่ม" liveCameraOnly onUploaded={(url) => setUrls((current) => [...current, url])} />
      <button className="rounded-md bg-[var(--fnb-brand)] px-3 py-2 text-sm text-white" disabled={props.busy}>{props.busy ? "กำลังบันทึก..." : "บันทึกต้มเบสเพิ่ม"}</button>
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
  onDone: (label: string) => void;
  onError: (note: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [urls, setUrls] = useState<string[]>([]);
  const [qty, setQty] = useState("1");
  const [pieces, setPieces] = useState("1");
  const [grams, setGrams] = useState("");
  const [itemId, setItemId] = useState("");
  const visible = barOpenItems(props.items).filter((item) => itemMatches(query, item)).slice(0, 80);
  const selected = visible.find((item) => item.id === itemId) ?? visible[0];
  const profile = produceProfile(selected);
  return (
    <form className="space-y-2" onSubmit={(event) => {
      event.preventDefault();
      const body = new FormData(event.currentTarget);
      if (profile.enabled && selected) {
        void issueCatchWeightProduceSliceAction({
          branch_code: props.branch,
          work_date: props.workDate,
          shift_instance: String(body.get("shift_instance") || "SHIFT_1"),
          item_id: selected.id,
          piece_count: Math.trunc(Number(pieces) || 0),
          actual_sliced_grams: grams === "" ? null : Number(grams),
          photo_urls: urls,
          notes: `หั่น${selected.name_th}`,
          actor_source: props.actorSource,
          brand_lock: props.brand,
        }).then((saved) => {
          if (saved.error || !saved.data.ok) props.onError(saved.error || saved.data.message || "บันทึกหั่นผลไม้ไม่สำเร็จ");
          else props.onDone(saved.data.sticker || `บันทึกหั่น${selected.name_th}แล้ว`);
        });
        return;
      }
      body.set("actor_source", props.actorSource);
      body.set("brand_lock", props.brand);
      body.set("branch_code", props.branch);
      body.set("work_date", props.workDate);
      body.set("batch_kind", "OPEN_ITEM");
      body.set("brew_portion_mode", "FULL_RECIPE");
      body.set("photo_urls", urls.join("|"));
      body.set("pack_qty", selected?.allow_decimal_count_qty ? qty : String(Math.trunc(Number(qty) || 0)));
      void issueWipBatchAction(body).then((saved) => {
        if (saved.error || !saved.data.ok) props.onError(saved.error || saved.data.message || "เบิกเปิดของไม่สำเร็จ");
        else props.onDone(saved.data.sticker || "ติดป้ายวันหมดอายุ");
      });
    }}>
      <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-12">
        <label className="text-sm md:col-span-5">วัตถุดิบที่เบิกเปิดขึ้นบาร์
          <input className="mt-1 h-10 w-full rounded-md border px-3 text-sm" value={query} placeholder="ค้นหา LEM MK CMK" onChange={(event) => setQuery(event.target.value)} />
          <select className="mt-1 h-10 w-full rounded-md border px-3 text-sm" name="item_id" value={selected?.id ?? ""} onChange={(event) => setItemId(event.target.value)}>{visible.map((item) => <option key={item.id} value={item.id}>{barItemLabel(item)}</option>)}</select>
        </label>
        <div className="text-sm md:col-span-4">
          {profile.enabled ? <ProduceSliceFields label={profile.label} usablePerPiece={profile.usablePerPiece} pieces={pieces} grams={grams} onPieces={setPieces} onGrams={setGrams} /> : <label>จำนวน<span className="mt-1 block"><FnbQtyInput value={qty} onChange={setQty} unit={selected?.count_uom || "ชิ้น"} allowDecimal={selected?.allow_decimal_count_qty === true} /></span></label>}
        </div>
        <label className="text-sm md:col-span-2">กะงาน
          <select className="mt-1 h-10 w-full rounded-md border px-3 text-sm" name="shift_instance"><option value="SHIFT_1">กะแรก</option><option value="SHIFT_2">กะสอง</option>{props.enableShift3 ? <option value="SHIFT_3">กะสาม</option> : null}</select>
        </label>
        <div className="space-y-2 md:col-span-3">
          <p className="text-sm">ถ่ายรูปสด</p>
          <LiveWatermarkCamera branchCode={props.branch} stage="WIP" staffName={props.actorName} taskTitle="เบิกเปิดของขึ้นบาร์" liveCameraOnly onUploaded={(url) => setUrls((current) => [...current, url])} />
          <button className="rounded-md bg-[var(--fnb-brand)] px-3 py-2 text-sm text-white" disabled={props.busy}>{props.busy ? "กำลังบันทึก..." : profile.enabled ? `💾 บันทึกหั่น${selected?.name_th ?? "ผลไม้สด"}` : "เบิกขึ้นบาร์"}</button>
        </div>
      </div>
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
          <LiveWatermarkCamera branchCode={props.branch} stage="WIP" staffName={props.actorName} taskTitle={props.row.item_label} liveCameraOnly onUploaded={(url) => setUrls((current) => [...current, url])} />
          <button className="rounded-md bg-[var(--fnb-brand)] px-3 py-2 text-white" disabled={props.busy}>{props.busy ? "กำลังบันทึก..." : "บันทึกของเสีย"}</button>
        </form>
      ) : null}
    </article>
  );
}
