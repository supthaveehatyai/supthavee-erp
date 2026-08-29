/**
 * Phase 8.5 — WHT Excel Export (ภ.ง.ด.3 / ภ.ง.ด.53)
 * GET /api/tax/export-wht?year=&month=&formType=PND3|PND53
 * Service Role only — Zero Client-Side Fetching.
 */

import ExcelJS from "exceljs";
import { NextRequest, NextResponse } from "next/server";
import { loadMonthlyWhtReportRows } from "@/lib/tax/monthly-wht-report-data";
import {
  formatWhtPaymentDate,
  mapWhtReportRowsForExport,
} from "@/lib/tax/wht-export";
import type { TaxEntityType } from "@/types/tax";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FormType = "PND3" | "PND53";

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
    const entityType: TaxEntityType =
      formType === "PND3" ? "INDIVIDUAL" : "CORPORATE";

    const sourceRows = await loadMonthlyWhtReportRows(period.year, period.month);
    const rows = mapWhtReportRowsForExport(sourceRows, entityType);

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
      { header: "ชื่อผู้จำหน่าย / ช่าง", key: "companyName", width: 32 },
      { header: "ที่อยู่", key: "address", width: 40 },
      { header: "วันที่จ่ายเงิน", key: "expenseDate", width: 14 },
      { header: "เลขที่เอกสาร", key: "documentNo", width: 16 },
      { header: "ประเภท", key: "source", width: 8 },
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
        taxId: row.tax_id,
        branchCode: row.tax_branch_code,
        companyName: row.company_name,
        address: row.tax_address,
        expenseDate: formatWhtPaymentDate(row.payment_date),
        documentNo: row.document_no,
        source: row.source,
        whtBase: row.wht_base_amount,
        whtRate: row.wht_rate,
        whtAmount: row.wht_amount,
      });
    });

    for (let r = 2; r <= rows.length + 1; r += 1) {
      worksheet.getCell(`B${r}`).numFmt = "@";
      worksheet.getCell(`C${r}`).numFmt = "@";
      worksheet.getCell(`I${r}`).numFmt = "#,##0.00";
      worksheet.getCell(`J${r}`).numFmt = "0.00";
      worksheet.getCell(`K${r}`).numFmt = "#,##0.00";
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
