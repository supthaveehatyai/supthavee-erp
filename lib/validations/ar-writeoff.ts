import { z } from "zod";

export const WRITEOFF_AMOUNT_RANGE_MESSAGE =
  "ยอดตัดหนี้ต้องมากกว่า 0 และไม่เกินยอดคงเหลือของบิล";

/** เหตุผลการตัดหนี้สูญ — บังคับกรอกทั้งฝั่งฟอร์มและ Server Action */
export const arWriteoffRemarkSchema = z
  .string()
  .trim()
  .min(1, "กรุณาระบุเหตุผลการตัดหนี้สูญ");

export const arWriteoffAllocatedItemSchema = z.object({
  document_id: z.string().uuid("รหัสบิลขายไม่ถูกต้อง"),
  writeoff_amount: z.coerce
    .number()
    .positive("ยอดตัดหนี้สูญต้องมากกว่า 0"),
});

export const createArWriteoffSchema = z.object({
  contact_id: z.string().uuid("ต้องระบุลูกค้า"),
  remark: arWriteoffRemarkSchema,
  allocated_items: z
    .array(arWriteoffAllocatedItemSchema)
    .min(1, "กรุณาเลือกบิลอย่างน้อย 1 รายการ"),
});

/** Client line guard — empty (0) lines are skipped; positive lines cannot exceed remaining. */
export const arWriteoffFormLineSchema = z
  .object({
    document_id: z.string().uuid("รหัสบิลขายไม่ถูกต้อง"),
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

export const arWriteoffFormSchema = z.object({
  contact_id: z.string().uuid("ต้องระบุลูกค้า"),
  remark: arWriteoffRemarkSchema,
  lines: z
    .array(arWriteoffFormLineSchema)
    .superRefine((lines, ctx) => {
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

export type ArWriteoffAllocatedItemInput = z.infer<
  typeof arWriteoffAllocatedItemSchema
>;
export type CreateArWriteoffInput = z.infer<typeof createArWriteoffSchema>;
export type ArWriteoffFormValues = z.infer<typeof arWriteoffFormSchema>;
