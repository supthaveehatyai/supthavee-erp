import { z } from "zod";

/** Allowed Multi-Role values for contacts.contact_roles */
export const CONTACT_ROLE_ENUM = z.enum([
  "Customer",
  "Vendor",
  "Technician",
]);

/**
 * Multi-role array — replaces legacy contact_type.
 * At least one role required.
 */
export const contactRolesSchema = z
  .array(CONTACT_ROLE_ENUM)
  .min(1, "กรุณาเลือกอย่างน้อย 1 สถานะ");

/** Create / update contact identity payload (no contact_type). */
export const contactMutationSchema = z.object({
  companyName: z
    .string()
    .trim()
    .min(1, "กรุณากรอกชื่อบริษัทหรือชื่อคู่ค้า"),
  contact_roles: contactRolesSchema,
  customerType: z.string().trim().optional(),
  taxId: z.string().trim().nullable().optional(),
  branchCode: z.string().trim().nullable().optional(),
  phone: z.string().trim().nullable().optional(),
  address: z.string().trim().nullable().optional(),
});

export type ContactMutationInput = z.infer<typeof contactMutationSchema>;

export function parseContactRolesInput(
  rolesRaw: unknown,
):
  | { ok: true; contact_roles: z.infer<typeof contactRolesSchema> }
  | { ok: false; error: string } {
  // Accept camelCase from UI or snake_case from DB-shaped payloads
  const result = contactRolesSchema.safeParse(rolesRaw);
  if (!result.success) {
    return {
      ok: false,
      error: result.error.issues[0]?.message ?? "กรุณาเลือกอย่างน้อย 1 สถานะ",
    };
  }
  return { ok: true, contact_roles: result.data };
}

export function parseContactMutation(input: {
  companyName: unknown;
  contactRoles?: unknown;
  contact_roles?: unknown;
  customerType?: unknown;
  taxId?: unknown;
  branchCode?: unknown;
  phone?: unknown;
  address?: unknown;
}):
  | { ok: true; data: ContactMutationInput }
  | { ok: false; error: string } {
  const result = contactMutationSchema.safeParse({
    companyName: input.companyName,
    contact_roles: input.contactRoles ?? input.contact_roles,
    customerType: input.customerType,
    taxId: input.taxId ?? null,
    branchCode: input.branchCode ?? null,
    phone: input.phone ?? null,
    address: input.address ?? null,
  });

  if (!result.success) {
    return {
      ok: false,
      error: result.error.issues[0]?.message ?? "ข้อมูลคู่ค้าไม่ถูกต้อง",
    };
  }
  return { ok: true, data: result.data };
}
