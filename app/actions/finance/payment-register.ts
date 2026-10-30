"use server";

import { requireSessionUserId } from "@/lib/auth/current-user";
import { queryPaymentReceiptRegister } from "@/lib/finance/payment-register-data";
import { createClient } from "@/lib/supabase/server-admin";
import type { PaymentRegisterData, PaymentRegisterQuery } from "@/types/payment-register";

function emptyResult(error: string): PaymentRegisterData {
  return { rows: [], banks: [], channels: [], error };
}

export async function getPaymentReceiptRegisterAction(
  input: PaymentRegisterQuery,
): Promise<PaymentRegisterData> {
  const owner = await requireSessionUserId();
  if (!owner.ok) return emptyResult(owner.error);
  const fromDate = input.fromDate?.trim().slice(0, 10) ?? "";
  const toDate = input.toDate?.trim().slice(0, 10) ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    return emptyResult("ช่วงวันที่ต้องเป็น YYYY-MM-DD");
  }
  if (fromDate > toDate) return emptyResult("วันเริ่มต้นต้องไม่เกินวันสิ้นสุด");
  const direction = input.direction === "AP" || input.direction === "AR" ? input.direction : "ALL";
  try {
    return await queryPaymentReceiptRegister(createClient(), {
      direction,
      fromDate,
      toDate,
      channelId: input.channelId?.trim() || null,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "โหลดสมุดทะเบียนรับ-จ่ายไม่สำเร็จ";
    return emptyResult(message);
  }
}
