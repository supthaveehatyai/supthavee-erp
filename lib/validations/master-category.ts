import { z } from "zod";

export const PARENT_CATEGORY_CODE_LENGTH = 1;
export const CHILD_CATEGORY_CODE_LENGTH = 2;

export const PARENT_CODE_ERROR_MESSAGE =
  "รหัสหมวดหมู่หลักต้องยาว 1 ตัวอักษร (A–Z)";

export const CHILD_CODE_ERROR_MESSAGE =
  "รหัสหมวดหมู่ย่อยต้องยาว 2 ตัวอักษร (A–Z) โดยอักษรตัวแรกสืบทอดจากหมวดหมู่หลัก";

export function normalizeCategoryCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z]/g, "");
}

const categoryBaseSchema = z.object({
  category_code: z
    .string()
    .trim()
    .transform(normalizeCategoryCode)
    .pipe(
      z
        .string()
        .min(1, "กรุณาระบุรหัสหมวดหมู่")
        .max(CHILD_CATEGORY_CODE_LENGTH, "รหัสหมวดหมู่ยาวไม่เกิน 2 ตัวอักษร"),
    ),
  category_name: z
    .string()
    .trim()
    .min(1, "กรุณาระบุชื่อหมวดหมู่")
    .max(100, "ชื่อหมวดหมู่ยาวไม่เกิน 100 ตัวอักษร"),
  kind: z.enum(["parent", "child"]),
  parent_id: z.preprocess(
    (value) => (value === "" || value === undefined ? null : value),
    z.string().uuid("กรุณาเลือกหมวดหมู่หลัก").nullable(),
  ),
});

function refineCategoryHierarchy(
  value: z.output<typeof categoryBaseSchema>,
  ctx: z.RefinementCtx,
) {
  if (value.kind === "parent") {
    if (
      value.category_code.length !== PARENT_CATEGORY_CODE_LENGTH ||
      !/^[A-Z]$/.test(value.category_code)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["category_code"],
        message: PARENT_CODE_ERROR_MESSAGE,
      });
    }
    return;
  }

  if (
    value.category_code.length !== CHILD_CATEGORY_CODE_LENGTH ||
    !/^[A-Z]{2}$/.test(value.category_code)
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["category_code"],
      message: CHILD_CODE_ERROR_MESSAGE,
    });
  }

  if (!value.parent_id) {
    ctx.addIssue({
      code: "custom",
      path: ["parent_id"],
      message: "กรุณาเลือกหมวดหมู่หลัก",
    });
  }
}

export const categoryMasterSchema = categoryBaseSchema.superRefine(
  refineCategoryHierarchy,
);

export const updateCategoryMasterSchema = categoryBaseSchema
  .extend({
    id: z.string().uuid("ไม่พบรหัสหมวดหมู่"),
  })
  .superRefine(refineCategoryHierarchy);

export const toggleCategoryStatusSchema = z.object({
  id: z.string().uuid("ไม่พบรหัสหมวดหมู่"),
});

export type CategoryMasterInput = z.input<typeof categoryMasterSchema>;
export type CategoryMasterParsed = z.output<typeof categoryMasterSchema>;
