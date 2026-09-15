/**
 * Report Center Excel export
 * GET /api/finance/export-tax?year=&month=&reportType=OUTPUT_TAX|INPUT_TAX|INV_DO|EXP|PAY
 * Service Role data load — Zero Client-Side Fetching.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentAuthUser } from "@/lib/auth/current-user";
import { canAccessPath } from "@/lib/auth/module-access";
import {
  isDocumentRegisterReportType,
  isFinanceReportType,
  isVatLedgerReportType,
} from "@/lib/constants/document";
import { loadDocumentRegisterReport } from "@/lib/tax/document-register-data";
import {
  buildDocumentRegisterWorkbook,
  financeReportFilename,
} from "@/lib/tax/document-register-excel";
import {
  loadVatLedgerReport,
  parseVatLedgerPeriod,
} from "@/lib/tax/vat-ledger-data";
import { buildVatLedgerWorkbook } from "@/lib/tax/vat-ledger-excel";
import { formatExportTimestamp } from "@/lib/utils/date-formatter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentAuthUser();
    if (!user) {
      return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
    }
    if (
      !canAccessPath(
        "/finance/tax-reports",
        user.accessibleModules,
        user.roleCode,
      )
    ) {
      return NextResponse.json(
        { error: "ไม่มีสิทธิ์ดาวน์โหลดรายงาน" },
        { status: 403 },
      );
    }

    const { searchParams } = request.nextUrl;
    const period = parseVatLedgerPeriod(
      searchParams.get("year"),
      searchParams.get("month"),
    );
    const reportTypeRaw = (searchParams.get("reportType") ?? "").toUpperCase();

    if (!period) {
      return NextResponse.json(
        { error: "year/month ไม่ถูกต้อง (month ต้องเป็น 1–12)" },
        { status: 400 },
      );
    }
    if (!isFinanceReportType(reportTypeRaw)) {
      return NextResponse.json(
        {
          error:
            "reportType ต้องเป็น OUTPUT_TAX, INPUT_TAX, INV_DO, EXP หรือ PAY",
        },
        { status: 400 },
      );
    }

    const timestamp = formatExportTimestamp();
    const filename = financeReportFilename(reportTypeRaw, timestamp);
    let buffer: ExcelJSBuffer;

    if (isVatLedgerReportType(reportTypeRaw)) {
      const report = await loadVatLedgerReport({
        year: period.year,
        month: period.month,
        reportType: reportTypeRaw,
      });
      buffer = await buildVatLedgerWorkbook(report);
    } else if (isDocumentRegisterReportType(reportTypeRaw)) {
      const report = await loadDocumentRegisterReport({
        year: period.year,
        month: period.month,
        reportType: reportTypeRaw,
      });
      buffer = await buildDocumentRegisterWorkbook(report);
    } else {
      return NextResponse.json(
        { error: "ประเภทรายงานไม่รองรับ" },
        { status: 400 },
      );
    }

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
    const message =
      err instanceof Error ? err.message : "ส่งออกรายงานไม่สำเร็จ";
    console.error("[REPORT_CENTER_EXPORT]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

type ExcelJSBuffer = ArrayBuffer | Uint8Array | Buffer;
