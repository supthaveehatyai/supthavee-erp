import { NextRequest } from "next/server";
import { getCurrentAuthUser } from "@/lib/auth/current-user";
import { canAccessReportCenter } from "@/lib/auth/module-access";
import { buildCashReceiptCsv } from "@/lib/finance/cash-receipt-csv";
import { loadCashReceiptPack } from "@/lib/finance/cash-receipt-data";
import { buildCashReceiptWorkbook } from "@/lib/finance/cash-receipt-excel";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getCurrentAuthUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!canAccessReportCenter(user.accessibleModules, user.roleCode)) {
    return new Response("Unauthorized", { status: 403 });
  }

  const from = request.nextUrl.searchParams.get("from") ?? "";
  const to = request.nextUrl.searchParams.get("to") ?? "";
  const format = request.nextUrl.searchParams.get("format") === "csv" ? "csv" : "xlsx";
  const seller = request.nextUrl.searchParams.get("seller") === "cash" ? "cash" : "name";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return Response.json({ error: "ช่วงวันที่ไม่ถูกต้อง" }, { status: 400 });
  }

  const pack = await loadCashReceiptPack(createSupabaseServerClient(), from, to);
  if (pack.error) return Response.json({ error: pack.error }, { status: 500 });

  if (format === "csv") {
    const csv = buildCashReceiptCsv(pack.bills, seller);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="cash-receipts-${from}_${to}.csv"`,
      },
    });
  }

  const buffer = await buildCashReceiptWorkbook(pack.bills, seller);
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer as ArrayBuffer);
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="cash-receipts-${from}_${to}.xlsx"`,
    },
  });
}
