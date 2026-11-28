"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { checkInShiftCrewAction, getLiveBranchShiftSnapshotAction, swapShiftCrewSeatAction } from "@/lib/actions/fnb-live-sync";
import { hhmm } from "@/components/fnb/section-confirm-card";
import type { FnbLiveSnapshot } from "@/types/fnb";

type LiveValue = {
  snapshot: FnbLiveSnapshot | null;
  refresh: () => Promise<void>;
  shiftSlot: "SHIFT_1" | "SHIFT_2";
  assistReason: string;
  assistArmed: boolean;
  setAssistReason: (value: string) => void;
  armAssist: () => void;
  inputsLocked: boolean;
  lockMessage: string;
};

const LiveBranchContext = createContext<LiveValue | null>(null);

export function CrewLockedFieldset({ monthLocked, children }: { monthLocked: boolean; children: React.ReactNode }) {
  const live = useLiveBranch();
  const roster = live.snapshot?.rosters.find((item) => item.shiftSlot === live.shiftSlot);
  const inCrew = Boolean(roster?.members.some((member) => member.userId === live.snapshot?.viewer.userId));
  const supervisorWaiting = live.snapshot?.viewer.isSupervisor === true && !inCrew && !live.assistArmed;
  return <fieldset disabled={monthLocked || live.inputsLocked || supervisorWaiting} className="min-w-0 space-y-4 border-0 p-0 disabled:opacity-70">{children}</fieldset>;
}

export function useLiveBranch(): LiveValue {
  return useContext(LiveBranchContext) ?? {
    snapshot: null,
    refresh: async () => undefined,
    shiftSlot: "SHIFT_1",
    assistReason: "",
    assistArmed: false,
    setAssistReason: () => undefined,
    armAssist: () => undefined,
    inputsLocked: false,
    lockMessage: "",
  };
}

export function LiveBranchProvider(props: {
  branch: string;
  workDate: string;
  shiftSlot: "SHIFT_1" | "SHIFT_2";
  children: React.ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<FnbLiveSnapshot | null>(null);
  const [assistReason, setAssistReason] = useState("");
  const [assistArmed, setAssistArmed] = useState(false);
  const [askAssist, setAskAssist] = useState(false);
  const [viewSlot, setViewSlot] = useState(props.shiftSlot);
  const refresh = useCallback(async () => {
    if (!props.branch) return;
    const loaded = await getLiveBranchShiftSnapshotAction({ branchCode: props.branch, workDate: props.workDate });
    if (loaded.data.branchCode === props.branch) setSnapshot(loaded.data);
    if (loaded.error) toast.error(loaded.error);
  }, [props.branch, props.workDate]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 10000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  useEffect(() => { setViewSlot(props.shiftSlot); }, [props.shiftSlot]);
  const roster = snapshot?.rosters.find((item) => item.shiftSlot === props.shiftSlot) ?? snapshot?.rosters[0];
  const viewerId = snapshot?.viewer.userId ?? "";
  const inCrew = Boolean(roster?.members.some((member) => member.userId === viewerId));
  const full = Boolean(roster && roster.members.length >= roster.maxSeats);
  const supervisor = snapshot?.viewer.isSupervisor === true;
  const inputsLocked = full && !inCrew && !supervisor;
  const names = roster?.members.map((member) => member.staffName).filter(Boolean).join(", ") || "";
  const lockMessage = inputsLocked ? `🔒 กะนี้มีผู้ปฏิบัติงานครบ ${roster?.maxSeats ?? 2} คนแล้ว (${names}) — ระบบล็อกป้องกันพนักงานท่านอื่นคีย์ข้อมูลซ้ำทับ` : "";
  const value = useMemo<LiveValue>(() => ({
    snapshot,
    refresh,
    shiftSlot: props.shiftSlot,
    assistReason,
    assistArmed,
    setAssistReason,
    armAssist: () => { if (assistReason.trim().length >= 4) setAssistArmed(true); },
    inputsLocked,
    lockMessage,
  }), [assistArmed, assistReason, inputsLocked, lockMessage, props.shiftSlot, refresh, snapshot]);
  return (
    <LiveBranchContext.Provider value={value}>
      <ShiftCrewChrome viewSlot={viewSlot} setViewSlot={setViewSlot} askAssist={askAssist} setAskAssist={setAskAssist} />
      {props.children}
    </LiveBranchContext.Provider>
  );
}

function ShiftCrewChrome(props: {
  viewSlot: "SHIFT_1" | "SHIFT_2";
  setViewSlot: (slot: "SHIFT_1" | "SHIFT_2") => void;
  askAssist: boolean;
  setAskAssist: (open: boolean) => void;
}) {
  const live = useLiveBranch();
  const roster = live.snapshot?.rosters.find((item) => item.shiftSlot === props.viewSlot);
  const max = roster?.maxSeats ?? live.snapshot?.maxStaffPerShift ?? 2;
  const members = roster?.members ?? [];
  const viewer = live.snapshot?.viewer;
  const inCrew = members.some((member) => member.userId === viewer?.userId);
  const [removeId, setRemoveId] = useState(members[0]?.userId ?? "");
  const [nextId, setNextId] = useState("");
  const [swapReason, setSwapReason] = useState("");
  const [swapOpen, setSwapOpen] = useState(false);
  const seats = [0, 1].slice(0, Math.max(2, Math.min(max, 2)));
  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">👥 ผู้ปฏิบัติงานประจำกะ — ล็อกสูงสุด {max} คน/กะ</h2>
        <button type="button" className="rounded-md bg-slate-900 px-3 py-1 text-sm text-white" onClick={() => { void live.refresh(); }}>🔄 ซิงก์ข้อมูลเพื่อนร่วมกะ</button>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={`rounded-full px-3 py-1 text-sm ${props.viewSlot === "SHIFT_1" ? "bg-[var(--fnb-brand)] text-white" : "bg-slate-100"}`} onClick={() => props.setViewSlot("SHIFT_1")}>กะเช้า (เปิดร้าน & กะแรก — สูงสุด {max} คน)</button>
        <button type="button" className={`rounded-full px-3 py-1 text-sm ${props.viewSlot === "SHIFT_2" ? "bg-[var(--fnb-brand)] text-white" : "bg-slate-100"}`} onClick={() => props.setViewSlot("SHIFT_2")}>กะบ่าย (กะสอง & ปิดร้าน — สูงสุด {max} คน)</button>
      </div>
      <div className="flex flex-wrap gap-2">
        {seats.map((index) => {
          const member = members[index];
          return (
            <p key={index} className="rounded-full bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-200">
              {member ? `[ ${index + 1}. 👤 ${member.staffName}${member.checkedInAt ? ` · ${hhmm(member.checkedInAt)}` : ""} ]` : `[ ${index + 1}. ⚪ ว่าง — กดลงชื่อเข้ากะ ]`}
            </p>
          );
        })}
      </div>
      {viewer && !viewer.isSupervisor && !inCrew ? (
        <button type="button" className="rounded-md bg-[var(--fnb-brand)] px-3 py-2 text-sm font-semibold text-white" onClick={() => {
          void checkInShiftCrewAction({ branchCode: live.snapshot?.branchCode || "", workDate: live.snapshot?.workDate || "", shiftSlot: props.viewSlot }).then((saved) => {
            if (saved.error || !saved.data.ok) toast.error(saved.error || "ลงชื่อเข้ากะไม่สำเร็จ");
            else { toast.success("ลงชื่อเข้ากะแล้ว"); void live.refresh(); }
          });
        }}>👋 กดลงชื่อเข้าปฏิบัติงานกะนี้</button>
      ) : null}
      {live.lockMessage ? <p className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white">{live.lockMessage}</p> : null}
      {viewer?.isSupervisor ? (
        <div className="space-y-2">
          <button type="button" className="rounded-md bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-950" onClick={() => props.setAskAssist(true)}>🛠️ โหมดผู้บริหาร/ผู้จัดการเข้าช่วยเหลือหรือแก้ไขข้อมูล (ต้องระบุเหตุผล)</button>
          <button type="button" className="ml-2 rounded-md border px-3 py-2 text-sm" onClick={() => setSwapOpen(true)}>🔄 เปลี่ยนตัวผู้ปฏิบัติงานในกะ (กรณีป่วย/สลับเวร)</button>
        </div>
      ) : null}
      {props.askAssist ? (
        <div className="space-y-2 rounded-lg bg-amber-50 p-3">
          <label className="block text-sm">เหตุผลการเข้าช่วยเหลือ/แก้ไข (อย่างน้อย 4 ตัวอักษร)
            <input className="mt-1 h-10 w-full rounded-md border px-2" value={live.assistReason} onChange={(event) => live.setAssistReason(event.target.value)} />
          </label>
          <button type="button" className="rounded-md bg-amber-900 px-3 py-2 text-sm text-white" onClick={() => {
            if (live.assistReason.trim().length < 4) { toast.error("ระบุเหตุผลการเข้าช่วยเหลือ/แก้ไข (อย่างน้อย 4 ตัวอักษร)"); return; }
            live.armAssist();
            props.setAskAssist(false);
            toast.success("เปิดโหมดช่วยเหลือแล้ว บันทึกหมวดได้ตามเหตุผลนี้");
          }}>ยืนยันเหตุผลและเริ่มช่วยเหลือ</button>
        </div>
      ) : null}
      {swapOpen ? (
        <div className="grid gap-2 rounded-lg bg-slate-50 p-3 md:grid-cols-2">
          <select className="h-10 rounded-md border px-2 text-sm" value={removeId} onChange={(event) => setRemoveId(event.target.value)}>
            {members.map((member) => <option key={member.userId} value={member.userId}>{member.staffName}</option>)}
          </select>
          <select className="h-10 rounded-md border px-2 text-sm" value={nextId} onChange={(event) => setNextId(event.target.value)}>
            <option value="">เลือกพนักงานที่เข้าแทน</option>
            {(live.snapshot?.staffOptions ?? []).map((person) => <option key={person.userId} value={person.userId}>{person.name}</option>)}
          </select>
          <input className="h-10 rounded-md border px-2 text-sm md:col-span-2" placeholder="สาเหตุ เช่น ป่วยกะทันหัน / สลับเวร" value={swapReason} onChange={(event) => setSwapReason(event.target.value)} />
          <button type="button" className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white" onClick={() => {
            const next = live.snapshot?.staffOptions.find((person) => person.userId === nextId);
            void swapShiftCrewSeatAction({
              branchCode: live.snapshot?.branchCode || "",
              workDate: live.snapshot?.workDate || "",
              shiftSlot: props.viewSlot,
              removeUserId: removeId,
              newUserId: nextId,
              newStaffName: next?.name || "",
              reason: swapReason,
            }).then((saved) => {
              if (saved.error || !saved.data.ok) toast.error(saved.error || "เปลี่ยนตัวไม่สำเร็จ");
              else { toast.success("เปลี่ยนตัวผู้ปฏิบัติงานแล้ว"); setSwapOpen(false); void live.refresh(); }
            });
          }}>บันทึกการเปลี่ยนตัว</button>
        </div>
      ) : null}
    </section>
  );
}
