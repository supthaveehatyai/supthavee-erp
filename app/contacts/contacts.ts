/**
 * Contacts / Vendors domain types (Supabase `contacts` table).
 * Multi-Role: `contact_roles` (VARCHAR[]) — Customer / Vendor / Technician.
 */

export type ContactType = "Customer" | "Vendor" | "Technician";
export type CustomerType = "นิติบุคคล" | "บุคคลธรรมดา";
export type PriceTier = "Retail" | "Wholesale";

export const CONTACT_ROLE_OPTIONS: ReadonlyArray<{
  value: ContactType;
  label: string;
}> = [
  { value: "Customer", label: "ลูกค้า" },
  { value: "Vendor", label: "ผู้จำหน่าย" },
  { value: "Technician", label: "ช่างรับเหมา" },
] as const;

export function contactRoleLabel(role: ContactType | string): string {
  if (role === "Vendor") return "ผู้จำหน่าย";
  if (role === "Technician") return "ช่างรับเหมา";
  return "ลูกค้า";
}

export function contactRoleBadgeClass(role: ContactType | string): string {
  if (role === "Vendor") return "bg-amber-50 text-amber-700 ring-1 ring-amber-100";
  if (role === "Technician")
    return "bg-violet-50 text-violet-700 ring-1 ring-violet-100";
  return "bg-blue-50 text-blue-700 ring-1 ring-blue-100";
}

/** Stable primary for legacy `contact_type` NOT NULL column. */
export function primaryContactType(roles: ContactType[]): ContactType {
  if (roles.includes("Customer")) return "Customer";
  if (roles.includes("Vendor")) return "Vendor";
  if (roles.includes("Technician")) return "Technician";
  return "Customer";
}

export function parseContactType(value: unknown): ContactType | null {
  if (value === "Customer" || value === "Vendor" || value === "Technician") {
    return value;
  }
  return null;
}

/** Normalize DB array / legacy single type into a unique ContactType[]. */
export function normalizeContactRoles(
  rolesRaw: unknown,
  fallbackType?: unknown,
): ContactType[] {
  const fromArray = Array.isArray(rolesRaw)
    ? rolesRaw
        .map((item) => parseContactType(item))
        .filter((item): item is ContactType => item != null)
    : [];

  if (fromArray.length > 0) {
    return [...new Set(fromArray)];
  }

  const fallback = parseContactType(fallbackType);
  return fallback ? [fallback] : ["Customer"];
}

export function contactHasRole(
  contact: { contact_roles?: ContactType[] | null; contact_type?: ContactType | string | null },
  role: ContactType,
): boolean {
  const roles = normalizeContactRoles(contact.contact_roles, contact.contact_type);
  return roles.includes(role);
}

/**
 * AI OCR pattern memorization payload stored in `contacts.ocr_pattern_config` (JSONB).
 * Admins edit this as JSON — used by Smart Goods Receipt / Gemini Vision.
 */
export type OcrPatternConfig = Record<string, any>;

export type Contact = {
  id: string;
  created_at: string;
  /** @deprecated Prefer `contact_roles` — kept as primary role for legacy paths. */
  contact_type: ContactType;
  /** Multi-role tags (Customer / Vendor / Technician). */
  contact_roles: ContactType[];
  customer_type: string | null;
  company_name: string;
  tax_id: string | null;
  branch_code: string | null;
  address: string | null;
  phone: string | null;
  default_price_tier: PriceTier | null;
  credit_days: number | null;
  /** Prompt / table-layout hints for Vision AI per vendor */
  ocr_pattern_config: OcrPatternConfig;
  is_active: boolean;
};

export type ContactPersonInput = {
  clientId: string;
  name: string;
  phone: string;
  departmentOrRole: string;
};

export type ContactFormValues = {
  /** Multi-select roles — at least one required. */
  contactRoles: ContactType[];
  customerType: CustomerType;
  companyName: string;
  taxId: string;
  branchCode: string;
  address: string;
  phone: string;
  /**
   * Raw JSON string bound to the OCR editor.
   * Parsed to `ocr_pattern_config` only after validation on submit.
   */
  ocrPatternConfigJson: string;
  persons: ContactPersonInput[];
};

/** @deprecated Use ContactFormValues.contactRoles */
export type ContactFormValuesLegacy = ContactFormValues & {
  contactType?: ContactType;
};

/** Default empty OCR config shown in the editor */
export const DEFAULT_OCR_PATTERN_CONFIG: OcrPatternConfig = {};

export const DEFAULT_OCR_PATTERN_JSON = "{\n  \n}\n";

/** Example template admins can paste / start from */
export const OCR_PATTERN_CONFIG_EXAMPLE: OcrPatternConfig = {
  version: 1,
  prompt_hints:
    "Extract line items as raw_vendor_sku, qty, unit_price, discount_text",
  /**
   * Tells Gemini WHERE/HOW this vendor prints their document/invoice
   * number on the receipt header, so `process-receipt-ocr` doesn't have
   * to guess blindly — read by `extractInvoiceNoHint` in the Edge Function.
   */
  invoice_no_hint:
    "เลขที่เอกสารอยู่มุมขวาบนของบิล ขึ้นต้นด้วยตัวอักษร แล้วตามด้วยตัวเลข เช่น IV-24011234",
  /**
   * Tells Gemini WHERE/HOW this vendor prints their document/invoice DATE
   * on the receipt header (e.g. Thai Buddhist Era vs. Gregorian, position
   * relative to the doc number) — read by `extractInvoiceDateHint` in the
   * Edge Function. Gemini always converts พ.ศ. → ค.ศ. and returns ISO
   * `YYYY-MM-DD` regardless of how the hint describes the source format.
   */
  invoice_date_hint:
    "วันที่เอกสารอยู่ถัดจากเลขที่เอกสาร รูปแบบ วว/ดด/ปปปป เป็นปี พ.ศ. เช่น 15/03/2567",
  table_region: {
    header_keywords: ["รหัส", "จำนวน", "ราคา", "ส่วนลด"],
  },
  field_map: {
    sku: "raw_vendor_sku",
    quantity: "qty",
    price: "unit_price",
    discount: "discount_text",
  },
};

export const contactSelect = [
  "id",
  "created_at",
  "contact_type",
  "contact_roles",
  "customer_type",
  "company_name",
  "tax_id",
  "branch_code",
  "address",
  "phone",
  "default_price_tier",
  "credit_days",
  "ocr_pattern_config",
  "is_active",
].join(", ");

/**
 * Validate a JSON string for `ocr_pattern_config`.
 * Must be a JSON object (not array / primitive). Empty → `{}`.
 */
export function parseOcrPatternConfigJson(
  raw: string,
):
  | { ok: true; value: OcrPatternConfig }
  | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: true, value: { ...DEFAULT_OCR_PATTERN_CONFIG } };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof SyntaxError
          ? `JSON ไม่ถูกต้อง: ${error.message}`
          : "JSON ไม่ถูกต้อง — ตรวจสอบวงเล็บและเครื่องหมายคำพูด",
    };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      error: "ocr_pattern_config ต้องเป็น JSON object เช่น { \"prompt_hints\": \"...\" }",
    };
  }

  return { ok: true, value: parsed as OcrPatternConfig };
}

export function formatOcrPatternConfig(
  config: OcrPatternConfig | null | undefined,
): string {
  const value =
    config && typeof config === "object" && !Array.isArray(config)
      ? config
      : DEFAULT_OCR_PATTERN_CONFIG;
  try {
    return `${JSON.stringify(value, null, 2)}\n`;
  } catch {
    return DEFAULT_OCR_PATTERN_JSON;
  }
}

export function normalizeContactRow(row: unknown): Contact {
  const raw = (row ?? {}) as Record<string, unknown>;
  const config = raw.ocr_pattern_config;
  const contactRoles = normalizeContactRoles(raw.contact_roles, raw.contact_type);
  const contactType = primaryContactType(contactRoles);

  return {
    id: String(raw.id ?? ""),
    created_at: String(raw.created_at ?? ""),
    contact_type: contactType,
    contact_roles: contactRoles,
    customer_type: (raw.customer_type as string | null) ?? null,
    company_name: String(raw.company_name ?? ""),
    tax_id: (raw.tax_id as string | null) ?? null,
    branch_code: (raw.branch_code as string | null) ?? null,
    address: (raw.address as string | null) ?? null,
    phone: (raw.phone as string | null) ?? null,
    default_price_tier:
      raw.default_price_tier === "Wholesale" ||
      raw.default_price_tier === "Retail"
        ? raw.default_price_tier
        : null,
    credit_days:
      typeof raw.credit_days === "number" ? raw.credit_days : null,
    ocr_pattern_config:
      config && typeof config === "object" && !Array.isArray(config)
        ? (config as OcrPatternConfig)
        : {},
    is_active: raw.is_active !== false,
  };
}
