import { z } from "zod";

const ALLOWED_CONTACT_ROLES = ["Customer", "Vendor", "Technician"] as const;

/**
 * Multi-role array — replaces legacy contact_type entirely.
 * Accept string[] first (UI / DB), then keep only known roles.
 */
export const contactRolesSchema = z
  .array(z.string())
  .min(1, "กรุณาเลือกอย่างน้อย 1 สถานะ")
  .transform((roles) => {
    const unique = [
      ...new Set(
        roles
          .map((role) => role.trim())
          .filter((role): role is (typeof ALLOWED_CONTACT_ROLES)[number] =>
            (ALLOWED_CONTACT_ROLES as readonly string[]).includes(role),
          ),
      ),
    ];
    return unique;
  })
  .refine((roles) => roles.length >= 1, {
    message: "กรุณาเลือกอย่างน้อย 1 สถานะ",
  });

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
  | { ok: true; contact_roles: string[] }
  | { ok: false; error: string } {
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
