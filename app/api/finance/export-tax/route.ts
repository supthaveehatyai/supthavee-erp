/**
 * Phase 19 — VAT Ledger Excel export
 * GET /api/finance/export-tax?year=&month=&reportType=OUTPUT_TAX|INPUT_TAX
 * Service Role data load — Zero Client-Side Fetching.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentAuthUser } from "@/lib/auth/current-user";
import { canAccessPath } from "@/lib/auth/module-access";
import { isVatLedgerReportType } from "@/lib/constants/document";
import {
  loadVatLedgerReport,
  parseVatLedgerPeriod,
} from "@/lib/tax/vat-ledger-data";
import {
  buildVatLedgerWorkbook,
  vatLedgerFilename,
} from "@/lib/tax/vat-ledger-excel";

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
        { error: "ไม่มีสิทธิ์ดาวน์โหลดรายงานภาษี" },
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
    if (!isVatLedgerReportType(reportTypeRaw)) {
      return NextResponse.json(
        { error: "reportType ต้องเป็น OUTPUT_TAX หรือ INPUT_TAX" },
        { status: 400 },
      );
    }

    const report = await loadVatLedgerReport({
      year: period.year,
      month: period.month,
      reportType: reportTypeRaw,
    });
    const buffer = await buildVatLedgerWorkbook(report);
    const filename = vatLedgerFilename(report);

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
      err instanceof Error ? err.message : "ส่งออกรายงานภาษีไม่สำเร็จ";
    console.error("[VAT_LEDGER_EXPORT]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
