import { NextResponse } from "next/server";
import { getPaymentReceiptRegisterAction } from "@/app/actions/finance/payment-register";
import { buildPaymentRegisterWorkbook } from "@/lib/finance/payment-register-excel";
import type { PaymentRegisterDirection } from "@/types/payment-register";

export const dynamic = "force-dynamic";

function asDirection(value: string | null): PaymentRegisterDirection {
  if (value === "AP" || value === "AR") return value;
  return "ALL";
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const fromDate = url.searchParams.get("from")?.trim() ?? "";
    const toDate = url.searchParams.get("to")?.trim() ?? "";
    const data = await getPaymentReceiptRegisterAction({
      direction: asDirection(url.searchParams.get("direction")),
      fromDate,
      toDate,
      channelId: url.searchParams.get("channel"),
    });
    if (data.error) {
      return NextResponse.json({ error: data.error }, { status: 400 });
    }
    const buffer = await buildPaymentRegisterWorkbook(
      data,
      `${fromDate} ถึง ${toDate}`,
    );
    const body = new Uint8Array(buffer);
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="payment-register-${fromDate}_${toDate}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "ส่งออกสมุดทะเบียนไม่สำเร็จ";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
