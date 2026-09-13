import { z } from "zod";

export const NET_CASH_NEGATIVE_MESSAGE = "ยอดรับชำระสุทธิห้ามติดลบ";

/**
 * Guardrail: Net Cash on REC must never go below 0
 * (e.g. selected CN greater than invoices).
 */
export const recNetCashGuardSchema = z
  .object({
    totalInvoices: z.number(),
    totalCnApplied: z.number(),
    depositApplied: z.number(),
    whtAmount: z.number(),
    netCash: z.number(),
  })
  .superRefine((value, ctx) => {
    if (value.netCash < 0) {
      ctx.addIssue({
        code: "custom",
        path: ["netCash"],
        message: NET_CASH_NEGATIVE_MESSAGE,
      });
    }
  });

export type RecNetCashGuardValues = z.infer<typeof recNetCashGuardSchema>;
