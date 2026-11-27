"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  approveFnbPayrollAction,
  loadFnbPayrollAction,
  openPrivateDocAction,
  previewFnbUsernameAction,
  resetFnbEmployeePinAction,
  resignFnbEmployeeAction,
  saveFnbEmployeeAction,
  submitFnbPayrollAction,
} from "@/lib/actions/fnb-people";
import { payrollAmounts } from "@/lib/fnb/payroll-math";
import type { FnbEmployeeCard, FnbPayrollDraftLine, FnbPeoplePayload } from "@/types/iam";

export function FnbPeopleWorkspace({ payload }: { payload: FnbPeoplePayload }) {
  const [tab, setTab] = useState<"people" | "payroll">("people");
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold text-red-700">ร้านน้ำ</p>
        <h1 className="text-2xl font-bold text-slate-900">บุคลากรและเงินเดือนร้านน้ำ</h1>
        <p className="text-sm text-slate-500">ผู้บันทึก: {payload.actorName}</p>
      </div>
      <div className="flex gap-2">
        <button type="button" className={`rounded-full px-3 py-1.5 text-sm ${tab === "people" ? "bg-red-700 text-white" : "bg-white"}`} onClick={() => setTab("people")}>ทะเบียนพนักงานและรหัสล็อกอิน</button>
        <button type="button" className={`rounded-full px-3 py-1.5 text-sm ${tab === "payroll" ? "bg-red-700 text-white" : "bg-white"}`} onClick={() => setTab("payroll")}>เตรียมเงินเดือนและชั่วโมงพาร์ทไทม์</button>
      </div>
      {tab === "people" ? <PeopleTab payload={payload} /> : <PayrollTab payload={payload} />}
    </div>
  );
}

function PeopleTab({ payload }: { payload: FnbPeoplePayload }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [editing, setEditing] = useState<FnbEmployeeCard | null>(null);
  const brand = payload.brands.length === 1 ? payload.brands[0] : "LUCKY_CUP";
  const branches = payload.branches.filter((item) => item.brand === brand);

  return (
    <div className="space-y-4">
      <button type="button" className="rounded-xl bg-red-700 px-4 py-2 text-sm font-semibold text-white" onClick={() => { setEditing(null); setOpen(true); }}>เพิ่มพนักงาน</button>
      {open ? (
        <form
          className="grid gap-3 rounded-2xl border bg-white p-4 md:grid-cols-2"
          onSubmit={async (event) => {
            event.preventDefault();
            const saved = await saveFnbEmployeeAction(new FormData(event.currentTarget));
            if (!saved.success) toast.error(saved.error ?? "บันทึกไม่สำเร็จ");
            else {
              toast.success("บันทึกพนักงานแล้ว");
              setOpen(false);
              router.refresh();
            }
          }}
        >
          <input type="hidden" name="id" value={editing?.id ?? ""} />
          <input type="hidden" name="user_id" value={editing?.userId ?? ""} />
          <label className="text-sm">ชื่อ-นามสกุล (ไทย)<input name="full_name_th" defaultValue={editing?.fullNameTh} className="mt-1 w-full rounded-lg border px-3 py-2" required /></label>
          <label className="text-sm">ชื่อเล่นในร้าน<input name="nickname" defaultValue={editing?.nickname} className="mt-1 w-full rounded-lg border px-3 py-2" required /></label>
          <label className="text-sm">ชื่อจริงภาษาอังกฤษ<input name="first_name_en" defaultValue={editing?.firstNameEn} className="mt-1 w-full rounded-lg border px-3 py-2" onChange={(event) => {
            const form = event.currentTarget.form;
            void previewFnbUsernameAction(event.target.value, String(new FormData(form!).get("last_name_en") ?? "")).then(setUsername);
          }} required /></label>
          <label className="text-sm">นามสกุลภาษาอังกฤษ<input name="last_name_en" defaultValue={editing?.lastNameEn} className="mt-1 w-full rounded-lg border px-3 py-2" onChange={(event) => {
            const form = event.currentTarget.form;
            void previewFnbUsernameAction(String(new FormData(form!).get("first_name_en") ?? ""), event.target.value).then(setUsername);
          }} required /></label>
          <p className="text-sm md:col-span-2">Username: <strong>{username || editing?.username || "firstname.las"}</strong></p>
          <label className="text-sm">แบรนด์
            <select name="brand_code" defaultValue={editing?.brandCode || brand} className="mt-1 w-full rounded-lg border px-3 py-2" disabled={payload.brands.length === 1}>
              {payload.brands.map((item) => <option key={item} value={item}>{item === "LUCKY_CUP" ? "Lucky Cup" : "ชาทรตะโหมด"}</option>)}
            </select>
          </label>
          {payload.brands.length === 1 ? <input type="hidden" name="brand_code" value={brand} /> : null}
          <label className="text-sm">สาขาหลัก
            <select name="primary_branch_code" defaultValue={editing?.primaryBranchCode || branches[0]?.code} className="mt-1 w-full rounded-lg border px-3 py-2">
              {payload.branches.filter((item) => payload.brands.includes(item.brand as "LUCKY_CUP")).map((item) => <option key={item.code} value={item.code}>{item.code} {item.name}</option>)}
            </select>
          </label>
          <div className="text-sm md:col-span-2">สาขาที่อนุญาตให้ส่งงาน
            <div className="mt-1 flex flex-wrap gap-3">
              {payload.branches.filter((item) => payload.brands.includes(item.brand as "LUCKY_CUP")).map((item) => (
                <label key={item.code}><input type="checkbox" name="allowed_branch_codes" value={item.code} defaultChecked={editing?.allowedBranchCodes.includes(item.code) || item.code === (editing?.primaryBranchCode || branches[0]?.code)} /> {item.code}</label>
              ))}
            </div>
          </div>
          <label className="text-sm">วันเริ่มงานจริง<input type="date" name="hire_date" defaultValue={editing?.hireDate || new Date().toISOString().slice(0, 10)} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
          <label className="text-sm">ประเภทการจ้าง
            <select name="employment_type" defaultValue={editing?.employmentType || "FULL_TIME_MONTHLY"} className="mt-1 w-full rounded-lg border px-3 py-2">
              <option value="FULL_TIME_MONTHLY">ประจำรายเดือน</option>
              <option value="PART_TIME_HOURLY">พาร์ทไทม์รายชั่วโมง</option>
              <option value="DAILY_WAGE">รายวัน</option>
            </select>
          </label>
          {editing?.hidePay ? null : (
            <>
              <label className="text-sm">อัตราค่าจ้าง<input name="base_pay_rate" type="number" step="0.01" defaultValue={editing?.basePayRate ?? 0} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
              <label className="text-sm">เบี้ยขยันมาตรฐาน<input name="diligence_allowance" type="number" step="0.01" defaultValue={editing?.diligenceAllowance ?? 0} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
              <label className="text-sm">ค่าตำแหน่ง<input name="position_allowance" type="number" step="0.01" defaultValue={editing?.positionAllowance ?? 0} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
              <label className="text-sm">เลขบัญชีรับเงินเดือน<input name="bank_account_no" defaultValue={editing?.bankAccountNo ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
            </>
          )}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_sso_enrolled" value="true" defaultChecked={editing?.isSsoEnrolled !== false} />เข้าประกันสังคม ม.33</label>
          {payload.canSetTier ? (
            <label className="text-sm">ชั้นความลับค่าตอบแทน
              <select name="compensation_tier" defaultValue={editing?.compensationTier || "GENERAL_STAFF"} className="mt-1 w-full rounded-lg border px-3 py-2">
                <option value="GENERAL_STAFF">พนักงานทั่วไป</option>
                <option value="EXECUTIVE_CONFIDENTIAL">ผู้บริหารปกปิดพิเศษ</option>
                <option value="INTERNAL_PRIVATE">จ่ายส่วนตัวนอกระบบบัญชี</option>
              </select>
            </label>
          ) : null}
          <label className="text-sm">สำเนาบัตรประชาชน<input name="id_card" type="file" accept="image/*,.pdf" className="mt-1 block text-xs" /></label>
          <label className="text-sm">หน้าสมุดบัญชี<input name="bank_book" type="file" accept="image/*,.pdf" className="mt-1 block text-xs" /></label>
          {!editing?.userId ? <label className="flex items-center gap-2 text-sm md:col-span-2"><input type="checkbox" name="open_login" value="true" defaultChecked />เปิดรหัสล็อกอินเข้าระบบ (PIN เริ่มต้น 555555)</label> : null}
          <div className="flex gap-2 md:col-span-2">
            <button className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white" type="submit">บันทึก</button>
            <button className="rounded-lg border px-4 py-2 text-sm" type="button" onClick={() => setOpen(false)}>ปิด</button>
          </div>
        </form>
      ) : null}
      <div className="overflow-x-auto rounded-2xl border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-red-50 text-slate-600"><tr><th className="px-3 py-2">พนักงาน</th><th className="px-3 py-2">Username</th><th className="px-3 py-2">สาขา</th><th className="px-3 py-2">จัดการ</th></tr></thead>
          <tbody>
            {payload.employees.map((row) => (
              <tr key={row.id} className="border-t">
                <td className="px-3 py-2">{row.nickname} · {row.fullNameTh}<div className="text-xs text-slate-500">{row.employmentStatus} {row.hidePay ? "" : row.employmentType}</div></td>
                <td className="px-3 py-2">{row.username || "—"}</td>
                <td className="px-3 py-2">{row.brandCode} {row.allowedBranchCodes.join(", ")}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="text-xs text-blue-700" onClick={() => { setEditing(row); setUsername(row.username || ""); setOpen(true); }}>แก้ไข</button>
                    {row.userId ? <button type="button" className="text-xs" onClick={async () => {
                      const saved = await resetFnbEmployeePinAction(row.id);
                      if (!saved.success) toast.error(saved.error ?? "รีเซ็ตไม่สำเร็จ");
                      else toast.success("รีเซ็ต PIN เป็น 555555 แล้ว");
                    }}>รีเซ็ต PIN เป็น 555555</button> : null}
                    <button type="button" className="text-xs text-red-700" onClick={async () => {
                      const resignedDate = window.prompt("วันลาออก (YYYY-MM-DD)") ?? "";
                      const reason = window.prompt("สาเหตุการลาออก") ?? "";
                      if (!resignedDate || !reason) return;
                      const saved = await resignFnbEmployeeAction(row.id, resignedDate, reason);
                      if (!saved.success) toast.error(saved.error ?? "บันทึกไม่สำเร็จ");
                      else {
                        toast.success("ระงับสิทธิ์ทันทีแล้ว");
                        router.refresh();
                      }
                    }}>แจ้งลาออกและระงับสิทธิ์ทันที</button>
                    <button type="button" className="text-xs" onClick={async () => {
                      const opened = await openPrivateDocAction(row.id, "idcard");
                      if (!opened.url) toast.error(opened.error ?? "ไม่มีไฟล์");
                      else window.open(opened.url, "_blank", "noopener");
                    }}>ดูบัตรประชาชน</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PayrollTab({ payload }: { payload: FnbPeoplePayload }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [brand, setBrand] = useState<"LUCKY_CUP" | "CHATORN">(payload.brands[0] ?? "LUCKY_CUP");
  const [lines, setLines] = useState<FnbPayrollDraftLine[]>([]);
  const [status, setStatus] = useState("DRAFT_HR");
  const [periodId, setPeriodId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const locked = status === "APPROVED_LOCKED" || status === "PAID";

  async function load() {
    const result = await loadFnbPayrollAction(year, month, brand);
    if (!result.data) {
      toast.error(result.error ?? "โหลดงวดไม่สำเร็จ");
      return;
    }
    setLines(result.data.lines);
    setStatus(result.data.status);
    setPeriodId(result.data.periodId);
    setLoaded(true);
  }

  const totals = useMemo(() => lines.reduce((sum, line) => sum + payrollAmounts(line).net, 0), [lines]);

  return (
    <div className="space-y-3 rounded-2xl border bg-white p-4">
      <div className="flex flex-wrap gap-2">
        <input type="number" className="w-24 rounded-lg border px-2 py-1" value={year} onChange={(event) => setYear(Number(event.target.value))} />
        <input type="number" min={1} max={12} className="w-20 rounded-lg border px-2 py-1" value={month} onChange={(event) => setMonth(Number(event.target.value))} />
        <select className="rounded-lg border px-2 py-1" value={brand} onChange={(event) => setBrand(event.target.value === "CHATORN" ? "CHATORN" : "LUCKY_CUP")}>
          {payload.brands.map((item) => <option key={item} value={item}>{item === "LUCKY_CUP" ? "Lucky Cup — บจก. จัสมิน พลัส จำกัด" : "ชาทรตะโหมด"}</option>)}
        </select>
        <button type="button" className="rounded-lg border px-3 py-1 text-sm" onClick={() => void load()}>โหลดงวด</button>
      </div>
      {loaded ? (
        <>
          <p className="text-sm text-slate-500">สถานะ {status} · ยอดโอนสุทธิรวม {totals.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr>{["พนักงาน", "ชั่วโมง/วัน", "OT", "คอมมิชชัน", "เบี้ยขยัน", "ค่าตำแหน่ง", "หักอื่น", "Gross", "ประกันสังคม", "โอนสุทธิ"].map((label) => <th key={label} className="px-2 py-1">{label}</th>)}</tr></thead>
              <tbody>
                {lines.map((line, index) => {
                  const amounts = payrollAmounts(line);
                  return (
                    <tr key={line.employeeId} className="border-t">
                      <td className="px-2 py-1">{line.name}</td>
                      {(["hoursOrDays", "otPay", "salesCommission", "diligenceBonus", "positionAllowance", "otherDeduction"] as const).map((key) => (
                        <td key={key} className="px-1 py-1"><input disabled={locked} className="w-20 rounded border px-1" type="number" value={line[key]} onChange={(event) => {
                          const next = [...lines];
                          next[index] = { ...line, [key]: Number(event.target.value) };
                          setLines(next);
                        }} /></td>
                      ))}
                      <td className="px-2">{amounts.gross.toFixed(2)}</td>
                      <td className="px-2">{amounts.ssoEmployee.toFixed(2)}</td>
                      <td className="px-2">{amounts.net.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2">
            {!locked ? <button type="button" className="rounded-lg bg-red-700 px-3 py-2 text-sm font-semibold text-white" onClick={async () => {
              const saved = await submitFnbPayrollAction({ year, month, brandCode: brand, lines });
              if (!saved.success) toast.error(saved.error ?? "ส่งร่างไม่สำเร็จ");
              else {
                toast.success("บันทึกและส่งร่างเงินเดือนให้ผู้บริหารอนุมัติแล้ว");
                await load();
              }
            }}>บันทึกและส่งร่างเงินเดือนให้ผู้บริหารอนุมัติ</button> : null}
            {payload.canApprovePayroll && periodId && status === "SUBMITTED_FOR_APPROVAL" ? <button type="button" className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white" onClick={async () => {
              const saved = await approveFnbPayrollAction(periodId);
              if (!saved.success) toast.error(saved.error ?? "อนุมัติไม่สำเร็จ");
              else {
                toast.success("อนุมัติและล็อกงวดเงินเดือนแล้ว");
                await load();
              }
            }}>อนุมัติและล็อกงวดเงินเดือน</button> : null}
            <button type="button" className="rounded-lg border px-3 py-2 text-sm" onClick={async () => {
              const XLSX = await import("xlsx");
              const sheet = XLSX.utils.json_to_sheet(lines.map((line) => {
                const amounts = payrollAmounts(line);
                return { พนักงาน: line.name, ประเภท: line.employmentType, ฐาน: line.baseRate, ชั่วโมงหรือวัน: line.hoursOrDays, OT: line.otPay, คอมมิชชัน: line.salesCommission, เบี้ยขยัน: line.diligenceBonus, ค่าตำแหน่ง: line.positionAllowance, หักอื่น: line.otherDeduction, Gross: amounts.gross, ประกันสังคม: amounts.ssoEmployee, โอนสุทธิ: amounts.net };
              }));
              const book = XLSX.utils.book_new();
              XLSX.utils.book_append_sheet(book, sheet, "payroll");
              XLSX.writeFile(book, `payroll-${brand}-${year}-${month}.xlsx`);
            }}>ส่งออก Excel</button>
          </div>
        </>
      ) : null}
    </div>
  );
}
