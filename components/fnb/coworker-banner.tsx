"use client";

import { useEffect, useState } from "react";
import { listStageConfirmationsAction } from "@/lib/actions/fnb-stage";
import { useLiveBranch } from "@/components/fnb/shift-crew-bar";
import { progressSummary } from "@/lib/fnb/stage-progress";
import type { FnbStageConfirmation } from "@/types/fnb";

export function CoworkerBanner(props: {
  branch: string;
  workDate: string;
  stage: "OPENING" | "CLOSING";
  actorSource: "desktop" | "liff";
  brandLock: string;
  reloadToken?: number;
}) {
  const live = useLiveBranch();
  const [rows, setRows] = useState<FnbStageConfirmation[]>([]);
  const [tick, setTick] = useState(0);
  const shared = live.snapshot?.confirmations.filter((row) => row.stageCode === props.stage) ?? null;
  useEffect(() => {
    let active = true;
    if (live.snapshot) return;
    void listStageConfirmationsAction(props.branch, props.workDate, props.stage, props.actorSource, props.brandLock).then((loaded) => {
      if (active) setRows(loaded.data);
    });
    return () => { active = false; };
  }, [props.branch, props.workDate, props.stage, props.actorSource, props.brandLock, tick, props.reloadToken, live.snapshot]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") setTick((value) => value + 1);
    }, 10000);
    return () => window.clearInterval(timer);
  }, []);
  const summary = progressSummary(props.stage, shared ?? rows);
  return (
    <div className="rounded-xl bg-slate-900 p-3 text-sm text-white">
      <p className="font-semibold">ความคืบหน้า: เสร็จแล้ว {summary.done} / {summary.total} หมวด</p>
      <p className="mt-1">{summary.badges.length ? summary.badges.join(" · ") : "ยังไม่มีเพื่อนร่วมกะยืนยันหมวด"}</p>
      <button type="button" className="mt-2 rounded-md bg-white px-3 py-1 text-slate-900" onClick={() => { if (live.snapshot) void live.refresh(); else setTick((value) => value + 1); }}>🔄 ซิงก์ข้อมูลเพื่อนร่วมกะ</button>
      <p className="mt-1 text-xs text-white/80">เมื่อเข้ากะ 2 คนใช้มือถือคนละเครื่อง หมวดที่เพื่อนกดยืนยันแล้วจะขึ้นสีเขียวพร้อมชื่อผู้ทำอัตโนมัติ ไม่ต้องทำซ้ำกัน</p>
    </div>
  );
}
