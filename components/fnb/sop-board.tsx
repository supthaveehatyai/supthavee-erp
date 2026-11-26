"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { LiveWatermarkCamera } from "@/components/fnb/live-watermark-camera";
import { getSopBoardAction, lockSopStageAction, requestSopRetakeAction, submitSopTaskAction, uploadFnbEvidenceAction } from "@/lib/actions/fnb-sop";
import type { FnbBrandCode, FnbSopBoard, FnbSopStageInstance } from "@/types/fnb";

export function SopBoard({
  branch,
  workDate,
  stage,
  brandLock,
  actorSource,
  actorName,
  superAdmin,
}: {
  branch: string;
  workDate: string;
  stage: FnbSopStageInstance;
  brandLock: FnbBrandCode | null;
  actorSource: "desktop" | "liff";
  actorName: string;
  superAdmin: boolean;
}) {
  const [board, setBoard] = useState<FnbSopBoard | null>(null);
  const [message, setMessage] = useState("");
  const [zoom, setZoom] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [, start] = useTransition();

  function reload() {
    void getSopBoardAction({ branch_code: branch, work_date: workDate, stage_instance: stage, brand_lock: brandLock, actor_source: actorSource }).then((loaded) => {
      setBoard(loaded.data);
      if (loaded.error) setMessage(loaded.error);
    });
  }

  useEffect(() => {
    reload();
  }, [branch, workDate, stage, brandLock, actorSource]);

  useEffect(() => {
    if (!board || board.session_status === "LOCKED") return;
    const timer = window.setInterval(reload, 20000);
    return () => window.clearInterval(timer);
  }, [board?.session_status, branch, workDate, stage]);

  const ready = Boolean(board && board.mandatory_total > 0 && board.mandatory_done >= board.mandatory_total && board.session_status !== "LOCKED");

  return (
    <section className="space-y-3">
      <div className="rounded-xl bg-slate-900 p-3 text-sm text-white">
        <p>ผู้ร่วมงาน: {board?.contributors.length ? board.contributors.map((row) => `${row.staff_name} ${row.task_count} ข้อ`).join(" · ") : "ยังไม่มีผู้ส่งงาน"} | ความคืบหน้า {board?.mandatory_done ?? 0}/{board?.mandatory_total ?? 0} ข้อบังคับ</p>
        <button type="button" className="mt-2 rounded-md bg-white px-3 py-1 text-slate-900" onClick={reload}>🔄 รีเฟรชสถานะเพื่อนร่วมกะ</button>
      </div>
      {message ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{message}</p> : null}
      {(board?.tasks ?? []).map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          branch={branch}
          workDate={workDate}
          stage={stage}
          brandLock={brandLock}
          actorSource={actorSource}
          actorName={actorName}
          superAdmin={superAdmin}
          locked={board?.session_status === "LOCKED"}
          onZoom={setZoom}
          onDone={(note) => {
            toast.success(note);
            setMessage(note);
            reload();
          }}
          onError={(note) => {
            toast.error(note);
            setMessage(note);
          }}
        />
      ))}
      {board && board.tasks.length === 0 ? <p className="text-sm text-slate-500">วันนี้ไม่มีหัวข้อ SOP ของช่วงนี้สำหรับสาขา หรือยังไม่ได้ติ๊กสาขาในตารางระเบียบ</p> : null}
      <form className="space-y-2" onSubmit={(event) => {
        event.preventDefault();
        const body = new FormData(event.currentTarget);
        body.set("actor_source", actorSource);
        body.set("brand_lock", brandLock ?? "");
        body.set("branch_code", branch);
        body.set("work_date", workDate);
        body.set("stage_instance", stage);
        start(async () => {
          const saved = await lockSopStageAction(body);
          if (saved.error || !saved.data.ok) {
            toast.error(saved.error || saved.data.message || "ปิดเช็คลิสต์ไม่สำเร็จ");
            return;
          }
          toast.success(body.get("reopen") === "true" ? "เปิดแก้ไขแล้ว" : "ยืนยันปิดเช็คลิสต์ช่วงนี้แล้ว");
          reload();
        });
      }}>
        {board?.session_status === "LOCKED" ? <input className="h-10 w-full rounded-md border px-3 text-sm" name="edit_reason" value={reason} placeholder="สาเหตุการแก้ไข" onChange={(event) => setReason(event.target.value)} /> : null}
        {board?.session_status === "LOCKED" ? <button className="rounded-md border px-3 py-2 text-sm" name="reopen" value="true">ขอเปิดแก้ไขพร้อมระบุสาเหตุ</button> : null}
        {ready ? <button className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white">🔒 ยืนยันปิดเช็คลิสต์ช่วงนี้</button> : null}
      </form>
      {zoom ? <button type="button" className="fixed inset-0 z-50 bg-black/80 p-6" onClick={() => setZoom(null)}><img src={zoom} alt="" className="mx-auto max-h-full max-w-full object-contain" /></button> : null}
    </section>
  );
}

function TaskCard(props: {
  task: FnbSopBoard["tasks"][number];
  branch: string;
  workDate: string;
  stage: FnbSopStageInstance;
  brandLock: FnbBrandCode | null;
  actorSource: "desktop" | "liff";
  actorName: string;
  superAdmin: boolean;
  locked: boolean;
  onZoom: (url: string) => void;
  onDone: (note: string) => void;
  onError: (note: string) => void;
}) {
  const [urls, setUrls] = useState<string[]>([]);
  const [hashes, setHashes] = useState<string[]>([]);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const { task } = props;
  const done = Boolean(task.submission) && task.submission?.manager_review_status !== "RETAKE_REQUIRED";

  async function capture(file: File, liveCapture: boolean) {
    const body = new FormData();
    body.set("actor_source", props.actorSource);
    body.set("brand_lock", props.brandLock ?? "");
    body.set("branch_code", props.branch);
    body.set("work_date", props.workDate);
    body.set("stage_instance", props.stage);
    body.set("live_capture", liveCapture ? "true" : "false");
    body.set("file", file);
    setBusy(true);
    const uploaded = await uploadFnbEvidenceAction(body);
    setBusy(false);
    if (uploaded.error || !uploaded.data.url) {
      props.onError(uploaded.error || "อัปโหลดรูปไม่สำเร็จ");
      return;
    }
    setUrls((current) => [...current, uploaded.data.url]);
    setHashes((current) => [...current, uploaded.data.hash]);
    setLive(liveCapture);
  }

  return (
    <article className="space-y-2 rounded-xl border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{task.title_th}</h3>
          <p className="text-sm text-slate-500">{task.description_instruction}</p>
        </div>
        <span className="text-xs text-slate-500">{task.is_mandatory ? "บังคับ" : "ไม่บังคับ"} · {task.schedule_type}</span>
      </div>
      {task.reference_photo_url ? <img src={task.reference_photo_url} alt="" className="h-24 rounded-md object-cover" /> : null}
      {done && task.submission ? (
        <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
          <p>👤 ผู้รับผิดชอบ: {task.submission.submitted_by_name}</p>
          <p>เวลาเซิร์ฟเวอร์ {new Date(task.submission.server_submitted_at).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}</p>
          {task.submission.numeric_value != null ? <p>ค่าที่ส่ง {task.submission.numeric_value}</p> : null}
          <div className="mt-2 flex flex-wrap gap-2">
            {task.submission.photo_urls.map((url) => (
              <button type="button" key={url} onClick={() => props.onZoom(url)}><img src={url} alt="" className="h-16 w-16 rounded object-cover" /></button>
            ))}
          </div>
          {props.superAdmin ? <button type="button" className="mt-2 rounded-md border border-amber-700 px-3 py-1 text-amber-900" onClick={() => {
            void requestSopRetakeAction(task.submission!.id).then((saved) => {
              if (saved.error) props.onError(saved.error);
              else props.onDone("สั่งถ่ายซ่อมแล้ว");
            });
          }}>⚠️ ไม่ผ่าน — สั่งถ่ายซ่อม</button> : null}
        </div>
      ) : null}
      {props.locked || done ? null : (
        <form className="space-y-2" onSubmit={(event) => {
          event.preventDefault();
          const body = new FormData(event.currentTarget);
          body.set("actor_source", props.actorSource);
          body.set("brand_lock", props.brandLock ?? "");
          body.set("branch_code", props.branch);
          body.set("work_date", props.workDate);
          body.set("stage_instance", props.stage);
          body.set("template_id", task.id);
          body.set("photo_urls", urls.join("|"));
          body.set("photo_hashes", hashes.join("|"));
          body.set("live_capture", live ? "true" : "false");
          setBusy(true);
          void submitSopTaskAction(body).then((saved) => {
            setBusy(false);
            if (saved.error || !saved.data.ok) props.onError(saved.error || saved.data.message || "ส่งหัวข้อไม่สำเร็จ");
            else props.onDone(saved.data.message || `ส่ง ${task.title_th} แล้ว`);
          });
        }}>
          {task.input_type !== "PHOTO_ONLY" && task.input_type !== "PASS_FAIL_PHOTO" ? <input className="h-10 w-full rounded-md border px-3 text-sm" name="numeric_value" type="number" step="0.01" placeholder="ตัวเลขที่ต้องส่ง" /> : null}
          {task.input_type === "PASS_FAIL_PHOTO" ? <select className="h-10 w-full rounded-md border px-3 text-sm" name="status_value" defaultValue="DONE"><option value="DONE">ผ่าน</option><option value="ISSUE_FOUND">ไม่ผ่าน</option></select> : null}
          <input className="h-10 w-full rounded-md border px-3 text-sm" name="note_text" placeholder="หมายเหตุ" />
          <LiveWatermarkCamera branchCode={props.branch} stage={props.stage} staffName={props.actorName} taskTitle={task.title_th} liveCameraOnly={task.live_camera_only} onCapture={(file, liveCapture) => void capture(file, liveCapture)} />
          <button className="rounded-md bg-red-700 px-3 py-2 text-sm text-white" disabled={busy}>{busy ? "กำลังบันทึก..." : "📸 ถ่ายรูป & ส่งหัวข้อนี้"}</button>
        </form>
      )}
    </article>
  );
}
