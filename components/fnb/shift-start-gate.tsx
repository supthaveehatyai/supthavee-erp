"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { checkInShiftCrewAction, getLiveBranchShiftSnapshotAction, leaveUnusedShiftCrewSeatAction } from "@/lib/actions/fnb-live-sync";
import type { FnbBranchOption, FnbBrandCode, FnbLiveSnapshot } from "@/types/fnb";

function todayBangkok(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
}

export type FnbShiftLock = {
  branchCode: string;
  shiftSlot: "SHIFT_1" | "SHIFT_2";
  confirmedAt: string;
};

const SHIFT_LABEL: Record<FnbShiftLock["shiftSlot"], string> = {
  SHIFT_1: "☀️ กะเช้า (เปิดร้าน & ส่งเงินกะแรก)",
  SHIFT_2: "🌤️ กะบ่าย (ส่งเงินกะสอง & ปิดร้าน)",
};

function storageKey(userId: string, workDate: string): string {
  return `fnb_locked_shift_${userId}_${workDate}`;
}

function readLock(userId: string, workDate: string): FnbShiftLock | null {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(storageKey(userId, workDate));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FnbShiftLock>;
    if (!parsed.branchCode || (parsed.shiftSlot !== "SHIFT_1" && parsed.shiftSlot !== "SHIFT_2")) return null;
    return { branchCode: parsed.branchCode, shiftSlot: parsed.shiftSlot, confirmedAt: parsed.confirmedAt || "" };
  } catch {
    return null;
  }
}

function rosterOf(snapshot: FnbLiveSnapshot | null, slot: FnbShiftLock["shiftSlot"]) {
  return snapshot?.rosters.find((item) => item.shiftSlot === slot) ?? null;
}

function crewStatus(snapshot: FnbLiveSnapshot | null, slot: FnbShiftLock["shiftSlot"]): string {
  const roster = rosterOf(snapshot, slot);
  const names = roster?.members.map((member) => member.staffName).filter(Boolean) ?? [];
  const max = roster?.maxSeats ?? snapshot?.maxStaffPerShift ?? 2;
  if (names.length >= max) return `🔒 ครบ ${names.length}/${max} คนแล้ว (${names.join(", ")})`;
  if (names.length === 0) return `ว่าง 0/${max} คน`;
  return `เข้ากะแล้ว ${names.length}/${max} คน: 👤 ${names.join(", ")} (กดเพื่อเข้าคู่กับ ${names[0]})`;
}

function teamLabel(snapshot: FnbLiveSnapshot | null, slot: FnbShiftLock["shiftSlot"], actorName: string): string {
  const names = rosterOf(snapshot, slot)?.members.map((member) => member.staffName).filter(Boolean) ?? [];
  const mine = snapshot?.viewer.name || actorName;
  const listed = names.some((name) => name === mine) ? names : [...names, mine];
  return listed.filter(Boolean).join(" + ") || mine;
}

export function LiffShiftSession(props: {
  userId: string;
  actorName: string;
  branches: FnbBranchOption[];
  brand: FnbBrandCode;
  preferredBranch?: string;
  children: (lock: FnbShiftLock) => React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const workDate = todayBangkok();
  const [ready, setReady] = useState(false);
  const [lock, setLock] = useState<FnbShiftLock | null>(null);

  function remember(next: FnbShiftLock) {
    if (props.userId) localStorage.setItem(storageKey(props.userId, workDate), JSON.stringify(next));
    const params = new URLSearchParams(window.location.search);
    params.set("branch", next.branchCode);
    params.set("shift", next.shiftSlot);
    if (`${pathname}?${params.toString()}` !== `${pathname}${window.location.search}`) {
      router.replace(`${pathname}?${params.toString()}`);
    }
    setLock(next);
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      const stored = readLock(props.userId, workDate);
      const snaps = await Promise.all(props.branches.map((branch) => getLiveBranchShiftSnapshotAction({ branchCode: branch.branch_code, workDate })));
      if (!active) return;
      const seats: FnbShiftLock[] = [];
      for (const snap of snaps) {
        const viewerId = snap.data.viewer.userId;
        for (const roster of snap.data.rosters) {
          const mine = roster.members.find((member) => member.userId && member.userId === viewerId);
          if (mine) seats.push({ branchCode: snap.data.branchCode, shiftSlot: roster.shiftSlot, confirmedAt: mine.checkedInAt });
        }
      }
      const storedOk = stored && props.branches.some((branch) => branch.branch_code === stored.branchCode) ? stored : null;
      const matched = storedOk ? seats.find((seat) => seat.branchCode === storedOk.branchCode && seat.shiftSlot === storedOk.shiftSlot) : null;
      const chosen = matched || storedOk || seats.find((seat) => seat.shiftSlot === "SHIFT_1") || seats[0] || null;
      if (chosen) remember(chosen);
      setReady(true);
    })();
    return () => { active = false; };
    // Resume once per user/day. Branch list identity is the permitted set for this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.userId, workDate, props.branches.map((branch) => branch.branch_code).join("|")]);

  if (!ready) return <p className="rounded-xl bg-white px-3 py-4 text-sm text-slate-600">กำลังเปิดกะที่ล็อกไว้...</p>;
  if (!lock) {
    return (
      <StartGate
        actorName={props.actorName}
        branches={props.branches}
        brand={props.brand}
        preferredBranch={props.preferredBranch}
        workDate={workDate}
        onLock={remember}
      />
    );
  }
  return (
    <>
      <PinnedShiftCard
        lock={lock}
        actorName={props.actorName}
        branches={props.branches}
        brand={props.brand}
        workDate={workDate}
        onLock={remember}
        onClear={() => {
          if (props.userId) localStorage.removeItem(storageKey(props.userId, workDate));
          setLock(null);
        }}
      />
      {props.children(lock)}
    </>
  );
}

function StartGate(props: {
  actorName: string;
  branches: FnbBranchOption[];
  brand: FnbBrandCode;
  preferredBranch?: string;
  workDate: string;
  onLock: (lock: FnbShiftLock) => void;
}) {
  const [branchCode, setBranchCode] = useState(props.branches.some((branch) => branch.branch_code === props.preferredBranch) ? props.preferredBranch || "" : props.branches[0]?.branch_code || "");
  const [shiftSlot, setShiftSlot] = useState<FnbShiftLock["shiftSlot"]>("SHIFT_1");
  const [preview, setPreview] = useState<FnbLiveSnapshot | null>(null);
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const selected = props.branches.find((branch) => branch.branch_code === branchCode) ?? null;

  useEffect(() => {
    if (!branchCode) return;
    let active = true;
    const load = () => {
      void getLiveBranchShiftSnapshotAction({ branchCode, workDate: props.workDate }).then((loaded) => {
        if (active && loaded.data.branchCode === branchCode) setPreview(loaded.data);
      });
    };
    load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 10000);
    return () => { active = false; window.clearInterval(timer); };
  }, [branchCode, props.workDate]);

  const chosen = rosterOf(preview, shiftSlot);
  const viewerId = preview?.viewer.userId ?? "";
  const alreadyIn = Boolean(chosen?.members.some((member) => member.userId === viewerId));
  const shiftFull = Boolean(chosen && chosen.members.length >= chosen.maxSeats && !alreadyIn);

  async function confirm() {
    if (!selected || shiftFull) {
      toast.error(shiftFull ? "กะนี้ครบ 2 คนแล้ว" : "เลือกสาขาและกะก่อน");
      return;
    }
    setBusy(true);
    if (!preview?.viewer.isSuperAdmin) {
      const saved = await checkInShiftCrewAction({ branchCode: selected.branch_code, workDate: props.workDate, shiftSlot });
      if (saved.error || !saved.data.ok) {
        setBusy(false);
        toast.error(saved.error || "ลงชื่อเข้ากะไม่สำเร็จ");
        return;
      }
    }
    setBusy(false);
    setAsk(false);
    props.onLock({ branchCode: selected.branch_code, shiftSlot, confirmedAt: new Date().toISOString() });
    toast.success("ล็อกสาขาและกะแล้ว");
  }

  return (
    <section className="space-y-4 rounded-2xl bg-white p-4 shadow-sm" data-brand={props.brand}>
      <h2 className="text-xl font-bold">🚪 เริ่มปฏิบัติงานประจำวัน — เลือกสาขาและกะงาน</h2>
      <div className="space-y-2">
        <p className="text-sm font-semibold">เลือกสาขาที่เข้าทำงานวันนี้</p>
        <div className="grid gap-2">
          {props.branches.map((branch) => (
            <button key={branch.branch_code} type="button" className={`rounded-2xl px-4 py-4 text-left text-base font-semibold ${branch.branch_code === branchCode ? "bg-[#DC2626] text-white" : "bg-slate-50 ring-1 ring-slate-200"}`} onClick={() => setBranchCode(branch.branch_code)}>
              📍 {branch.branch_code} {branch.branch_name_th}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-semibold">เลือกกะเข้าปฏิบัติงาน</p>
        {(["SHIFT_1", "SHIFT_2"] as const).map((slot) => {
          const roster = rosterOf(preview, slot);
          const inside = Boolean(roster?.members.some((member) => member.userId === viewerId));
          const full = Boolean(roster && roster.members.length >= roster.maxSeats && !inside);
          return (
            <button key={slot} type="button" disabled={full} className={`block w-full rounded-2xl px-4 py-4 text-left disabled:opacity-60 ${shiftSlot === slot ? "bg-[#DC2626] text-white" : "bg-slate-50 ring-1 ring-slate-200"}`} onClick={() => setShiftSlot(slot)}>
              <span className="block text-base font-bold">{SHIFT_LABEL[slot]}</span>
              <span className="mt-1 block text-sm">{crewStatus(preview, slot)}</span>
            </button>
          );
        })}
      </div>
      <button type="button" className="w-full rounded-xl bg-slate-900 px-4 py-3 text-base font-bold text-white" onClick={() => setAsk(true)}>ถัดไป — ตรวจสอบและยืนยันเข้ากะ</button>
      {ask ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 sm:items-center">
          <div className="w-full max-w-md space-y-3 rounded-2xl bg-white p-4">
            <h3 className="text-lg font-bold">ยืนยันการเข้าสาขาและล็อกหน้าจอทำงาน</h3>
            <p className="text-sm text-slate-500">ยืนยันอีกชั้นกันนิ้วพลาด</p>
            <p className="text-base">📍 สาขา: {selected ? `${selected.branch_code} · ${selected.branch_name_th}` : branchCode}</p>
            <p className="text-base">⏰ กะงาน: {SHIFT_LABEL[shiftSlot]}</p>
            <p className="text-base font-semibold">👥 ทีมปฏิบัติงานกะนี้: {teamLabel(preview, shiftSlot, props.actorName)}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button type="button" className="rounded-xl border px-3 py-3 text-sm font-semibold" onClick={() => setAsk(false)}>↩️ ย้อนกลับไปเลือกใหม่</button>
              <button type="button" className="rounded-xl bg-[#DC2626] px-3 py-3 text-sm font-bold text-white" disabled={busy} onClick={() => { void confirm(); }}>{busy ? "กำลังล็อก..." : "✅ ยืนยันเข้าสาขานี้และล็อกหน้าจอ"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function PinnedShiftCard(props: {
  lock: FnbShiftLock;
  actorName: string;
  branches: FnbBranchOption[];
  brand: FnbBrandCode;
  workDate: string;
  onLock: (lock: FnbShiftLock) => void;
  onClear: () => void;
}) {
  const branch = props.branches.find((item) => item.branch_code === props.lock.branchCode) ?? null;
  const [snapshot, setSnapshot] = useState<FnbLiveSnapshot | null>(null);
  const [dialog, setDialog] = useState<"closed" | "menu" | "switch" | "switch-confirm">("closed");
  const [nextBranch, setNextBranch] = useState(props.lock.branchCode);
  const [nextSlot, setNextSlot] = useState<FnbShiftLock["shiftSlot"]>(props.lock.shiftSlot === "SHIFT_1" ? "SHIFT_2" : "SHIFT_1");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const load = () => {
      void getLiveBranchShiftSnapshotAction({ branchCode: props.lock.branchCode, workDate: props.workDate }).then((loaded) => {
        if (active) setSnapshot(loaded.data);
      });
    };
    load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 10000);
    return () => { active = false; window.clearInterval(timer); };
  }, [props.lock.branchCode, props.workDate]);

  const mine = rosterOf(snapshot, props.lock.shiftSlot);
  const otherSlot: FnbShiftLock["shiftSlot"] = props.lock.shiftSlot === "SHIFT_1" ? "SHIFT_2" : "SHIFT_1";
  const other = rosterOf(snapshot, otherSlot);
  const myNames = mine?.members.map((member) => member.staffName).filter(Boolean).join(" · ") || props.actorName;
  const otherNames = other?.members.map((member) => member.staffName).filter(Boolean).join(", ") || "";
  const count = `${mine?.members.length ?? 0}/${mine?.maxSeats ?? 2}`;

  async function leaveWrongPick() {
    setBusy(true);
    const saved = await leaveUnusedShiftCrewSeatAction({ branchCode: props.lock.branchCode, workDate: props.workDate, shiftSlot: props.lock.shiftSlot });
    setBusy(false);
    if (saved.error || !saved.data.ok) {
      toast.error(saved.error || "ออกจากกะไม่สำเร็จ");
      return;
    }
    props.onClear();
    setDialog("closed");
    toast.success("ออกจากกะแล้ว เลือกสาขาและกะใหม่ได้");
  }

  async function switchSession() {
    setBusy(true);
    const saved = await checkInShiftCrewAction({ branchCode: nextBranch, workDate: props.workDate, shiftSlot: nextSlot });
    setBusy(false);
    if (saved.error || !saved.data.ok) {
      toast.error(saved.error || "สลับกะไม่สำเร็จ");
      return;
    }
    props.onLock({ branchCode: nextBranch, shiftSlot: nextSlot, confirmedAt: new Date().toISOString() });
    setDialog("closed");
    toast.success("ล็อกกะใหม่แล้ว");
  }

  return (
    <section className="relative rounded-2xl bg-white p-4 shadow-sm" data-brand={props.brand}>
      <button type="button" className="absolute right-3 top-3 text-xs font-semibold text-slate-600 underline" onClick={() => setDialog("menu")}>⚙️ เปลี่ยนกะ / แก้ไขกรณีเลือกสาขาผิด</button>
      <p className="pr-28 text-sm font-semibold">🔒 สาขาที่ล็อกไว้: {props.lock.branchCode} {branch?.branch_name_th || ""}</p>
      <p className="mt-2 text-lg font-bold">{props.lock.shiftSlot === "SHIFT_1" ? "☀️" : "🌤️"} ผู้ปฏิบัติงาน{props.lock.shiftSlot === "SHIFT_1" ? "กะเช้า" : "กะบ่าย"} ({count}): {myNames.split(" · ").map((name) => `👤 ${name}`).join(" · ")}</p>
      <p className="mt-1 text-xs text-slate-500">(เครื่องนี้: {props.actorName})</p>
      {otherNames ? <p className="mt-2 rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-700">{otherSlot === "SHIFT_2" ? "🌤️" : "☀️"} พนักงาน{otherSlot === "SHIFT_2" ? "กะบ่าย" : "กะเช้า"}ที่เข้างานในร้านแล้ว: {otherNames} (แยกหน้าทำงานคนละกะ)</p> : null}
      {dialog === "closed" ? null : (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 sm:items-center">
          <div className="w-full max-w-md space-y-3 rounded-2xl bg-white p-4">
            <h3 className="text-lg font-bold">ยืนยันอีกชั้นก่อนเปลี่ยนกะ</h3>
            {dialog === "menu" ? (
              <>
                <button type="button" className="block w-full rounded-xl border px-3 py-3 text-left text-sm" disabled={busy} onClick={() => { void leaveWrongPick(); }}>เลือกสาขาหรือกะผิดตั้งแต่แรก — ออกจากที่นั่งนี้ถ้ายังไม่ส่งหมวด</button>
                <button type="button" className="block w-full rounded-xl border px-3 py-3 text-left text-sm" onClick={() => setDialog("switch")}>เข้าทำงานต่อในอีกกะ เช่น ควบกะบ่าย / ย้ายไปช่วยอีกสาขาช่วงบ่าย</button>
              </>
            ) : null}
            {dialog === "switch" || dialog === "switch-confirm" ? (
              <>
                <div className="grid gap-2">
                  {props.branches.map((item) => (
                    <button key={item.branch_code} type="button" className={`rounded-xl px-3 py-2 text-left text-sm ${nextBranch === item.branch_code ? "bg-[#DC2626] text-white" : "bg-slate-50"}`} onClick={() => setNextBranch(item.branch_code)}>📍 {item.branch_code} {item.branch_name_th}</button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" className={`rounded-xl px-2 py-2 text-sm ${nextSlot === "SHIFT_1" ? "bg-[#DC2626] text-white" : "bg-slate-50"}`} onClick={() => setNextSlot("SHIFT_1")}>☀️ กะเช้า</button>
                  <button type="button" className={`rounded-xl px-2 py-2 text-sm ${nextSlot === "SHIFT_2" ? "bg-[#DC2626] text-white" : "bg-slate-50"}`} onClick={() => setNextSlot("SHIFT_2")}>🌤️ กะบ่าย</button>
                </div>
              </>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="rounded-xl border px-3 py-3 text-sm" onClick={() => setDialog("closed")}>↩️ ย้อนกลับ</button>
              {dialog === "switch" ? <button type="button" className="rounded-xl bg-slate-900 px-3 py-3 text-sm font-bold text-white" onClick={() => setDialog("switch-confirm")}>ถัดไป — ยืนยันอีกครั้ง</button> : null}
              {dialog === "switch-confirm" ? <button type="button" className="rounded-xl bg-[#DC2626] px-3 py-3 text-sm font-bold text-white" disabled={busy} onClick={() => { void switchSession(); }}>{busy ? "กำลังสลับ..." : "✅ ยืนยันสลับกะและล็อกหน้าจอ"}</button> : null}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
