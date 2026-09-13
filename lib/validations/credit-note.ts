import { z } from "zod";

/** เหตุผลการลดหนี้ — บังคับกรอกทั้งฝั่งฟอร์มและ Server Action */
export const creditNoteRemarkSchema = z
  .string()
  .trim()
  .min(1, "กรุณาระบุเหตุผลการลดหนี้");

export const createCreditNoteFormSchema = z.object({
  remark: creditNoteRemarkSchema,
});

export type CreateCreditNoteFormValues = z.infer<
  typeof createCreditNoteFormSchema
>;
