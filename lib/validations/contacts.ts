import { z } from "zod";

const ALLOWED_CONTACT_ROLES = ["Customer", "Vendor", "Technician"] as const;

/**
 * Coerce any payload shape into string[]:
 * null / undefined, Postgres `{Customer,Vendor}`, single string,
 * or a numeric-key object (Server Action serialization).
 */
export function coerceContactRolesInput(raw: unknown): string[] {
  if (raw == null) return [];

  if (Array.isArray(raw)) {
    return raw
      .map((item) => String(item ?? "").trim())
      .filter((item) => item.length > 0);
  }

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      return trimmed
        .slice(1, -1)
        .split(",")
        .map((part) => part.trim().replace(/^"+|"+$/g, ""))
        .filter((part) => part.length > 0);
    }
    return [trimmed];
  }

  if (typeof raw === "object") {
    return Object.values(raw as Record<string, unknown>)
      .map((item) => String(item ?? "").trim())
      .filter((item) => item.length > 0);
  }

  return [];
}

function emptyToNull(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value == null) return null;
  const text = String(value).trim();
  if (!text || text === "-" || text === "–" || text === "—") return null;
  return text;
}

/**
 * Multi-role array — replaces legacy contact_type entirely.
 * Always an array of strings; at least one role required.
 */
export const contactRolesSchema = z.preprocess(
  coerceContactRolesInput,
  z
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
    }),
);

const optionalText = z.preprocess(
  emptyToNull,
  z.string().trim().nullable().optional(),
);

/** Create / update contact identity payload (no contact_type). */
export const contactMutationSchema = z.object({
  companyName: z
    .string()
    .trim()
    .min(1, "กรุณากรอกชื่อบริษัทหรือชื่อคู่ค้า"),
  contact_roles: contactRolesSchema,
  customerType: z.string().trim().optional(),
  taxId: optionalText,
  branchCode: optionalText,
  phone: optionalText,
  address: optionalText,
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
  return { ok: true, contact_roles: result.data as string[] };
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
  const rolesRaw = input.contactRoles ?? input.contact_roles;
  const result = contactMutationSchema.safeParse({
    companyName: input.companyName,
    contact_roles: rolesRaw,
    customerType: input.customerType,
    taxId: input.taxId ?? null,
    branchCode: input.branchCode ?? null,
    phone: input.phone ?? null,
    address: input.address ?? null,
  });

  if (!result.success) {
    console.error("[parseContactMutation] Zod failed", {
      issues: result.error.issues,
      contact_roles: rolesRaw,
      companyName: input.companyName,
    });
    return {
      ok: false,
      error: result.error.issues[0]?.message ?? "ข้อมูลคู่ค้าไม่ถูกต้อง",
    };
  }
  return { ok: true, data: result.data };
}
