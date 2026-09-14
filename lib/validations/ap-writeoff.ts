import { z } from "zod";

export const WRITEOFF_AMOUNT_RANGE_MESSAGE =
  "ยอดตัดหนี้ต้องมากกว่า 0 และไม่เกินยอดคงเหลือของบิล";

/** เหตุผลการตัดหนี้สูญ — บังคับกรอกทั้งฝั่งฟอร์มและ Server Action */
export const apWriteoffRemarkSchema = z
  .string()
  .trim()
  .min(1, "กรุณาระบุเหตุผลการตัดหนี้สูญ");

export const apWriteoffAllocatedItemSchema = z.object({
  document_id: z.string().uuid("รหัสบิลซื้อไม่ถูกต้อง"),
  writeoff_amount: z.coerce
    .number()
    .positive("ยอดตัดหนี้สูญต้องมากกว่า 0"),
});

export const createApWriteoffSchema = z.object({
  contact_id: z.string().uuid("ต้องระบุผู้จำหน่าย"),
  remark: apWriteoffRemarkSchema,
  allocated_items: z
    .array(apWriteoffAllocatedItemSchema)
    .min(1, "กรุณาเลือกบิลอย่างน้อย 1 รายการ"),
});

/** Client line guard — empty (0) lines are skipped; positive lines cannot exceed remaining. */
export const apWriteoffFormLineSchema = z
  .object({
    document_id: z.string().uuid("รหัสบิลซื้อไม่ถูกต้อง"),
    remaining_balance: z.coerce.number().nonnegative(),
    writeoff_amount: z.coerce.number(),
  })
  .superRefine((value, ctx) => {
    const amount = Number(value.writeoff_amount);
    const remaining = Number(value.remaining_balance);
    if (!Number.isFinite(amount) || amount <= 0) return;
    if (!Number.isFinite(remaining) || amount > remaining + 0.02) {
      ctx.addIssue({
        code: "custom",
        path: ["writeoff_amount"],
        message: WRITEOFF_AMOUNT_RANGE_MESSAGE,
      });
    }
  });

export const apWriteoffFormSchema = z.object({
  contact_id: z.string().uuid("ต้องระบุผู้จำหน่าย"),
  remark: apWriteoffRemarkSchema,
  lines: z.array(apWriteoffFormLineSchema).superRefine((lines, ctx) => {
    const positive = lines.filter((line) => Number(line.writeoff_amount) > 0);
    if (positive.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["lines"],
        message: "กรุณาระบุยอดตัดหนี้อย่างน้อย 1 บิล",
      });
    }
  }),
});

export type ApWriteoffAllocatedItemInput = z.infer<
  typeof apWriteoffAllocatedItemSchema
>;
export type CreateApWriteoffInput = z.infer<typeof createApWriteoffSchema>;
export type ApWriteoffFormValues = z.infer<typeof apWriteoffFormSchema>;
