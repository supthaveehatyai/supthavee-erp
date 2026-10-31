"use server";

import { revalidatePath } from "next/cache";
import { requireSessionUserId } from "@/lib/auth/current-user";
import { buildPayrollWorkbook } from "@/lib/finance/payroll-excel";
import { createClient } from "@/lib/supabase/server-admin";
import type {
  EmployeeMasterPayload,
  PayrollActionResult,
  PayrollChannel,
  PayrollEmployee,
  PayrollItem,
  PayrollItemCalculationPayload,
  PayrollPeriodView,
  PayrollWorkbookSheetRow,
  SalaryPaymentPayload,
  SsoRemittancePayload,
} from "@/types/payroll";

type Row = Record<string, unknown>;
type DbError = { message: string } | null;
type DbResult<T> = { data: T; error: DbError };

interface Chain extends PromiseLike<DbResult<Row[]>> {
  select(columns: string): Chain;
  insert(values: Row): Chain;
  update(values: Row): Chain;
  eq(column: string, value: unknown): Chain;
  order(column: string, options?: { ascending?: boolean }): Chain;
  maybeSingle(): Promise<DbResult<Row | null>>;
  single(): Promise<DbResult<Row>>;
}

interface PayrollAdmin {
  from(table: string): Chain;
  rpc(fn: string, args: Row): Promise<DbResult<string | null>>;
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        body: Buffer,
        options: { contentType: string; upsert: boolean },
      ): Promise<DbResult<unknown>>;
      getPublicUrl(path: string): { data: { publicUrl: string } };
    };
  };
}

const SALARY_CATEGORY_NAME = "ค่าจ้างและเงินเดือน";
const EMPLOYEE_COLUMNS =
  "id, emp_code, full_name, citizen_id, position_title, payroll_channel, base_salary, is_sso_enrolled, bank_name, bank_account_no, bank_account_name, is_active, address, id_card_attachment_url, bank_book_attachment_url";
const SSO_WAGE_FLOOR = 1650;
const SSO_WAGE_CEILING = 15000;
const SSO_AMOUNT_CAP = 750;

function adminClient(): PayrollAdmin {
  return createClient() as unknown as PayrollAdmin;
}

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function text(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function asChannel(value: unknown): PayrollChannel {
  return value === "INTERNAL_PRIVATE" ? "INTERNAL_PRIVATE" : "CORPORATE_OFFICIAL";
}

function mapEmployee(row: Row | null | undefined): PayrollEmployee {
  return {
    id: text(row?.id),
    empCode: text(row?.emp_code),
    fullName: text(row?.full_name),
    citizenId: text(row?.citizen_id),
    positionTitle: text(row?.position_title),
    payrollChannel: asChannel(row?.payroll_channel),
    baseSalary: num(row?.base_salary),
    isSsoEnrolled: row?.is_sso_enrolled === true,
    bankName: text(row?.bank_name),
    bankAccountNo: text(row?.bank_account_no),
    bankAccountName: text(row?.bank_account_name),
    address: text(row?.address),
    idCardAttachmentUrl: text(row?.id_card_attachment_url),
    bankBookAttachmentUrl: text(row?.bank_book_attachment_url),
    isActive: row?.is_active !== false,
  };
}

function mapItem(row: Row): PayrollItem {
  const employee = mapEmployee(
    (row.mst_employees as Row | Row[] | null) &&
      !Array.isArray(row.mst_employees)
      ? (row.mst_employees as Row)
      : Array.isArray(row.mst_employees)
        ? (row.mst_employees[0] ?? null)
        : null,
  );
  return {
    id: text(row.id),
    payrollPeriodId: text(row.payroll_period_id),
    employeeId: text(row.employee_id),
    payrollChannel: asChannel(row.payroll_channel),
    baseSalary: num(row.base_salary),
    otAmount: num(row.ot_amount),
    allowanceAmount: num(row.allowance_amount),
    commissionAmount: num(row.commission_amount),
    bonusAmount: num(row.bonus_amount),
    grossIncome: num(row.gross_income),
    ssoEmployeeAmount: num(row.sso_employee_amount),
    ssoEmployerAmount: num(row.sso_employer_amount),
    whtTaxAmount: num(row.wht_tax_amount),
    otherDeduction: num(row.other_deduction),
    netPay: num(row.net_pay),
    paymentStatus: text(row.payment_status) || "PENDING",
    paymentDate: row.payment_date == null ? null : String(row.payment_date),
    paidFromAccount: text(row.paid_from_account),
    paymentSlipUrl: row.payment_slip_url == null ? null : String(row.payment_slip_url),
    paymentReferenceNo:
      row.payment_reference_no == null ? null : String(row.payment_reference_no),
    linkedExpenseId:
      row.linked_expense_id == null ? null : String(row.linked_expense_id),
    employee,
  };
}

function grossOf(input: {
  baseSalary: number;
  otAmount: number;
  allowanceAmount: number;
  commissionAmount: number;
  bonusAmount: number;
}): number {
  return num(
    input.baseSalary +
      input.otAmount +
      input.allowanceAmount +
      input.commissionAmount +
      input.bonusAmount,
  );
}

function ssoFromWage(baseSalary: number, ratePct: number, enrolled: boolean, channel: PayrollChannel): number {
  if (!enrolled || channel !== "CORPORATE_OFFICIAL") return 0;
  const wage = Math.min(Math.max(baseSalary, SSO_WAGE_FLOOR), SSO_WAGE_CEILING);
  return Math.min(SSO_AMOUNT_CAP, Math.round(wage * (ratePct / 100)));
}

async function fail(error: string): Promise<PayrollActionResult<never>> {
  return { ok: false, error };
}

async function loadPeriodBundle(
  admin: PayrollAdmin,
  periodId: string,
): Promise<PayrollPeriodView> {
  const periodResult = await admin
    .from("hr_payroll_periods")
    .select("*")
    .eq("id", periodId)
    .single();
  if (periodResult.error || !periodResult.data) {
    throw new Error(periodResult.error?.message ?? "ไม่พบงวดเงินเดือน");
  }
  const itemResult = await admin
    .from("hr_payroll_items")
    .select(`*, mst_employees(${EMPLOYEE_COLUMNS})`)
    .eq("payroll_period_id", periodId);
  if (itemResult.error) throw new Error(itemResult.error.message);
  const employeeResult = await admin
    .from("mst_employees")
    .select(EMPLOYEE_COLUMNS)
    .order("emp_code", { ascending: true });
  if (employeeResult.error) throw new Error(employeeResult.error.message);

  const items = (itemResult.data ?? [])
    .map(mapItem)
    .sort((a, b) => a.employee.empCode.localeCompare(b.employee.empCode, "en"));
  const period = periodResult.data;
  return {
    id: text(period.id),
    periodYear: Number(period.period_year),
    periodMonth: Number(period.period_month),
    periodLabel: text(period.period_label),
    ssoRatePct: num(period.sso_rate_pct),
    ssoWageCeiling: num(period.sso_wage_ceiling),
    officialGrossTotal: num(period.official_gross_total),
    officialNetTotal: num(period.official_net_total),
    internalGrossTotal: num(period.internal_gross_total),
    internalNetTotal: num(period.internal_net_total),
    ssoEmployeeTotal: num(period.sso_employee_total),
    ssoEmployerTotal: num(period.sso_employer_total),
    ssoTotalRemittance: num(period.sso_total_remittance),
    ssoPaymentStatus: text(period.sso_payment_status) || "PENDING",
    ssoPaymentDate: period.sso_payment_date == null ? null : String(period.sso_payment_date),
    ssoPaymentSlipUrl:
      period.sso_payment_slip_url == null ? null : String(period.sso_payment_slip_url),
    ssoReferenceNo: period.sso_reference_no == null ? null : String(period.sso_reference_no),
    status: text(period.status) || "OPEN",
    paidCount: items.filter((item) => item.paymentStatus === "PAID").length,
    headcount: items.length,
    items,
    employees: (employeeResult.data ?? []).map((row) => mapEmployee(row)),
  };
}

async function syncPeriod(year: number, month: number, ratePct: number | null) {
  const admin = adminClient();
  let rate = ratePct;
  if (rate == null) {
    const existing = await admin
      .from("hr_payroll_periods")
      .select("sso_rate_pct")
      .eq("period_year", year)
      .eq("period_month", month)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    rate = existing.data ? num(existing.data.sso_rate_pct) : 5;
  }
  const created = await admin.rpc("generate_or_sync_payroll_period", {
    p_year: year,
    p_month: month,
    p_sso_rate_pct: rate,
  });
  if (created.error || !created.data) {
    throw new Error(created.error?.message ?? "สร้างงวดเงินเดือนไม่สำเร็จ");
  }
  return { admin, periodId: created.data, rate };
}

async function applySsoRate(admin: PayrollAdmin, periodId: string, ratePct: number) {
  const itemResult = await admin
    .from("hr_payroll_items")
    .select(`*, mst_employees(${EMPLOYEE_COLUMNS})`)
    .eq("payroll_period_id", periodId);
  if (itemResult.error) throw new Error(itemResult.error.message);
  for (const row of itemResult.data ?? []) {
    const item = mapItem(row);
    if (item.paymentStatus === "PAID") continue;
    const sso = ssoFromWage(
      item.baseSalary,
      ratePct,
      item.employee.isSsoEnrolled,
      item.payrollChannel,
    );
    const netPay = num(item.grossIncome - sso - item.whtTaxAmount - item.otherDeduction);
    const updated = await admin
      .from("hr_payroll_items")
      .update({
        sso_employee_amount: sso,
        sso_employer_amount: item.payrollChannel === "CORPORATE_OFFICIAL" ? sso : 0,
        net_pay: netPay,
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id);
    if (updated.error) throw new Error(updated.error.message);
  }
  const totals = await admin.rpc("recalculate_payroll_period_totals", {
    p_period_id: periodId,
  });
  if (totals.error) throw new Error(totals.error.message);
}

function jpegBuffer(slipJpegBase64: string, label = "ไฟล์สลิป"): Buffer {
  const payload = slipJpegBase64.replace(/^data:image\/jpeg;base64,/i, "").trim();
  const buffer = Buffer.from(payload, "base64");
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error(`${label}ต้องเป็นรูป JPEG (.jpg) เท่านั้น`);
  }
  if (buffer.length > 8 * 1024 * 1024) {
    throw new Error("ไฟล์สลิปใหญ่เกิน 8 MB");
  }
  return buffer;
}

async function uploadSlip(admin: PayrollAdmin, folder: string, slipJpegBase64: string) {
  const buffer = jpegBuffer(slipJpegBase64);
  const path = `payroll-slips/${folder}/${crypto.randomUUID()}.jpg`;
  const uploaded = await admin.storage.from("document_attachments").upload(path, buffer, {
    contentType: "image/jpeg",
    upsert: false,
  });
  if (uploaded.error) throw new Error(uploaded.error.message);
  return admin.storage.from("document_attachments").getPublicUrl(path).data.publicUrl;
}

async function salaryCategoryId(admin: PayrollAdmin): Promise<string> {
  const found = await admin
    .from("mst_expense_categories")
    .select("id, category_name")
    .eq("category_name", SALARY_CATEGORY_NAME)
    .maybeSingle();
  if (found.error) throw new Error(found.error.message);
  const id = text(found.data?.id);
  if (!id) throw new Error(`ไม่พบหมวดค่าใช้จ่าย ${SALARY_CATEGORY_NAME}`);
  return id;
}

export async function getOrCreatePayrollPeriodAction(
  year: number,
  month: number,
): Promise<PayrollActionResult<PayrollPeriodView>> {
  const session = await requireSessionUserId();
  if (!session.ok) return fail(session.error);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return fail("เดือนหรือปีของงวดไม่ถูกต้อง");
  }
  try {
    const synced = await syncPeriod(year, month, null);
    return { ok: true, data: await loadPeriodBundle(synced.admin, synced.periodId) };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "โหลดงวดเงินเดือนไม่สำเร็จ");
  }
}

export async function uploadEmployeeIdCardAction(
  empCode: string,
  jpegBase64: string,
): Promise<PayrollActionResult<{ url: string }>> {
  const session = await requireSessionUserId();
  if (!session.ok) return fail(session.error);
  const safeCode = empCode.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "") || "EMP";
  try {
    const admin = adminClient();
    const buffer = jpegBuffer(jpegBase64, "สำเนาบัตรประชาชน");
    const path = `employee-id-cards/${safeCode}-${Date.now()}.jpg`;
    const uploaded = await admin.storage.from("document_attachments").upload(path, buffer, {
      contentType: "image/jpeg",
      upsert: false,
    });
    if (uploaded.error) return fail(uploaded.error.message);
    const url = admin.storage.from("document_attachments").getPublicUrl(path).data.publicUrl;
    return { ok: true, data: { url } };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "อัปโหลดสำเนาบัตรประชาชนไม่สำเร็จ");
  }
}

export async function updateEmployeeIdCardAction(
  employeeId: string,
  idCardUrl: string,
): Promise<PayrollActionResult<{ employeeId: string }>> {
  const session = await requireSessionUserId();
  if (!session.ok) return fail(session.error);
  const url = idCardUrl.trim();
  if (!employeeId || !url) return fail("ไม่พบไฟล์บัตรประชาชน");
  const admin = adminClient();
  const saved = await admin.rpc("update_employee_id_card_attachment", {
    p_employee_id: employeeId,
    p_id_card_url: url,
  });
  if (saved.error) return fail(saved.error.message);
  revalidatePath("/finance/payroll");
  return { ok: true, data: { employeeId } };
}

export async function setPayrollSsoRateAction(
  year: number,
  month: number,
  ratePct: number,
): Promise<PayrollActionResult<PayrollPeriodView>> {
  const session = await requireSessionUserId();
  if (!session.ok) return fail(session.error);
  if (ratePct !== 5 && ratePct !== 3) return fail("อัตราประกันสังคมต้องเป็น 5% หรือ 3%");
  try {
    const synced = await syncPeriod(year, month, ratePct);
    await applySsoRate(synced.admin, synced.periodId, ratePct);
    return { ok: true, data: await loadPeriodBundle(synced.admin, synced.periodId) };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "ปรับอัตราประกันสังคมไม่สำเร็จ");
  }
}

export async function updatePayrollItemCalculationAction(
  payload: PayrollItemCalculationPayload,
): Promise<PayrollActionResult<PayrollPeriodView>> {
  const session = await requireSessionUserId();
  if (!session.ok) return fail(session.error);
  const admin = adminClient();
  try {
    const current = await admin
      .from("hr_payroll_items")
      .select(`*, mst_employees(${EMPLOYEE_COLUMNS})`)
      .eq("id", payload.itemId)
      .single();
    if (current.error || !current.data) {
      return fail(current.error?.message ?? "ไม่พบรายการเงินเดือน");
    }
    const item = mapItem(current.data);
    if (item.paymentStatus === "PAID") {
      return fail("รายการนี้โอนเงินเดือนแล้ว แก้ยอดไม่ได้");
    }
    const grossIncome = grossOf(payload);
    const ssoEmployee =
      item.payrollChannel === "INTERNAL_PRIVATE" ? 0 : num(payload.ssoEmployeeAmount);
    const netPay = num(
      grossIncome - ssoEmployee - num(payload.whtTaxAmount) - num(payload.otherDeduction),
    );
    if (netPay < 0) return fail("เงินได้สุทธิติดลบ");
    const updated = await admin
      .from("hr_payroll_items")
      .update({
        base_salary: num(payload.baseSalary),
        ot_amount: num(payload.otAmount),
        allowance_amount: num(payload.allowanceAmount),
        commission_amount: num(payload.commissionAmount),
        bonus_amount: num(payload.bonusAmount),
        gross_income: grossIncome,
        sso_employee_amount: ssoEmployee,
        sso_employer_amount: item.payrollChannel === "CORPORATE_OFFICIAL" ? ssoEmployee : 0,
        wht_tax_amount: num(payload.whtTaxAmount),
        other_deduction: num(payload.otherDeduction),
        net_pay: netPay,
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id);
    if (updated.error) return fail(updated.error.message);
    const totals = await admin.rpc("recalculate_payroll_period_totals", {
      p_period_id: item.payrollPeriodId,
    });
    if (totals.error) return fail(totals.error.message);
    return { ok: true, data: await loadPeriodBundle(admin, item.payrollPeriodId) };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "บันทึกยอดเงินเดือนไม่สำเร็จ");
  }
}

export async function confirmEmployeeSalaryPaymentAction(
  payload: SalaryPaymentPayload,
): Promise<PayrollActionResult<PayrollPeriodView>> {
  const session = await requireSessionUserId();
  if (!session.ok) return fail(session.error);
  const admin = adminClient();
  try {
    const current = await admin
      .from("hr_payroll_items")
      .select(`*, mst_employees(${EMPLOYEE_COLUMNS}), hr_payroll_periods(period_label, period_year, period_month)`)
      .eq("id", payload.itemId)
      .single();
    if (current.error || !current.data) {
      return fail(current.error?.message ?? "ไม่พบรายการเงินเดือน");
    }
    const item = mapItem(current.data);
    if (!payload.paymentDate) return fail("กรุณาระบุวันที่โอน");
    const slipUrl = await uploadSlip(admin, item.employee.empCode || "employee", payload.slipJpegBase64);
    const categoryId = await salaryCategoryId(admin);
    const tier =
      item.payrollChannel === "CORPORATE_OFFICIAL" ? "CORP_VAT" : "INTERNAL_1_3";
    const periodJoin = current.data.hr_payroll_periods;
    const periodRow = Array.isArray(periodJoin) ? periodJoin[0] : periodJoin;
    const periodLabel = text((periodRow as Row | null)?.period_label);
    const remark = `SALARY_WAGES ${periodLabel} ${item.employee.empCode} ${item.employee.fullName}`;
    let expenseId = item.linkedExpenseId;
    if (expenseId) {
      const patched = await admin
        .from("expenses")
        .update({
          expense_date: payload.paymentDate,
          net_amount: item.grossIncome,
          vat_amount: 0,
          wht_amount: item.whtTaxAmount,
          net_payable: item.netPay,
          payment_slip_url: slipUrl,
          receipt_url: slipUrl,
          remark,
          status: "PAID",
          accounting_tax_tier: tier,
          updated_at: new Date().toISOString(),
        })
        .eq("id", expenseId);
      if (patched.error) return fail(patched.error.message);
    } else {
      const month = String(
        Number((periodRow as Row | null)?.period_month ?? 0),
      ).padStart(2, "0");
      const documentNo = `SAL${(periodRow as Row | null)?.period_year ?? ""}${month}-${item.employee.empCode}`;
      const inserted = await admin
        .from("expenses")
        .insert({
          document_no: documentNo,
          expense_date: payload.paymentDate,
          category_id: categoryId,
          net_amount: item.grossIncome,
          vat_amount: 0,
          wht_amount: item.whtTaxAmount,
          wht_rate: 0,
          net_payable: item.netPay,
          payment_method: "TRANSFER",
          payment_slip_url: slipUrl,
          receipt_url: slipUrl,
          status: "PAID",
          approval_status: "APPROVED",
          remark,
          recorded_by: session.userId,
          vendor_name: item.employee.fullName,
          vendor_tax_id: item.employee.citizenId || null,
          vendor_doc_no: payload.paymentReferenceNo || null,
          accounting_tax_tier: tier,
        })
        .select("id")
        .single();
      if (inserted.error || !inserted.data) {
        return fail(inserted.error?.message ?? "บันทึกค่าใช้จ่ายเงินเดือนไม่สำเร็จ");
      }
      expenseId = text(inserted.data.id);
    }
    const saved = await admin
      .from("hr_payroll_items")
      .update({
        payment_status: "PAID",
        payment_date: payload.paymentDate,
        paid_from_account: payload.paidFromAccount.trim() || item.paidFromAccount,
        payment_slip_url: slipUrl,
        payment_reference_no: payload.paymentReferenceNo.trim() || null,
        linked_expense_id: expenseId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id);
    if (saved.error) return fail(saved.error.message);
    const totals = await admin.rpc("recalculate_payroll_period_totals", {
      p_period_id: item.payrollPeriodId,
    });
    if (totals.error) return fail(totals.error.message);
    return { ok: true, data: await loadPeriodBundle(admin, item.payrollPeriodId) };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "บันทึกการโอนเงินเดือนไม่สำเร็จ");
  }
}

export async function confirmSsoRemittancePaymentAction(
  payload: SsoRemittancePayload,
): Promise<PayrollActionResult<PayrollPeriodView>> {
  const session = await requireSessionUserId();
  if (!session.ok) return fail(session.error);
  const admin = adminClient();
  try {
    if (!payload.paymentDate) return fail("กรุณาระบุวันที่นำส่งประกันสังคม");
    const slipUrl = await uploadSlip(admin, "sso", payload.slipJpegBase64);
    const saved = await admin
      .from("hr_payroll_periods")
      .update({
        sso_payment_status: "PAID",
        sso_payment_date: payload.paymentDate,
        sso_payment_slip_url: slipUrl,
        sso_reference_no: payload.referenceNo.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", payload.periodId);
    if (saved.error) return fail(saved.error.message);
    return { ok: true, data: await loadPeriodBundle(admin, payload.periodId) };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "บันทึกสลิปประกันสังคมไม่สำเร็จ");
  }
}

async function refreshUnpaidItemsForEmployee(admin: PayrollAdmin, employee: PayrollEmployee) {
  const openItems = await admin
    .from("hr_payroll_items")
    .select("*, hr_payroll_periods(sso_rate_pct)")
    .eq("employee_id", employee.id)
    .eq("payment_status", "PENDING");
  if (openItems.error) throw new Error(openItems.error.message);
  const periodIds = new Set<string>();
  for (const row of openItems.data ?? []) {
    const periodJoin = row.hr_payroll_periods;
    const period = (Array.isArray(periodJoin) ? periodJoin[0] : periodJoin) as Row | null;
    const rate = num(period?.sso_rate_pct) || 5;
    const sso = ssoFromWage(employee.baseSalary, rate, employee.isSsoEnrolled, employee.payrollChannel);
    const ot = num(row.ot_amount);
    const allowance = num(row.allowance_amount);
    const commission = num(row.commission_amount);
    const bonus = num(row.bonus_amount);
    const wht = num(row.wht_tax_amount);
    const other = num(row.other_deduction);
    const gross = grossOf({
      baseSalary: employee.baseSalary,
      otAmount: ot,
      allowanceAmount: allowance,
      commissionAmount: commission,
      bonusAmount: bonus,
    });
    const updated = await admin
      .from("hr_payroll_items")
      .update({
        payroll_channel: employee.payrollChannel,
        base_salary: employee.baseSalary,
        gross_income: gross,
        sso_employee_amount: sso,
        sso_employer_amount: employee.payrollChannel === "CORPORATE_OFFICIAL" ? sso : 0,
        net_pay: num(gross - sso - wht - other),
        paid_from_account:
          employee.payrollChannel === "CORPORATE_OFFICIAL"
            ? "กรุงไทย • 9020746510 (บัญชีบริษัท)"
            : "บัญชีส่วนตัวผู้บริหาร (Internal)",
        updated_at: new Date().toISOString(),
      })
      .eq("id", text(row.id));
    if (updated.error) throw new Error(updated.error.message);
    periodIds.add(text(row.payroll_period_id));
  }
  for (const periodId of periodIds) {
    if (!periodId) continue;
    const totals = await admin.rpc("recalculate_payroll_period_totals", {
      p_period_id: periodId,
    });
    if (totals.error) throw new Error(totals.error.message);
  }
}

export async function upsertEmployeeMasterAction(
  payload: EmployeeMasterPayload,
): Promise<PayrollActionResult<{ employeeId: string }>> {
  const session = await requireSessionUserId();
  if (!session.ok) return fail(session.error);
  const fullName = payload.fullName.trim();
  const empCode = payload.empCode.trim().toUpperCase();
  if (!fullName || !empCode) return fail("กรุณาระบุรหัสและชื่อพนักงาน");
  if (payload.baseSalary < 0) return fail("เงินเดือนฐานต้องไม่ติดลบ");
  const channel = asChannel(payload.payrollChannel);
  const enrolled = channel === "CORPORATE_OFFICIAL" && payload.isSsoEnrolled;
  const row = {
    emp_code: empCode,
    full_name: fullName,
    citizen_id: payload.citizenId.replace(/\D/g, "") || null,
    position_title: payload.positionTitle.trim() || "พนักงาน",
    payroll_channel: channel,
    base_salary: num(payload.baseSalary),
    is_sso_enrolled: enrolled,
    bank_name: payload.bankName.trim() || null,
    bank_account_no: payload.bankAccountNo.replace(/\s/g, "") || null,
    bank_account_name: payload.bankAccountName.trim() || fullName,
    address: payload.address.trim() || null,
    id_card_attachment_url: payload.idCardAttachmentUrl.trim() || null,
    bank_book_attachment_url: payload.bankBookAttachmentUrl.trim() || null,
    is_active: true,
    updated_at: new Date().toISOString(),
  };
  const admin = adminClient();
  try {
    let employeeId = payload.id;
    if (employeeId) {
      const updated = await admin.from("mst_employees").update(row).eq("id", employeeId);
      if (updated.error) return fail(updated.error.message);
    } else {
      const inserted = await admin
        .from("mst_employees")
        .insert(row)
        .select("id")
        .single();
      if (inserted.error || !inserted.data) {
        return fail(inserted.error?.message ?? "เพิ่มพนักงานไม่สำเร็จ");
      }
      employeeId = text(inserted.data.id);
    }
    await refreshUnpaidItemsForEmployee(admin, {
      id: employeeId,
      empCode,
      fullName,
      citizenId: payload.citizenId.replace(/\D/g, ""),
      positionTitle: row.position_title,
      payrollChannel: channel,
      baseSalary: num(payload.baseSalary),
      isSsoEnrolled: enrolled,
      bankName: payload.bankName.trim(),
      bankAccountNo: payload.bankAccountNo.replace(/\s/g, ""),
      bankAccountName: payload.bankAccountName.trim() || fullName,
      address: payload.address.trim(),
      idCardAttachmentUrl: payload.idCardAttachmentUrl.trim(),
      bankBookAttachmentUrl: payload.bankBookAttachmentUrl.trim(),
      isActive: true,
    });
    return { ok: true, data: { employeeId } };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "บันทึกข้อมูลพนักงานไม่สำเร็จ");
  }
}

function sheetRow(item: PayrollItem, monthCount = 1): PayrollWorkbookSheetRow {
  return {
    empCode: item.employee.empCode,
    fullName: item.employee.fullName,
    citizenId: item.employee.citizenId,
    baseSalary: item.baseSalary,
    otAmount: item.otAmount,
    allowanceAmount: item.allowanceAmount,
    extraIncome: num(item.commissionAmount + item.bonusAmount),
    grossIncome: item.grossIncome,
    ssoEmployeeAmount: item.ssoEmployeeAmount,
    ssoEmployerAmount: item.ssoEmployerAmount,
    whtTaxAmount: item.whtTaxAmount,
    netPay: item.netPay,
    slipUrl: item.paymentSlipUrl ?? "",
    idCardUrl: item.employee.idCardAttachmentUrl,
    isSsoEnrolled: item.employee.isSsoEnrolled,
    monthCount,
  };
}

export async function exportPayrollWorkbookAction(
  periodId: string,
): Promise<PayrollActionResult<{ filename: string; base64: string }>> {
  const session = await requireSessionUserId();
  if (!session.ok) return fail(session.error);
  const admin = adminClient();
  try {
    const bundle = await loadPeriodBundle(admin, periodId);
    const yearItems = await admin
      .from("hr_payroll_items")
      .select(`*, mst_employees(${EMPLOYEE_COLUMNS}), hr_payroll_periods!inner(period_year)`)
      .eq("payroll_channel", "CORPORATE_OFFICIAL");
    if (yearItems.error) return fail(yearItems.error.message);
    const yearly = new Map<string, PayrollWorkbookSheetRow>();
    for (const row of yearItems.data ?? []) {
      const periodJoin = row.hr_payroll_periods;
      const period = (Array.isArray(periodJoin) ? periodJoin[0] : periodJoin) as Row | null;
      if (Number(period?.period_year) !== bundle.periodYear) continue;
      const item = mapItem(row);
      const current = yearly.get(item.employeeId);
      if (!current) {
        yearly.set(item.employeeId, sheetRow(item, 1));
        continue;
      }
      current.baseSalary = num(current.baseSalary + item.baseSalary);
      current.otAmount = num(current.otAmount + item.otAmount);
      current.allowanceAmount = num(current.allowanceAmount + item.allowanceAmount);
      current.extraIncome = num(current.extraIncome + item.commissionAmount + item.bonusAmount);
      current.grossIncome = num(current.grossIncome + item.grossIncome);
      current.ssoEmployeeAmount = num(current.ssoEmployeeAmount + item.ssoEmployeeAmount);
      current.ssoEmployerAmount = num(current.ssoEmployerAmount + item.ssoEmployerAmount);
      current.whtTaxAmount = num(current.whtTaxAmount + item.whtTaxAmount);
      current.netPay = num(current.netPay + item.netPay);
      current.monthCount += 1;
    }
    const official = bundle.items
      .filter((item) => item.payrollChannel === "CORPORATE_OFFICIAL")
      .map((item) => sheetRow(item));
    const buffer = await buildPayrollWorkbook({
      periodLabel: bundle.periodLabel,
      buddhistYear: bundle.periodYear + 543,
      monthRows: official,
      yearRows: [...yearly.values()].sort((a, b) => a.empCode.localeCompare(b.empCode, "en")),
      ssoEmployeeTotal: bundle.ssoEmployeeTotal,
      ssoEmployerTotal: bundle.ssoEmployerTotal,
      ssoRemittance: bundle.ssoTotalRemittance,
    });
    const month = String(bundle.periodMonth).padStart(2, "0");
    const filename = `${bundle.periodYear + 543}-เงินเดือน_${bundle.periodYear}${month}.xlsx`;
    return {
      ok: true,
      data: {
        filename,
        base64: Buffer.from(buffer).toString("base64"),
      },
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "ส่งออก Excel ไม่สำเร็จ");
  }
}
