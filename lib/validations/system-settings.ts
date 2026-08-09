import { z } from "zod";

/** Company profile form — Phase 10 SSOT fields editable from Settings UI. */
export const companySettingsSchema = z.object({
  company_name: z
    .string()
    .trim()
    .min(1, "กรุณาระบุชื่อบริษัท"),
  tax_id: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || /^\d{13}$/.test(value),
      "เลขผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก",
    ),
  branch_code: z
    .string()
    .trim()
    .min(1, "กรุณาระบุรหัสสาขา")
    .max(10, "รหัสสาขาต้องไม่เกิน 10 ตัวอักษร"),
  branch_name: z
    .string()
    .trim()
    .min(1, "กรุณาระบุชื่อสาขา"),
  address: z.string().trim(),
  phone: z.string().trim(),
  email: z
    .string()
    .trim()
    .refine(
      (value) =>
        value === "" ||
        z.string().email().safeParse(value).success,
      "รูปแบบอีเมลไม่ถูกต้อง",
    ),
  vat_rate: z.coerce
    .number({ error: "กรุณาระบุอัตรา VAT" })
    .min(0, "อัตรา VAT ต้องไม่ต่ำกว่า 0")
    .max(100, "อัตรา VAT ต้องไม่เกิน 100"),
  logo_url: z.string().optional(),
  allow_negative_inventory: z.boolean().optional().default(false),
});

export type CompanySettingsFormValues = z.infer<typeof companySettingsSchema>;
