"use client";

import { useState } from "react";
import { toast } from "sonner";
import { LiveWatermarkCamera } from "@/components/fnb/live-watermark-camera";
import { uploadFnbEvidenceAction } from "@/lib/actions/fnb-sop";
import { confirmStageSectionAction } from "@/lib/actions/fnb-stage";
import { crewAssist, useLiveBranch } from "@/components/fnb/shift-crew-bar";
import { bangkokClock } from "@/lib/fnb/stage-progress";
import type { FnbStageConfirmation } from "@/types/fnb";

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

export function CleaningSpots(props: {
  title: string;
  stage: "OPENING" | "CLOSING";
  spots: { id: string; spotNameTh: string }[];
  confirmations: FnbStageConfirmation[];
  branch: string;
  workDate: string;
  actorSource: "desktop" | "liff";
  brand: string;
  staffName: string;
  onDone: () => void;
}) {
  const live = useLiveBranch();
  const [status, setStatus] = useState<Record<string, "PASSED" | "ISSUE_REPORTED">>({});
  const prefix = props.stage === "OPENING" ? "SEC_7_SPOT_" : "SEC_2_SPOT_";
  return (
    <article className="space-y-2">
      <h3 className="font-semibold">{props.title}</h3>
      {props.spots.length === 0 ? <p className="text-sm text-slate-500">สาขานี้ยังไม่มีจุดความสะอาด — เพิ่มได้ที่ตั้งค่า SOP</p> : null}
      {props.spots.map((spot) => {
        const saved = props.confirmations.find((row) => row.sectionKey === `${prefix}${spot.id}`) ?? null;
        const flag = status[spot.id] ?? (saved?.statusFlag === "ISSUE_REPORTED" ? "ISSUE_REPORTED" : "PASSED");
        return (
          <div key={spot.id} className={`rounded-lg p-3 text-sm ${saved ? "bg-emerald-50" : "bg-slate-50"}`}>
            <p className="font-medium">{spot.spotNameTh}</p>
            <div className="mt-1 flex flex-wrap gap-2">
              <button type="button" className={`rounded-full px-2 py-1 ${flag === "PASSED" ? "bg-emerald-700 text-white" : "bg-white"}`} onClick={() => setStatus((current) => ({ ...current, [spot.id]: "PASSED" }))}>✅ สะอาดพร้อมเปิด</button>
              <button type="button" className={`rounded-full px-2 py-1 ${flag === "ISSUE_REPORTED" ? "bg-amber-600 text-white" : "bg-white"}`} onClick={() => setStatus((current) => ({ ...current, [spot.id]: "ISSUE_REPORTED" }))}>⚠️ พบจุดชำรุด/แจ้งซ่อม</button>
            </div>
            {saved?.photoUrls[0] ? <a href={saved.photoUrls[0]} target="_blank" rel="noreferrer"><img src={saved.photoUrls[0]} alt="" className="mt-2 h-16 w-16 rounded object-cover" /></a> : null}
            {saved ? <p className="mt-1 text-xs">ตรวจโดย: {saved.confirmedByName} · {bangkokClock(saved.confirmedAt)}</p> : null}
            <LiveWatermarkCamera branchCode={props.branch} stage={props.stage} staffName={props.staffName} taskTitle={spot.spotNameTh} liveCameraOnly onCapture={(file, liveShot) => void uploadShot(file, liveShot, props.branch, props.actorSource, props.brand).then(async (url) => {
              const assist: { assistReason?: string; isEdit?: boolean } = crewAssist(live);
              const savedSpot = await confirmStageSectionAction({
                branchCode: props.branch,
                workDate: props.workDate,
                stageCode: props.stage,
                sectionKey: `${prefix}${spot.id}`,
                sectionTitle: spot.spotNameTh,
                statusFlag: flag,
                photoUrls: [url],
                payload: { spotId: spot.id },
                actorSource: props.actorSource,
                brandLock: props.brand,
                isEdit: Boolean(saved) || assist.isEdit,
                editReason: saved ? "ถ่ายรูปจุดนี้อีกครั้ง" : "",
                assistReason: assist.assistReason,
                shiftSlot: props.stage === "CLOSING" ? "SHIFT_2" : "SHIFT_1",
              });
              if (savedSpot.error || !savedSpot.data.ok) { toast.error(savedSpot.error || "บันทึกจุดนี้ไม่สำเร็จ"); return; }
              const done = props.spots.every((item) => item.id === spot.id || props.confirmations.some((row) => row.sectionKey === `${prefix}${item.id}`));
              if (done) {
                await confirmStageSectionAction({
                  branchCode: props.branch,
                  workDate: props.workDate,
                  stageCode: props.stage,
                  sectionKey: props.stage === "OPENING" ? "SEC_7_CLEANING" : "CLOSE_2_CLEANING",
                  sectionTitle: props.stage === "OPENING" ? "หมวดที่ 7: ความสะอาดเปิดร้าน" : "หมวดที่ 2 ปิดร้าน: ความสะอาด",
                  actorSource: props.actorSource,
                  brandLock: props.brand,
                  shiftSlot: props.stage === "CLOSING" ? "SHIFT_2" : "SHIFT_1",
                  payload: { spots: props.spots.map((item) => ({ id: item.id, name: item.spotNameTh, done: item.id === spot.id || props.confirmations.some((row) => row.sectionKey === `${prefix}${item.id}`) })) },
                  ...assist,
                });
              }
              toast.success(`บันทึก ${spot.spotNameTh} แล้ว`);
              props.onDone();
            }).catch((error: Error) => toast.error(error.message))} />
          </div>
        );
      })}
    </article>
  );
}
