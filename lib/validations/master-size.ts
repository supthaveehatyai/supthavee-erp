import { z } from "zod";

/** รหัสไซส์สูงสุด 2 ตัวอักษร (A–Z / 0–9) เช่น S, XL, 10 */
export const SIZE_CODE_MAX_LENGTH = 2;

export const SIZE_CODE_REGEX = /^[A-Z0-9]{1,2}$/;

export const SIZE_CODE_ERROR_MESSAGE =
  "รหัสไซส์ต้องเป็น A–Z / 0–9 ความยาวไม่เกิน 2 ตัวอักษร (เช่น S, XL, 10)";

export const sizeMasterSchema = z.object({
  size_code: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase().replace(/[^A-Z0-9]/g, ""))
    .pipe(
      z
        .string()
        .min(1, "กรุณาระบุรหัสไซส์")
        .max(SIZE_CODE_MAX_LENGTH, SIZE_CODE_ERROR_MESSAGE)
        .regex(SIZE_CODE_REGEX, SIZE_CODE_ERROR_MESSAGE),
    ),
  size_label: z
    .string()
    .trim()
    .min(1, "กรุณาระบุชื่อป้ายไซส์")
    .max(20, "ชื่อป้ายไซส์ยาวไม่เกิน 20 ตัวอักษร"),
  sort_order: z.coerce
    .number({ error: "ลำดับต้องเป็นตัวเลข" })
    .int("ลำดับต้องเป็นจำนวนเต็ม")
    .min(0, "ลำดับต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป"),
});

export const updateSizeMasterSchema = sizeMasterSchema.extend({
  id: z.string().uuid("ไม่พบรหัสไซส์"),
});

export const toggleSizeStatusSchema = z.object({
  id: z.string().uuid("ไม่พบรหัสไซส์"),
});

export type SizeMasterInput = z.input<typeof sizeMasterSchema>;
export type SizeMasterParsed = z.output<typeof sizeMasterSchema>;

/**
 * Fixed-2 สำหรับ SKU — รหัส 1 ตัวถูก zero-pad (`S` → `0S`)
 */
export function normalizeSizeCode(raw: string): string {
  const code = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length === 1) return code.padStart(SIZE_CODE_MAX_LENGTH, "0");
  return code.slice(0, SIZE_CODE_MAX_LENGTH);
}
