import { z } from "zod";

export const REFUND_AMOUNT_RANGE_MESSAGE =
  "ยอดคืนเงินต้องมากกว่า 0 และไม่เกินยอดมัดจำคงเหลือ";

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
});

export type CreateRefundDocumentInput = z.infer<
  typeof createRefundDocumentSchema
>;
