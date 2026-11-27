"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { LiveWatermarkCamera } from "@/components/fnb/live-watermark-camera";
import { uploadFnbEvidenceAction } from "@/lib/actions/fnb-sop";
import {
  getStoreDayBoardAction,
  replenishZoneAction,
  saveCleaningPhotoAction,
  saveEquipmentCalibrationAction,
  saveZoneCountsAction,
} from "@/lib/actions/fnb-store-day";
import { closeWipBatchAction, issueWipBatchAction, listWipBoardAction } from "@/lib/actions/fnb-wip";
import { itemMatches } from "@/lib/fnb/item-search";
import type { FnbBrandCode, FnbStoreDayBoard, FnbZoneCountLine } from "@/types/fnb";

const field = "h-10 w-full rounded-md border border-slate-200 px-3 text-sm";

function useBoard(branch: string, workDate: string, actorSource: string, brandLock: string) {
  const [board, setBoard] = useState<FnbStoreDayBoard | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void getStoreDayBoardAction(branch, workDate, actorSource, brandLock).then((loaded) => {
      if (!active) return;
      setBoard(loaded.data);
      setError(loaded.error ?? "");
    });
    return () => { active = false; };
  }, [branch, workDate, actorSource, brandLock]);
  return { board, error, reload: () => void getStoreDayBoardAction(branch, workDate, actorSource, brandLock).then((loaded) => { setBoard(loaded.data); setError(loaded.error ?? ""); }) };
}

async function uploadShot(file: File, live: boolean, branch: string, actorSource: string, brandLock: string): Promise<string> {
  const body = new FormData();
  body.set("file", file);
  body.set("live_capture", String(live));
  body.set("branch_code", branch);
  body.set("actor_source", actorSource);
  body.set("brand_lock", brandLock);
  const saved = await uploadFnbEvidenceAction(body);
  if (saved.error || !saved.data.url) throw new Error(saved.error || "อัปโหลดรูปไม่สำเร็จ");
  return saved.data.url;
}

export function OpeningChecklist(props: { branch: string; workDate: string; actorSource: "desktop" | "liff"; brandLock: FnbBrandCode | null; staffName: string }) {
  const brand = props.brandLock ?? "";
  const { board, error, reload } = useBoard(props.branch, props.workDate, props.actorSource, brand);
  const [busy, start] = useTransition();
  const [photo, setPhoto] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [expiry, setExpiry] = useState<Record<string, string>>({});
  const front = board?.locations.find((row) => row.zoneType === "FRONT_DISPLAY");
  const back = board?.locations.find((row) => row.zoneType === "BACKROOM");
  return (
    <section className="space-y-4 rounded-xl border border-red-100 bg-white p-4">
      <h2 className="text-lg font-semibold">ช่วงที่ 1 — เปิดร้าน 7 หมวด</h2>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <article className="space-y-2">
        <h3 className="font-semibold">หมวด 1–3 เบส อุปกรณ์ และซอส</h3>
        <p className="text-sm text-slate-600">ต้มเบส JT 1,950 ml · BT 2,800 ml · ML 50g+น้ำ 750ml · MMK 50g+นม 1,000ml และหั่นเลมอน ใช้ปุ่ม ⚡ ระหว่างวัน หรือแท็บต้มเบส สัดส่วน 25/50/75/100</p>
        <form className="grid gap-2 md:grid-cols-3" onSubmit={(event) => {
          event.preventDefault();
          const body = new FormData(event.currentTarget);
          body.set("branch_code", props.branch);
          body.set("work_date", props.workDate);
          body.set("actor_source", props.actorSource);
          body.set("brand_lock", brand);
          body.set("photo_urls", photo);
          start(async () => {
            const saved = await saveEquipmentCalibrationAction(body);
            if (saved.error || !saved.data.ok) toast.error(saved.error || "บันทึกอุปกรณ์ไม่สำเร็จ");
            else toast.success(saved.data.warning || "บันทึกมาตรฐานอุปกรณ์แล้ว");
            reload();
          });
        }}>
          <label className="text-sm">เครื่องบด (เป้า 19.8–20.0 g)<input className={field} name="grinder_dose_g" type="number" step="0.1" defaultValue={board?.calibration?.grinderDoseG ?? ""} /></label>
          <label className="text-sm">เวลาช็อต (22–28 วิ)<input className={field} name="espresso_time_sec" type="number" step="0.1" defaultValue={board?.calibration?.espressoTimeSec ?? ""} /></label>
          <label className="text-sm">น้ำหนักช็อต (38–40 g)<input className={field} name="espresso_yield_g" type="number" step="0.1" defaultValue={board?.calibration?.espressoYieldG ?? ""} /></label>
          <label className="text-sm">ตัวเลขที่เครื่องน้ำเชื่อมสุ่ม (g)<input className={field} name="syrup_random_target_g" type="number" step="0.1" defaultValue={board?.calibration?.syrupRandomG ?? ""} /></label>
          <label className="text-sm">น้ำหนักชั่งจริง (g)<input className={field} name="syrup_measured_actual_g" type="number" step="0.1" defaultValue={board?.calibration?.syrupActualG ?? ""} /></label>
          <label className="flex items-center gap-2 text-sm"><input name="syrup_adjusted_ok" type="checkbox" value="true" defaultChecked={board?.calibration?.syrupAdjusted} />ปรับจูนเครื่องเรียบร้อยแล้ว</label>
          <LiveWatermarkCamera branchCode={props.branch} stage="OPENING" staffName={props.staffName} taskTitle="เช็คมาตรฐานอุปกรณ์" liveCameraOnly onCapture={(file, live) => void uploadShot(file, live, props.branch, props.actorSource, brand).then(setPhoto).catch((reason: Error) => toast.error(reason.message))} />
          <button className="rounded-md bg-red-700 px-3 py-2 text-sm text-white" disabled={busy}>บันทึกหมวด 2</button>
        </form>
        <div className="grid gap-2 md:grid-cols-2">
          {(board?.sauces ?? []).map((sauce) => (
            <div key={sauce.code} className="rounded-lg bg-slate-50 p-3 text-sm">
              <p className="font-semibold">{sauce.code} · {sauce.nameTh} · อายุเปิด {sauce.openDays} วัน</p>
              <p>{sauce.expiresAt ? `หมดอายุ ${sauce.expiresAt}` : "ยังไม่มีขวดที่เปิดอยู่"} {sauce.sticker ? `· ${sauce.sticker}` : ""}</p>
              {sauce.batchId ? <button type="button" className="mt-2 rounded-md border px-2 py-1" onClick={() => {
                const body = new FormData();
                body.set("batch_id", sauce.batchId || "");
                body.set("close_mode", "EXPIRED_DUMPED");
                body.set("branch_code", props.branch);
                body.set("actor_source", props.actorSource);
                body.set("brand_lock", brand);
                body.set("photo_urls", photo);
                body.set("notes", "เทซอสหมดอายุตอนเปิดร้าน");
                start(async () => {
                  const saved = await closeWipBatchAction(body);
                  if (saved.error || !saved.data.ok) toast.error(saved.error || saved.data.message || "เททิ้งไม่สำเร็จ");
                  else toast.success("เทซอสหมดอายุแล้ว");
                  reload();
                });
              }}>เททิ้งขวดหมดอายุ</button> : null}
            </div>
          ))}
        </div>
      </article>
      <article className="space-y-2">
        <h3 className="font-semibold">หมวด 4–5 ชั้นโชว์และตู้แช่หน้าร้าน</h3>
        {(board?.frontOpeningLines ?? []).map((line) => (
          <div key={line.itemId} className="grid gap-2 rounded-lg bg-slate-50 p-3 md:grid-cols-4">
            <p className="text-sm font-medium md:col-span-4">{line.shortCode} {line.nameTh} {line.belowLastClose ? <span className="text-amber-700">ต่ำกว่ายอดปิดเมื่อคืน</span> : null}</p>
            <input className={field} type="number" step="0.01" placeholder="จำนวนหน้าร้าน" value={qty[line.itemId] ?? (line.countedQty ?? "")} onChange={(event) => setQty((current) => ({ ...current, [line.itemId]: event.target.value }))} />
            <input className={field} type="date" value={expiry[line.itemId] ?? line.nearestExpiry ?? ""} onChange={(event) => setExpiry((current) => ({ ...current, [line.itemId]: event.target.value }))} />
          </div>
        ))}
        <button type="button" className="rounded-md bg-red-700 px-3 py-2 text-sm text-white" disabled={busy || !front} onClick={() => start(async () => {
          const lines = (board?.frontOpeningLines ?? []).filter((line) => qty[line.itemId] !== undefined && qty[line.itemId] !== "").map((line) => ({
            itemId: line.itemId, locationCode: front?.locationCode || line.locationCode, countedQty: Number(qty[line.itemId]), nearestExpiry: expiry[line.itemId] || null, openingQty: line.openingQty, replenishedQty: 0, posSoldQty: 0,
          }));
          const saved = await saveZoneCountsAction({ branchCode: props.branch, workDate: props.workDate, stage: "OPENING", actorSource: props.actorSource, brandLock: brand, lines });
          if (saved.error || !saved.data.ok) toast.error(saved.error || "บันทึกยอดเช้าไม่สำเร็จ");
          else toast.success("บันทึกยอดชั้นโชว์ตอนเปิดร้านแล้ว");
          reload();
        })}>บันทึกยอดเปิดร้าน</button>
      </article>
      <article className="space-y-2">
        <h3 className="font-semibold">หมวด 6 เงินสดตั้งต้นในเก๊ะ 1,200.00 บาท</h3>
        <p className="text-sm text-slate-600">ถ่ายรูปเก๊ะตอนเปิดร้าน ตัวเลขเงินสดตั้งต้นใช้วงเงินทอนมาตรฐาน 1,200.00 บาทของสาขา</p>
        <LiveWatermarkCamera branchCode={props.branch} stage="OPENING" staffName={props.staffName} taskTitle="เงินสดตั้งต้นในเก๊ะ 1,200 บาท" liveCameraOnly onCapture={(file, live) => void uploadShot(file, live, props.branch, props.actorSource, brand).then(() => toast.success("บันทึกรูปเงินสดตั้งต้นแล้ว")).catch((reason: Error) => toast.error(reason.message))} />
      </article>
      <SpotPhotos title="หมวด 7 ความสะอาดเปิดร้าน" spots={board?.openingSpots ?? []} {...props} brand={brand} stage="OPENING" />
      {back ? null : null}
    </section>
  );
}

function SpotPhotos(props: { title: string; spots: { id: string; spotNameTh: string }[]; branch: string; workDate: string; actorSource: "desktop" | "liff"; brand: string; staffName: string; stage: "OPENING" | "CLOSING" }) {
  return (
    <article className="space-y-2">
      <h3 className="font-semibold">{props.title}</h3>
      {props.spots.length === 0 ? <p className="text-sm text-slate-500">สาขานี้ยังไม่มีจุดความสะอาด — เพิ่มได้ที่ตั้งค่า SOP</p> : null}
      {props.spots.map((spot) => (
        <div key={spot.id} className="rounded-lg bg-slate-50 p-3">
          <p className="text-sm font-medium">{spot.spotNameTh}</p>
          <LiveWatermarkCamera branchCode={props.branch} stage={props.stage} staffName={props.staffName} taskTitle={spot.spotNameTh} liveCameraOnly onCapture={(file, live) => void uploadShot(file, live, props.branch, props.actorSource, props.brand).then(async (url) => {
            const saved = await saveCleaningPhotoAction({ branchCode: props.branch, workDate: props.workDate, stage: props.stage, spotId: spot.id, photoUrl: url, actorSource: props.actorSource, brandLock: props.brand });
            if (saved.error || !saved.data.ok) toast.error(saved.error || "บันทึกรูปจุดนี้ไม่สำเร็จ");
            else toast.success(`บันทึกรูป ${spot.spotNameTh} แล้ว`);
          }).catch((reason: Error) => toast.error(reason.message))} />
        </div>
      ))}
    </article>
  );
}

export function MiddayShortcuts(props: { branch: string; workDate: string; actorSource: "desktop" | "liff"; brandLock: FnbBrandCode | null; staffName: string; brand: FnbBrandCode }) {
  const brandLock = props.brandLock ?? "";
  const { board, reload } = useBoard(props.branch, props.workDate, props.actorSource, brandLock);
  const [open, setOpen] = useState<"base" | "sauce" | "lemon" | "move" | null>(null);
  const [pct, setPct] = useState(1);
  const [bases, setBases] = useState<{ base_code: string; yield_qty_ml: number }[]>([]);
  const [items, setItems] = useState<{ id: string; short_code: string; name_th: string; alias_codes: string[]; external_code: string | null }[]>([]);
  const [query, setQuery] = useState("");
  const [baseCode, setBaseCode] = useState("BT");
  useEffect(() => {
    void listWipBoardAction({ branch_code: props.branch, work_date: props.workDate, actor_source: props.actorSource, brand_lock: props.brand }).then((loaded) => {
      setBases(loaded.data?.bases ?? []);
      setItems(loaded.data?.items ?? []);
    });
  }, [props.branch, props.workDate, props.actorSource, props.brand]);
  const selected = bases.find((base) => base.base_code === baseCode) ?? bases[0];
  const visible = items.filter((item) => itemMatches(query, item)).slice(0, 40);
  const front = board?.locations.find((row) => row.zoneType === "FRONT_DISPLAY");
  const back = board?.locations.find((row) => row.zoneType === "BACKROOM");
  const warehouse = board?.locations.find((row) => row.zoneType === "WAREHOUSE");
  function brew(kind: "PREP_BASE" | "OPEN_ITEM", extra: { prep?: string; itemId?: string; pack: number; notes?: string }) {
    const body = new FormData();
    body.set("actor_source", props.actorSource);
    body.set("brand_lock", props.brand);
    body.set("branch_code", props.branch);
    body.set("work_date", props.workDate);
    body.set("batch_kind", kind);
    body.set("brew_portion_mode", "FULL_RECIPE");
    body.set("pack_qty", String(extra.pack));
    body.set("shift_instance", "SHIFT_1");
    if (extra.prep) body.set("prep_base_code", extra.prep);
    if (extra.itemId) body.set("item_id", extra.itemId);
    if (extra.notes) body.set("notes", extra.notes);
    void issueWipBatchAction(body).then((saved) => {
      if (saved.error || !saved.data.ok) toast.error(saved.error || saved.data.message || "บันทึกไม่สำเร็จ");
      else toast.success(saved.data.sticker || "ติดป้ายตามเวลาที่ระบบคำนวณ");
      reload();
    });
  }
  return (
    <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <h2 className="font-semibold">⚡ เติมเบส / เทซอส / หั่นเลมอน / เบิกของหลังร้านเติมหน้าร้าน</h2>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="rounded-full bg-white px-3 py-1 text-sm" onClick={() => setOpen("base")}>ต้มเบสเพิ่ม</button>
        <button type="button" className="rounded-full bg-white px-3 py-1 text-sm" onClick={() => setOpen("sauce")}>เทซอสขวดใหม่</button>
        <button type="button" className="rounded-full bg-white px-3 py-1 text-sm" onClick={() => setOpen("lemon")}>หั่นเลมอนเพิ่ม</button>
        <button type="button" className="rounded-full bg-white px-3 py-1 text-sm" onClick={() => setOpen("move")}>เบิกย้ายจุดจัดเก็บ</button>
      </div>
      {open === "base" ? (
        <div className="space-y-2">
          <select className={field} value={baseCode} onChange={(event) => setBaseCode(event.target.value)}>{bases.map((base) => <option key={base.base_code} value={base.base_code}>{base.base_code} · {base.yield_qty_ml.toFixed(0)} ml</option>)}</select>
          <div className="flex flex-wrap gap-2">
            {[0.25, 0.5, 0.75, 1].map((part) => (
              <button key={part} type="button" className={`rounded-full px-3 py-1 text-sm ${pct === part ? "bg-red-700 text-white" : "bg-white"}`} onClick={() => setPct(part)}>{Math.round(part * 100)}% ({Math.round((selected?.yield_qty_ml ?? 0) * part)} ml)</button>
            ))}
          </div>
          <button type="button" className="rounded-md bg-red-700 px-3 py-2 text-sm text-white" onClick={() => brew("PREP_BASE", { prep: baseCode, pack: pct })}>บันทึกต้มเบส {Math.round(pct * 100)}%</button>
        </div>
      ) : null}
      {open === "sauce" || open === "lemon" ? (
        <div className="space-y-2">
          <input className={field} value={query} placeholder="ค้น PF PS CW CWT LEM" onChange={(event) => setQuery(event.target.value)} />
          <button type="button" className="rounded-md bg-red-700 px-3 py-2 text-sm text-white" onClick={() => {
            const item = visible[0];
            if (!item) return;
            const grams = open === "lemon" ? window.prompt("น้ำหนักเลมอนที่หั่นจริง (กรัม)", "0") : null;
            const count = open === "lemon" ? Number(window.prompt("จำนวนลูก", "6") || 0) : 1;
            brew("OPEN_ITEM", { itemId: item.id, pack: count || 1, notes: grams ? `เลมอน ${count} ลูก ${grams} g` : "เทซอสขวดใหม่" });
          }}>{open === "lemon" ? "บันทึกหั่นเลมอน" : `เทขวดใหม่ ${visible[0]?.short_code ?? ""}`}</button>
        </div>
      ) : null}
      {open === "move" && back && front ? (
        <MoveForm items={visible} query={query} setQuery={setQuery} fromCode={warehouse?.locationCode || back.locationCode} toChoices={(board?.locations ?? []).filter((row, index, list) => list.findIndex((item) => item.locationCode === row.locationCode) === index)} onSave={(itemId, qty, fromCode, toCode) => {
          void replenishZoneAction({ branchCode: props.branch, workDate: props.workDate, fromLocationCode: fromCode, toLocationCode: toCode, itemId, qty, actorSource: props.actorSource, brandLock, notes: "เบิกเติมระหว่างวัน" }).then((saved) => {
            if (saved.error || !saved.data.ok) toast.error(saved.error || "เบิกเติมไม่สำเร็จ");
            else toast.success(saved.data.transferNo || "บันทึกเบิกเติมแล้ว");
            reload();
          });
        }} />
      ) : null}
    </section>
  );
}

function MoveForm(props: {
  items: { id: string; short_code: string; name_th: string }[];
  query: string;
  setQuery: (value: string) => void;
  fromCode: string;
  toChoices: { locationCode: string; locationNameTh: string }[];
  onSave: (itemId: string, qty: number, fromCode: string, toCode: string) => void;
}) {
  const [itemId, setItemId] = useState(props.items[0]?.id ?? "");
  const [fromCode, setFromCode] = useState(props.fromCode);
  const [toCode, setToCode] = useState(props.toChoices[0]?.locationCode ?? "");
  const [qty, setQty] = useState("1");
  return (
    <div className="grid gap-2 md:grid-cols-2">
      <input className={field} value={props.query} placeholder="ค้นรหัสย่อ ชื่อ หรือรหัสเรียก" onChange={(event) => props.setQuery(event.target.value)} />
      <select className={field} value={itemId} onChange={(event) => setItemId(event.target.value)}>{props.items.map((item) => <option key={item.id} value={item.id}>{item.short_code} {item.name_th}</option>)}</select>
      <select className={field} value={fromCode} onChange={(event) => setFromCode(event.target.value)}>{props.toChoices.map((row) => <option key={row.locationCode} value={row.locationCode}>จาก {row.locationNameTh}</option>)}</select>
      <select className={field} value={toCode} onChange={(event) => setToCode(event.target.value)}>{props.toChoices.map((row) => <option key={row.locationCode} value={row.locationCode}>ไป {row.locationNameTh}</option>)}</select>
      <input className={field} type="number" step="0.01" value={qty} onChange={(event) => setQty(event.target.value)} />
      <button type="button" className="rounded-md bg-red-700 px-3 py-2 text-sm text-white" onClick={() => props.onSave(itemId, Number(qty) || 0, fromCode, toCode)}>บันทึกเบิกย้ายจุด</button>
    </div>
  );
}

export function NightCloseCount(props: { branch: string; workDate: string; actorSource: "desktop" | "liff"; brandLock: FnbBrandCode | null; staffName: string; warehouseOnly?: boolean }) {
  const brand = props.brandLock ?? "";
  const { board, error, reload } = useBoard(props.branch, props.workDate, props.actorSource, brand);
  const [showAll, setShowAll] = useState(false);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [busy, start] = useTransition();
  const front = board?.locations.find((row) => row.zoneType === "FRONT_DISPLAY");
  const back = board?.locations.find((row) => row.zoneType === "BACKROOM");
  const backLines = (board?.backroomLines ?? []).filter((line) => showAll || line.dueTonight);
  function save(stage: "CLOSING" | "CYCLE_COUNT", lines: FnbZoneCountLine[], locationCode: string) {
    start(async () => {
      const payload = lines.filter((line) => qty[`${locationCode}|${line.itemId}`] !== undefined && qty[`${locationCode}|${line.itemId}`] !== "").map((line) => ({
        itemId: line.itemId,
        locationCode,
        countedQty: Number(qty[`${locationCode}|${line.itemId}`]),
        nearestExpiry: line.nearestExpiry,
        openingQty: line.openingQty,
        replenishedQty: line.replenishedQty,
        posSoldQty: line.posSoldQty,
      }));
      const saved = await saveZoneCountsAction({ branchCode: props.branch, workDate: props.workDate, stage, actorSource: props.actorSource, brandLock: brand, lines: payload });
      if (saved.error || !saved.data.ok) toast.error(saved.error || "บันทึกยอดนับไม่สำเร็จ");
      else toast.success("บันทึกยอดนับแล้ว");
      reload();
    });
  }
  return (
    <section className="space-y-4 rounded-xl border border-red-100 bg-white p-4">
      <h2 className="text-lg font-semibold">{props.warehouseOnly ? "รอบนับโกดัง" : "ช่วงที่ 4 — ปิดร้านและจับของหาย"}</h2>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {props.warehouseOnly ? null : (
        <article className="space-y-2">
          <h3 className="font-semibold">หมวด 1 ยืนยันเงินสดคงเหลือติดเก๊ะ 1,200.00 บาท</h3>
          <p className="text-sm text-slate-600">ยอดเงินสดนับจริงและวิธีฝากบันทึกในฟอร์มปิดกะ รูปนี้ยืนยันว่าเก๊ะเหลือวงเงินทอน 1,200.00 บาท</p>
          <LiveWatermarkCamera branchCode={props.branch} stage="CLOSING" staffName={props.staffName} taskTitle="เงินสดคงเหลือในเก๊ะ 1,200 บาท" liveCameraOnly onCapture={(file, live) => void uploadShot(file, live, props.branch, props.actorSource, brand).then(() => toast.success("บันทึกรูปเงินสดปิดร้านแล้ว")).catch((reason: Error) => toast.error(reason.message))} />
        </article>
      )}
      {props.warehouseOnly ? null : <SpotPhotos title="หมวด 2 ความสะอาดและล้างอุปกรณ์ปิดร้าน" spots={board?.closingSpots ?? []} branch={props.branch} workDate={props.workDate} actorSource={props.actorSource} brand={brand} staffName={props.staffName} stage="CLOSING" />}
      {props.warehouseOnly ? null : (
        <article className="space-y-2">
          <h3 className="font-semibold">โซนหน้าร้าน — นับทุกคืน</h3>
          {(board?.frontLines ?? []).map((line) => (
            <CountRow key={line.itemId} line={line} qty={qty} setQty={setQty} onRetro={back && front ? (gap) => {
              void replenishZoneAction({
                branchCode: props.branch, workDate: props.workDate, fromLocationCode: back.locationCode, toLocationCode: front.locationCode, itemId: line.itemId, qty: gap, actorSource: props.actorSource, brandLock: brand, autoReconciled: true, notes: "บันทึกเบิกเติมย้อนหลังจากยอดนับปิดร้าน",
              }).then((saved) => {
                if (saved.error || !saved.data.ok) toast.error(saved.error || "บันทึกเบิกย้อนหลังไม่สำเร็จ");
                else toast.success("บันทึกเบิกเติมย้อนหลังแล้ว");
                reload();
              });
            } : undefined} />
          ))}
          <button type="button" className="rounded-md bg-red-700 px-3 py-2 text-sm text-white" disabled={busy || !front} onClick={() => front && save("CLOSING", board?.frontLines ?? [], front.locationCode)}>บันทึกยอดปิดหน้าร้าน</button>
        </article>
      )}
      {props.warehouseOnly ? null : (
        <article className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold">คลังหลังร้านและวัสดุสิ้นเปลืองที่ถึงรอบคืนนี้</h3>
            <label className="text-sm"><input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} /> แสดงรายการนอกรอบทั้งหมด</label>
          </div>
          {backLines.map((line) => <CountRow key={line.itemId} line={line} qty={qty} setQty={setQty} />)}
          <button type="button" className="rounded-md bg-red-700 px-3 py-2 text-sm text-white" disabled={busy || !back} onClick={() => back && save("CLOSING", backLines, back.locationCode)}>บันทึกยอดหลังร้าน</button>
        </article>
      )}
      {board?.warehouseDue || props.warehouseOnly ? (
        <article className="space-y-2">
          <h3 className="font-semibold">โกดัง {board?.locations.find((row) => row.zoneType === "WAREHOUSE")?.locationNameTh ?? ""}</h3>
          {(board?.warehouseLines ?? []).map((line) => <CountRow key={line.itemId} line={line} qty={qty} setQty={setQty} />)}
          <button type="button" className="rounded-md bg-red-700 px-3 py-2 text-sm text-white" disabled={busy} onClick={() => {
            const warehouse = board?.locations.find((row) => row.zoneType === "WAREHOUSE");
            if (warehouse) save("CYCLE_COUNT", board?.warehouseLines ?? [], warehouse.locationCode);
          }}>บันทึกยอดโกดัง</button>
        </article>
      ) : <p className="text-sm text-slate-500">โกดังยังไม่ถึงรอบนับคืนนี้ — นับได้จากแท็บรอบนับในคลังสินค้า</p>}
      {props.warehouseOnly ? null : (
        <article>
          <h3 className="font-semibold">หมวด 4 รายการเททิ้งประจำวัน</h3>
          <p className="text-sm text-slate-600">JT, BT, ML, MMK, LEM และซอสที่หมดอายุวันนี้ บันทึกผ่านแท็บต้มเบส/ปิดภาชนะ พร้อมรูปสด</p>
          {(board?.sauces ?? []).filter((sauce) => sauce.expiresAt && sauce.expiresAt.slice(0, 10) <= props.workDate).map((sauce) => (
            <p key={sauce.code} className="text-sm text-red-700">{sauce.code} หมดอายุวันนี้ {sauce.sticker}</p>
          ))}
        </article>
      )}
    </section>
  );
}

function CountRow(props: { line: FnbZoneCountLine; qty: Record<string, string>; setQty: (value: Record<string, string>) => void; onRetro?: (qty: number) => void }) {
  const key = `${props.line.locationCode}|${props.line.itemId}`;
  const typed = props.qty[key];
  const counted = typed === undefined || typed === "" ? props.line.countedQty : Number(typed);
  const missing = counted == null || Number.isNaN(counted) ? 0 : props.line.expectedQty - counted;
  const extra = counted == null || Number.isNaN(counted) ? 0 : counted - props.line.expectedQty;
  return (
    <div className={`rounded-lg p-3 text-sm ${missing > 0 ? "bg-red-50" : "bg-slate-50"}`}>
      <p className="font-medium">{props.line.shortCode} {props.line.nameTh}</p>
      <p>เปิดเช้า {props.line.openingQty} + เบิกเติม {props.line.replenishedQty} − ขาย POS {props.line.posSoldQty} = ควรเหลือ {props.line.expectedQty}</p>
      {missing > 0 ? <p>🚨 ของหาย {missing} ชิ้น</p> : null}
      <input className={`${field} mt-2`} type="number" step="0.01" placeholder="ยอดนับจริง" value={props.qty[key] ?? (props.line.countedQty ?? "")} onChange={(event) => props.setQty({ ...props.qty, [key]: event.target.value })} />
      {extra > 0 && props.onRetro ? <button type="button" className="mt-2 rounded-md border px-2 py-1" onClick={() => props.onRetro?.(extra)}>➕ บันทึกเบิกเติมจากคลังหลังร้านย้อนหลัง {extra} ชิ้น</button> : null}
    </div>
  );
}
