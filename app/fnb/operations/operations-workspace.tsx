"use client";

import { useEffect, useState, useTransition } from "react";
import {
  prefillPosSlipAction,
  previewPosExcelAction,
  commitPosExcelAction,
  recordMorningOpeningAction,
  recordNightWasteAction,
  recordShiftClosingAction,
  saveShelfChecksAction,
} from "@/lib/actions/fnb-operations";
import { submitStaffReimbursementAction } from "@/lib/actions/fnb-procurement";
import { FNB_FRONT_GROUP_LABEL, FNB_FRONT_GROUPS, FNB_NOTE_VALUES, type FnbBranchOption, type FnbItemRow, type FnbPosImportPreview } from "@/types/fnb";

const field = "h-10 w-full rounded-md border border-slate-200 px-3 text-sm";

function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
}

export function OperationsWorkspace({
  branches,
  shelfItems,
  liff,
  schemaMessage,
}: {
  branches: FnbBranchOption[];
  shelfItems: FnbItemRow[];
  liff: boolean;
  schemaMessage?: string | null;
}) {
  const [tab, setTab] = useState<"open" | "close" | "waste">("open");
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  useEffect(() => {
    const block = (event: DragEvent) => {
      event.preventDefault();
    };
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold text-red-700">{liff ? "LIFF" : "หน้าร้าน"}</p>
        <h1 className="text-2xl font-bold text-slate-900">ปฏิบัติการ 3 ช่วงเวลา</h1>
        {schemaMessage ? <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{schemaMessage}</p> : null}
        {liff ? null : (
          <p className="text-sm text-slate-500">
            พนักงานใช้มือถือที่ <a className="text-red-700 underline" href="/liff/fnb">/liff/fnb</a>
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <TabButton active={tab === "open"} onClick={() => setTab("open")}>เปิดร้านเช้า</TabButton>
        <TabButton active={tab === "close"} onClick={() => setTab("close")}>ปิดกะ / 7-Eleven</TabButton>
        <TabButton active={tab === "waste"} onClick={() => setTab("waste")}>ของทิ้งและเช็กหน้าหลัง</TabButton>
      </div>
      {message ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{message}</p> : null}
      {tab === "open" ? <MorningForm branches={branches} liff={liff} pending={pending} start={start} setMessage={setMessage} /> : null}
      {tab === "close" ? <CloseForm branches={branches} liff={liff} pending={pending} start={start} setMessage={setMessage} /> : null}
      {tab === "waste" ? <WasteForm branches={branches} shelfItems={shelfItems} liff={liff} pending={pending} start={start} setMessage={setMessage} /> : null}
      {liff ? <ReimburseBox branches={branches} pending={pending} start={start} setMessage={setMessage} /> : <PosExcelBox branches={branches} pending={pending} start={start} setMessage={setMessage} />}
    </div>
  );
}

function MorningForm({
  branches,
  liff,
  pending,
  start,
  setMessage,
}: FormProps) {
  const [shots, setShots] = useState(1);
  return (
    <form
      className="space-y-3 rounded-xl border border-red-100 bg-white p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const body = new FormData(event.currentTarget);
        body.set("calibration_shots", String(shots));
        start(async () => {
          const saved = await recordMorningOpeningAction(body);
          setMessage(saved.error ?? "บันทึกเปิดร้านแล้ว ระบบตัดเมล็ดกาแฟตามจำนวนช็อต");
        });
      }}
    >
      <BranchStaff branches={branches} />
      <label className="block text-sm">จำนวนช็อตเทสต์
        <div className="mt-1 flex items-center gap-2">
          <button type="button" className="h-10 w-10 rounded-md border" onClick={() => setShots((value) => Math.max(0, value - 1))}>-</button>
          <span className="w-8 text-center font-semibold">{shots}</span>
          <button type="button" className="h-10 w-10 rounded-md border" onClick={() => setShots((value) => value + 1)}>+</button>
        </div>
      </label>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm">โดสต่อช็อต (g)<input className={field} name="dose_per_shot_g" type="number" defaultValue={20} /></label>
        <label className="text-sm">เวลาสกัด (เป้า 22–28 วิ)<input className={field} name="extraction_time_sec" type="number" defaultValue={25} /></label>
        <label className="text-sm">น้ำหนักน้ำกาแฟ (เป้า 38–42 g)<input className={field} name="liquid_yield_g" type="number" defaultValue={40} /></label>
      </div>
      <PhotoDrop name="photos" liff={liff} label="รูปตาชั่ง บาร์ ตู้ขนม และห้องน้ำ" />
      <button className="rounded-md bg-red-700 px-4 py-2 text-sm text-white" disabled={pending}>บันทึกเปิดร้าน</button>
    </form>
  );
}

function CloseForm({ branches, pending, start, setMessage }: FormProps) {
  const [mode, setMode] = useState<"POS_SLIP" | "QUICK_SUMMARY">("POS_SLIP");
  const [notes, setNotes] = useState<Record<number, number>>({});
  const [cashPos, setCashPos] = useState(0);
  const [deposit, setDeposit] = useState(0);
  const [quick, setQuick] = useState({ morning: 0, afternoon: 0, qr: 0 });
  const counted = FNB_NOTE_VALUES.reduce((sum, face) => sum + face * (notes[face] ?? 0), 0);
  const quickSum = quick.morning + quick.afternoon + quick.qr;
  return (
    <form
      className="space-y-3 rounded-xl border border-red-100 bg-white p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const body = new FormData(event.currentTarget);
        body.set("entry_mode", mode);
        body.set("cash_counted_amount", String(mode === "QUICK_SUMMARY" ? quick.morning + quick.afternoon : counted));
        if (mode === "QUICK_SUMMARY") {
          body.set("morning_cash_quick", String(quick.morning));
          body.set("afternoon_cash_quick", String(quick.afternoon));
          body.set("qr_amount", String(quick.qr));
          body.set("net_sales_inc_vat", String(quickSum));
          body.set("gross_sales", String(quickSum));
          body.set("cash_pos_amount", String(quick.morning + quick.afternoon));
        }
        body.set("seven_eleven_fee_thb", deposit > 0 ? "15" : "0");
        start(async () => {
          const saved = await recordShiftClosingAction(body);
          setMessage(saved.error ?? "บันทึกปิดกะแล้ว ถ้ามีฝาก 7-Eleven ระบบตั้งคิวคืนค่าธรรมเนียม 15 บาทให้คุณจวง");
        });
      }}
    >
      <BranchStaff branches={branches} />
      <label className="text-sm">กะ
        <select className={field} name="shift_type" defaultValue="FULL_DAY">
          <option value="MORNING">เช้า</option>
          <option value="AFTERNOON">บ่าย</option>
          <option value="FULL_DAY">ทั้งวัน</option>
        </select>
      </label>
      <div className="flex gap-2">
        <TabButton active={mode === "POS_SLIP"} onClick={() => setMode("POS_SLIP")}>สลิป POS</TabButton>
        <TabButton active={mode === "QUICK_SUMMARY"} onClick={() => setMode("QUICK_SUMMARY")}>ยอดด่วนชาทร</TabButton>
      </div>
      {mode === "POS_SLIP" ? (
        <div className="grid gap-3 md:grid-cols-3">
          <SlipField name="gross_sales" label="ยอดขาย" />
          <SlipField name="discount_total" label="ส่วนลด" />
          <SlipField name="delivery_price_diff_discount" label="ส่วนต่างเดลิเวอรี" />
          <SlipField name="net_sales_inc_vat" label="ยอดสุทธิ" />
          <label className="text-sm">เงินสด POS<input className={field} name="cash_pos_amount" type="number" step="0.01" onChange={(event) => setCashPos(Number(event.target.value) || 0)} /></label>
          <SlipField name="qr_amount" label="QR" />
          <SlipField name="lineman_gross_amount" label="LineMan" />
          <SlipField name="grab_gross_amount" label="Grab" />
          <SlipField name="webapp_amount" label="เว็บแอป" />
          <PhotoDrop name="slips" liff label="วางหรือถ่ายสลิป POS / LineMan / Grab" onFile={(file) => {
            const body = new FormData();
            body.set("file", file);
            start(async () => {
              const filled = await prefillPosSlipAction(body);
              setMessage(filled.error ?? "เติมตัวเลขจากสลิปแล้ว ตรวจก่อนบันทึก");
              if (!filled.error) {
                for (const [key, value] of Object.entries(filled.data)) {
                  const input = document.querySelector<HTMLInputElement>(`input[name="${key}"]`);
                  if (input) input.value = String(value);
                  if (key === "cash_pos_amount") setCashPos(value);
                }
              }
            });
          }} />
          <div className="md:col-span-3 grid grid-cols-3 gap-2">
            {FNB_NOTE_VALUES.map((face) => (
              <label key={face} className="text-xs">{face}
                <input className={field} name={`note_${face}`} type="number" min={0} onChange={(event) => setNotes((current) => ({ ...current, [face]: Number(event.target.value) || 0 }))} />
              </label>
            ))}
          </div>
          <p className="text-sm md:col-span-3">นับได้ {counted.toFixed(2)} ต่างจาก POS {(counted - cashPos).toFixed(2)}</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">สดเช้า<input className={field} type="number" step="0.01" onChange={(event) => setQuick((current) => ({ ...current, morning: Number(event.target.value) || 0 }))} /></label>
          <label className="text-sm">สดบ่าย<input className={field} type="number" step="0.01" onChange={(event) => setQuick((current) => ({ ...current, afternoon: Number(event.target.value) || 0 }))} /></label>
          <label className="text-sm">สแกน QR<input className={field} type="number" step="0.01" onChange={(event) => setQuick((current) => ({ ...current, qr: Number(event.target.value) || 0 }))} /></label>
          <label className="text-sm">หมายเหตุ<input className={field} name="weather_or_shift_note" placeholder="ฝนตกทั้งวัน" /></label>
          <p className="text-sm font-semibold md:col-span-2">รวม {quickSum.toFixed(2)} บาท</p>
        </div>
      )}
      <div className="rounded-lg bg-slate-50 p-3">
        <p className="text-sm font-medium">ฝาก 7-Eleven (ไม่หักยอดขาย)</p>
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          <label className="text-sm">ยอดฝาก<input className={field} name="seven_eleven_deposit_amount" type="number" step="0.01" onChange={(event) => setDeposit(Number(event.target.value) || 0)} /></label>
          <label className="text-sm">บัญชีพนักงาน<input className={field} name="staff_bank_info" /></label>
          <p className="text-sm">ค่าธรรมเนียม {deposit > 0 ? "15.00" : "0.00"} บาท</p>
          <PhotoDrop name="seven_slip" liff label="สลิป 7-Eleven" />
        </div>
      </div>
      <button className="rounded-md bg-red-700 px-4 py-2 text-sm text-white" disabled={pending}>บันทึกปิดกะ</button>
    </form>
  );
}

function WasteForm({ branches, shelfItems, liff, pending, start, setMessage }: FormProps & { shelfItems: FnbItemRow[] }) {
  const [group, setGroup] = useState<(typeof FNB_FRONT_GROUPS)[number]>("BAKERY_CAKE");
  const [waste, setWaste] = useState<Record<string, string>>({ JT: "", BT: "", MMK: "", ML: "", LEM: "" });
  const [extraCode, setExtraCode] = useState("");
  const [report, setReport] = useState("");
  const visible = shelfItems.filter((item) => item.front_back_group === group);
  return (
    <div className="space-y-4">
      <form
        className="space-y-3 rounded-xl border border-red-100 bg-white p-4"
        onSubmit={(event) => {
          event.preventDefault();
          const body = new FormData(event.currentTarget);
          const entries = Object.entries(waste)
            .filter(([, qty]) => Number(qty) > 0)
            .map(([code, qty]) => ({ short_code: code, qty: Number(qty), uom: code === "LEM" ? "g" : "ml" }));
          body.set("waste_entries_json", JSON.stringify(entries));
          start(async () => {
            const saved = await recordNightWasteAction(body);
            setMessage(saved.error ?? "บันทึกของทิ้งแล้ว");
            setReport(saved.data ? JSON.stringify(saved.data, null, 2) : "");
          });
        }}
      >
        <BranchStaff branches={branches} />
        <div className="grid gap-3 md:grid-cols-5">
          {["JT", "BT", "MMK", "ML", "LEM"].map((code) => (
            <label key={code} className="text-sm">{code} {code === "LEM" ? "(g)" : "(ml)"}
              <input className={field} value={waste[code] ?? ""} onChange={(event) => setWaste((current) => ({ ...current, [code]: event.target.value }))} />
            </label>
          ))}
        </div>
        <div className="flex gap-2">
          <input className={field} placeholder="รหัสเพิ่ม" value={extraCode} onChange={(event) => setExtraCode(event.target.value.toUpperCase())} />
          <button type="button" className="rounded-md border px-3 text-sm" onClick={() => extraCode && setWaste((current) => ({ ...current, [extraCode]: current[extraCode] ?? "" }))}>เพิ่ม</button>
        </div>
        <PhotoDrop name="photos" liff={liff} label="ถ่ายของที่เททิ้ง" />
        <button className="rounded-md bg-red-700 px-4 py-2 text-sm text-white" disabled={pending}>บันทึกของทิ้ง</button>
        {report ? <pre className="overflow-auto rounded-md bg-slate-950 p-3 text-xs text-white">{report}</pre> : null}
      </form>
      <form
        className="space-y-3 rounded-xl border border-red-100 bg-white p-4"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const lines = shelfItems.map((item) => ({
            item_id: item.id,
            sold_qty: Number(form.get(`sold_${item.id}`) ?? 0),
            front_qty: Number(form.get(`front_${item.id}`) ?? 0),
            back_qty: Number(form.get(`back_${item.id}`) ?? 0),
            expiry_date: String(form.get(`exp_${item.id}`) ?? ""),
          })).filter((line) => line.sold_qty || line.front_qty || line.back_qty || line.expiry_date);
          start(async () => {
            const saved = await saveShelfChecksAction({
              branch_code: String(form.get("branch_code") ?? ""),
              check_date: String(form.get("work_date") ?? today()),
              staff_name: String(form.get("staff_name") ?? ""),
              lines,
            });
            setMessage(saved.error ?? `บันทึกเช็กของ ${saved.data.saved} รายการ`);
          });
        }}
      >
        <BranchStaff branches={branches} />
        <div className="flex flex-wrap gap-2">
          {FNB_FRONT_GROUPS.map((key) => (
            <TabButton key={key} active={group === key} onClick={() => setGroup(key)}>{FNB_FRONT_GROUP_LABEL[key]}</TabButton>
          ))}
        </div>
        <div className="space-y-2">
          {visible.map((item) => (
            <div key={item.id} className="grid gap-2 rounded-md bg-slate-50 p-2 md:grid-cols-5">
              <p className="text-sm font-medium">{item.short_code} {item.name_th}</p>
              <input className={field} name={`sold_${item.id}`} type="number" placeholder="ขายไป" />
              <input className={field} name={`front_${item.id}`} type="number" placeholder="หน้าตู้" />
              <input className={field} name={`back_${item.id}`} type="number" placeholder="สต็อกหลัง" />
              <input className={field} name={`exp_${item.id}`} type="date" />
            </div>
          ))}
        </div>
        <button className="rounded-md bg-red-700 px-4 py-2 text-sm text-white" disabled={pending}>บันทึกเช็กของ</button>
      </form>
    </div>
  );
}

function PosExcelBox({ branches, pending, start, setMessage }: FormProps) {
  const [preview, setPreview] = useState<FnbPosImportPreview | null>(null);
  const [branch, setBranch] = useState(branches[0]?.branch_code ?? "");
  return (
    <section className="space-y-3 rounded-xl border border-red-100 bg-white p-4">
      <h2 className="font-semibold">นำเข้า Excel POS Lucky Cup</h2>
      <select className={field} value={branch} onChange={(event) => setBranch(event.target.value)}>
        {branches.map((item) => <option key={item.branch_code} value={item.branch_code}>{item.branch_code}</option>)}
      </select>
      <PhotoDrop name="pos" label="วางไฟล์ 堂食订单.xlsx" onFile={(file) => {
        const body = new FormData();
        body.set("file", file);
        start(async () => {
          const parsed = await previewPosExcelAction(body);
          setPreview(parsed.data);
          setMessage(parsed.error ?? `ขายปกติ ${parsed.data?.valid_order_count ?? 0} ใบ คืน/ยกเลิก ${parsed.data?.cancelled_order_count ?? 0} ใบ`);
        });
      }} />
      {preview ? (
        <button
          className="rounded-md bg-red-700 px-4 py-2 text-sm text-white"
          disabled={pending}
          onClick={() => start(async () => {
            const saved = await commitPosExcelAction({ ...preview, branch_code: branch });
            setMessage(saved.error ?? "บันทึกประวัติการนำเข้าแล้ว");
          })}
        >
          บันทึกนำเข้า
        </button>
      ) : null}
    </section>
  );
}

function ReimburseBox({ branches, pending, start, setMessage }: FormProps) {
  return (
    <form
      className="space-y-3 rounded-xl border border-red-100 bg-white p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const body = new FormData(event.currentTarget);
        start(async () => {
          const saved = await submitStaffReimbursementAction(body);
          setMessage(saved.error ?? `ส่งคำขอ ${saved.data.reimb_no} แล้ว`);
        });
      }}
    >
      <h2 className="font-semibold">ขอโอนคืน / จ่ายตรง</h2>
      <BranchStaff branches={branches} />
      <select className={field} name="reimb_mode" defaultValue="STAFF_ADVANCE_REIMBURSE">
        <option value="STAFF_ADVANCE_REIMBURSE">สำรองจ่ายยอดเล็ก</option>
        <option value="HQ_DIRECT_PAY">ให้คุณจวงโอนตรงร้านค้า</option>
      </select>
      <input className={field} name="vendor_or_purpose" placeholder="ร้านค้า / รายการ" required />
      <input className={field} name="total_amount" type="number" step="0.01" placeholder="ยอดบาท" required />
      <input className={field} name="payee_bank_info" placeholder="บัญชีรับเงิน" />
      <PhotoDrop name="photos" liff label="รูปบิล" />
      <button className="rounded-md bg-red-700 px-4 py-2 text-sm text-white" disabled={pending}>ส่งให้คุณจวง</button>
    </form>
  );
}

function BranchStaff({ branches }: { branches: FnbBranchOption[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <select className={field} name="branch_code" required defaultValue={branches[0]?.branch_code ?? ""}>
        {branches.map((branch) => <option key={branch.branch_code} value={branch.branch_code}>{branch.branch_code} {branch.branch_name_th}</option>)}
      </select>
      <input className={field} name="staff_name" placeholder="ชื่อพนักงาน" required />
      <input className={field} name="work_date" type="date" defaultValue={today()} />
    </div>
  );
}

function SlipField({ name, label }: { name: string; label: string }) {
  return <label className="text-sm">{label}<input className={field} name={name} type="number" step="0.01" defaultValue={0} /></label>;
}

function PhotoDrop({
  name,
  label,
  liff = false,
  onFile,
}: {
  name: string;
  label: string;
  liff?: boolean;
  onFile?: (file: File) => void;
}) {
  return (
    <label
      className="block rounded-lg border border-dashed border-red-200 p-3 text-sm text-slate-600"
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const file = event.dataTransfer.files?.[0];
        if (file && onFile) onFile(file);
      }}
    >
      {label}
      <input
        className="mt-2 block w-full text-sm"
        name={name}
        type="file"
        accept={name === "pos" ? ".xlsx,.xls" : "image/*"}
        capture={liff ? "environment" : undefined}
        multiple={name !== "seven_slip" && name !== "pos"}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file && onFile) onFile(file);
        }}
      />
    </label>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return <button type="button" onClick={onClick} className={`rounded-full px-3 py-1.5 text-sm ${active ? "bg-red-700 text-white" : "bg-white text-red-800 ring-1 ring-red-200"}`}>{children}</button>;
}

type FormProps = {
  branches: FnbBranchOption[];
  liff?: boolean;
  pending: boolean;
  start: (callback: () => void) => void;
  setMessage: (message: string) => void;
};
