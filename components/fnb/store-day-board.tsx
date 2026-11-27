"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { LiveWatermarkCamera } from "@/components/fnb/live-watermark-camera";
import { uploadFnbEvidenceAction } from "@/lib/actions/fnb-sop";
import {
  getStoreDayBoardAction,
  replenishZoneAction,
  saveEquipmentCalibrationAction,
  saveZoneCountsAction,
} from "@/lib/actions/fnb-store-day";
import { closeWipBatchAction, issueWipBatchAction, listWipBoardAction } from "@/lib/actions/fnb-wip";
import { FnbQtyInput } from "@/components/fnb/fnb-qty-input";
import { CashFloatConfirm } from "@/components/fnb/cash-float-confirm";
import { CleaningSpots } from "@/components/fnb/cleaning-spots";
import { CoworkerBanner } from "@/components/fnb/coworker-banner";
import { DisplayCabinetGrid } from "@/components/fnb/display-cabinet-grid";
import { WriteOffButton } from "@/components/fnb/write-off-panel";
import { confirmStageSectionAction, listStageConfirmationsAction } from "@/lib/actions/fnb-stage";
import { itemMatches } from "@/lib/fnb/item-search";
import type { FnbBrandCode, FnbStageConfirmation, FnbStoreDayBoard, FnbZoneCountLine } from "@/types/fnb";

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

export function OpeningChecklist(props: { branch: string; workDate: string; actorSource: "desktop" | "liff"; brandLock: FnbBrandCode | null; staffName: string; cashFloat?: number }) {
  const brand = props.brandLock ?? "";
  const { board, error, reload } = useBoard(props.branch, props.workDate, props.actorSource, brand);
  const [busy, start] = useTransition();
  const [photo, setPhoto] = useState("");
  const [equipPhoto, setEquipPhoto] = useState("");
  const [equipError, setEquipError] = useState("");
  const [bases, setBases] = useState<{ base_code: string; base_name_th?: string; yield_qty_ml: number }[]>([]);
  const [lemons, setLemons] = useState<{ id: string; count_uom: string }[]>([]);
  const [portion, setPortion] = useState<Record<string, string>>({});
  const [lemonCount, setLemonCount] = useState("");
  const [lemonGrams, setLemonGrams] = useState("");
  const [prepPhoto, setPrepPhoto] = useState("");
  const [confirms, setConfirms] = useState<FnbStageConfirmation[]>([]);
  const [confirmTick, setConfirmTick] = useState(0);
  useEffect(() => {
    void listStageConfirmationsAction(props.branch, props.workDate, "OPENING", props.actorSource, brand).then((loaded) => setConfirms(loaded.data));
  }, [props.branch, props.workDate, props.actorSource, brand, confirmTick]);
  function bump() { setConfirmTick((value) => value + 1); reload(); }
  useEffect(() => {
    void listWipBoardAction({ branch_code: props.branch, work_date: props.workDate, actor_source: props.actorSource, brand_lock: props.brandLock }).then((loaded) => {
      setBases(loaded.data?.bases ?? []);
      setLemons((loaded.data?.items ?? []).filter((item) => item.short_code === "LEM"));
    });
  }, [props.branch, props.workDate, props.actorSource, props.brandLock]);
  const front = board?.locations.find((row) => row.zoneType === "FRONT_DISPLAY");
  const back = board?.locations.find((row) => row.zoneType === "BACKROOM");
  return (
    <section className="space-y-4 rounded-xl border border-red-100 bg-white p-4">
      <CoworkerBanner branch={props.branch} workDate={props.workDate} stage="OPENING" actorSource={props.actorSource} brandLock={brand} reloadToken={confirmTick} />
      <h2 className="text-lg font-semibold">ช่วงที่ 1 — เปิดร้าน 7 หมวด</h2>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <article className="space-y-2">
        <h3 className="font-semibold">หมวดที่ 1: เตรียมวัตถุดิบเบสและหั่นเลมอน</h3>
        <div className="space-y-2">
          {bases.map((base) => (
            <div key={base.base_code} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2 text-sm">
              <p className="w-40 font-medium">{base.base_code} {base.yield_qty_ml.toFixed(0)} ml</p>
              {["0.25", "0.5", "0.75", "1", "SKIP"].map((part) => (
                <button key={part} type="button" className={`rounded-full px-3 py-1 ${portion[base.base_code] === part ? "bg-[var(--fnb-brand)] text-white" : "bg-white"}`} onClick={() => setPortion((current) => ({ ...current, [base.base_code]: part }))}>
                  {part === "SKIP" ? "มีของเดิม/ยังไม่ต้ม" : `${Math.round(Number(part) * 100)}% (${Math.round(base.yield_qty_ml * Number(part))} ml)`}
                </button>
              ))}
            </div>
          ))}
          <div className="flex flex-wrap items-end gap-3 rounded-lg bg-slate-50 p-2">
            <label className="text-sm">หั่นเลมอน จำนวนลูก<FnbQtyInput value={lemonCount} onChange={setLemonCount} unit="ลูก" /></label>
            <label className="text-sm">น้ำหนักเนื้อ<FnbQtyInput value={lemonGrams} onChange={setLemonGrams} unit="g" /></label>
          </div>
          <LiveWatermarkCamera branchCode={props.branch} stage="OPENING" staffName={props.staffName} taskTitle="เตรียมเบสและหั่นเลมอน" liveCameraOnly onCapture={(file, live) => void uploadShot(file, live, props.branch, props.actorSource, brand).then(setPrepPhoto).catch((reason: Error) => toast.error(reason.message))} />
          <button type="button" className="rounded-md bg-[var(--fnb-brand)] px-3 py-2 text-sm text-white" disabled={busy} onClick={() => start(async () => {
            if (!prepPhoto) { toast.error("ถ่ายรูปสดหมวดที่ 1 ก่อนบันทึก"); return; }
            if (bases.some((base) => !portion[base.base_code]) || lemonCount === "" || lemonGrams === "") { toast.error("เลือกสัดส่วนทุกเบส และกรอกเลมอนให้ครบ"); return; }
            for (const base of bases) {
              if (portion[base.base_code] === "SKIP") continue;
              const body = new FormData();
              body.set("actor_source", props.actorSource);
              body.set("brand_lock", brand);
              body.set("branch_code", props.branch);
              body.set("work_date", props.workDate);
              body.set("batch_kind", "PREP_BASE");
              body.set("brew_portion_mode", "FULL_RECIPE");
              body.set("prep_base_code", base.base_code);
              body.set("pack_qty", portion[base.base_code]);
              body.set("photo_urls", prepPhoto);
              body.set("shift_instance", "SHIFT_1");
              const saved = await issueWipBatchAction(body);
              if (saved.error || !saved.data.ok) { toast.error(saved.error || saved.data.message || `ต้ม ${base.base_code} ไม่สำเร็จ`); return; }
            }
            const lemon = lemons[0];
            if (lemon && Number(lemonCount) > 0) {
              const body = new FormData();
              body.set("actor_source", props.actorSource);
              body.set("brand_lock", brand);
              body.set("branch_code", props.branch);
              body.set("work_date", props.workDate);
              body.set("batch_kind", "OPEN_ITEM");
              body.set("item_id", lemon.id);
              body.set("pack_qty", lemonCount);
              body.set("notes", `เลมอน ${lemonCount} ลูก ${lemonGrams} g`);
              body.set("photo_urls", prepPhoto);
              body.set("brew_portion_mode", "FULL_RECIPE");
              body.set("shift_instance", "SHIFT_1");
              const saved = await issueWipBatchAction(body);
              if (saved.error || !saved.data.ok) { toast.error(saved.error || "บันทึกเลมอนไม่สำเร็จ"); return; }
            }
            const again = confirms.some((row) => row.sectionKey === "SEC_1_PREP");
            await confirmStageSectionAction({ branchCode: props.branch, workDate: props.workDate, stageCode: "OPENING", sectionKey: "SEC_1_PREP", sectionTitle: "หมวด 1 เตรียมเบสและหั่นเลมอน", photoUrls: prepPhoto ? [prepPhoto] : [], actorSource: props.actorSource, brandLock: brand, isEdit: again, editReason: again ? "บันทึกหมวดนี้อีกครั้ง" : "" });
            toast.success("บันทึกหมวดที่ 1 แล้ว");
            bump();
          })}>บันทึกหมวดที่ 1</button>
        </div>
      </article>
      <article className="space-y-2">
        <h3 className="font-semibold">หมวดที่ 2: ตรวจสอบมาตรฐานอุปกรณ์</h3>
        <form className="grid gap-2 md:grid-cols-3" onSubmit={(event) => {
          event.preventDefault();
          const body = new FormData(event.currentTarget);
          const dose = Number(body.get("grinder_dose_g"));
          const seconds = Number(body.get("espresso_time_sec"));
          const yieldG = Number(body.get("espresso_yield_g"));
          const randomG = Number(body.get("syrup_random_target_g"));
          const actualG = Number(body.get("syrup_measured_actual_g"));
          if (!(dose > 0) || !(seconds > 0) || !(yieldG > 0) || !(randomG > 0) || !(actualG > 0) || !equipPhoto) {
            const note = "กรอกตัวเลขทุกช่องให้มากกว่า 0 และถ่ายรูปสดก่อนบันทึก";
            setEquipError(note);
            toast.error(note);
            return;
          }
          setEquipError("");
          body.set("branch_code", props.branch);
          body.set("work_date", props.workDate);
          body.set("actor_source", props.actorSource);
          body.set("brand_lock", brand);
          body.set("photo_urls", equipPhoto);
          start(async () => {
            const saved = await saveEquipmentCalibrationAction(body);
            if (saved.error || !saved.data.ok) toast.error(saved.error || "บันทึกอุปกรณ์ไม่สำเร็จ");
            else {
              const again = confirms.some((row) => row.sectionKey === "SEC_2_EQUIPMENT");
              await confirmStageSectionAction({ branchCode: props.branch, workDate: props.workDate, stageCode: "OPENING", sectionKey: "SEC_2_EQUIPMENT", sectionTitle: "หมวด 2 ตรวจสอบมาตรฐานอุปกรณ์", photoUrls: equipPhoto ? [equipPhoto] : [], actorSource: props.actorSource, brandLock: brand, isEdit: again, editReason: again ? "บันทึกหมวดนี้อีกครั้ง" : "" });
              toast.success(saved.data.warning || "บันทึกมาตรฐานอุปกรณ์แล้ว");
              bump();
            }
          });
        }}>
          <label className="text-sm">เครื่องบด (เป้า 19.8–20.0)<span className="mt-1 flex items-center gap-1"><input className="h-10 w-24 rounded-md border px-2 text-sm" name="grinder_dose_g" type="number" min="0.1" max="999" step="0.1" defaultValue={board?.calibration?.grinderDoseG ?? ""} /><span className="text-xs">g</span></span></label>
          <label className="text-sm">เวลาช็อต (22–28)<span className="mt-1 flex items-center gap-1"><input className="h-10 w-24 rounded-md border px-2 text-sm" name="espresso_time_sec" type="number" min="0.1" max="999" step="0.1" defaultValue={board?.calibration?.espressoTimeSec ?? ""} /><span className="text-xs">วินาที</span></span></label>
          <label className="text-sm">น้ำหนักช็อต (38–40)<span className="mt-1 flex items-center gap-1"><input className="h-10 w-24 rounded-md border px-2 text-sm" name="espresso_yield_g" type="number" min="0.1" max="999" step="0.1" defaultValue={board?.calibration?.espressoYieldG ?? ""} /><span className="text-xs">g</span></span></label>
          <label className="text-sm">ตัวเลขที่เครื่องน้ำเชื่อมสุ่ม<span className="mt-1 flex items-center gap-1"><input className="h-10 w-24 rounded-md border px-2 text-sm" name="syrup_random_target_g" type="number" min="0.1" max="999" step="0.1" defaultValue={board?.calibration?.syrupRandomG ?? ""} /><span className="text-xs">g</span></span></label>
          <label className="text-sm">น้ำหนักชั่งจริง<span className="mt-1 flex items-center gap-1"><input className="h-10 w-24 rounded-md border px-2 text-sm" name="syrup_measured_actual_g" type="number" min="0.1" max="999" step="0.1" defaultValue={board?.calibration?.syrupActualG ?? ""} /><span className="text-xs">g</span></span></label>
          <label className="flex items-center gap-2 text-sm"><input name="syrup_adjusted_ok" type="checkbox" value="true" defaultChecked={board?.calibration?.syrupAdjusted} />ปรับจูนเครื่องเรียบร้อยแล้ว</label>
          {equipError ? <p className="text-sm text-red-700 md:col-span-3">{equipError}</p> : null}
          <LiveWatermarkCamera branchCode={props.branch} stage="OPENING" staffName={props.staffName} taskTitle="เช็คมาตรฐานอุปกรณ์" liveCameraOnly onCapture={(file, live) => void uploadShot(file, live, props.branch, props.actorSource, brand).then(setEquipPhoto).catch((reason: Error) => toast.error(reason.message))} />
          <button className="rounded-md bg-[var(--fnb-brand)] px-3 py-2 text-sm text-white" disabled={busy}>บันทึกหมวดที่ 2</button>
        </form>
      </article>
      <article className="space-y-2">
        <h3 className="font-semibold">หมวดที่ 3: ซอสและวัตถุดิบเปิดใช้หน้าบาร์</h3>
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
        <button type="button" className="rounded-md border px-3 py-2 text-sm" onClick={() => start(async () => {
          const again = confirms.some((row) => row.sectionKey === "SEC_3_SAUCE");
          const saved = await confirmStageSectionAction({ branchCode: props.branch, workDate: props.workDate, stageCode: "OPENING", sectionKey: "SEC_3_SAUCE", sectionTitle: "หมวด 3 ซอสและวัตถุดิบเปิดใช้", photoUrls: photo ? [photo] : [], actorSource: props.actorSource, brandLock: brand, isEdit: again, editReason: again ? "บันทึกหมวดนี้อีกครั้ง" : "" });
          if (saved.error || !saved.data.ok) toast.error(saved.error || "ยืนยันหมวด 3 ไม่สำเร็จ");
          else { toast.success("ยืนยันหมวดที่ 3 แล้ว"); bump(); }
        })}>ยืนยันหมวดที่ 3</button>
      </article>
      <article className="space-y-2">
        <h3 className="font-semibold">หมวดที่ 4–5: ตู้แช่เบเกอรี่ ตู้ไอศกรีม และชั้นโชว์ของพรีเมียม</h3>
        <DisplayCabinetGrid
          lines={board?.frontOpeningLines ?? []}
          lots={board?.displayLots ?? []}
          today={props.workDate}
          branch={props.branch}
          workDate={props.workDate}
          actorSource={props.actorSource}
          brand={brand}
          frontCode={front?.locationCode ?? ""}
          backCode={back?.locationCode ?? ""}
          onDone={bump}
        />
        <WriteOffButton branch={props.branch} workDate={props.workDate} actorSource={props.actorSource} brand={props.brandLock ?? "LUCKY_CUP"} staffName={props.staffName} locations={board?.locations ?? []} onDone={bump} />
      </article>
      <article className="space-y-2">
        <h3 className="font-semibold">หมวด 6: เงินสดตั้งต้นในเก๊ะ</h3>
        <CashFloatConfirm title="หมวด 6 เงินสดตั้งต้นในเก๊ะ" sectionKey="SEC_6_CASH_FLOAT" stage="OPENING" expected={props.cashFloat && props.cashFloat > 0 ? props.cashFloat : 1200} branch={props.branch} workDate={props.workDate} actorSource={props.actorSource} brand={brand} staffName={props.staffName} saved={confirms.find((row) => row.sectionKey === "SEC_6_CASH_FLOAT") ?? null} onDone={bump} />
      </article>
      <CleaningSpots title="หมวด 7 ความสะอาดเปิดร้าน" stage="OPENING" spots={board?.openingSpots ?? []} confirmations={confirms} branch={props.branch} workDate={props.workDate} actorSource={props.actorSource} brand={brand} staffName={props.staffName} onDone={bump} />
    </section>
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
        <WriteOffButton branch={props.branch} workDate={props.workDate} actorSource={props.actorSource} brand={props.brand} staffName={props.staffName} locations={board?.locations ?? []} onDone={reload} />
      </div>
      {open === "base" ? (
        <div className="space-y-2">
          <select className={field} value={baseCode} onChange={(event) => setBaseCode(event.target.value)}>{bases.map((base) => <option key={base.base_code} value={base.base_code}>{base.base_code} · {base.yield_qty_ml.toFixed(0)} ml</option>)}</select>
          <div className="flex flex-wrap gap-2">
            {[0.25, 0.5, 0.75, 1].map((part) => (
              <button key={part} type="button" className={`rounded-full px-3 py-1 text-sm ${pct === part ? "bg-[var(--fnb-brand)] text-white" : "bg-white"}`} onClick={() => setPct(part)}>{Math.round(part * 100)}% ({Math.round((selected?.yield_qty_ml ?? 0) * part)} ml)</button>
            ))}
          </div>
          <button type="button" className="rounded-md bg-[var(--fnb-brand)] px-3 py-2 text-sm text-white" onClick={() => brew("PREP_BASE", { prep: baseCode, pack: pct })}>บันทึกต้มเบส {Math.round(pct * 100)}%</button>
        </div>
      ) : null}
      {open === "sauce" || open === "lemon" ? (
        <div className="space-y-2">
          <input className={field} value={query} placeholder="ค้น PF PS CW CWT LEM" onChange={(event) => setQuery(event.target.value)} />
          <button type="button" className="rounded-md bg-[var(--fnb-brand)] px-3 py-2 text-sm text-white" onClick={() => {
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
      <button type="button" className="rounded-md bg-[var(--fnb-brand)] px-3 py-2 text-sm text-white" onClick={() => props.onSave(itemId, Number(qty) || 0, fromCode, toCode)}>บันทึกเบิกย้ายจุด</button>
    </div>
  );
}

export function NightCloseCount(props: { branch: string; workDate: string; actorSource: "desktop" | "liff"; brandLock: FnbBrandCode | null; staffName: string; warehouseOnly?: boolean; cashFloat?: number }) {
  const brand = props.brandLock ?? "";
  const { board, error, reload } = useBoard(props.branch, props.workDate, props.actorSource, brand);
  const [confirms, setConfirms] = useState<FnbStageConfirmation[]>([]);
  const [confirmTick, setConfirmTick] = useState(0);
  useEffect(() => {
    void listStageConfirmationsAction(props.branch, props.workDate, "CLOSING", props.actorSource, brand).then((loaded) => setConfirms(loaded.data));
  }, [props.branch, props.workDate, props.actorSource, brand, confirmTick]);
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
      else {
        if (stage === "CLOSING" && locationCode === front?.locationCode) {
          await confirmStageSectionAction({ branchCode: props.branch, workDate: props.workDate, stageCode: "CLOSING", sectionKey: "SEC_3_FRONT_COUNT", sectionTitle: "หมวด 3 นับปิดหน้าร้าน", actorSource: props.actorSource, brandLock: brand });
        }
        toast.success("บันทึกยอดนับแล้ว");
      }
      setConfirmTick((value) => value + 1);
      reload();
    });
  }
  return (
    <section className="space-y-4 rounded-xl border border-red-100 bg-white p-4">
      {props.warehouseOnly ? null : <CoworkerBanner branch={props.branch} workDate={props.workDate} stage="CLOSING" actorSource={props.actorSource} brandLock={brand} reloadToken={confirmTick} />}
      <h2 className="text-lg font-semibold">{props.warehouseOnly ? "รอบนับโกดัง" : "ช่วงที่ 4 — ปิดร้านและจับของหาย"}</h2>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {props.warehouseOnly ? null : (
        <article className="space-y-2">
          <h3 className="font-semibold">หมวด 1 เงินสดคงเหลือติดเก๊ะปิดร้าน</h3>
          <CashFloatConfirm title="หมวด 1 เงินสดคงเหลือติดเก๊ะปิดร้าน" sectionKey="SEC_1_CASH_FLOAT" stage="CLOSING" expected={props.cashFloat && props.cashFloat > 0 ? props.cashFloat : 1200} branch={props.branch} workDate={props.workDate} actorSource={props.actorSource} brand={brand} staffName={props.staffName} saved={confirms.find((row) => row.sectionKey === "SEC_1_CASH_FLOAT") ?? null} onDone={() => setConfirmTick((value) => value + 1)} />
        </article>
      )}
      {props.warehouseOnly ? null : <CleaningSpots title="หมวด 2 ความสะอาดและล้างอุปกรณ์ปิดร้าน" stage="CLOSING" spots={board?.closingSpots ?? []} confirmations={confirms} branch={props.branch} workDate={props.workDate} actorSource={props.actorSource} brand={brand} staffName={props.staffName} onDone={() => setConfirmTick((value) => value + 1)} />}
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
          <button type="button" className="rounded-md bg-[var(--fnb-brand)] px-3 py-2 text-sm text-white" disabled={busy || !front} onClick={() => front && save("CLOSING", board?.frontLines ?? [], front.locationCode)}>บันทึกยอดปิดหน้าร้าน</button>
        </article>
      )}
      {props.warehouseOnly ? null : (
        <article className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold">คลังหลังร้านและวัสดุสิ้นเปลืองที่ถึงรอบคืนนี้</h3>
            <label className="text-sm"><input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} /> แสดงรายการนอกรอบทั้งหมด</label>
          </div>
          {backLines.map((line) => <CountRow key={line.itemId} line={line} qty={qty} setQty={setQty} />)}
          <button type="button" className="rounded-md bg-[var(--fnb-brand)] px-3 py-2 text-sm text-white" disabled={busy || !back} onClick={() => back && save("CLOSING", backLines, back.locationCode)}>บันทึกยอดหลังร้าน</button>
        </article>
      )}
      {board?.warehouseDue || props.warehouseOnly ? (
        <article className="space-y-2">
          <h3 className="font-semibold">โกดัง {board?.locations.find((row) => row.zoneType === "WAREHOUSE")?.locationNameTh ?? ""}</h3>
          {(board?.warehouseLines ?? []).map((line) => <CountRow key={line.itemId} line={line} qty={qty} setQty={setQty} />)}
          <button type="button" className="rounded-md bg-[var(--fnb-brand)] px-3 py-2 text-sm text-white" disabled={busy} onClick={() => {
            const warehouse = board?.locations.find((row) => row.zoneType === "WAREHOUSE");
            if (warehouse) save("CYCLE_COUNT", board?.warehouseLines ?? [], warehouse.locationCode);
          }}>บันทึกยอดโกดัง</button>
        </article>
      ) : <p className="text-sm text-slate-500">โกดังยังไม่ถึงรอบนับคืนนี้ — นับได้จากแท็บรอบนับในคลังสินค้า</p>}
      {props.warehouseOnly ? null : (
        <article className="space-y-2">
          <h3 className="font-semibold">หมวด 4 รายการเททิ้งประจำวัน</h3>
          <WriteOffButton branch={props.branch} workDate={props.workDate} actorSource={props.actorSource} brand={props.brandLock ?? "LUCKY_CUP"} staffName={props.staffName} locations={board?.locations ?? []} onDone={() => { setConfirmTick((value) => value + 1); reload(); }} />
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
      <p>เปิดเช้า {props.line.openingQty} + เบิกเติม {props.line.replenishedQty} − ขาย POS {props.line.posSoldQty} − ตัดเสีย {props.line.writeOffQty} = ควรเหลือ {props.line.expectedQty}</p>
      {missing > 0 ? <p>🚨 ของหาย {missing} ชิ้น</p> : null}
      <input className={`${field} mt-2`} type="number" step="0.01" placeholder="ยอดนับจริง" value={props.qty[key] ?? (props.line.countedQty ?? "")} onChange={(event) => props.setQty({ ...props.qty, [key]: event.target.value })} />
      {extra > 0 && props.onRetro ? <button type="button" className="mt-2 rounded-md border px-2 py-1" onClick={() => props.onRetro?.(extra)}>➕ บันทึกเบิกเติมจากคลังหลังร้านย้อนหลัง {extra} ชิ้น</button> : null}
    </div>
  );
}
