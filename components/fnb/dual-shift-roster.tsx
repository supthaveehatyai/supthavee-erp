"use client";

import { toast } from "sonner";
import { checkInShiftCrewAction } from "@/lib/actions/fnb-live-sync";
import { useLiveBranch } from "@/components/fnb/shift-crew-bar";
import { progressSummary } from "@/lib/fnb/stage-progress";
import type { FnbLiveShiftClosing, FnbShiftRoster } from "@/types/fnb";

function seats(roster: FnbShiftRoster | undefined) {
  const max = Math.max(2, Math.min(roster?.maxSeats ?? 2, 2));
  return Array.from({ length: max }, (_, index) => roster?.members[index] ?? null);
}

function morningCashLabel(row: FnbLiveShiftClosing | undefined): string {
  if (!row) return "ส่งยอดกะเช้า: รอส่ง";
  if (row.handoverStatus === "ACCEPTED_BY_AFTERNOON") return "ส่งยอดกะเช้า: กะบ่ายรับยอดแล้ว";
  return "ส่งยอดกะเช้า: รอกะบ่ายกดรับ";
}

export function DualShiftRoster({ interactive }: { interactive: boolean }) {
  const live = useLiveBranch();
  const morningRoster = live.snapshot?.rosters.find((item) => item.shiftSlot === "SHIFT_1");
  const afternoonRoster = live.snapshot?.rosters.find((item) => item.shiftSlot === "SHIFT_2");
  const opening = progressSummary("OPENING", (live.snapshot?.confirmations ?? []).filter((row) => row.stageCode === "OPENING"));
  const closing = progressSummary("CLOSING", (live.snapshot?.confirmations ?? []).filter((row) => row.stageCode === "CLOSING"));
  const morningClose = live.snapshot?.closings.find((row) => row.shiftType === "MORNING");
  const afternoonClose = live.snapshot?.closings.find((row) => row.shiftType === "AFTERNOON");
  const viewer = live.snapshot?.viewer;

  function checkIn(slot: "SHIFT_1" | "SHIFT_2") {
    void checkInShiftCrewAction({
      branchCode: live.snapshot?.branchCode || "",
      workDate: live.snapshot?.workDate || "",
      shiftSlot: slot,
    }).then((saved) => {
      if (saved.error || saved.data.ok !== true) toast.error(saved.error || "ลงชื่อเข้ากะไม่สำเร็จ");
      else {
        toast.success("ลงชื่อเข้ากะแล้ว");
        void live.refresh();
      }
    });
  }

  return (
    <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <article className="rounded-xl border border-amber-300 bg-amber-50 p-3">
        <h2 className="font-semibold text-amber-950">☀️ กะเช้า (เปิดร้าน & ส่งมอบยอดกะแรก)</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {seats(morningRoster).map((member, index) => (
            <p key={index} className="rounded-full bg-white px-3 py-1 text-sm text-amber-950 ring-1 ring-amber-200">
              {member ? `[ ${index + 1}. 👤 ${member.staffName} ]` : `[ ${index + 1}. ⚪ ว่าง ]`}
            </p>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-white px-2 py-1">เปิดร้าน {opening.done}/7</span>
          <span className="rounded-full bg-white px-2 py-1">{morningCashLabel(morningClose)}</span>
        </div>
        {interactive && viewer && !viewer.isSuperAdmin && !(morningRoster?.members.some((member) => member.userId === viewer.userId)) && (morningRoster?.members.length ?? 0) < (morningRoster?.maxSeats ?? 2) ? (
          <button type="button" className="mt-3 rounded-md bg-amber-700 px-3 py-2 text-sm font-semibold text-white" onClick={() => checkIn("SHIFT_1")}>👋 ลงชื่อกะเช้า</button>
        ) : null}
      </article>
      <article className="rounded-xl border border-sky-300 bg-sky-50 p-3">
        <h2 className="font-semibold text-sky-950">🌤️ กะบ่าย (รับมอบเงินสด ปิดยอดกะสอง & ปิดร้าน)</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {seats(afternoonRoster).map((member, index) => (
            <p key={index} className="rounded-full bg-white px-3 py-1 text-sm text-sky-950 ring-1 ring-sky-200">
              {member ? `[ ${index + 1}. 👤 ${member.staffName} ]` : `[ ${index + 1}. ⚪ ว่าง ]`}
            </p>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-white px-2 py-1">รับเงินกะเช้า: {morningClose?.handoverStatus === "ACCEPTED_BY_AFTERNOON" ? "รับแล้ว" : "รอรับ"}</span>
          <span className="rounded-full bg-white px-2 py-1">ปิดยอด & ฝาก 7-11: {afternoonClose ? "บันทึกแล้ว" : "ยังไม่ปิดยอด"}</span>
          <span className="rounded-full bg-white px-2 py-1">ปิดร้าน {closing.done}/{closing.total}</span>
        </div>
        {interactive && viewer && !viewer.isSuperAdmin && !(afternoonRoster?.members.some((member) => member.userId === viewer.userId)) && (afternoonRoster?.members.length ?? 0) < (afternoonRoster?.maxSeats ?? 2) ? (
          <button type="button" className="mt-3 rounded-md bg-sky-700 px-3 py-2 text-sm font-semibold text-white" onClick={() => checkIn("SHIFT_2")}>👋 ลงชื่อกะบ่าย</button>
        ) : null}
      </article>
    </section>
  );
}
