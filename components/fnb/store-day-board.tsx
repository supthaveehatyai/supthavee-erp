"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { LiveWatermarkCamera } from "@/components/fnb/live-watermark-camera";
import { postFnbInstantSave, readSectionDraft, writeSectionDraft } from "@/lib/fnb/instant-client";
import {
  getStoreDayBoardAction,
  replenishZoneAction,
  saveDisplaySectionCountsAction,
  saveEquipmentCalibrationAction,
  saveZoneCountsAction,
} from "@/lib/actions/fnb-store-day";
import { issueCatchWeightProduceSliceAction } from "@/lib/actions/fnb-produce";
import { issueWipBatchAction, listWipBoardAction } from "@/lib/actions/fnb-wip";
import { ProduceSliceFields, ProduceSliceForm } from "@/components/fnb/produce-slice-form";
import { ProduceWasteForm } from "@/components/fnb/produce-waste-form";
import { produceProfile } from "@/lib/utils/fnb-format";
import { FnbQtyInput } from "@/components/fnb/fnb-qty-input";
import { CashFloatConfirm } from "@/components/fnb/cash-float-confirm";
import { CleaningSpots } from "@/components/fnb/cleaning-spots";
import { CoworkerBanner } from "@/components/fnb/coworker-banner";
import { DisplayCabinetGrid } from "@/components/fnb/display-cabinet-grid";
import { ShiftDrinkRemakeModal } from "@/components/fnb/shift-incident-block";
import { WriteOffButton } from "@/components/fnb/write-off-panel";
import { confirmStageSectionAction, listStageConfirmationsAction } from "@/lib/actions/fnb-stage";
import { findSection, LockedSectionCard, UnsavedDraftBar } from "@/components/fnb/section-confirm-card";
import { crewAssist, useLiveBranch } from "@/components/fnb/shift-crew-bar";
import { barItemLabel, barOpenItems, itemMatches, prepBaseLabel } from "@/lib/fnb/item-search";
import { OpeningSauceCards } from "@/components/fnb/opening-sauce-cards";
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

function prepSummary(row: FnbStageConfirmation) {
  const bases = Array.isArray(row.payload.bases) ? row.payload.bases : [];
  const parts = bases.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const rec = item as Record<string, unknown>;
    const code = String(rec.code ?? "");
    if (rec.portion === "SKIP" || rec.portion === "SKIP_EXISTING") return [`${code} มีของเดิม`];
    const pct = Math.round(Number(rec.portion) * 100);
    return [`${code} ${pct}% (${Number(rec.ml) || 0} ml)`];
  });
  const produce = Array.isArray(row.payload.produce) ? row.payload.produce : [];
  if (produce.length > 0) {
    for (const item of produce) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const pieces = Number(rec.pieces) || 0;
      if (pieces > 0) parts.push(`${String(rec.name || "ผลไม้")} ${pieces} ${String(rec.label || "ลูก")}`);
    }
  } else {
    const lemons = Number(row.payload.lemons);
    if (Number.isFinite(lemons)) parts.push(lemons > 0 ? `เลมอน ${lemons} ลูก` : "เลมอน มีของเดิม/ยังไม่หั่น");
  }
  return parts.join(", ") || row.sectionTitle;
}

export function OpeningChecklist(props: { branch: string; workDate: string; actorSource: "desktop" | "liff"; brandLock: FnbBrandCode | null; staffName: string; cashFloat?: number }) {
  const brand = props.brandLock ?? "";
  const live = useLiveBranch();
  const { board, error, reload } = useBoard(props.branch, props.workDate, props.actorSource, brand);
  const [busy, start] = useTransition();
  const [equipPhoto, setEquipPhoto] = useState("");
  const [equipError, setEquipError] = useState("");
  const [bases, setBases] = useState<{ base_code: string; base_name_th?: string; yield_qty_ml: number; sort_order?: number }[]>([]);
  const [fruits, setFruits] = useState<{ id: string; short_code: string; name_th: string; is_catch_weight_produce?: boolean; piece_uom_label?: string; avg_gross_grams_per_piece?: number; prep_yield_pct?: number }[]>([]);
  const [portion, setPortion] = useState<Record<string, string>>({});
  const [slices, setSlices] = useState<Record<string, { pieces: string; grams: string }>>({});
  const [prepPhoto, setPrepPhoto] = useState("");
  const [missingBase, setMissingBase] = useState("");
  const [photoMissing, setPhotoMissing] = useState(false);
  const [reopen, setReopen] = useState<string | null>(null);
  const [reviseKey, setReviseKey] = useState<string | null>(null);
  const [reviseReason, setReviseReason] = useState("");
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const cameraRef = useRef<HTMLDivElement | null>(null);
  const prefilled = useRef(false);
  const [confirms, setConfirms] = useState<FnbStageConfirmation[]>([]);
  const [confirmTick, setConfirmTick] = useState(0);
  useEffect(() => {
    void listStageConfirmationsAction(props.branch, props.workDate, "OPENING", props.actorSource, brand).then((loaded) => setConfirms(loaded.data));
  }, [props.branch, props.workDate, props.actorSource, brand, confirmTick]);
  function bump() { setConfirmTick((value) => value + 1); reload(); }
  useEffect(() => {
    void listWipBoardAction({ branch_code: props.branch, work_date: props.workDate, actor_source: props.actorSource, brand_lock: props.brandLock }).then((loaded) => {
      setBases(loaded.data?.bases ?? []);
      setFruits((loaded.data?.items ?? []).filter((item) => item.is_catch_weight_produce === true));
    });
  }, [props.branch, props.workDate, props.actorSource, props.brandLock]);
  const openingConfirms = live.snapshot ? live.snapshot.confirmations.filter((row) => row.stageCode === "OPENING") : confirms;
  const shownBases = live.snapshot?.prepBases.length ? live.snapshot.prepBases.map((base) => ({ base_code: base.baseCode, base_name_th: base.baseNameTh, yield_qty_ml: base.yieldQtyMl, sort_order: base.sortOrder })) : bases;
  const prepSaved = findSection(openingConfirms, ["SEC_1_PREP"]);
  const equipSaved = findSection(openingConfirms, ["SEC_2_EQUIP", "SEC_2_EQUIPMENT"]);
  const sauceSaved = findSection(openingConfirms, ["SEC_3_SAUCE"]);
  const prepDirty = !prepSaved && (
    shownBases.some((base) => Boolean(portion[base.base_code]) && !(base.base_code === "CCF" && portion[base.base_code] === "SKIP_EXISTING"))
    || fruits.some((item) => {
      const row = slices[item.id];
      return Boolean(row && row.pieces !== "" && row.pieces !== "0");
    })
    || Boolean(prepPhoto)
  );
  function portionOf(code: string): string {
    if (portion[code]) return portion[code];
    return code === "CCF" ? "SKIP_EXISTING" : "";
  }
  function isSkip(part: string): boolean {
    return part === "SKIP" || part === "SKIP_EXISTING";
  }
  function assist() {
    return crewAssist(live);
  }
  const viewerId = live.snapshot?.viewer.userId ?? "";
  const inCrew = (live.snapshot?.rosters ?? []).some((roster) => roster.members.some((member) => member.userId === viewerId));
  const canRevise = live.snapshot?.viewer.isSuperAdmin === true || live.snapshot?.viewer.workspaceRole === "FNB_BRANCH_MANAGER" || inCrew;
  useEffect(() => {
    if (reopen !== "SEC_1_PREP") { prefilled.current = false; return; }
    if (prefilled.current || !prepSaved) return;
    prefilled.current = true;
    const next: Record<string, string> = {};
    const bases = Array.isArray(prepSaved.payload.bases) ? prepSaved.payload.bases : [];
    for (const item of bases) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const code = String(rec.code ?? "");
      if (code) next[code] = String(rec.portion ?? "");
    }
    setPortion(next);
    const savedProduce = Array.isArray(prepSaved.payload.produce) ? prepSaved.payload.produce : [];
    const nextSlices: Record<string, { pieces: string; grams: string }> = {};
    for (const item of savedProduce) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const id = String(rec.id ?? "");
      if (id) nextSlices[id] = { pieces: String(rec.pieces ?? "0"), grams: Number(rec.grams) > 0 ? String(rec.grams) : "" };
    }
    if (Object.keys(nextSlices).length === 0 && prepSaved.payload.lemons != null) {
      const first = fruits[0];
      if (first) nextSlices[first.id] = { pieces: String(prepSaved.payload.lemons ?? "0"), grams: Number(prepSaved.payload.lemonGrams) > 0 ? String(prepSaved.payload.lemonGrams) : "" };
    }
    setSlices(nextSlices);
  }, [prepSaved, reopen]);
  const front = board?.locations.find((row) => row.zoneType === "FRONT_DISPLAY");
  const back = board?.locations.find((row) => row.zoneType === "BACKROOM");
  return (
    <section className="space-y-4 rounded-xl border border-red-100 bg-white p-4">
      <CoworkerBanner branch={props.branch} workDate={props.workDate} stage="OPENING" actorSource={props.actorSource} brandLock={brand} reloadToken={confirmTick} />
      <h2 className="text-lg font-semibold">ช่วงที่ 1 — เปิดร้าน 7 หมวด</h2>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <article className="space-y-2">
        <h3 className="font-semibold">หมวดที่ 1: เตรียมวัตถุดิบเบสและหั่นเลมอน</h3>
        {prepSaved && reopen !== "SEC_1_PREP" ? <LockedSectionCard row={prepSaved} summary={prepSummary(prepSaved)} onRevise={canRevise ? () => { setReviseReason(""); setReviseKey("SEC_1_PREP"); } : undefined} /> : <div className="space-y-2">
          {[...shownBases].sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0) || left.base_code.localeCompare(right.base_code)).map((base) => (
            <div key={base.base_code} ref={(node) => { rowRefs.current[base.base_code] = node; }} className={`flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2 text-sm ${missingBase === base.base_code ? "ring-2 ring-red-600" : ""}`}>
              <div className="min-w-44">
                <p className="font-bold">{base.base_code} · {base.base_name_th || base.base_code}</p>
                <p className="text-xs text-slate-500">(เต็มสูตร {base.yield_qty_ml.toLocaleString("th-TH", { maximumFractionDigits: 0 })} ml)</p>
              </div>
              {["0.25", "0.5", "0.75", "1", "SKIP_EXISTING"].map((part) => (
                <button key={part} type="button" className={`rounded-full px-3 py-1 ${portionOf(base.base_code) === part ? "bg-[#DC2626] text-white" : "bg-white ring-1 ring-slate-200"}`} onClick={() => { setMissingBase(""); setPortion((current) => ({ ...current, [base.base_code]: part })); }}>
                  {part === "SKIP_EXISTING" ? "มีของเดิม/ยังไม่ต้ม" : `${Math.round(Number(part) * 100)}% (${Math.round(base.yield_qty_ml * Number(part))} ml)`}
                </button>
              ))}
            </div>
          ))}
          {fruits.map((item) => {
            const profile = produceProfile(item);
            const row = slices[item.id] ?? { pieces: "0", grams: "" };
            return (
              <div key={item.id} className="rounded-lg bg-slate-50 p-2">
                <p className="mb-1 text-sm font-semibold">{item.short_code} · {item.name_th}</p>
                <ProduceSliceFields
                  label={profile.label}
                  usablePerPiece={profile.usablePerPiece}
                  pieces={row.pieces}
                  grams={row.grams}
                  onPieces={(value) => setSlices((current) => ({ ...current, [item.id]: { pieces: value, grams: current[item.id]?.grams ?? "" } }))}
                  onGrams={(value) => setSlices((current) => ({ ...current, [item.id]: { pieces: current[item.id]?.pieces ?? "0", grams: value } }))}
                />
              </div>
            );
          })}
          <div ref={cameraRef} className={photoMissing ? "rounded-xl ring-2 ring-red-600" : ""}>
            <LiveWatermarkCamera branchCode={props.branch} stage="OPENING" staffName={props.staffName} taskTitle="เตรียมเบสและหั่นเลมอน" liveCameraOnly onUploaded={(url) => { setPhotoMissing(false); setPrepPhoto(url); writeSectionDraft(props.branch, props.workDate, "SEC_1_PREP", { photo: url }); }} />
          </div>
          <button type="button" className="rounded-md bg-[#DC2626] px-3 py-2 text-sm text-white disabled:opacity-60" disabled={busy} onClick={() => start(async () => {
            const missing = shownBases.find((base) => !portionOf(base.base_code));
            if (missing) {
              setMissingBase(missing.base_code);
              rowRefs.current[missing.base_code]?.scrollIntoView({ behavior: "smooth", block: "center" });
              toast.error(`กรุณาเลือกสัดส่วนการต้มของ ${missing.base_name_th || missing.base_code}`);
              return;
            }
            if (!prepPhoto) {
              setPhotoMissing(true);
              cameraRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
              toast.error("กรุณาถ่ายรูปสดวัตถุดิบเบส 1 ใบก่อนกดบันทึกหมวดที่ 1");
              return;
            }
            for (const base of shownBases) {
              const chosen = portionOf(base.base_code);
              if (isSkip(chosen)) continue;
              const body = new FormData();
              body.set("actor_source", props.actorSource);
              body.set("brand_lock", brand);
              body.set("branch_code", props.branch);
              body.set("work_date", props.workDate);
              body.set("batch_kind", "PREP_BASE");
              body.set("brew_portion_mode", "FULL_RECIPE");
              body.set("prep_base_code", base.base_code);
              body.set("pack_qty", chosen);
              body.set("photo_urls", prepPhoto);
              body.set("shift_instance", "SHIFT_1");
              const saved = await issueWipBatchAction(body);
              if (saved.error || !saved.data.ok) { toast.error(saved.error || saved.data.message || `ต้ม ${base.base_code} ไม่สำเร็จ`); return; }
            }
            const sliced = fruits.flatMap((item) => {
              const profile = produceProfile(item);
              const row = slices[item.id];
              const pieces = Math.trunc(Number(row?.pieces) || 0);
              const grams = row?.grams === "" || row?.grams == null ? 0 : Number(row.grams) || 0;
              return pieces > 0 ? [{ item, profile, pieces, grams }] : [];
            });
            for (const row of sliced) {
              const saved = await issueCatchWeightProduceSliceAction({
                branch_code: props.branch,
                work_date: props.workDate,
                shift_instance: "SHIFT_1",
                item_id: row.item.id,
                piece_count: row.pieces,
                actual_sliced_grams: row.grams > 0 ? row.grams : null,
                photo_urls: prepPhoto ? [prepPhoto] : [],
                notes: `หั่น${row.item.name_th} ${row.pieces} ${row.profile.label}`,
                actor_source: props.actorSource,
                brand_lock: brand,
              });
              if (saved.error || !saved.data.ok) { toast.error(saved.error || saved.data.message || `บันทึกหั่น${row.item.name_th}ไม่สำเร็จ`); return; }
            }
            const confirmed = await confirmStageSectionAction({
              branchCode: props.branch, workDate: props.workDate, stageCode: "OPENING", sectionKey: "SEC_1_PREP", sectionTitle: "หมวดที่ 1: เตรียมวัตถุดิบเบสและหั่นเลมอน",
              photoUrls: prepPhoto ? [prepPhoto] : [], actorSource: props.actorSource, brandLock: brand, shiftSlot: "SHIFT_1", ...assist(),
              payload: {
                bases: shownBases.map((base) => ({ code: base.base_code, portion: portionOf(base.base_code), ml: isSkip(portionOf(base.base_code)) ? 0 : Math.round(base.yield_qty_ml * Number(portionOf(base.base_code))) })),
                lemons: sliced[0]?.pieces ?? 0,
                lemonGrams: sliced[0]?.grams ?? 0,
                produce: sliced.map((row) => ({ id: row.item.id, name: row.item.name_th, pieces: row.pieces, grams: row.grams, label: row.profile.label, usable: row.grams > 0 ? row.grams : row.pieces * row.profile.usablePerPiece, estimated: row.grams <= 0 })),
              },
            });
            if (confirmed.error || !confirmed.data.ok) { toast.error(confirmed.error || "ยืนยันหมวดที่ 1 ไม่สำเร็จ"); return; }
            toast.success("บันทึกหมวดที่ 1 แล้ว");
            setReopen(null);
            void live.refresh();
            bump();
          })}>{busy ? "กำลังบันทึก..." : "💾 บันทึกยืนยันหมวดที่ 1"}</button>
          {prepDirty ? <UnsavedDraftBar sectionNo={1} /> : null}
        </div>}
      </article>
      <article className="space-y-2">
        <h3 className="font-semibold">หมวดที่ 2: ตรวจสอบมาตรฐานอุปกรณ์</h3>
        {equipSaved && reopen !== "SEC_2_EQUIP" ? <LockedSectionCard row={equipSaved} summary={`บด ${live.snapshot?.calibration?.grinderDoseG ?? "-"} g · ช็อต ${live.snapshot?.calibration?.espressoTimeSec ?? "-"} วิ · น้ำหนัก ${live.snapshot?.calibration?.espressoYieldG ?? "-"} g`} onRevise={canRevise ? () => { setReviseReason(""); setReviseKey("SEC_2_EQUIP"); } : undefined} /> : <form className="grid gap-2 md:grid-cols-3" onSubmit={(event) => {
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
              await confirmStageSectionAction({ branchCode: props.branch, workDate: props.workDate, stageCode: "OPENING", sectionKey: "SEC_2_EQUIP", sectionTitle: "หมวดที่ 2: ตรวจสอบมาตรฐานอุปกรณ์", photoUrls: equipPhoto ? [equipPhoto] : [], actorSource: props.actorSource, brandLock: brand, shiftSlot: "SHIFT_1", payload: { grinderDoseG: dose, espressoTimeSec: seconds, espressoYieldG: yieldG, syrupRandomG: randomG, syrupActualG: actualG }, ...assist() });
              toast.success(saved.data.warning || "บันทึกมาตรฐานอุปกรณ์แล้ว");
              void live.refresh();
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
          <LiveWatermarkCamera branchCode={props.branch} stage="OPENING" staffName={props.staffName} taskTitle="เช็คมาตรฐานอุปกรณ์" liveCameraOnly onUploaded={(url) => { setEquipPhoto(url); writeSectionDraft(props.branch, props.workDate, "SEC_2_EQUIP", { photo: url }); }} />
          <button className="rounded-md bg-[#DC2626] px-3 py-2 text-sm text-white disabled:opacity-60" disabled={busy}>{busy ? "กำลังบันทึก..." : "💾 บันทึกยืนยันหมวดที่ 2"}</button>
        </form>}
      </article>
      <article className="space-y-2">
        <h3 className="font-semibold">หมวดที่ 3: ซอสและวัตถุดิบเปิดใช้หน้าบาร์</h3>
        {sauceSaved && reopen !== "SEC_3_SAUCE" ? <LockedSectionCard row={sauceSaved} summary={openBarSummary(live.snapshot?.wipBatches ?? [])} onRevise={canRevise ? () => { setReviseReason(""); setReviseKey("SEC_3_SAUCE"); } : undefined} /> : <>
        <OpeningSauceCards sauces={board?.sauces ?? []} branch={props.branch} workDate={props.workDate} actorSource={props.actorSource} brand={brand} staffName={props.staffName} onDone={bump} />
        <button type="button" className="rounded-md bg-[var(--fnb-brand)] px-3 py-2 text-sm text-white" onClick={() => start(async () => {
          const saved = await confirmStageSectionAction({ branchCode: props.branch, workDate: props.workDate, stageCode: "OPENING", sectionKey: "SEC_3_SAUCE", sectionTitle: "หมวดที่ 3: ซอสและวัตถุดิบเปิดใช้หน้าบาร์", actorSource: props.actorSource, brandLock: brand, shiftSlot: "SHIFT_1", payload: { sauces: (board?.sauces ?? []).map((sauce) => ({ code: sauce.code, name: sauce.nameTh, expiresAt: sauce.expiresAt })) }, ...assist() });
          if (saved.error || !saved.data.ok) toast.error(saved.error || "ยืนยันหมวด 3 ไม่สำเร็จ");
          else { toast.success("ยืนยันหมวดที่ 3 แล้ว"); void live.refresh(); bump(); }
        })}>💾 บันทึกยืนยันหมวดที่ 3</button>
        </>}
      </article>
      <article className="space-y-2">
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
          reopen={reopen}
          onRevise={canRevise ? (key) => { setReviseReason(""); setReviseKey(key); } : undefined}
          onDone={() => { setReopen(null); bump(); }}
        />
        <WriteOffButton branch={props.branch} workDate={props.workDate} actorSource={props.actorSource} brand={props.brandLock ?? "LUCKY_CUP"} staffName={props.staffName} locations={board?.locations ?? []} onDone={bump} />
      </article>
      <article className="space-y-2">
        <h3 className="font-semibold">หมวดที่ 6: เงินสดตั้งต้นในเก๊ะ</h3>
        <CashFloatConfirm title={`หมวดที่ 6: เงินสดตั้งต้นในเก๊ะ ${(props.cashFloat && props.cashFloat > 0 ? props.cashFloat : 1200).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`} sectionKey="SEC_6_CASH_FLOAT" stage="OPENING" expected={props.cashFloat && props.cashFloat > 0 ? props.cashFloat : 1200} branch={props.branch} workDate={props.workDate} actorSource={props.actorSource} brand={brand} staffName={props.staffName} saved={confirms.find((row) => row.sectionKey === "SEC_6_CASH_FLOAT") ?? null} onDone={bump} />
      </article>
      <CleaningSpots title="หมวดที่ 7: ความสะอาดเปิดร้าน" stage="OPENING" spots={board?.openingSpots ?? []} confirmations={confirms} branch={props.branch} workDate={props.workDate} actorSource={props.actorSource} brand={brand} staffName={props.staffName} onDone={bump} />
      {reviseKey ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 sm:items-center">
          <div className="w-full max-w-md space-y-3 rounded-2xl bg-white p-4">
            <h3 className="text-lg font-bold">เหตุผลการเข้าช่วยเหลือ/แก้ไข</h3>
            <input className="h-11 w-full rounded-md border px-3" value={reviseReason} onChange={(event) => setReviseReason(event.target.value)} placeholder="อย่างน้อย 3 ตัวอักษร" />
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="rounded-xl border px-3 py-3 text-sm" onClick={() => setReviseKey(null)}>ย้อนกลับ</button>
              <button type="button" className="rounded-xl bg-[#DC2626] px-3 py-3 text-sm font-bold text-white" onClick={() => {
                if (!live.armAssist(reviseReason)) { toast.error("ระบุเหตุผลการเข้าช่วยเหลือ/แก้ไข (อย่างน้อย 3 ตัวอักษร)"); return; }
                setReopen(reviseKey);
                setReviseKey(null);
              }}>ยืนยันและแก้ไขหมวดนี้</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function lockedShift(): "MORNING" | "AFTERNOON" {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: "Asia/Bangkok" }).format(new Date()));
  return hour >= 14 ? "AFTERNOON" : "MORNING";
}

function RemakeShortcut(props: { branch: string; workDate: string; actorSource: "desktop" | "liff"; brand: FnbBrandCode; staffName: string }) {
  const [open, setOpen] = useState(false);
  const shift = lockedShift();
  return (
    <>
      <button type="button" className="rounded-md border border-red-300 bg-white px-3 py-2 text-sm" onClick={() => setOpen(true)}>🥤 แจ้งทำเมนูผิด / ชงใหม่</button>
      <ShiftDrinkRemakeModal open={open} onClose={() => setOpen(false)} branch={props.branch} workDate={props.workDate} brand={props.brand} actorSource={props.actorSource} staffName={props.staffName} shiftType={shift} onDone={() => setOpen(false)} />
    </>
  );
}

export function MiddayShortcuts(props: { branch: string; workDate: string; actorSource: "desktop" | "liff"; brandLock: FnbBrandCode | null; staffName: string; brand: FnbBrandCode }) {
  const brandLock = props.brandLock ?? "";
  const { board, reload } = useBoard(props.branch, props.workDate, props.actorSource, brandLock);
  const live = useLiveBranch();
  const [open, setOpen] = useState<"base" | "sauce" | "lemon" | "move" | null>(null);
  const [pct, setPct] = useState(1);
  const [bases, setBases] = useState<{ base_code: string; base_name_th?: string; yield_qty_ml: number; sort_order?: number }[]>([]);
  const [items, setItems] = useState<{ id: string; short_code: string; name_th: string; count_uom?: string; alias_codes: string[]; external_code: string | null; item_category?: string; has_open_shelf_rule?: boolean; is_catch_weight_produce?: boolean; piece_uom_label?: string; avg_gross_grams_per_piece?: number; prep_yield_pct?: number }[]>([]);
  const [query, setQuery] = useState("");
  const [sauceId, setSauceId] = useState("");
  const [baseCode, setBaseCode] = useState("JT");
  useEffect(() => {
    void listWipBoardAction({ branch_code: props.branch, work_date: props.workDate, actor_source: props.actorSource, brand_lock: props.brand }).then((loaded) => {
      setBases(loaded.data?.bases ?? []);
      setItems(loaded.data?.items ?? []);
    });
  }, [props.branch, props.workDate, props.actorSource, props.brand]);
  const orderedBases = [...bases].sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0) || left.base_code.localeCompare(right.base_code));
  const selected = orderedBases.find((base) => base.base_code === baseCode) ?? orderedBases[0];
  const barItems = barOpenItems(items).filter((item) => itemMatches(query, item));
  const visible = items.filter((item) => itemMatches(query, item)).slice(0, 40);
  const sauceItem = barItems.find((item) => item.id === sauceId) ?? barItems[0];
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
        <button type="button" className="rounded-full bg-white px-3 py-1 text-sm" onClick={() => setOpen("lemon")}>🍋 หั่นเลมอนเพิ่ม / หั่นผลไม้สด</button>
        <button type="button" className="rounded-full bg-white px-3 py-1 text-sm" onClick={() => setOpen("move")}>เบิกย้ายจุดจัดเก็บ</button>
        <WriteOffButton branch={props.branch} workDate={props.workDate} actorSource={props.actorSource} brand={props.brand} staffName={props.staffName} locations={board?.locations ?? []} shiftType={lockedShift()} onDone={reload} />
        <RemakeShortcut branch={props.branch} workDate={props.workDate} actorSource={props.actorSource} brand={props.brand} staffName={props.staffName} />
      </div>
      {open === "base" ? (
        <div className="space-y-2">
          <select className={field} value={selected?.base_code ?? baseCode} onChange={(event) => setBaseCode(event.target.value)}>{orderedBases.map((base) => <option key={base.base_code} value={base.base_code}>{prepBaseLabel(base)}</option>)}</select>
          <div className="flex flex-wrap gap-2">
            {[0.25, 0.5, 0.75, 1].map((part) => (
              <button key={part} type="button" className={`rounded-full px-3 py-1 text-sm ${pct === part ? "bg-[var(--fnb-brand)] text-white" : "bg-white"}`} onClick={() => setPct(part)}>{Math.round(part * 100)}% ({Math.round((selected?.yield_qty_ml ?? 0) * part)} ml)</button>
            ))}
          </div>
          <button type="button" className="rounded-md bg-[var(--fnb-brand)] px-3 py-2 text-sm text-white" onClick={() => brew("PREP_BASE", { prep: baseCode, pack: pct })}>บันทึกต้มเบส {Math.round(pct * 100)}%</button>
        </div>
      ) : null}
      {open === "lemon" ? (
        <ProduceSliceForm
          items={items}
          branch={props.branch}
          workDate={props.workDate}
          actorSource={props.actorSource}
          brand={props.brand}
          staffName={props.staffName}
          shiftInstance={live.shiftSlot || "SHIFT_1"}
          onSaved={reload}
        />
      ) : null}
      {open === "sauce" ? (
        <div className="space-y-2">
          <input className={field} value={query} placeholder="ค้นรหัสหรือชื่อวัตถุดิบชง" onChange={(event) => setQuery(event.target.value)} />
          <select className={field} value={sauceItem?.id ?? ""} onChange={(event) => setSauceId(event.target.value)}>{barItems.map((item) => <option key={item.id} value={item.id}>{barItemLabel(item)}</option>)}</select>
          <button type="button" className="rounded-md bg-[var(--fnb-brand)] px-3 py-2 text-sm text-white" onClick={() => {
            const item = sauceItem;
            if (!item) return;
            brew("OPEN_ITEM", { itemId: item.id, pack: 1, notes: "เทซอสขวดใหม่" });
          }}>{`เทขวดใหม่ ${sauceItem?.short_code ?? ""}`}</button>
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
  const live = useLiveBranch();
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
      const assist = crewAssist(live);
      if (stage === "CLOSING" && locationCode === front?.locationCode) {
        const saved = await saveDisplaySectionCountsAction({
          branchCode: props.branch,
          workDate: props.workDate,
          stageCode: "CLOSING",
          sectionKey: "CLOSE_3_FRONT",
          sectionTitle: "หมวดที่ 3 ปิดร้าน: นับของหน้าร้าน",
          items: payload.map((line) => ({ itemId: line.itemId, countedQty: line.countedQty })),
          actorSource: props.actorSource,
          brandLock: brand,
          isEdit: confirms.some((row) => row.sectionKey === "CLOSE_3_FRONT"),
          editReason: assist.editReason || (confirms.some((row) => row.sectionKey === "CLOSE_3_FRONT") ? "นับปิดร้านรอบนี้" : ""),
        });
        if (saved.error || saved.data.ok !== true) { toast.error(saved.error || "บันทึกยอดนับไม่สำเร็จ"); return; }
        toast.success("บันทึกยอดนับแล้ว");
        void live.refresh();
        setConfirmTick((value) => value + 1);
        reload();
        return;
      }
      const saved = await saveZoneCountsAction({ branchCode: props.branch, workDate: props.workDate, stage, actorSource: props.actorSource, brandLock: brand, lines: payload });
      if (saved.error || !saved.data.ok) toast.error(saved.error || "บันทึกยอดนับไม่สำเร็จ");
      else {
        if (stage === "CLOSING" && locationCode !== front?.locationCode) {
          const confirmed = await confirmStageSectionAction({ branchCode: props.branch, workDate: props.workDate, stageCode: "CLOSING", sectionKey: "CLOSE_4_BACKROOM", sectionTitle: "หมวดที่ 4 ปิดร้าน: นับหลังร้านและของเสีย", actorSource: props.actorSource, brandLock: brand, shiftSlot: "SHIFT_2", payload: { lines: payload }, ...assist });
          if (confirmed.error || !confirmed.data.ok) { toast.error(confirmed.error || "ยืนยันหมวดที่ 4 ไม่สำเร็จ"); return; }
        }
        toast.success("บันทึกยอดนับแล้ว");
        void live.refresh();
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
      {Object.values(qty).some((value) => value !== "") ? <UnsavedDraftBar sectionNo={3} /> : null}
      {props.warehouseOnly ? null : (
        <article className="space-y-2">
          <h3 className="font-semibold">หมวดที่ 1 ปิดร้าน: เงินสดคงเหลือติดเก๊ะ</h3>
          <CashFloatConfirm title="หมวดที่ 1 ปิดร้าน: เงินสดคงเหลือติดเก๊ะ" sectionKey="CLOSE_1_CASH" stage="CLOSING" expected={props.cashFloat && props.cashFloat > 0 ? props.cashFloat : 1200} branch={props.branch} workDate={props.workDate} actorSource={props.actorSource} brand={brand} staffName={props.staffName} saved={confirms.find((row) => row.sectionKey === "CLOSE_1_CASH" || row.sectionKey === "SEC_1_CASH_FLOAT") ?? null} onDone={() => setConfirmTick((value) => value + 1)} />
        </article>
      )}
      {props.warehouseOnly ? null : <CleaningSpots title="หมวด 2 ความสะอาดและล้างอุปกรณ์ปิดร้าน" stage="CLOSING" spots={board?.closingSpots ?? []} confirmations={confirms} branch={props.branch} workDate={props.workDate} actorSource={props.actorSource} brand={brand} staffName={props.staffName} onDone={() => setConfirmTick((value) => value + 1)} />}
      {props.warehouseOnly ? null : (
        <article className="space-y-2">
          <h3 className="font-semibold">โซนหน้าร้าน — นับทุกคืน</h3>
          {(board?.frontLines ?? []).map((line) => (
            <CountRow key={line.itemId} line={line} qty={qty} setQty={setQty} instant={{ branch: props.branch, workDate: props.workDate, stage: "CLOSING" }} onRetro={back && front ? (gap) => {
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
          {backLines.map((line) => <CountRow key={line.itemId} line={line} qty={qty} setQty={setQty} instant={{ branch: props.branch, workDate: props.workDate, stage: "CLOSING" }} />)}
          <button type="button" className="rounded-md bg-[var(--fnb-brand)] px-3 py-2 text-sm text-white" disabled={busy || !back} onClick={() => back && save("CLOSING", backLines, back.locationCode)}>บันทึกยอดหลังร้าน</button>
        </article>
      )}
      {board?.warehouseDue || props.warehouseOnly ? (
        <article className="space-y-2">
          <h3 className="font-semibold">โกดัง {board?.locations.find((row) => row.zoneType === "WAREHOUSE")?.locationNameTh ?? ""}</h3>
          {(board?.warehouseLines ?? []).map((line) => <CountRow key={line.itemId} line={line} qty={qty} setQty={setQty} instant={{ branch: props.branch, workDate: props.workDate, stage: "CLOSING" }} />)}
          <button type="button" className="rounded-md bg-[var(--fnb-brand)] px-3 py-2 text-sm text-white" disabled={busy} onClick={() => {
            const warehouse = board?.locations.find((row) => row.zoneType === "WAREHOUSE");
            if (warehouse) save("CYCLE_COUNT", board?.warehouseLines ?? [], warehouse.locationCode);
          }}>บันทึกยอดโกดัง</button>
        </article>
      ) : <p className="text-sm text-slate-500">โกดังยังไม่ถึงรอบนับคืนนี้ — นับได้จากแท็บรอบนับในคลังสินค้า</p>}
      {props.warehouseOnly ? null : (
        <article className="space-y-2">
          <h3 className="font-semibold">หมวดปิดร้านที่ 4: ชั่งเททิ้งเบส JT, BT, MMK, ML และเลมอน LEM</h3>
          <BaseWasteList branch={props.branch} workDate={props.workDate} staffName={props.staffName} />
          <ProduceWasteForm branch={props.branch} workDate={props.workDate} actorSource={props.actorSource} brand={props.brandLock ?? "LUCKY_CUP"} staffName={props.staffName} />
          <WriteOffButton branch={props.branch} workDate={props.workDate} actorSource={props.actorSource} brand={props.brandLock ?? "LUCKY_CUP"} staffName={props.staffName} locations={board?.locations ?? []} onDone={() => { setConfirmTick((value) => value + 1); reload(); }} />
          {(board?.sauces ?? []).filter((sauce) => sauce.expiresAt && sauce.expiresAt.slice(0, 10) <= props.workDate).map((sauce) => (
            <p key={sauce.code} className="text-sm text-red-700">{sauce.code} หมดอายุวันนี้ {sauce.sticker}</p>
          ))}
        </article>
      )}
    </section>
  );
}

function CountRow(props: { line: FnbZoneCountLine; qty: Record<string, string>; setQty: (value: Record<string, string>) => void; onRetro?: (qty: number) => void; instant?: { branch: string; workDate: string; stage: "OPENING" | "CLOSING" } }) {
  const key = `${props.line.locationCode}|${props.line.itemId}`;
  const timer = useRef(0);
  const [mark, setMark] = useState("");
  function remember(value: string) {
    props.setQty({ ...props.qty, [key]: value });
    if (!props.instant) return;
    setMark("⏳");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void postFnbInstantSave({
        action: "DISPLAY_ITEM_COUNT",
        branchCode: props.instant?.branch,
        workDate: props.instant?.workDate,
        stageCode: props.instant?.stage,
        itemId: props.line.itemId,
        locationCode: props.line.locationCode,
        countedQty: Number(value) || 0,
      }).then((saved) => setMark(saved.ok ? "☁️ บันทึกแล้ว" : ""));
    }, 700);
  }
  const [carton, setCarton] = useState(false);
  const typed = props.qty[key];
  const counted = typed === undefined || typed === "" ? props.line.countedQty : Number(typed);
  const missing = counted == null || Number.isNaN(counted) ? 0 : props.line.expectedQty - counted;
  const extra = counted == null || Number.isNaN(counted) ? 0 : counted - props.line.expectedQty;
  const unit = props.line.isCatchWeight ? (props.line.pieceLabel || "ลูก") : "ชิ้น";
  return (
    <div className={`rounded-lg border-l-4 p-3 text-sm odd:bg-white even:bg-slate-50 ${missing > 0 ? "!bg-red-50/95 border-l-red-600 text-red-950" : extra > 0 ? "!bg-amber-50/90 border-l-amber-500" : "border-l-emerald-500"}`}>
      <p className="font-medium">{props.line.shortCode} {props.line.nameTh}</p>
      {props.line.isCatchWeight ? <p>ควรเหลือ {props.line.expectedQty} {unit}</p> : <p>เปิดเช้า {props.line.openingQty} + เบิกเติม {props.line.replenishedQty} − ขาย POS {props.line.posSoldQty} − ตัดเสีย {props.line.writeOffQty} = ควรเหลือ {props.line.expectedQty}</p>}
      {props.line.writeOffQty > 0 ? <p className="font-semibold text-red-600">ตัดเสีย {props.line.writeOffQty}</p> : null}
      {missing > 0 ? <p className="font-semibold text-red-600">🔴 ขาด -{missing} {unit}</p> : extra > 0 ? <p className="font-semibold text-amber-700">🟠 เกิน +{extra} {unit}</p> : counted != null ? <p className="font-semibold text-emerald-700">🟢 ครบตรง</p> : null}
      {props.line.isCatchWeight ? (
        <div className="mt-2 space-y-2">
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={carton} onChange={(event) => setCarton(event.target.checked)} /> นับลังปิดเป็น กก.</label>
          {carton ? (
            <FnbQtyInput allowDecimal unit="กก." onChange={(value) => {
              const pieces = Math.round(((Number(value) || 0) * 1000) / (props.line.avgGrossGrams || 110));
              remember(String(pieces));
            }} />
          ) : (
            <FnbQtyInput value={props.qty[key] ?? (props.line.countedQty == null ? "" : String(props.line.countedQty))} unit={unit} onChange={remember} />
          )}
          {carton && props.qty[key] ? <p>คิดเป็น {props.qty[key]} {unit}</p> : null}
        </div>
      ) : <span className="mt-2 flex items-center gap-2"><input className={field} type="number" step={props.line.allowDecimal ? "0.01" : "1"} placeholder="ยอดนับจริง" value={props.qty[key] ?? (props.line.countedQty ?? "")} onChange={(event) => remember(event.target.value)} onBlur={(event) => remember(event.target.value)} />{mark ? <span className="text-xs text-emerald-700">{mark}</span> : null}</span>}
      {extra > 0 && props.onRetro ? <button type="button" className="mt-2 rounded-md border px-2 py-1" onClick={() => props.onRetro?.(extra)}>➕ บันทึกเบิกเติมจากคลังหลังร้านย้อนหลัง {extra} {unit}</button> : null}
    </div>
  );
}

const NIGHT_WASTE = [
  { code: "JT", uom: "ml" },
  { code: "BT", uom: "ml" },
  { code: "MMK", uom: "ml" },
  { code: "ML", uom: "ml" },
  { code: "LEM", uom: "g" },
] as const;

function openBarSummary(batches: { batchKind: string; batchStatus: string; prepBaseCode: string; itemId: string; packsDeducted: number }[]): string {
  const seen = new Set<string>();
  const lines = batches.filter((row) => {
    if (row.batchKind !== "OPEN_ITEM") return false;
    const status = row.batchStatus.toUpperCase();
    if (status === "VOID" || status === "VOIDED") return false;
    const key = row.itemId || row.prepBaseCode;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (lines.length === 0) return "ยังไม่มีภาชนะเปิดใช้ที่ยังไม่ถูกยกเลิก";
  return lines.map((row) => `${row.prepBaseCode || row.itemId} · ${row.packsDeducted}`).join(" · ");
}

function BaseWasteList(props: { branch: string; workDate: string; staffName: string }) {
  const live = useLiveBranch();
  return (
    <div className="space-y-2">
      {NIGHT_WASTE.map((item) => <BaseWasteRow key={item.code} {...item} {...props} savedQty={(live.snapshot?.waste ?? []).find((row) => row.itemCode === item.code)?.qty ?? 0} savedPhoto={(live.snapshot?.waste ?? []).find((row) => row.itemCode === item.code)?.photoUrl ?? ""} />)}
    </div>
  );
}

function BaseWasteRow(props: { code: string; uom: string; branch: string; workDate: string; staffName: string; savedQty: number; savedPhoto: string }) {
  const draft = readSectionDraft(props.branch, props.workDate, `WASTE_${props.code}`);
  const [qty, setQty] = useState(props.savedQty > 0 ? String(props.savedQty) : draft.qty || "");
  const [photo, setPhoto] = useState(props.savedPhoto || draft.photo || "");
  const [saved, setSaved] = useState(props.savedQty > 0 || draft.saved === "1");
  const [busy, setBusy] = useState(false);
  async function commit(nextQty = qty, nextPhoto = photo) {
    const amount = Number(nextQty);
    if (!(amount > 0) || !nextPhoto) return;
    setBusy(true);
    const result = await postFnbInstantSave({
      action: "SINGLE_WASTE_ITEM",
      branchCode: props.branch,
      workDate: props.workDate,
      itemCode: props.code,
      qty: amount,
      uom: props.uom,
      photoUrl: nextPhoto,
    });
    setBusy(false);
    if (!result.ok) { toast.error(result.error || "บันทึกเททิ้งไม่สำเร็จ"); return; }
    writeSectionDraft(props.branch, props.workDate, `WASTE_${props.code}`, { qty: nextQty, photo: nextPhoto, saved: "1" });
    setSaved(true);
  }
  return (
    <div className={`space-y-2 rounded-lg border p-3 ${saved ? "border-emerald-500 bg-emerald-50" : "bg-white"}`}>
      <p className="font-semibold">{props.code}</p>
      <FnbQtyInput allowDecimal value={qty} unit={props.uom} onChange={(value) => { setQty(value); setSaved(false); if (photo) void commit(value, photo); }} />
      <LiveWatermarkCamera branchCode={props.branch} stage="CLOSING" staffName={props.staffName} taskTitle={`เททิ้ง ${props.code}`} liveCameraOnly onUploaded={(url) => { setPhoto(url); void commit(qty, url); }} />
      <button type="button" className="rounded-md bg-[var(--fnb-brand)] px-3 py-2 text-sm text-white" disabled={busy} onClick={() => { void commit(); }}>{busy ? "กำลังบันทึก..." : "💾 บันทึกรายการนี้"}</button>
      {saved ? <p className="text-sm font-semibold text-emerald-800">☁️ บันทึกเททิ้ง {qty} {props.uom} แล้ว</p> : null}
    </div>
  );
}
