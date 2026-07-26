import { z } from "zod";
import { MODEL_CODE_LENGTH } from "@/app/products/product-sku";

/** Fixed-3 Character Color Standard (Blueprint v3.6) */
export const COLOR_CODE_LENGTH = 3;
export const COLOR_CODE_REGEX = /^[A-Z]{3}$/;

export const COLOR_CODE_ERROR_MESSAGE =
  "รหัสสีต้องเป็นตัวอักษรภาษาอังกฤษ 3 ตัวเท่านั้น (เช่น BLK, RED)";

export const VENDOR_ID_REQUIRED_MESSAGE =
  "ต้องระบุผู้จำหน่าย (vendor_id) เป็น UUID ที่ถูกต้อง — ห้ามเว้นว่าง";

/** Strict required UUID for product_models.vendor_id */
export const vendorIdSchema = z.uuid({ error: VENDOR_ID_REQUIRED_MESSAGE });

/**
 * Master color row — `color_code` locked to exactly 3 uppercase A–Z letters.
 */
export const colorSchema = z.object({
  id: z.uuid().optional(),
  color_code: z
    .string()
    .regex(COLOR_CODE_REGEX, COLOR_CODE_ERROR_MESSAGE),
  color_name: z
    .string()
    .trim()
    .min(1, "กรุณาระบุชื่อสี"),
  is_active: z.boolean().optional().default(true),
});

export type ColorSchemaInput = z.input<typeof colorSchema>;
export type ColorSchemaOutput = z.output<typeof colorSchema>;

const taxTypeSchema = z.enum(["INC_VAT", "EXC_VAT", "NON_VAT"]);

/**
 * Product model identity (Phase 1 Base Model).
 * `vendor_id` is a strictly required UUID — never optional / nullable.
 */
export const productModelSchema = z.object({
  vendor_id: vendorIdSchema,
  brand_id: z.uuid({ error: "ต้องระบุแบรนด์ (brand_id) เป็น UUID ที่ถูกต้อง" }),
  category_id: z.uuid({
    error: "ต้องระบุหมวดหมู่ (category_id) เป็น UUID ที่ถูกต้อง",
  }),
  model_code: z
    .string()
    .trim()
    .toUpperCase()
    .length(
      MODEL_CODE_LENGTH,
      `รหัสรุ่น (model_code) ต้องมีความยาว ${MODEL_CODE_LENGTH} ตัวอักษรพอดี`,
    ),
  name: z.string().trim().min(1, "กรุณาระบุชื่อรุ่นสินค้า"),
  short_name: z.string().trim().max(100).optional(),
  gender: z.string().trim().min(1, "กรุณาเลือกเพศ"),
  tax_type: taxTypeSchema.default("INC_VAT"),
});

export type ProductModelSchemaInput = z.input<typeof productModelSchema>;
export type ProductModelSchemaOutput = z.output<typeof productModelSchema>;

/** First Zod issue message, or a fallback. */
export function zodFirstError(
  error: z.ZodError,
  fallback = "ข้อมูลไม่ถูกต้อง",
): string {
  return error.issues[0]?.message ?? fallback;
}

/**
 * Validate Phase-1 model identity (camelCase form → snake_case schema).
 */
export function parseProductModelIdentity(input: {
  vendorId: string;
  brandId: string;
  categoryId: string;
  modelCode: string;
  name: string;
  shortName?: string;
  gender: string;
  taxType: "INC_VAT" | "EXC_VAT" | "NON_VAT";
}):
  | { ok: true; data: ProductModelSchemaOutput }
  | { ok: false; error: string } {
  const result = productModelSchema.safeParse({
    vendor_id: input.vendorId,
    brand_id: input.brandId,
    category_id: input.categoryId,
    model_code: input.modelCode,
    name: input.name,
    short_name: input.shortName,
    gender: input.gender,
    tax_type: input.taxType,
  });

  if (!result.success) {
    return { ok: false, error: zodFirstError(result.error) };
  }
  return { ok: true, data: result.data };
}

/**
 * Validate a new / edited color_code against Fixed-3 rule.
 */
export function parseColorCode(
  colorCode: string,
): { ok: true; color_code: string } | { ok: false; error: string } {
  const result = colorSchema.shape.color_code.safeParse(colorCode);
  if (!result.success) {
    return { ok: false, error: zodFirstError(result.error, COLOR_CODE_ERROR_MESSAGE) };
  }
  return { ok: true, color_code: result.data };
}
