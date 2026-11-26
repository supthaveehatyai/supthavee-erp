"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { ApprovalQueue } from "@/app/fnb/approval-queue";
import {
  commitPosExcelAction,
  getFnbDayStateAction,
  listPendingShiftApprovalsAction,
  prefillPosSlipAction,
  previewPosExcelAction,
  recordMorningOpeningAction,
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
  initialApprovals = [],
}: {
  branches: FnbBranchOption[];
  shelfItems: FnbItemRow[];
  brandLock: FnbBrandCode | null;
  superAdmin: boolean;
  initialApprovals?: FnbChangeRequestRow[];
}) {
  const [tab, setTab] = useState<"open" | "close" | "waste">("open");
  const [branch, setBranch] = useState(branches[0]?.branch_code ?? "");
  const [workDate, setWorkDate] = useState(today());
  const [staffName, setStaffName] = useState("");
  const [message, setMessage] = useState("");
  const [day, setDay] = useState<FnbDayState | null>(null);
  const [approvals, setApprovals] = useState(initialApprovals);
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();
  const selected = branches.find((item) => item.branch_code === branch) ?? null;
  const brand = brandLock ?? (selected?.brand_code === "CHATORN" ? "CHATORN" : "LUCKY_CUP");
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
      <div>
        <p className="text-xs font-semibold text-red-700">{brandLock ? "LIFF" : "ผู้จัดการ"}</p>
        <h1 className="text-2xl font-bold text-slate-900">{heading}</h1>
        {brandLock ? null : <p className="text-sm text-slate-500">มือถือพนักงานของสาขานี้ใช้ {brand === "LUCKY_CUP" ? "/liff/luckycup" : "/liff/chatorn"}</p>}
      </div>
      {message ? <p className={`rounded-lg px-3 py-2 text-sm ${message.includes("รออนุมัติ") ? "bg-amber-50 text-amber-900" : message.includes("เรียบร้อย") || message.includes("แล้ว") ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>{message}</p> : null}
      {superAdmin ? <ApprovalQueue requests={approvals} onDone={() => { void listPendingShiftApprovalsAction().then((listed) => setApprovals(listed.data)); }} /> : null}
      <div className="grid gap-3 rounded-xl border border-red-100 bg-white p-4 md:grid-cols-3">
        <select className={field} value={branch} onChange={(event) => setBranch(event.target.value)}>
          {branches.map((item) => <option key={item.branch_code} value={item.branch_code}>{item.branch_code} {item.branch_name_th}</option>)}
        </select>
        <input className={field} value={staffName} placeholder="ชื่อพนักงาน" onChange={(event) => setStaffName(event.target.value)} />
        <input className={field} type="date" value={workDate} onChange={(event) => setWorkDate(event.target.value)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <TabButton active={tab === "open"} onClick={() => setTab("open")}>เปิดร้านเช้า</TabButton>
        <TabButton active={tab === "close"} onClick={() => setTab("close")}>ปิดกะเช้า / ปิดกะบ่าย</TabButton>
        <TabButton active={tab === "waste"} onClick={() => setTab("waste")}>ปิดร้าน: ของทิ้งและเช็กหน้า-หลัง</TabButton>
      </div>
      {tab === "open" ? <MorningPanel brandLock={brandLock} branch={branch} workDate={workDate} staffName={staffName} day={day} busy={busy === "open"} run={run} /> : null}
      {tab === "close" ? <ClosePanel brand={brand} brandLock={brandLock} superAdmin={superAdmin} branch={branch} branches={branches} workDate={workDate} staffName={staffName} day={day} busy={busy} run={run} /> : null}
      {tab === "waste" ? <WastePanel brand={brand} brandLock={brandLock} branch={branch} workDate={workDate} staffName={staffName} shelfItems={shelfItems} day={day} busy={busy} run={run} /> : null}
      {brandLock ? <ReimburseBox brand={brand} brandLock={brandLock} branch={branch} workDate={workDate} staffName={staffName} busy={busy === "reimburse"} run={run} /> : null}
      {superAdmin ? <SettlementPanel shifts={day?.shifts ?? []} busy={busy === "settle"} run={run} /> : null}
    </div>
  );
}

function MorningPanel({
  brandLock,
  branch,
  workDate,
  staffName,
  day,
  busy,
  run,
}: {
  brandLock: FnbBrandCode | null;
  branch: string;
  workDate: string;
  staffName: string;
  day: FnbDayState | null;
  busy: boolean;
  run: (key: string, task: () => Promise<{ error: string | null; data: FnbSubmitResult }>, success: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [shots, setShots] = useState(1);
  const locked = Boolean(day?.opening) && !editing;
  return (
    <section className="space-y-3 rounded-xl border border-red-100 bg-white p-4">
      {day?.opening && !editing ? (
        <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
          บันทึกเปิดร้านวันนี้เรียบร้อยแล้ว — บันทึกได้วันละ 1 ครั้ง
          <p>พนักงาน {day.opening.staff_name} · ช็อต {day.opening.calibration_shots} · กาแฟ {day.opening.total_coffee_used_g} g</p>
          <button type="button" className="mt-2 rounded-md border border-emerald-700 px-3 py-1" onClick={() => { setEditing(true); setShots(day.opening?.calibration_shots ?? 1); }}>แก้ไขข้อมูลเปิดร้าน</button>
        </div>
      ) : null}
      {locked ? null : (
        <form className="space-y-3" onSubmit={(event) => {
          event.preventDefault();
          const body = new FormData(event.currentTarget);
          fillCommon(body, { brandLock, branch, workDate, staffName });
          body.set("calibration_shots", String(shots));
          body.set("is_edit", day?.opening ? "true" : "false");
          run("open", () => recordMorningOpeningAction(body), "บันทึกเปิดร้านเรียบร้อยแล้ว");
          setEditing(false);
        }}>
          <label className="block text-sm">จำนวนช็อตเทสต์
            <span className="mt-1 flex items-center gap-2"><button type="button" className="h-10 w-10 rounded-md border" onClick={() => setShots((value) => Math.max(0, value - 1))}>-</button><b>{shots}</b><button type="button" className="h-10 w-10 rounded-md border" onClick={() => setShots((value) => value + 1)}>+</button></span>
          </label>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-sm">โดสต่อช็อต (g)<input className={field} name="dose_per_shot_g" type="number" defaultValue={day?.opening?.dose_per_shot_g ?? 20} /></label>
            <label className="text-sm">เวลาสกัด (เป้า 22–28 วิ)<input className={field} name="extraction_time_sec" type="number" defaultValue={day?.opening?.extraction_time_sec ?? 25} /></label>
            <label className="text-sm">น้ำหนักน้ำกาแฟ (เป้า 38–42 g)<input className={field} name="liquid_yield_g" type="number" defaultValue={day?.opening?.liquid_yield_g ?? 40} /></label>
          </div>
          <PhotoDrop name="photos" camera label="รูปตาชั่ง บาร์ ตู้ขนม และห้องน้ำ" />
          {day?.opening ? <label className="block text-sm">สาเหตุการแก้ไข *<input className={field} name="edit_reason" required minLength={3} /></label> : null}
          <SaveButton busy={busy}>บันทึกเปิดร้าน</SaveButton>
        </form>
      )}
    </section>
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
  day: FnbDayState | null;
  busy: string | null;
  run: (key: string, task: () => Promise<{ error: string | null; data: FnbSubmitResult }>, success: string) => void;
}) {
  const morning = props.day?.shifts.find((shift) => shift.shift_type === "MORNING") ?? null;
  const afternoon = props.day?.shifts.find((shift) => shift.shift_type === "AFTERNOON") ?? null;
  const [shiftType, setShiftType] = useState<"MORNING" | "AFTERNOON">("MORNING");
  const current = shiftType === "MORNING" ? morning : afternoon;
  const pending = props.day?.pending.find((row) => row.shift_type === shiftType);
  return (
    <section className="space-y-3">
      <article className="rounded-xl bg-slate-900 p-4 text-sm text-white">
        <p className="font-semibold">สรุปยอดรวมทั้งวันอัตโนมัติ = กะเช้า + กะบ่าย</p>
        <p className="mt-1">ยอดสุทธิ {money((morning?.net_sales_inc_vat ?? 0) + (afternoon?.net_sales_inc_vat ?? 0))} · เงินสด POS {money((morning?.cash_pos_amount ?? 0) + (afternoon?.cash_pos_amount ?? 0))} · QR {money((morning?.qr_amount ?? 0) + (afternoon?.qr_amount ?? 0))}</p>
      </article>
      <div className="flex gap-2">
        <TabButton active={shiftType === "MORNING"} onClick={() => setShiftType("MORNING")}>กะเช้า</TabButton>
        <TabButton active={shiftType === "AFTERNOON"} onClick={() => setShiftType("AFTERNOON")}>กะบ่าย / ปิดยอดขาย</TabButton>
      </div>
      {pending ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">รออนุมัติแก้ไขตัวเลขการเงิน ({pending.request_no})</p> : null}
      <ShiftForm {...props} shiftType={shiftType} current={current} />
      {props.brand === "LUCKY_CUP" && props.superAdmin ? <PosExcelBox branches={props.branches.filter((item) => item.brand_code === "LUCKY_CUP")} /> : null}
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
  shiftType: "MORNING" | "AFTERNOON";
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
          fillCommon(body, { brandLock, branch, workDate, staffName });
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

function WastePanel({
  brand,
  brandLock,
  branch,
  workDate,
  staffName,
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
            fillCommon(body, { brandLock, branch, workDate, staffName });
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

function PosExcelBox({ branches }: { branches: FnbBranchOption[] }) {
  const [preview, setPreview] = useState<FnbPosImportPreview | null>(null);
  const [branch, setBranch] = useState(branches[0]?.branch_code ?? "");
  const [busy, setBusy] = useState(false);
  const [, start] = useTransition();
  return (
    <section className="space-y-3 rounded-xl border bg-white p-4" onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const file = event.dataTransfer.files?.[0]; if (file) read(file); }}>
      <h2 className="font-semibold">นำเข้า Excel POS</h2>
      <select className={field} value={branch} onChange={(event) => setBranch(event.target.value)}>{branches.map((item) => <option key={item.branch_code} value={item.branch_code}>{item.branch_code}</option>)}</select>
      <input type="file" accept=".xlsx,.xls" onChange={(event) => { const file = event.target.files?.[0]; if (file) read(file); }} />
      {preview ? <button type="button" className="rounded-md bg-red-700 px-4 py-2 text-sm text-white" disabled={busy} onClick={() => {
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

function ReimburseBox(props: { brand: FnbBrandCode; brandLock: FnbBrandCode | null; branch: string; workDate: string; staffName: string; busy: boolean; run: (key: string, task: () => Promise<{ error: string | null; data: FnbSubmitResult }>, success: string) => void }) {
  return (
    <form className="space-y-3 rounded-xl border bg-white p-4" onSubmit={(event) => {
      event.preventDefault();
      const body = new FormData(event.currentTarget);
      body.set("branch_code", props.branch);
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

function fillCommon(body: FormData, input: { brandLock: FnbBrandCode | null; branch: string; workDate: string; staffName: string }) {
  body.set("brand_lock", input.brandLock ?? "");
  body.set("branch_code", input.branch);
  body.set("work_date", input.workDate);
  body.set("staff_name", input.staffName);
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
  return <button className="inline-flex items-center gap-2 rounded-md bg-red-700 px-4 py-2 text-sm text-white disabled:opacity-60" disabled={busy}>{busy ? <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : null}{busy ? "กำลังบันทึก..." : children}</button>;
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return <button type="button" onClick={onClick} className={`rounded-full px-3 py-1.5 text-sm ${active ? "bg-red-700 text-white" : "bg-white text-red-800 ring-1 ring-red-200"}`}>{children}</button>;
}
