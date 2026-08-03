/**
 * Phase 8.5 — WHT Excel Export (ภ.ง.ด.3 / ภ.ง.ด.53)
 * GET /api/tax/export-wht?year=&month=&formType=PND3|PND53
 * Service Role only — Zero Client-Side Fetching.
 */

import ExcelJS from "exceljs";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FormType = "PND3" | "PND53";

type ContactEmbed = {
  id: string;
  company_name: string;
  tax_id: string | null;
  tax_branch_code: string | null;
  entity_type: string | null;
  tax_address: string | null;
  address: string | null;
};

function parsePeriod(
  yearRaw: string | null,
  monthRaw: string | null,
): { year: number; month: number } | null {
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
}

function monthBounds(year: number, month: number): {
  startDate: string;
  endDate: string;
} {
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { startDate, endDate };
}

function toMoney(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizeTaxId(value: string | null | undefined): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.slice(0, 13);
}

function normalizeBranchCode(value: string | null | undefined): string {
  const digits = String(value ?? "00000").replace(/\D/g, "") || "00000";
  return digits.slice(0, 5).padStart(5, "0");
}

function formatExpenseDate(value: string): string {
  if (!value) return "";
  const d = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value.slice(0, 10);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const period = parsePeriod(
      searchParams.get("year"),
      searchParams.get("month"),
    );
    const formTypeRaw = (searchParams.get("formType") ?? "").toUpperCase();

    if (!period) {
      return NextResponse.json(
        { error: "year/month ไม่ถูกต้อง (month ต้องเป็น 1–12)" },
        { status: 400 },
      );
    }

    if (formTypeRaw !== "PND3" && formTypeRaw !== "PND53") {
      return NextResponse.json(
        { error: "formType ต้องเป็น PND3 หรือ PND53" },
        { status: 400 },
      );
    }

    const formType = formTypeRaw as FormType;
    const entityType =
      formType === "PND3" ? "INDIVIDUAL" : "CORPORATE";
    const { startDate, endDate } = monthBounds(period.year, period.month);

    const supabase = createClient();

    const { data, error } = await supabase
      .from("expenses")
      .select(
        `
        id,
        document_no,
        expense_date,
        wht_base_amount,
        wht_rate,
        wht_amount,
        status,
        contacts!expenses_vendor_id_fkey!inner (
          id,
          company_name,
          tax_id,
          tax_branch_code,
          entity_type,
          tax_address,
          address
        )
      `,
      )
      .eq("status", "ISSUED")
      .gt("wht_amount", 0)
      .gte("expense_date", startDate)
      .lte("expense_date", endDate)
      .eq("contacts.entity_type", entityType)
      .order("expense_date", { ascending: true })
      .order("document_no", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data ?? []).map((row) => {
      const contactRaw = row.contacts as unknown;
      const contact =
        contactRaw &&
        typeof contactRaw === "object" &&
        !Array.isArray(contactRaw)
          ? (contactRaw as ContactEmbed)
          : null;

      const taxAddress =
        contact?.tax_address?.trim() ||
        contact?.address?.trim() ||
        "";

      return {
        taxId: normalizeTaxId(contact?.tax_id),
        branchCode: normalizeBranchCode(contact?.tax_branch_code),
        companyName: contact?.company_name?.trim() || "",
        address: taxAddress,
        expenseDate: formatExpenseDate(String(row.expense_date ?? "")),
        whtBase: toMoney(row.wht_base_amount),
        whtRate: toMoney(row.wht_rate),
        whtAmount: toMoney(row.wht_amount),
      };
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Supthavee ERP";
    workbook.created = new Date();

    const sheetName =
      formType === "PND3" ? "ภ.ง.ด.3" : "ภ.ง.ด.53";
    const worksheet = workbook.addWorksheet(sheetName, {
      views: [{ state: "frozen", ySplit: 1 }],
    });

    worksheet.columns = [
      { header: "ลำดับ", key: "seq", width: 8 },
      { header: "เลขผู้เสียภาษี (13 หลัก)", key: "taxId", width: 18 },
      { header: "รหัสสาขา (5 หลัก)", key: "branchCode", width: 14 },
      { header: "ชื่อผู้จำหน่าย", key: "companyName", width: 32 },
      { header: "ที่อยู่", key: "address", width: 40 },
      { header: "วันที่จ่ายเงิน", key: "expenseDate", width: 14 },
      { header: "ฐานภาษี", key: "whtBase", width: 14 },
      { header: "อัตราภาษี (%)", key: "whtRate", width: 12 },
      { header: "ยอดภาษีหัก ณ ที่จ่าย", key: "whtAmount", width: 18 },
    ];

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.alignment = { vertical: "middle", horizontal: "center" };

    rows.forEach((row, index) => {
      worksheet.addRow({
        seq: index + 1,
        taxId: row.taxId,
        branchCode: row.branchCode,
        companyName: row.companyName,
        address: row.address,
        expenseDate: row.expenseDate,
        whtBase: row.whtBase,
        whtRate: row.whtRate,
        whtAmount: row.whtAmount,
      });
    });

    // Keep tax id / branch as text (leading zeros)
    for (let r = 2; r <= rows.length + 1; r += 1) {
      worksheet.getCell(`B${r}`).numFmt = "@";
      worksheet.getCell(`C${r}`).numFmt = "@";
      worksheet.getCell(`G${r}`).numFmt = "#,##0.00";
      worksheet.getCell(`H${r}`).numFmt = "0.00";
      worksheet.getCell(`I${r}`).numFmt = "#,##0.00";
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const monthPad = String(period.month).padStart(2, "0");
    const filename = `WHT_${formType}_${monthPad}_${period.year}.xlsx`;

    return new NextResponse(Buffer.from(buffer), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("WHT Excel export failed:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
