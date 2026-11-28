"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { branchForBrand } from "@/lib/fnb/brand-branch";
import { BranchPills, fnbBranchStorageKey, useStoredBranch } from "@/components/fnb/branch-pills";
import { toast } from "sonner";
import { ApprovalQueue } from "@/app/fnb/approval-queue";
import { CashFloatNote } from "@/components/fnb/cash-float-note";
import { ClosingWipBanner } from "@/components/fnb/closing-wip-banner";
import { WipPanel } from "@/components/fnb/wip-panel";
import { MenuSalesPanel } from "@/components/fnb/menu-sales-panel";
import { SopBoard } from "@/components/fnb/sop-board";
import { SectionPhotoDrawer } from "@/components/fnb/section-photo-drawer";
import { ExecutiveInspector } from "@/components/fnb/executive-inspector";
import { MiddayShortcuts, NightCloseCount, OpeningChecklist } from "@/components/fnb/store-day-board";
import { getMonthLockAction } from "@/lib/actions/fnb-audit";
import { saveShift3HandoverAction } from "@/lib/actions/fnb-sop";
import {
  commitPosExcelAction,
  getFnbDayStateAction,
  listPendingShiftApprovalsAction,
  prefillPosSlipAction,
  previewPosExcelAction,
  recordNightWasteAction,
  recordShiftClosingAction,
  saveShelfChecksAction,
  settlePlatformPayoutAction,
} from "@/lib/actions/fnb-operations";
import { submitStaffReimbursementAction } from "@/lib/actions/fnb-procurement";
import {
  FNB_FRONT_GROUP_LABEL,
  FNB_FRONT_GROUPS,
  FNB_NOTE_VALUES,
  type FnbBranchOption,
  type FnbBrandCode,
  type FnbChangeRequestRow,
  type FnbDayState,
  type FnbItemRow,
  type FnbPosImportPreview,
  type FnbShiftCard,
  type FnbSopStageInstance,
  type FnbSubmitResult,
} from "@/types/fnb";

const field = "h-10 w-full rounded-md border border-slate-200 px-3 text-sm";

function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
}

function money(value: number): string {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function OperationsWorkspace({
  branches,
  shelfItems,
  brandLock,
  superAdmin,
  actorName,
  actorSource,
  initialApprovals = [],
  activeBrand,
  initialBranch = "",
}: {
  branches: FnbBranchOption[];
  shelfItems: FnbItemRow[];
  brandLock: FnbBrandCode | null;
  superAdmin: boolean;
  actorName: string;
  actorSource: "desktop" | "liff";
  initialApprovals?: FnbChangeRequestRow[];
  activeBrand: FnbBrandCode;
  initialBranch?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = useState<FnbSopStageInstance | "WIP">("OPENING");
  const [branch, setBranch] = useState(() => branchForBrand(branches, activeBrand, initialBranch || branches[0]?.branch_code || ""));
  const [workDate, setWorkDate] = useState(today());
  const staffName = actorName;
  const [message, setMessage] = useState("");
  const [day, setDay] = useState<FnbDayState | null>(null);
  const [approvals, setApprovals] = useState(initialApprovals);
  const [busy, setBusy] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"EXECUTIVE_INSPECTOR" | "STAFF_ASSIST">("EXECUTIVE_INSPECTOR");
  const [monthLocked, setMonthLocked] = useState(false);
  const [lockLabel, setLockLabel] = useState("");
  const [, start] = useTransition();
  const selected = branches.find((item) => item.branch_code === branch) ?? null;
  const brand = activeBrand;
  const storageKey = fnbBranchStorageKey(activeBrand, actorName);
  const pickBranch = useCallback((code: string) => {
    const next = branchForBrand(branches, activeBrand, code);
    if (!next) return;
    setBranch(next);
    localStorage.setItem(storageKey, next);
    const params = new URLSearchParams(window.location.search);
    if (params.get("branch") === next) return;
    params.set("branch", next);
    router.replace(`${pathname}?${params.toString()}`);
  }, [activeBrand, branches, pathname, router, storageKey]);
  useStoredBranch(storageKey, branches, pickBranch);
  const seenBranch = useRef(initialBranch);
  useEffect(() => {
    if (initialBranch === seenBranch.current) return;
    seenBranch.current = initialBranch;
    const next = branchForBrand(branches, activeBrand, initialBranch);
    if (next) setBranch(next);
  }, [activeBrand, branches, initialBranch]);
  useEffect(() => {
    const next = branchForBrand(branches, activeBrand, branch);
    if (next !== branch) setBranch(next);
  }, [activeBrand, branches, branch]);
  useEffect(() => {
    const assisted = superAdmin && actorSource === "desktop" && viewMode === "STAFF_ASSIST";
    if (assisted) document.documentElement.dataset.fnbAssisted = "1";
    else delete document.documentElement.dataset.fnbAssisted;
    return () => { delete document.documentElement.dataset.fnbAssisted; };
  }, [actorSource, superAdmin, viewMode]);
  const heading = brand === "LUCKY_CUP" ? "ปฏิบัติการ Lucky Cup" : "ปฏิบัติการชาทรตะโหมด";

  useEffect(() => {
    const block = (event: DragEvent) => event.preventDefault();
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, []);

  useEffect(() => {
    if (!workDate) return;
    void getMonthLockAction(brand, workDate).then((loaded) => {
      setMonthLocked(loaded.data.locked);
      setLockLabel(loaded.data.label);
    });
  }, [brand, workDate]);

  useEffect(() => {
    if (!branch) return;
    let active = true;
    void getFnbDayStateAction(branch, workDate, brandLock).then((loaded) => {
      if (!active) return;
      setDay(loaded.data);
      if (loaded.error) setMessage(loaded.error);
    });
    return () => {
      active = false;
    };
  }, [branch, workDate, brandLock, message]);

  function run(key: string, task: () => Promise<{ error: string | null; data: FnbSubmitResult }>, success: string) {
    setBusy(key);
    start(async () => {
      const saved = await task();
      setBusy(null);
      if (saved.error || !saved.data.ok) {
        const detail = saved.error || saved.data.message || "บันทึกไม่สำเร็จ";
        toast.error(detail);
        setMessage(detail);
        return;
      }
      const note = saved.data.mode === "PENDING_APPROVAL"
        ? `รออนุมัติแก้ไขตัวเลขการเงิน (${saved.data.request_no ?? ""})`
        : success;
      toast.success(note);
      setMessage(note);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-red-700">{brandLock ? "LIFF" : "ผู้จัดการ"}</p>
          <h1 className="text-2xl font-bold text-slate-900">{heading}</h1>
          {brandLock ? null : <p className="text-sm text-slate-500">มือถือพนักงานของสาขานี้ใช้ {brand === "LUCKY_CUP" ? "/liff/luckycup" : "/liff/chatorn"}</p>}
        </div>
        {superAdmin ? (
          <button type="button" className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm" onClick={() => setViewMode((mode) => mode === "EXECUTIVE_INSPECTOR" ? "STAFF_ASSIST" : "EXECUTIVE_INSPECTOR")}>
            {viewMode === "EXECUTIVE_INSPECTOR" ? "✍️ เข้าโหมดกรอกข้อมูลแทนพนักงาน" : "กลับสู่โหมดผู้บริหาร Read-Only"}
          </button>
        ) : null}
      </div>
      {monthLocked ? <p className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white">{lockLabel || "🔒 งวดเดือนนี้ถูกล็อกปิดงวดแล้ว (อ่านอย่างเดียว)"}</p> : null}
      {superAdmin && viewMode === "STAFF_ASSIST" ? <p className="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-950">กำลังอยู่ในโหมดคีย์ข้อมูลแทนพนักงาน — กลับสู่โหมดผู้บริหาร Read-Only</p> : null}
      {message ? <p className={`rounded-lg px-3 py-2 text-sm ${message.includes("รออนุมัติ") ? "bg-amber-50 text-amber-900" : message.includes("เรียบร้อย") || message.includes("แล้ว") ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>{message}</p> : null}
      {superAdmin ? <ApprovalQueue requests={approvals} onDone={() => { void listPendingShiftApprovalsAction().then((listed) => setApprovals(listed.data)); }} /> : null}
      {actorSource === "desktop" ? <BranchPills branches={branches} active={branch} onPick={pickBranch} /> : null}
      <div className="grid gap-3 rounded-xl border border-red-100 bg-white p-4 md:grid-cols-3">
        <select className={field} value={branch} disabled={branches.length <= 1} onChange={(event) => pickBranch(event.target.value)}>
          {branches.map((item) => <option key={item.branch_code} value={item.branch_code}>{item.branch_code} {item.branch_name_th}</option>)}
        </select>
        <p className="flex h-10 items-center rounded-md bg-red-50 px-3 text-sm text-red-900">ผู้ปฏิบัติงาน: {staffName || "บัญชีที่ล็อกอิน"}</p>
        <input className={field} type="date" value={workDate} onChange={(event) => setWorkDate(event.target.value)} />
      </div>
      {superAdmin && viewMode === "EXECUTIVE_INSPECTOR" ? <ExecutiveInspector brand={brand} workDate={workDate} branch={branch} onPickBranch={pickBranch} /> : <fieldset disabled={monthLocked} className="min-w-0 space-y-4 border-0 p-0 disabled:opacity-70">
      <div className="flex flex-wrap gap-2">
        <TabButton active={tab === "OPENING"} onClick={() => setTab("OPENING")}>1. เปิดร้าน (กะแรก)</TabButton>
        <TabButton active={tab === "WIP"} onClick={() => setTab("WIP")}>ต้มเบสเพิ่มและเบิกเปิดของขึ้นบาร์</TabButton>
        <TabButton active={tab === "SHIFT_1"} onClick={() => setTab("SHIFT_1")}>2. ส่งเงินกะแรก</TabButton>
        <TabButton active={tab === "SHIFT_2"} onClick={() => setTab("SHIFT_2")}>3. ส่งเงินกะสอง</TabButton>
        {selected?.enable_shift_3 ? <TabButton active={tab === "SHIFT_3"} onClick={() => setTab("SHIFT_3")}>4. ส่งเงินกะสาม</TabButton> : null}
        <TabButton active={tab === "CLOSING"} onClick={() => setTab("CLOSING")}>{`${selected?.enable_shift_3 ? "5" : "4"}. ปิดร้านและยอดขายรายเมนู (${selected?.enable_shift_3 ? "กะสาม" : "กะสอง"})`}</TabButton>
      </div>
      <MiddayShortcuts branch={branch} workDate={workDate} actorSource={actorSource} brandLock={brandLock} staffName={staffName} brand={brand} />
      {tab === "OPENING" ? <OpeningChecklist branch={branch} workDate={workDate} actorSource={actorSource} brandLock={brand} staffName={staffName} cashFloat={selected?.standard_cash_float} /> : null}
      {tab === "SHIFT_1" || tab === "SHIFT_2" ? <ClosePanel brand={brand} brandLock={brandLock} superAdmin={superAdmin} branch={branch} branches={branches} workDate={workDate} staffName={staffName} actorSource={actorSource} day={day} busy={busy} run={run} lockShift={tab === "SHIFT_1" ? "MORNING" : "AFTERNOON"} onBranch={pickBranch} /> : null}
      {tab === "SHIFT_3" ? <Shift3Panel brandLock={brandLock} branch={branch} workDate={workDate} actorSource={actorSource} busy={busy === "shift3"} run={run} /> : null}
      {tab === "WIP" ? <WipPanel branch={branch} workDate={workDate} brand={brand} actorSource={actorSource} actorName={staffName} enableShift3={Boolean(selected?.enable_shift_3)} /> : null}
      {tab === "CLOSING" ? <><ClosingWipBanner branch={branch} workDate={workDate} /><WastePanel brand={brand} brandLock={brandLock} branch={branch} workDate={workDate} staffName={staffName} actorSource={actorSource} shelfItems={shelfItems} day={day} busy={busy} run={run} /><MenuSalesPanel branch={branch} workDate={workDate} brand={brand} actorSource={actorSource} /><NightCloseCount branch={branch} workDate={workDate} actorSource={actorSource} brandLock={brand} staffName={staffName} cashFloat={selected?.standard_cash_float} /></> : null}
      {tab !== "WIP" && tab !== "OPENING" && tab !== "CLOSING" ? <SopBoard branch={branch} workDate={workDate} stage={tab} brandLock={brandLock} actorSource={actorSource} actorName={staffName} superAdmin={superAdmin} /> : null}
      {brandLock ? <ReimburseBox brand={brand} brandLock={brandLock} branch={branch} workDate={workDate} staffName={staffName} actorSource={actorSource} busy={busy === "reimburse"} run={run} /> : null}
      {superAdmin ? <SectionPhotoDrawer workDate={workDate} brand={brand} /> : null}
      {superAdmin ? <SettlementPanel shifts={day?.shifts ?? []} busy={busy === "settle"} run={run} /> : null}
      </fieldset>}
    </div>
  );
}

function ClosePanel(props: {
  brand: FnbBrandCode;
  brandLock: FnbBrandCode | null;
  superAdmin: boolean;
  branch: string;
  branches: FnbBranchOption[];
  workDate: string;
  staffName: string;
  actorSource: "desktop" | "liff";
  day: FnbDayState | null;
  busy: string | null;
  run: (key: string, task: () => Promise<{ error: string | null; data: FnbSubmitResult }>, success: string) => void;
  lockShift?: "MORNING" | "AFTERNOON";
  onBranch: (code: string) => void;
}) {
  const morning = props.day?.shifts.find((shift) => shift.shift_type === "MORNING") ?? null;
  const afternoon = props.day?.shifts.find((shift) => shift.shift_type === "AFTERNOON") ?? null;
  const [shiftType, setShiftType] = useState<"MORNING" | "AFTERNOON">(props.lockShift ?? "MORNING");
  const activeShift = props.lockShift ?? shiftType;
  const current = activeShift === "MORNING" ? morning : afternoon;
  const pending = props.day?.pending.find((row) => row.shift_type === activeShift);
  return (
    <section className="space-y-3">
      <article className="rounded-xl bg-slate-900 p-4 text-sm text-white">
        <p className="font-semibold">สรุปยอดรวมทั้งวันอัตโนมัติ = กะเช้า + กะบ่าย</p>
        <p className="mt-1">ยอดสุทธิ {money((morning?.net_sales_inc_vat ?? 0) + (afternoon?.net_sales_inc_vat ?? 0))} · เงินสด POS {money((morning?.cash_pos_amount ?? 0) + (afternoon?.cash_pos_amount ?? 0))} · QR {money((morning?.qr_amount ?? 0) + (afternoon?.qr_amount ?? 0))}</p>
      </article>
      {props.lockShift ? null : (
        <div className="flex gap-2">
          <TabButton active={shiftType === "MORNING"} onClick={() => setShiftType("MORNING")}>กะแรก</TabButton>
          <TabButton active={shiftType === "AFTERNOON"} onClick={() => setShiftType("AFTERNOON")}>กะสอง</TabButton>
        </div>
      )}
      {pending ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">รออนุมัติแก้ไขตัวเลขการเงิน ({pending.request_no})</p> : null}
      <ShiftForm {...props} shiftType={activeShift} current={current} />
      {props.brand === "LUCKY_CUP" && props.superAdmin ? <PosExcelBox branches={props.branches.filter((item) => item.brand_code === "LUCKY_CUP")} branch={props.branch} onBranch={props.onBranch} /> : null}
    </section>
  );
}

function ShiftForm({
  brand,
  brandLock,
  superAdmin,
  branch,
  workDate,
  staffName,
  actorSource,
  shiftType,
  current,
  busy,
  run,
}: {
  brand: FnbBrandCode;
  brandLock: FnbBrandCode | null;
  superAdmin: boolean;
  branch: string;
  workDate: string;
  staffName: string;
  actorSource: "desktop" | "liff";
  shiftType: "MORNING" | "AFTERNOON";
  lockShift?: "MORNING" | "AFTERNOON";
  current: FnbShiftCard | null;
  busy: string | null;
  run: (key: string, task: () => Promise<{ error: string | null; data: FnbSubmitResult }>, success: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<"POS_SLIP" | "QUICK_SUMMARY">(brand === "CHATORN" ? "QUICK_SUMMARY" : "POS_SLIP");
  const [notes, setNotes] = useState<Record<number, number>>({});
  const [cashPos, setCashPos] = useState(0);
  const [deposit, setDeposit] = useState<"BANK_DIRECT" | "SEVEN_ELEVEN" | "HOLD_NEXT_SHIFT">("HOLD_NEXT_SHIFT");
  const counted = FNB_NOTE_VALUES.reduce((sum, face) => sum + face * (notes[face] ?? 0), 0);
  const diff = counted - cashPos;
  const locked = Boolean(current) && !editing;
  return (
    <div className="space-y-3 rounded-xl border border-red-100 bg-white p-4">
      {current && !editing ? (
        <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
          บันทึก{shiftType === "MORNING" ? "กะเช้า" : "กะบ่าย"}วันนี้เรียบร้อยแล้ว — บันทึกได้วันละ 1 ครั้ง
          <p>ยอดสุทธิ {money(current.net_sales_inc_vat)} · เงินสด POS {money(current.cash_pos_amount)} · นับจริง {money(current.cash_counted_amount)} · ส่วนต่าง {money(current.cash_variance ?? current.cash_counted_amount - current.cash_pos_amount)}</p>
          <button type="button" className="mt-2 rounded-md border border-emerald-700 px-3 py-1" onClick={() => setEditing(true)}>
            {superAdmin ? "แก้ไขข้อมูลปิดกะ" : "ขอแก้ไขข้อมูลปิดกะ (ส่งผู้บริหารอนุมัติกรณีแก้จำนวนเงิน)"}
          </button>
        </div>
      ) : null}
      {locked ? null : (
        <form className="space-y-3" onSubmit={(event) => {
          event.preventDefault();
          if (Math.abs(diff) >= 0.5) {
            const reason = String(new FormData(event.currentTarget).get("cash_variance_reason") ?? "");
            if (reason.trim().length < 3) {
              toast.error("กรุณาระบุสาเหตุส่วนต่างเงินสด");
              return;
            }
          }
          const body = new FormData(event.currentTarget);
          fillCommon(body, { brandLock, branch, workDate, staffName, actorSource });
          body.set("shift_type", shiftType);
          body.set("entry_mode", brand === "LUCKY_CUP" ? "POS_SLIP" : mode);
          body.set("cash_counted_amount", String(counted));
          body.set("is_edit", current ? "true" : "false");
          body.set("is_super_admin", superAdmin ? "true" : "false");
          body.set("deposit_method", deposit);
          body.set("seven_eleven_fee_thb", deposit === "SEVEN_ELEVEN" ? "15" : "0");
          if (mode === "QUICK_SUMMARY" && brand === "CHATORN") {
            body.set(shiftType === "MORNING" ? "morning_cash_quick" : "afternoon_cash_quick", String(cashPos));
            body.set("cash_pos_amount", String(cashPos));
          }
          run("close", () => recordShiftClosingAction(body), "บันทึกปิดกะเรียบร้อยแล้ว");
          setEditing(false);
        }}>
          {brand === "CHATORN" ? (
            <div className="flex gap-2">
              <TabButton active={mode === "QUICK_SUMMARY"} onClick={() => setMode("QUICK_SUMMARY")}>ยอดด่วนประจำกะ</TabButton>
              <TabButton active={mode === "POS_SLIP"} onClick={() => setMode("POS_SLIP")}>สลิป Wongnai</TabButton>
            </div>
          ) : <p className="text-sm font-medium">สลิป POS</p>}
          {mode === "POS_SLIP" || brand === "LUCKY_CUP" ? (
            <div className="grid gap-3 md:grid-cols-3">
              <Slip name="gross_sales" label="ยอดขายรวม (หักบิลยกเลิก)" />
              <Slip name="discount_total" label="ยอดรวมส่วนลดทั้งหมด" />
              <Slip name="net_sales_inc_vat" label="ยอดขายสุทธิ / ยอดรวมที่รับจริง" />
              <label className="text-sm">เงินสดตามสลิป POS<input className={field} name="cash_pos_amount" type="number" step="0.01" onChange={(event) => setCashPos(Number(event.target.value) || 0)} /></label>
              <Slip name="qr_amount" label="THAI QR" />
              <Slip name="lineman_gross_amount" label="LineMan" />
              <Slip name="grab_gross_amount" label="GrabFood" />
              <Slip name="webapp_amount" label="Web & App" />
              <PhotoDrop name="slips" camera label="วางหรือถ่ายสลิป POS" onFile={(file) => {
                const body = new FormData();
                body.set("file", file);
                run("ocr", async () => {
                  const filled = await prefillPosSlipAction(body);
                  if (filled.error) return { error: filled.error, data: { ok: false, mode: null, request_no: null, message: filled.error } };
                  for (const [key, value] of Object.entries(filled.data)) {
                    const input = document.querySelector<HTMLInputElement>(`input[name="${key}"]`);
                    if (input) input.value = String(value);
                    if (key === "cash_pos_amount") setCashPos(value);
                  }
                  return { error: null, data: { ok: true, mode: "OCR", request_no: null, message: null } };
                }, "เติมตัวเลขจากสลิปแล้ว ตรวจก่อนบันทึก");
              }} />
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm">{shiftType === "MORNING" ? "สดเช้า" : "สดบ่าย"}<input className={field} type="number" step="0.01" onChange={(event) => setCashPos(Number(event.target.value) || 0)} /></label>
              <label className="text-sm">สแกน QR<input className={field} name="qr_amount" type="number" step="0.01" /></label>
              <label className="text-sm md:col-span-2">หมายเหตุ<input className={field} name="weather_or_shift_note" placeholder="เช่น ฝนตกทั้งวัน" /></label>
            </div>
          )}
          <div className="rounded-lg border border-red-200 p-3">
            <p className="font-semibold">ส่งมอบเงินสดประจำกะ</p>
            <p className="text-sm">เงินสดตามสลิป POS {money(cashPos)} · เงินสดนับจริงจากลิ้นชัก {money(counted)} · ผลต่างเงินสดส่งกะ {money(diff)}</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {FNB_NOTE_VALUES.map((face) => (
                <label key={face} className="text-xs">{face}<input className={field} name={`note_${face}`} type="number" min={0} onChange={(event) => setNotes((currentNotes) => ({ ...currentNotes, [face]: Number(event.target.value) || 0 }))} /></label>
              ))}
            </div>
            {Math.abs(diff) >= 0.5 ? <label className="mt-2 block text-sm">สาเหตุส่วนต่างเงินสด *<input className={field} name="cash_variance_reason" required minLength={3} /></label> : null}
          </div>
          <CashFloatNote branch={branch} workDate={workDate} shiftType={shiftType} counted={counted} cashPos={cashPos} />
          <div className="space-y-2 rounded-lg bg-slate-50 p-3">
            <p className="font-medium">วิธีฝากเงินสด</p>
            <label className="flex gap-2 text-sm"><input type="radio" checked={deposit === "BANK_DIRECT"} onChange={() => setDeposit("BANK_DIRECT")} />ฝากธนาคาร / ตู้ CDM (ไม่มีค่าธรรมเนียม 0 บาท)</label>
            <label className="flex gap-2 text-sm"><input type="radio" checked={deposit === "SEVEN_ELEVEN"} onChange={() => setDeposit("SEVEN_ELEVEN")} />ฝาก 7-Eleven (ค่าธรรมเนียม 15 บาท — คุณจวงโอนคืนพนักงานวันถัดไป)</label>
            <label className="flex gap-2 text-sm"><input type="radio" checked={deposit === "HOLD_NEXT_SHIFT"} onChange={() => setDeposit("HOLD_NEXT_SHIFT")} />เก็บรอฝากรวมกะถัดไป</label>
            {deposit === "BANK_DIRECT" ? <div className="grid gap-2 md:grid-cols-2"><input className={field} name="bank_deposit_amount" type="number" step="0.01" placeholder="ยอดฝากธนาคาร" /><PhotoDrop name="bank_slip" camera label="สลิปฝากธนาคาร" /></div> : null}
            {deposit === "SEVEN_ELEVEN" ? <div className="grid gap-2 md:grid-cols-2"><input className={field} name="seven_eleven_deposit_amount" type="number" step="0.01" placeholder="ยอดฝาก (ไม่หักยอดขาย)" /><input className={field} name="staff_bank_info" placeholder="บัญชีพนักงาน" /><PhotoDrop name="seven_slip" camera label="สลิป 7-Eleven" /></div> : null}
          </div>
          <p className="text-xs text-slate-500">กรอกเฉพาะยอดขายหน้าระบบที่เห็นตอนปิดกะ ส่วนค่า GP/ส่วนต่างที่แพลตฟอร์มตัดหัก ฝ่ายบัญชีจะบันทึกกระทบยอดย้อนหลังเมื่อสรุปยอดช่วงเย็น</p>
          {current ? <div className="space-y-2"><label className="block text-sm">สาเหตุการแก้ไข *<input className={field} name="edit_reason" required minLength={3} /></label><PhotoDrop name="evidence" camera label="รูปหลักฐานประกอบคำขอแก้ไข (ถ้ามี)" /></div> : null}
          <SaveButton busy={busy === "close" || busy === "ocr"}>บันทึกปิดกะ</SaveButton>
        </form>
      )}
    </div>
  );
}

function Shift3Panel({
  brandLock,
  branch,
  workDate,
  actorSource,
  busy,
  run,
}: {
  brandLock: FnbBrandCode | null;
  branch: string;
  workDate: string;
  actorSource: "desktop" | "liff";
  busy: boolean;
  run: (key: string, task: () => Promise<{ error: string | null; data: FnbSubmitResult }>, success: string) => void;
}) {
  const [notes, setNotes] = useState<Record<number, number>>({});
  const [deposit, setDeposit] = useState<"BANK_DIRECT" | "SEVEN_ELEVEN" | "HOLD_NEXT_SHIFT">("HOLD_NEXT_SHIFT");
  const [cashPos, setCashPos] = useState(0);
  const counted = FNB_NOTE_VALUES.reduce((sum, face) => sum + face * (notes[face] ?? 0), 0);
  return (
    <form className="space-y-3 rounded-xl border bg-white p-4" onSubmit={(event) => {
      event.preventDefault();
      const body = new FormData(event.currentTarget);
      fillCommon(body, { brandLock, branch, workDate, staffName: "", actorSource });
      body.set("cash_counted_amount", String(counted));
      body.set("deposit_method", deposit);
      run("shift3", () => saveShift3HandoverAction(body), "บันทึกส่งเงินกะสามแล้ว");
    }}>
      <h2 className="font-semibold">ส่งเงินกะสาม</h2>
      <p className="text-sm text-slate-500">กะสามบันทึกบนเซสชันหน้าร้าน เพราะสมุดปิดกะรองรับกะแรกและกะสอง</p>
      <CashFloatNote branch={branch} workDate={workDate} shiftType="SHIFT_3" counted={counted} cashPos={cashPos} />
      <label className="text-sm">เงินสดตาม POS<input className={field} type="number" step="0.01" onChange={(event) => setCashPos(Number(event.target.value) || 0)} /></label>
      <div className="grid gap-2 md:grid-cols-3">{FNB_NOTE_VALUES.map((face) => <label key={face} className="text-sm">ธนบัตร {face}<input className={field} type="number" min={0} onChange={(event) => setNotes((current) => ({ ...current, [face]: Number(event.target.value) || 0 }))} /></label>)}</div>
      <label className="flex gap-2 text-sm"><input type="radio" checked={deposit === "BANK_DIRECT"} onChange={() => setDeposit("BANK_DIRECT")} />ฝากธนาคาร 0฿</label>
      <label className="flex gap-2 text-sm"><input type="radio" checked={deposit === "SEVEN_ELEVEN"} onChange={() => setDeposit("SEVEN_ELEVEN")} />ฝาก 7-Eleven ค่าธรรมเนียม 15฿ โอนคืนโดยคุณจวง</label>
      <label className="flex gap-2 text-sm"><input type="radio" checked={deposit === "HOLD_NEXT_SHIFT"} onChange={() => setDeposit("HOLD_NEXT_SHIFT")} />เก็บรอฝากรวมกะถัดไป</label>
      <SaveButton busy={busy}>บันทึกส่งเงินกะสาม</SaveButton>
    </form>
  );
}

function WastePanel({
  brand,
  brandLock,
  branch,
  workDate,
  staffName,
  actorSource,
  shelfItems,
  day,
  busy,
  run,
}: {
  brand: FnbBrandCode;
  brandLock: FnbBrandCode | null;
  branch: string;
  workDate: string;
  staffName: string;
  actorSource: "desktop" | "liff";
  shelfItems: FnbItemRow[];
  day: FnbDayState | null;
  busy: string | null;
  run: (key: string, task: () => Promise<{ error: string | null; data: FnbSubmitResult }>, success: string) => void;
}) {
  const [editingWaste, setEditingWaste] = useState(false);
  const [editingShelf, setEditingShelf] = useState(false);
  const [group, setGroup] = useState<(typeof FNB_FRONT_GROUPS)[number]>("BAKERY_CAKE");
  const [waste, setWaste] = useState<Record<string, string>>({ JT: "", BT: "", MMK: "", ML: "", LEM: "" });
  const visible = shelfItems.filter((item) => item.front_back_group === group);
  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-xl border bg-white p-4">
        {day?.waste && !editingWaste ? (
          <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
            บันทึกของเหลือทิ้งวันนี้เรียบร้อยแล้ว — บันทึกได้วันละ 1 ครั้ง
            <p>ทุนของทิ้ง {money(day.waste.total_waste_cost_thb)} บาท</p>
            <button type="button" className="mt-2 rounded-md border px-3 py-1" onClick={() => setEditingWaste(true)}>แก้ไขข้อมูล</button>
          </div>
        ) : (
          <form className="space-y-3" onSubmit={(event) => {
            event.preventDefault();
            const body = new FormData(event.currentTarget);
            fillCommon(body, { brandLock, branch, workDate, staffName, actorSource });
            body.set("is_edit", day?.waste ? "true" : "false");
            body.set("waste_entries_json", JSON.stringify(Object.entries(waste).filter(([, qty]) => Number(qty) > 0).map(([code, qty]) => ({ code, qty: Number(qty) }))));
            run("waste", () => recordNightWasteAction(body).then((saved) => {
              if (saved.data.detail) setMessageSafe(JSON.stringify(saved.data.detail));
              return saved;
            }), "บันทึกของทิ้งเรียบร้อยแล้ว");
            setEditingWaste(false);
          }}>
            <div className="grid gap-3 md:grid-cols-5">
              {["JT", "BT", "MMK", "ML", "LEM"].map((code) => <label key={code} className="text-sm">{code} {code === "LEM" ? "(g)" : "(ml)"}<input className={field} value={waste[code] ?? ""} onChange={(event) => setWaste((current) => ({ ...current, [code]: event.target.value }))} /></label>)}
            </div>
            <PhotoDrop name="photos" camera label="ถ่ายของที่เททิ้ง" />
            {day?.waste ? <label className="block text-sm">สาเหตุการแก้ไข *<input className={field} name="edit_reason" required minLength={3} /></label> : null}
            <SaveButton busy={busy === "waste"}>บันทึกของทิ้ง</SaveButton>
          </form>
        )}
      </section>
      <section className="space-y-3 rounded-xl border bg-white p-4">
        {day?.shelf && !editingShelf ? (
          <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
            บันทึกเช็กของหน้า-หลังวันนี้เรียบร้อยแล้ว — บันทึกได้วันละ 1 ครั้ง
            <p>{day.shelf.item_count} รายการ · {day.shelf.staff_name}</p>
            <button type="button" className="mt-2 rounded-md border px-3 py-1" onClick={() => setEditingShelf(true)}>แก้ไขข้อมูล</button>
          </div>
        ) : (
          <form className="space-y-3" onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const lines = shelfItems.map((item) => ({
              item_id: item.id,
              sold_qty: Number(form.get(`sold_${item.id}`) ?? 0),
              front_qty: Number(form.get(`front_${item.id}`) ?? 0),
              back_qty: Number(form.get(`back_${item.id}`) ?? 0),
              expiry_date: String(form.get(`exp_${item.id}`) ?? ""),
            })).filter((line) => line.sold_qty || line.front_qty || line.back_qty || line.expiry_date);
            run("shelf", () => saveShelfChecksAction({
              branch_code: branch,
              check_date: workDate,
              staff_name: staffName,
              actor_source: actorSource,
              brand_lock: brandLock,
              is_edit: Boolean(day?.shelf),
              edit_reason: String(form.get("edit_reason") ?? ""),
              lines,
            }), "บันทึกเช็กของเรียบร้อยแล้ว");
            setEditingShelf(false);
          }}>
            <div className="flex flex-wrap gap-2">
              {FNB_FRONT_GROUPS.map((key) => <TabButton key={key} active={group === key} onClick={() => setGroup(key)}>{brand === "CHATORN" && key === "MERCHANDISE" ? "ของพรีเมียม" : FNB_FRONT_GROUP_LABEL[key]}</TabButton>)}
            </div>
            {visible.map((item) => (
              <div key={item.id} className="grid gap-2 rounded-md bg-slate-50 p-2 md:grid-cols-5">
                <p className="text-sm">{item.short_code} {item.name_th}</p>
                <input className={field} name={`sold_${item.id}`} type="number" placeholder="ขายไป" />
                <input className={field} name={`front_${item.id}`} type="number" placeholder="หน้าตู้" />
                <input className={field} name={`back_${item.id}`} type="number" placeholder="สต็อกหลัง" />
                <input className={field} name={`exp_${item.id}`} type="date" />
              </div>
            ))}
            {day?.shelf ? <label className="block text-sm">สาเหตุการแก้ไข *<input className={field} name="edit_reason" required minLength={3} /></label> : null}
            <SaveButton busy={busy === "shelf"}>บันทึกเช็กของ</SaveButton>
          </form>
        )}
      </section>
    </div>
  );
}

function SettlementPanel({
  shifts,
  busy,
  run,
}: {
  shifts: FnbShiftCard[];
  busy: boolean;
  run: (key: string, task: () => Promise<{ error: string | null; data: FnbSubmitResult }>, success: string) => void;
}) {
  const pending = shifts.filter((shift) => shift.platform_settlement_status === "PENDING_SETTLEMENT");
  if (pending.length === 0) return null;
  return (
    <section className="space-y-3 rounded-xl border bg-white p-4">
      <h2 className="font-semibold">กระทบยอดแพลตฟอร์มย้อนหลัง</h2>
      {pending.map((shift) => (
        <form key={shift.id} className="grid gap-2 md:grid-cols-4" onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          run("settle", async () => {
            const saved = await settlePlatformPayoutAction({
              shift_id: shift.id,
              lineman_net_payout: Number(form.get("lineman") ?? 0),
              grab_net_payout: Number(form.get("grab") ?? 0),
              webapp_net_payout: Number(form.get("webapp") ?? 0),
              platform_deduction_note: String(form.get("note") ?? ""),
            });
            return { error: saved.error, data: { ok: !saved.error, mode: null, request_no: null, message: saved.error } };
          }, "บันทึกกระทบยอดแพลตฟอร์มแล้ว");
        }}>
          <p className="text-sm md:col-span-4">{shift.shift_type === "MORNING" ? "กะเช้า" : "กะบ่าย"} · ยอดหน้าระบบ LineMan {money(shift.lineman_gross_amount)} / Grab {money(shift.grab_gross_amount)} / เว็บแอป {money(shift.webapp_amount)}</p>
          <input className={field} name="lineman" type="number" step="0.01" placeholder="LineMan ยอดโอนจริง" />
          <input className={field} name="grab" type="number" step="0.01" placeholder="Grab ยอดโอนจริง" />
          <input className={field} name="webapp" type="number" step="0.01" placeholder="เว็บแอปยอดโอนจริง" />
          <input className={field} name="note" placeholder="หมายเหตุส่วนต่าง" />
          <SaveButton busy={busy}>บันทึกว่ากระทบยอดแล้ว</SaveButton>
        </form>
      ))}
    </section>
  );
}

function PosExcelBox({ branches, branch, onBranch }: { branches: FnbBranchOption[]; branch: string; onBranch: (code: string) => void }) {
  const [preview, setPreview] = useState<FnbPosImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [, start] = useTransition();
  return (
    <section className="space-y-3 rounded-xl border bg-white p-4" onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const file = event.dataTransfer.files?.[0]; if (file) read(file); }}>
      <h2 className="font-semibold">นำเข้า Excel POS</h2>
      <select className={field} value={branch} disabled={branches.length <= 1} onChange={(event) => onBranch(event.target.value)}>{branches.map((item) => <option key={item.branch_code} value={item.branch_code}>{item.branch_code}</option>)}</select>
      <input type="file" accept=".xlsx,.xls" onChange={(event) => { const file = event.target.files?.[0]; if (file) read(file); }} />
      {preview ? <button type="button" className="rounded-md bg-[var(--fnb-brand)] px-4 py-2 text-sm text-white" disabled={busy} onClick={() => {
        setBusy(true);
        start(async () => {
          const saved = await commitPosExcelAction({ ...preview, branch_code: branch });
          setBusy(false);
          if (saved.error) toast.error(saved.error);
          else toast.success("บันทึกนำเข้าออเดอร์แล้ว");
        });
      }}>บันทึกนำเข้า {busy ? "..." : ""}</button> : null}
    </section>
  );
  function read(file: File) {
    const body = new FormData();
    body.set("file", file);
    setBusy(true);
    start(async () => {
      const parsed = await previewPosExcelAction(body);
      setPreview(parsed.data);
      setBusy(false);
      if (parsed.error || !parsed.data) toast.error(parsed.error || "อ่านไฟล์ไม่สำเร็จ");
      else toast.success(`อ่านได้ ${parsed.data.valid_order_count} บิลขาย และ ${parsed.data.cancelled_order_count} บิลยกเลิก`);
    });
  }
}

function ReimburseBox(props: { brand: FnbBrandCode; brandLock: FnbBrandCode | null; branch: string; workDate: string; staffName: string; actorSource: "desktop" | "liff"; busy: boolean; run: (key: string, task: () => Promise<{ error: string | null; data: FnbSubmitResult }>, success: string) => void }) {
  return (
    <form className="space-y-3 rounded-xl border bg-white p-4" onSubmit={(event) => {
      event.preventDefault();
      const body = new FormData(event.currentTarget);
      body.set("branch_code", props.branch);
      body.set("brand_lock", props.brandLock ?? "");
      body.set("actor_source", props.actorSource);
      body.set("staff_name", props.staffName);
      props.run("reimburse", async () => {
        const saved = await submitStaffReimbursementAction(body);
        return { error: saved.error, data: { ok: !saved.error, mode: null, request_no: saved.data.reimb_no, message: saved.error } };
      }, "ส่งคำขอให้คุณจวงแล้ว");
    }}>
      <h2 className="font-semibold">ขอโอนคืน / จ่ายตรง</h2>
      <select className={field} name="reimb_mode" defaultValue="STAFF_ADVANCE_REIMBURSE"><option value="STAFF_ADVANCE_REIMBURSE">สำรองจ่ายยอดเล็ก</option><option value="HQ_DIRECT_PAY">ให้คุณจวงโอนตรงร้านค้า</option></select>
      <input className={field} name="vendor_or_purpose" placeholder="ร้านค้า / รายการ" required />
      <input className={field} name="total_amount" type="number" step="0.01" placeholder="ยอดบาท" required />
      <input className={field} name="payee_bank_info" placeholder="บัญชีรับเงิน" />
      <PhotoDrop name="photos" camera label="รูปบิล" />
      <SaveButton busy={props.busy}>ส่งให้คุณจวง</SaveButton>
    </form>
  );
}

function fillCommon(body: FormData, input: { brandLock: FnbBrandCode | null; branch: string; workDate: string; staffName: string; actorSource: "desktop" | "liff" }) {
  body.set("brand_lock", input.brandLock ?? "");
  body.set("branch_code", input.branch);
  body.set("work_date", input.workDate);
  body.set("staff_name", input.staffName);
  body.set("actor_source", input.actorSource);
}

function setMessageSafe(value: string) {
  toast.message(value.slice(0, 180));
}

function Slip({ name, label }: { name: string; label: string }) {
  return <label className="text-sm">{label}<input className={field} name={name} type="number" step="0.01" defaultValue={0} /></label>;
}

function PhotoDrop({ name, label, camera, onFile }: { name: string; label: string; camera?: boolean; onFile?: (file: File) => void }) {
  return (
    <label className="block rounded-lg border border-dashed border-red-200 p-3 text-sm" onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const file = event.dataTransfer.files?.[0]; if (file && onFile) onFile(file); }}>
      {label}
      <input className="mt-2 block w-full text-sm" name={name} type="file" accept="image/*" capture={camera ? "environment" : undefined} multiple={name === "photos" || name === "slips"} onChange={(event) => { const file = event.target.files?.[0]; if (file && onFile) onFile(file); }} />
    </label>
  );
}

function SaveButton({ busy, children }: { busy: boolean; children: string }) {
  return <button className="inline-flex items-center gap-2 rounded-md bg-[var(--fnb-brand)] px-4 py-2 text-sm text-white disabled:opacity-60" disabled={busy}>{busy ? <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : null}{busy ? "กำลังบันทึก..." : children}</button>;
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return <button type="button" onClick={onClick} className={`rounded-full px-3 py-1.5 text-sm ${active ? "bg-[var(--fnb-brand)] text-white" : "bg-white text-red-800 ring-1 ring-red-200"}`}>{children}</button>;
}
