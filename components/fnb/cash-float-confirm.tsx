"use client";

import { useState } from "react";
import { toast } from "sonner";
import { LiveWatermarkCamera } from "@/components/fnb/live-watermark-camera";
import { uploadFnbEvidenceAction } from "@/lib/actions/fnb-sop";
import { confirmStageSectionAction } from "@/lib/actions/fnb-stage";
import { useLiveBranch } from "@/components/fnb/shift-crew-bar";
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

function money(amount: number): string {
  return amount.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function CashFloatConfirm(props: {
  title: string;
  sectionKey: string;
  stage: "OPENING" | "CLOSING";
  expected: number;
  branch: string;
  workDate: string;
  actorSource: "desktop" | "liff";
  brand: string;
  staffName: string;
  saved: FnbStageConfirmation | null;
  onDone: () => void;
}) {
  const live = useLiveBranch();
  const [editing, setEditing] = useState(false);
  const [counted, setCounted] = useState(props.saved?.numericAmount != null ? String(props.saved.numericAmount) : String(props.expected));
  const [photo, setPhoto] = useState(props.saved?.photoUrls[0] ?? "");
  const [reason, setReason] = useState("");
  const locked = Boolean(props.saved) && !editing;
  const amount = Number(counted);
  const mismatch = Number.isFinite(amount) && Math.abs(amount - props.expected) > 0.009;
  if (locked && props.saved) {
    const shot = props.saved.photoUrls[0];
    return (
      <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
        {shot ? <a href={shot} target="_blank" rel="noreferrer"><img src={shot} alt="" className="mb-2 h-16 w-16 rounded object-cover" /></a> : null}
        <p>✅ ยืนยันเงินสดในเก๊ะ {money(props.saved.numericAmount ?? props.expected)} บาท โดย: {props.saved.confirmedByName} · เวลา {bangkokClock(props.saved.confirmedAt)}</p>
        <button type="button" className="mt-2 rounded-md border border-emerald-700 px-3 py-1" onClick={() => setEditing(true)}>✏️ แก้ไขพร้อมระบุสาเหตุ</button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-sm">วงเงินมาตรฐาน: {money(props.expected)} บาท</p>
      <label className="text-sm">ยอดเงินสดที่นับได้จริงในเก๊ะ (บาท)
        <input className="mt-1 h-10 w-32 rounded-md border px-2 text-sm" type="number" min="0" step="0.01" value={counted} onChange={(event) => setCounted(event.target.value)} />
      </label>
      {mismatch ? <label className="block text-sm">สาเหตุที่เงินทอนในเก๊ะไม่ตรง *<input className="mt-1 h-10 w-full rounded-md border px-2 text-sm" value={reason} onChange={(event) => setReason(event.target.value)} /></label> : null}
      {editing ? <label className="block text-sm">สาเหตุการแก้ไข *<input className="mt-1 h-10 w-full rounded-md border px-2 text-sm" value={reason} onChange={(event) => setReason(event.target.value)} /></label> : null}
      <LiveWatermarkCamera branchCode={props.branch} stage={props.stage} staffName={props.staffName} taskTitle={props.title} liveCameraOnly onCapture={(file, live) => void uploadShot(file, live, props.branch, props.actorSource, props.brand).then(setPhoto).catch((error: Error) => toast.error(error.message))} />
      <button type="button" className="rounded-md bg-[var(--fnb-brand)] px-3 py-2 text-sm text-white" onClick={() => {
        if (!photo) { toast.error("ถ่ายรูปเงินในเก๊ะสดก่อนยืนยัน"); return; }
        if (mismatch && reason.trim().length < 3) { toast.error("ระบุสาเหตุที่เงินทอนในเก๊ะไม่ตรง"); return; }
        if (editing && reason.trim().length < 3) { toast.error("ระบุสาเหตุการแก้ไข"); return; }
        void confirmStageSectionAction({
          branchCode: props.branch,
          workDate: props.workDate,
          stageCode: props.stage,
          sectionKey: props.sectionKey,
          sectionTitle: props.title,
          numericAmount: amount,
          expectedAmount: props.expected,
          varianceReason: mismatch ? reason : "",
          photoUrls: [photo],
          actorSource: props.actorSource,
          brandLock: props.brand,
          isEdit: editing,
          editReason: editing ? reason : "",
          assistReason: live.snapshot?.viewer.isSupervisor ? live.assistReason : "",
          shiftSlot: props.stage === "CLOSING" ? "SHIFT_2" : "SHIFT_1",
        }).then((saved) => {
          if (!saved.error && saved.data.ok) void live.refresh();
          if (saved.error || !saved.data.ok) toast.error(saved.error || "ยืนยันเงินในเก๊ะไม่สำเร็จ");
          else { toast.success("ยืนยันการนับเงินในเก๊ะแล้ว"); setEditing(false); props.onDone(); }
        });
      }}>✅ ยืนยันการนับเงินในเก๊ะ</button>
    </div>
  );
}
