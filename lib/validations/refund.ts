import { z } from "zod";

export const REFUND_AMOUNT_RANGE_MESSAGE =
  "ยอดคืนเงินต้องมากกว่า 0 และไม่เกินยอดมัดจำคงเหลือ";

export const CASH_ACCOUNT_SENTINEL = "CASH";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const createRefundDocumentSchema = z.object({
  type: z.enum(["AR", "AP"]),
  contact_id: z.string().uuid("ต้องระบุคู่ค้า"),
  deposit_id: z.string().uuid("รหัสเอกสารมัดจำไม่ถูกต้อง"),
  amount: z.coerce.number().positive("ยอดคืนเงินต้องมากกว่า 0"),
  remark: z
    .string()
    .trim()
    .max(2000, "หมายเหตุยาวเกินไป")
    .optional()
    .nullable(),
  document_date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "รูปแบบวันที่ไม่ถูกต้อง (YYYY-MM-DD)")
    .optional()
    .nullable(),
  bank_account_id: z
    .string()
    .trim()
    .min(1, "กรุณาเลือกช่องทางรับ/จ่ายเงิน")
    .refine(
      (value) => value === CASH_ACCOUNT_SENTINEL || UUID_RE.test(value),
      "บัญชีธนาคารไม่ถูกต้อง",
    ),
});

export type CreateRefundDocumentInput = z.infer<
  typeof createRefundDocumentSchema
>;
