import { z } from "zod";
import {
  COLOR_CODE_LENGTH,
  MODEL_CODE_LENGTH,
  SIZE_CODE_LENGTH,
} from "@/app/products/product-sku";

export { COLOR_CODE_LENGTH, SIZE_CODE_LENGTH };

/** Fixed-3 Character Color Standard (Blueprint v3.6) */
export const COLOR_CODE_REGEX = /^[A-Z]{3}$/;

export const COLOR_CODE_ERROR_MESSAGE =
  "รหัสสีต้องเป็นตัวอักษรภาษาอังกฤษ 3 ตัวเท่านั้น (เช่น BLK, RED)";

/** Fixed-2 Character Size Code — matches DB Check Constraint on `mst_sizes.size_code`. */
export const SIZE_CODE_REGEX = /^[A-Z0-9]{2}$/;

export const SIZE_CODE_ERROR_MESSAGE =
  "รหัสไซส์ต้องมีความยาว 2 ตัวอักษรพอดี (เช่น XL, 0S, 28)";

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

/**
 * Master size row — `size_code` locked to exactly 2 uppercase A–Z / 0–9 chars.
 */
export const sizeSchema = z.object({
  id: z.uuid().optional(),
  brand_id: z.uuid().nullable().optional(),
  size_label: z.string().trim().min(1, "กรุณาระบุชื่อป้ายไซส์"),
  size_code: z
    .string()
    .regex(SIZE_CODE_REGEX, SIZE_CODE_ERROR_MESSAGE),
  sort_order: z
    .number({ error: "ลำดับต้องเป็นตัวเลข" })
    .int("ลำดับต้องเป็นจำนวนเต็ม")
    .nonnegative("ลำดับต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป"),
  is_active: z.boolean().optional().default(true),
});

export type SizeSchemaInput = z.input<typeof sizeSchema>;
export type SizeSchemaOutput = z.output<typeof sizeSchema>;

const taxTypeSchema = z.enum(["INC_VAT", "EXC_VAT", "NON_VAT"]);

/** Empty string / undefined → null so Postgres UUID columns never receive "". */
const optionalUuid = z.preprocess(
  (value) => {
    if (value == null) return null;
    if (typeof value === "string" && value.trim() === "") return null;
    return value;
  },
  z.uuid().nullable().optional(),
);

/**
 * Product model identity (Phase 1 Base Model).
 * `vendor_id` / `brand_id` required for Buy goods;
 * `vendor_id` optional when `is_service` or `is_manufactured` (Make).
 */
export const productModelSchema = z
  .object({
    vendor_id: optionalUuid,
    brand_id: optionalUuid,
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
    /** Public URL จาก Storage product_assets (Visual Verification) */
    image_url: z.string().nullable().optional(),
    is_service: z.boolean().default(false),
    is_raw_material: z.boolean().default(false),
    /** Make vs Buy — true = ผลิตเอง (vendor ไม่บังคับ) */
    is_manufactured: z.boolean().default(false),
    base_uom_id: z.uuid({
      error: "ต้องเลือกหน่วยนับ (base_uom_id) เป็น UUID ที่ถูกต้อง",
    }),
    /** หน่วยซื้อ bulk — optional; ใช้เมื่อ is_raw_material / is_manufactured */
    purchasing_uom_id: optionalUuid,
    /** 1 purchasing UoM = N base UoM (ทศนิยมสูงสุด 4 ตำแหน่ง, default 1) */
    uom_conversion_factor: z.preprocess(
      (value) => {
        if (value == null || value === "") return 1;
        const n = Number(value);
        return Number.isFinite(n) ? n : value;
      },
      z
        .number({ error: "อัตราแปลงหน่วยต้องเป็นตัวเลข" })
        .positive("อัตราแปลงหน่วยต้องมากกว่า 0")
        .max(1_000_000, "อัตราแปลงหน่วยสูงเกินไป")
        .transform((n) => Math.round(n * 10000) / 10000)
        .default(1),
    ),
  })
  .superRefine((data, ctx) => {
    if (data.is_service) return;
    if (!data.is_manufactured && !data.vendor_id) {
      ctx.addIssue({
        code: "custom",
        path: ["vendor_id"],
        message: VENDOR_ID_REQUIRED_MESSAGE,
      });
    }
    if (!data.brand_id) {
      ctx.addIssue({
        code: "custom",
        path: ["brand_id"],
        message: "ต้องระบุแบรนด์ (brand_id) เป็น UUID ที่ถูกต้อง",
      });
    }
  })
  .transform((data) => {
    const needsPurchaseUom =
      data.is_raw_material === true || data.is_manufactured === true;
    const purchasing_uom_id = needsPurchaseUom
      ? (data.purchasing_uom_id ?? null)
      : null;
    const uom_conversion_factor = needsPurchaseUom
      ? data.uom_conversion_factor
      : 1;

    if (data.is_service) {
      return {
        ...data,
        vendor_id: null,
        brand_id: null,
        purchasing_uom_id: null,
        uom_conversion_factor: 1,
      };
    }
    if (data.is_manufactured) {
      return {
        ...data,
        vendor_id: null,
        brand_id: data.brand_id ?? null,
        purchasing_uom_id,
        uom_conversion_factor,
      };
    }
    return {
      ...data,
      vendor_id: data.vendor_id ?? null,
      brand_id: data.brand_id ?? null,
      purchasing_uom_id,
      uom_conversion_factor,
    };
  });

export type ProductModelSchemaInput = z.input<typeof productModelSchema>;
export type ProductModelSchemaOutput = z.output<typeof productModelSchema>;

/** Per-size prices for `updateProductModel` bulk SKU update */
export const updateProductModelSizePriceSchema = z.object({
  sizeCode: z.string().trim().min(1, "ต้องระบุ sizeCode"),
  sizeLabel: z.string().trim().nullable().optional(),
  costPrice: z.number().finite().nonnegative("ราคาต้นทุนต้องไม่ติดลบ"),
  retailPrice: z.number().finite().nonnegative("ราคาปลีกต้องไม่ติดลบ"),
  wholesalePrice: z.number().finite().nonnegative("ราคาส่งต้องไม่ติดลบ"),
});

/**
 * Payload สำหรับแก้ไขทั้งรุ่น (Product Model + bulk SKU prices).
 * `image_url` เป็น Public URL จาก Storage product_assets
 */
export const updateProductModelSchema = z
  .object({
    modelId: z.uuid({ error: "ต้องระบุ model_id เป็น UUID ที่ถูกต้อง" }),
    vendorId: optionalUuid,
    name: z.string().trim().min(1, "กรุณาระบุชื่อรุ่นสินค้า"),
    shortName: z.string().trim().max(100).optional(),
    gender: z.string().trim().min(1, "กรุณาเลือกเพศ"),
    taxType: taxTypeSchema,
    image_url: z.string().nullable().optional(),
    isService: z.boolean().default(false),
    isRawMaterial: z.boolean().default(false),
    isManufactured: z.boolean().default(false),
    baseUomId: z.uuid({
      error: "ต้องเลือกหน่วยนับ (base_uom_id) เป็น UUID ที่ถูกต้อง",
    }),
    purchasingUomId: optionalUuid,
    uomConversionFactor: z.preprocess(
      (value) => {
        if (value == null || value === "") return 1;
        const n = Number(value);
        return Number.isFinite(n) ? n : value;
      },
      z
        .number({ error: "อัตราแปลงหน่วยต้องเป็นตัวเลข" })
        .positive("อัตราแปลงหน่วยต้องมากกว่า 0")
        .max(1_000_000, "อัตราแปลงหน่วยสูงเกินไป")
        .transform((n) => Math.round(n * 10000) / 10000)
        .default(1),
    ),
    sizePrices: z
      .array(updateProductModelSizePriceSchema)
      .min(1, "ต้องระบุราคาตามไซส์อย่างน้อย 1 รายการ"),
  })
  .superRefine((data, ctx) => {
    if (data.isService || data.isManufactured) return;
    if (!data.vendorId) {
      ctx.addIssue({
        code: "custom",
        path: ["vendorId"],
        message: VENDOR_ID_REQUIRED_MESSAGE,
      });
    }
  })
  .transform((data) => ({
    ...data,
    vendorId:
      data.isService || data.isManufactured ? null : (data.vendorId ?? null),
  }));

export type UpdateProductModelSchemaInput = z.input<
  typeof updateProductModelSchema
>;
export type UpdateProductModelSchemaOutput = z.output<
  typeof updateProductModelSchema
>;

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
  imageUrl?: string | null;
  isService?: boolean;
  isRawMaterial?: boolean;
  isManufactured?: boolean;
  baseUomId?: string | null;
  purchasingUomId?: string | null;
  uomConversionFactor?: number | null;
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
    image_url: input.imageUrl ?? null,
    is_service: Boolean(input.isService),
    is_raw_material: Boolean(input.isRawMaterial),
    is_manufactured: Boolean(input.isManufactured),
    base_uom_id: input.baseUomId,
    purchasing_uom_id: input.purchasingUomId,
    uom_conversion_factor: input.uomConversionFactor ?? 1,
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

/**
 * Validate a new / edited size_code against Fixed-2 Check Constraint.
 */
export function parseSizeCode(
  sizeCode: string,
): { ok: true; size_code: string } | { ok: false; error: string } {
  const result = sizeSchema.shape.size_code.safeParse(sizeCode);
  if (!result.success) {
    return {
      ok: false,
      error: zodFirstError(result.error, SIZE_CODE_ERROR_MESSAGE),
    };
  }
  return { ok: true, size_code: result.data };
}

/**
 * Validate create/edit size form payload before calling Server Action.
 */
export function parseSizeForm(input: {
  size_label: string;
  size_code: string;
  sort_order: number;
  brand_id?: string | null;
  id?: string;
}):
  | { ok: true; data: SizeSchemaOutput }
  | { ok: false; error: string } {
  const result = sizeSchema.safeParse(input);
  if (!result.success) {
    return { ok: false, error: zodFirstError(result.error) };
  }
  return { ok: true, data: result.data };
}
