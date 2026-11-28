"use client";

import { useState } from "react";
import { toast } from "sonner";
import { LiveWatermarkCamera } from "@/components/fnb/live-watermark-camera";
import { uploadFnbEvidenceAction } from "@/lib/actions/fnb-sop";
import { saveCleaningSpotLogAction } from "@/lib/actions/fnb-store-day";
import { confirmStageSectionAction } from "@/lib/actions/fnb-stage";
import { hhmm } from "@/components/fnb/section-confirm-card";
import { crewAssist, useLiveBranch } from "@/components/fnb/shift-crew-bar";
import { bangkokWeekday } from "@/lib/fnb/stage-progress";
import type { FnbCleaningSpot, FnbLiveCleaningLog, FnbStageConfirmation } from "@/types/fnb";

async function uploadShot(file: File, live: boolean, branch: string, actorSource: string, brand: string): Promise<string> {
  const body = new FormData();
  body.set("file", file);
  body.set("live_capture", String(live));
  body.set("branch_code", branch);
  body.set("actor_source", actorSource);
  body.set("brand_lock", brand);
  const saved = await uploadFnbEvidenceAction(body);
  if (saved.error || !saved.data.url) throw new Error(saved.error || "อัปโหลดรูปไม่สำเร็จ");
  return saved.data.url;
}

function dueToday(spot: FnbCleaningSpot, workDate: string): boolean {
  if (spot.scheduleType !== "WEEKLY") return true;
  if (spot.weekdays.length === 0) return true;
  return spot.weekdays.includes(bangkokWeekday(workDate));
}

export function CleaningSpots(props: {
  title: string;
  stage: "OPENING" | "CLOSING";
  spots: FnbCleaningSpot[];
  confirmations: FnbStageConfirmation[];
  branch: string;
  workDate: string;
  actorSource: "desktop" | "liff";
  brand: string;
  staffName: string;
  onDone: () => void;
}) {
  const live = useLiveBranch();
  const sectionKey = props.stage === "OPENING" ? "SEC_7_CLEANING" : "CLOSE_2_CLEANING";
  const legacyPrefix = props.stage === "OPENING" ? "SEC_7_SPOT_" : "SEC_2_SPOT_";
  const [status, setStatus] = useState<Record<string, "PASSED" | "ISSUE_REPORTED">>({});
  const [local, setLocal] = useState<Record<string, FnbLiveCleaningLog>>({});
  const [missingId, setMissingId] = useState("");
  const [savingId, setSavingId] = useState("");
  const [pending, setPending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState("");
  const [askReason, setAskReason] = useState(false);
  const due = props.spots.filter((spot) => dueToday(spot, props.workDate));
  const logs = (live.snapshot?.cleaningSpotLogs ?? []).filter((row) => row.stageCode === props.stage);
  const savedSection = (live.snapshot?.confirmations ?? props.confirmations).find((row) => row.sectionKey === sectionKey) ?? null;
  const canRevise = live.snapshot?.viewer.isSuperAdmin === true || live.snapshot?.viewer.workspaceRole === "FNB_BRANCH_MANAGER";
  function logOf(spotId: string): FnbLiveCleaningLog | null {
    return local[spotId] ?? logs.find((row) => row.spotId === spotId) ?? null;
  }
  function photoOf(spot: FnbCleaningSpot): string {
    const shot = logOf(spot.id)?.photoUrls[0];
    if (shot) return shot;
    return props.confirmations.find((row) => row.sectionKey === `${legacyPrefix}${spot.id}`)?.photoUrls[0] ?? "";
  }
  function flagOf(spot: FnbCleaningSpot): "PASSED" | "ISSUE_REPORTED" {
    if (status[spot.id]) return status[spot.id];
    const remote = logOf(spot.id)?.statusFlag;
    return remote === "ISSUE_REPORTED" ? "ISSUE_REPORTED" : "PASSED";
  }
  const doneCount = due.filter((spot) => Boolean(photoOf(spot))).length;
  async function persist(spot: FnbCleaningSpot, flag: "PASSED" | "ISSUE_REPORTED", photoUrl: string) {
    if (!photoUrl) { setSavingId(""); return; }
    setSavingId(spot.id);
    const saved = await saveCleaningSpotLogAction({
      branchCode: props.branch,
      workDate: props.workDate,
      stageCode: props.stage,
      spotId: spot.id,
      statusFlag: flag,
      photoUrl,
      actorSource: props.actorSource,
      brandLock: props.brand,
    });
    setSavingId("");
    if (saved.error || !saved.data.ok) { toast.error(saved.error || "บันทึกจุดนี้ไม่สำเร็จ"); return; }
    setLocal((current) => ({
      ...current,
      [spot.id]: {
        id: spot.id,
        spotId: spot.id,
        stageCode: props.stage,
        spotNameTh: spot.spotNameTh,
        statusFlag: flag,
        photoUrls: [photoUrl],
        checkedByName: saved.data.checkedByName || props.staffName,
        checkedAt: saved.data.checkedAt,
      },
    }));
    setMissingId("");
    toast.success(`บันทึก ${spot.spotNameTh} แล้ว`);
    void live.refresh();
    props.onDone();
  }
  async function confirmSection() {
    if (pending) return;
    const missing = due.find((spot) => !photoOf(spot));
    if (missing) {
      setMissingId(missing.id);
      document.getElementById(`clean-${missing.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      toast.error(`ยังขาดรูปความสะอาดจุดที่: ${missing.spotNameTh}`);
      return;
    }
    if (due.length === 0) { toast.error("สาขานี้ยังไม่มีจุดความสะอาดที่ถึงรอบวันนี้"); return; }
    setPending(true);
    const photos = due.map((spot) => photoOf(spot)).filter(Boolean);
    const assist = crewAssist(live);
    const confirmed = await confirmStageSectionAction({
      branchCode: props.branch,
      workDate: props.workDate,
      stageCode: props.stage,
      sectionKey,
      sectionTitle: props.stage === "OPENING" ? "หมวดที่ 7: ความสะอาดเปิดร้าน" : "หมวดที่ 2: ความสะอาดและล้างอุปกรณ์ปิดร้าน",
      photoUrls: photos,
      actorSource: props.actorSource,
      brandLock: props.brand,
      shiftSlot: props.stage === "CLOSING" ? "SHIFT_2" : "SHIFT_1",
      isEdit: Boolean(savedSection) || assist.isEdit,
      editReason: savedSection ? "ยืนยันความสะอาดอีกครั้ง" : "",
      assistReason: assist.assistReason,
      payload: {
        spots: due.map((spot) => ({
          id: spot.id,
          name: spot.spotNameTh,
          status: flagOf(spot),
          photoUrl: photoOf(spot),
          checkedByName: logOf(spot.id)?.checkedByName || props.staffName,
          checkedAt: logOf(spot.id)?.checkedAt || "",
        })),
      },
    });
    setPending(false);
    if (confirmed.error || !confirmed.data.ok) { toast.error(confirmed.error || "ยืนยันหมวดความสะอาดไม่สำเร็จ"); return; }
    toast.success(props.stage === "OPENING" ? "บันทึกยืนยันหมวดที่ 7 แล้ว" : "บันทึกยืนยันความสะอาดปิดร้านแล้ว");
    setEditing(false);
    void live.refresh();
    props.onDone();
  }
  const locked = Boolean(savedSection) && !editing;
  const buttonLabel = props.stage === "OPENING"
    ? "✅ บันทึกยืนยันหมวดที่ 7 (ความสะอาดเปิดร้านครบทุกจุด)"
    : "✅ บันทึกยืนยันความสะอาดปิดร้าน";
  return (
    <article className="space-y-2">
      <h3 className="font-semibold">{props.title}</h3>
      {locked && savedSection ? <LockedCleaning row={savedSection} spots={due} logs={logs} /> : (
        <>
          {due.length === 0 ? <p className="text-sm text-slate-500">สาขานี้ยังไม่มีจุดความสะอาดที่ถึงรอบวันนี้ — เพิ่มได้ที่ตั้งค่า SOP</p> : null}
          <p className="text-sm font-medium">ถ่ายแล้ว {doneCount} / {due.length} จุด</p>
          {due.map((spot) => {
            const saved = logOf(spot.id);
            const photo = photoOf(spot);
            const flag = flagOf(spot);
            return (
              <div key={spot.id} id={`clean-${spot.id}`} className={`rounded-lg p-3 text-sm ${missingId === spot.id ? "bg-red-50 ring-2 ring-red-600" : saved || photo ? "bg-emerald-50" : "bg-slate-50"}`}>
                <p className="font-medium">{spot.spotNameTh}</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  <button type="button" className={`rounded-full px-2 py-1 ${flag === "PASSED" ? "bg-emerald-700 text-white" : "bg-white"}`} onClick={() => { setStatus((current) => ({ ...current, [spot.id]: "PASSED" })); if (photo) void persist(spot, "PASSED", photo); }}>✅ สะอาดพร้อมเปิด</button>
                  <button type="button" className={`rounded-full px-2 py-1 ${flag === "ISSUE_REPORTED" ? "bg-amber-600 text-white" : "bg-white"}`} onClick={() => { setStatus((current) => ({ ...current, [spot.id]: "ISSUE_REPORTED" })); if (photo) void persist(spot, "ISSUE_REPORTED", photo); }}>⚠️ พบจุดชำรุด/แจ้งซ่อม</button>
                </div>
                {photo ? <a href={photo} target="_blank" rel="noreferrer"><img src={photo} alt="" className="mt-2 h-16 w-16 rounded object-cover" /></a> : null}
                {saved ? <p className="mt-1 text-xs text-emerald-800">☁️ บันทึกจุดนี้เข้าระบบแล้ว · โดย {saved.checkedByName} ({hhmm(saved.checkedAt)})</p> : null}
                <LiveWatermarkCamera branchCode={props.branch} stage={props.stage} staffName={props.staffName} taskTitle={spot.spotNameTh} liveCameraOnly onCapture={(file, liveShot) => {
                  if (savingId) return;
                  setSavingId(spot.id);
                  void uploadShot(file, liveShot, props.branch, props.actorSource, props.brand).then((url) => persist(spot, flag, url)).catch((error: Error) => { setSavingId(""); toast.error(error.message); });
                }} />
              </div>
            );
          })}
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-sm font-semibold">ถ่ายรูปบันทึกแล้ว {doneCount} / {due.length} จุด</p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
              <div className="h-2 rounded-full bg-emerald-600" style={{ width: `${due.length ? Math.round((doneCount / due.length) * 100) : 0}%` }} />
            </div>
            <button type="button" className="mt-3 rounded-md bg-[var(--fnb-brand)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60" disabled={pending || savingId !== ""} onClick={() => void confirmSection()}>{pending ? "กำลังบันทึก..." : buttonLabel}</button>
          </div>
        </>
      )}
      {locked && canRevise ? <button type="button" className="font-semibold underline" onClick={() => setAskReason(true)}>✏️ แก้ไขพร้อมระบุเหตุผล</button> : null}
      {askReason ? (
        <div className="grid gap-2 rounded-xl border p-3">
          <input className="h-10 rounded-md border px-2 text-sm" value={reason} placeholder="เหตุผลอย่างน้อย 4 ตัวอักษร" onChange={(event) => setReason(event.target.value)} />
          <button type="button" className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white" onClick={() => {
            if (!live.armAssist(reason)) { toast.error("ระบุเหตุผลการเข้าช่วยเหลือ/แก้ไข (อย่างน้อย 4 ตัวอักษร)"); return; }
            setEditing(true);
            setAskReason(false);
          }}>ยืนยันและแก้ไขหมวดนี้</button>
        </div>
      ) : null}
    </article>
  );
}

function LockedCleaning(props: { row: FnbStageConfirmation; spots: FnbCleaningSpot[]; logs: FnbLiveCleaningLog[] }) {
  const raw = Array.isArray(props.row.payload.spots) ? props.row.payload.spots : [];
  const cards = raw.length > 0 ? raw.flatMap((item) => {
    const rec = item && typeof item === "object" ? item as Record<string, unknown> : null;
    if (!rec) return [];
    const photo = String(rec.photoUrl ?? "");
    return [{ name: String(rec.name ?? "จุดตรวจ"), photo, by: String(rec.checkedByName ?? props.row.confirmedByName) }];
  }) : props.spots.map((spot) => {
    const log = props.logs.find((row) => row.spotId === spot.id);
    return { name: spot.spotNameTh, photo: log?.photoUrls[0] || "", by: log?.checkedByName || props.row.confirmedByName };
  });
  return (
    <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-950">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {cards.map((card) => (
          <a key={`${card.name}-${card.photo}`} href={card.photo || undefined} target="_blank" rel="noreferrer" className="rounded-lg bg-white p-2">
            {card.photo ? <img src={card.photo} alt="" className="h-20 w-full rounded object-cover" /> : <div className="flex h-20 items-center justify-center bg-slate-100 text-xs">ไม่มีรูป</div>}
            <p className="mt-1 text-xs font-medium">{card.name}</p>
            <p className="text-[10px] text-slate-500">{card.by}</p>
          </a>
        ))}
      </div>
      <p className="mt-2">✅ บันทึกยืนยันแล้วโดย: {props.row.confirmedByName} · {hhmm(props.row.confirmedAt)}</p>
    </div>
  );
}
