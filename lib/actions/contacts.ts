"use server";

/**
 * Contacts / Contact Persons Server Actions.
 *
 * Zero Client-Side Fetching: Service Role via `createSupabaseServerClient` only
 * (bypasses RLS on `contacts` / `contact_persons`).
 */

import { revalidatePath } from "next/cache";
import {
  contactSelect,
  normalizeContactRoles,
  normalizeContactRow,
  type Contact,
  type ContactType,
  type CustomerType,
  type OcrPatternConfig,
  type PriceTier,
} from "@/app/contacts/contacts";
import { findDuplicateContactError } from "@/lib/contacts/duplicate-check";
import { createSupabaseServerClient } from "@/lib/supabase-server";

const CONTACTS_PATH = "/contacts";

export type ContactPersonPayload = {
  name: string;
  phone?: string | null;
  departmentOrRole?: string | null;
};

export type CreateContactInput = {
  /** Multi-role selection — at least one of Customer / Vendor / Technician. */
  contactRoles: ContactType[];
  customerType: CustomerType | string;
  companyName: string;
  taxId?: string | null;
  branchCode?: string | null;
  address?: string | null;
  phone?: string | null;
  ocrPatternConfig?: OcrPatternConfig;
  persons?: ContactPersonPayload[];
};

export type CreateContactResult = {
  data: Contact | null;
  error: string | null;
};

export type GetContactsResult = {
  data: Contact[];
  error: string | null;
};

export type ImportContactRow = {
  /** Preferred multi-role field. */
  contact_roles?: ContactType[] | string[];
  /**
   * CSV legacy column name kept for import templates only —
   * mapped into contact_roles; never written to DB as contact_type.
   */
  contact_type?: ContactType | string;
  customer_type: string;
  company_name: string;
  tax_id?: string | null;
  branch_code?: string | null;
  phone?: string | null;
  address?: string | null;
  default_price_tier?: PriceTier | string | null;
  credit_days?: number | null;
};

export type ImportContactsResult = {
  success: boolean;
  error: string | null;
  inserted?: number;
};

/** List all contacts — Service Role (bypass RLS). */
export async function getContacts(): Promise<GetContactsResult> {
  try {
    const supabaseAdmin = createSupabaseServerClient();
    const { data, error } = await supabaseAdmin
      .from("contacts")
      .select(contactSelect)
      .order("created_at", { ascending: false });

    if (error) {
      return { data: [], error: error.message };
    }

    return {
      data: (data ?? []).map((row) => normalizeContactRow(row)),
      error: null,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "โหลดรายการคู่ค้าไม่สำเร็จ";
    return { data: [], error: message };
  }
}

/**
 * Create a contact (+ optional contact_persons).
 * Rolls back the contact if persons insert fails.
 */
export async function createContact(
  input: CreateContactInput,
): Promise<CreateContactResult> {
  try {
    const companyName = input.companyName?.trim() ?? "";
    if (!companyName) {
      return { data: null, error: "กรุณากรอกชื่อบริษัทหรือชื่อคู่ค้า" };
    }

    const contactRoles = normalizeContactRoles(input.contactRoles);
    if (contactRoles.length === 0) {
      return { data: null, error: "กรุณาเลือกประเภทคู่ค้าอย่างน้อย 1 สถานะ" };
    }
    const persons = (input.persons ?? [])
      .map((person) => ({
        name: person.name?.trim() ?? "",
        phone: person.phone?.trim() || null,
        departmentOrRole: person.departmentOrRole?.trim() || null,
      }))
      .filter((person) => person.name.length > 0);

    const incomplete = (input.persons ?? []).find(
      (person) =>
        !(person.name?.trim() ?? "") &&
        ((person.phone?.trim() ?? "") ||
          (person.departmentOrRole?.trim() ?? "")),
    );
    if (incomplete) {
      return { data: null, error: "กรุณากรอกชื่อของผู้ประสานงานให้ครบถ้วน" };
    }

    const supabaseAdmin = createSupabaseServerClient();
    const taxId = input.taxId?.trim() || null;

    const duplicateError = await findDuplicateContactError(supabaseAdmin, {
      companyName,
      taxId,
    });
    if (duplicateError) {
      return { data: null, error: duplicateError };
    }

    const { data: contact, error: contactError } = await supabaseAdmin
      .from("contacts")
      .insert({
        contact_roles: contactRoles,
        customer_type: input.customerType || "นิติบุคคล",
        company_name: companyName,
        tax_id: taxId,
        branch_code: input.branchCode?.trim() || "สำนักงานใหญ่",
        address: input.address?.trim() || null,
        phone: input.phone?.trim() || null,
        ocr_pattern_config:
          contactRoles.includes("Vendor") ? (input.ocrPatternConfig ?? {}) : {},
        is_active: true,
      })
      .select(contactSelect)
      .single();

    if (contactError || !contact) {
      return {
        data: null,
        error: contactError?.message ?? "ไม่สามารถสร้างข้อมูลคู่ค้าได้",
      };
    }

    const created = normalizeContactRow(contact);

    if (persons.length > 0) {
      const { error: personsError } = await supabaseAdmin
        .from("contact_persons")
        .insert(
          persons.map((person, index) => ({
            contact_id: created.id,
            name: person.name,
            phone: person.phone,
            department_or_role: person.departmentOrRole,
            is_primary: index === 0,
          })),
        );

      if (personsError) {
        const { error: rollbackError } = await supabaseAdmin
          .from("contacts")
          .delete()
          .eq("id", created.id);

        return {
          data: null,
          error: rollbackError
            ? `บันทึกผู้ประสานงานไม่สำเร็จ และไม่สามารถยกเลิกข้อมูลคู่ค้าอัตโนมัติได้: ${personsError.message}`
            : `บันทึกผู้ประสานงานไม่สำเร็จ ระบบยกเลิกข้อมูลคู่ค้าแล้ว: ${personsError.message}`,
        };
      }
    }

    revalidatePath(CONTACTS_PATH);
    return { data: created, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "สร้างข้อมูลคู่ค้าไม่สำเร็จ";
    return { data: null, error: message };
  }
}

/**
 * Soft Delete Toggle: สลับ `contacts.is_active` (Active ↔ Inactive)
 * ห้าม Hard Delete — ใช้ระงับ/เปิดใช้งานเพื่อรักษา Audit Trail
 * หลังสำเร็จเรียก `revalidatePath("/contacts")` ให้ UI รีเฟรช
 */
export async function toggleContactStatus(
  id: string,
  currentStatus: boolean,
): Promise<CreateContactResult> {
  try {
    const contactId = id?.trim() ?? "";
    if (!contactId) {
      return { data: null, error: "ไม่พบรหัสคู่ค้า" };
    }

    const supabaseAdmin = createSupabaseServerClient();
    const nextStatus = !currentStatus;

    const { data, error } = await supabaseAdmin
      .from("contacts")
      .update({ is_active: nextStatus })
      .eq("id", contactId)
      .select(contactSelect)
      .single();

    if (error || !data) {
      return {
        data: null,
        error: error?.message ?? "อัปเดตสถานะคู่ค้าไม่สำเร็จ",
      };
    }

    revalidatePath(CONTACTS_PATH);
    return { data: normalizeContactRow(data), error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "อัปเดตสถานะคู่ค้าไม่สำเร็จ";
    return { data: null, error: message };
  }
}

/** Bulk CSV import into `contacts`. */
export async function importContacts(
  rows: ImportContactRow[],
): Promise<ImportContactsResult> {
  try {
    if (!rows.length) {
      return { success: false, error: "ไม่มีแถวข้อมูลสำหรับนำเข้า" };
    }

    const payload = rows.map((row) => {
      const contactRoles = normalizeContactRoles(
        row.contact_roles?.length ? row.contact_roles : row.contact_type,
      );
      return {
        contact_roles: contactRoles,
        customer_type: row.customer_type || "บุคคลธรรมดา",
        company_name: row.company_name.trim(),
        tax_id: row.tax_id?.trim() || null,
        branch_code: row.branch_code?.trim() || "สำนักงานใหญ่",
        phone: row.phone?.trim() || null,
        address: row.address?.trim() || null,
        default_price_tier:
          row.default_price_tier === "Wholesale" ||
          row.default_price_tier === "Retail"
            ? row.default_price_tier
            : "Retail",
        credit_days:
          typeof row.credit_days === "number" && Number.isFinite(row.credit_days)
            ? row.credit_days
            : 0,
        is_active: true,
      };
    });

    if (payload.some((row) => !row.company_name)) {
      return { success: false, error: "พบแถวที่ไม่มีชื่อบริษัท" };
    }

    const seenNames = new Set<string>();
    const seenTaxIds = new Set<string>();
    for (const row of payload) {
      const nameKey = row.company_name.trim().toLocaleLowerCase("th-TH");
      if (seenNames.has(nameKey)) {
        return {
          success: false,
          error: `ไฟล์นำเข้ามีชื่อซ้ำ: ${row.company_name}`,
        };
      }
      seenNames.add(nameKey);

      const taxKey = (row.tax_id ?? "").replace(/[\s-]/g, "");
      if (taxKey) {
        if (seenTaxIds.has(taxKey)) {
          return {
            success: false,
            error: `ไฟล์นำเข้ามีเลขประจำตัวผู้เสียภาษีซ้ำ: ${row.tax_id}`,
          };
        }
        seenTaxIds.add(taxKey);
      }
    }

    const supabaseAdmin = createSupabaseServerClient();

    for (const row of payload) {
      const duplicateError = await findDuplicateContactError(supabaseAdmin, {
        companyName: row.company_name,
        taxId: row.tax_id,
      });
      if (duplicateError) {
        return {
          success: false,
          error: `${duplicateError} (${row.company_name})`,
        };
      }
    }

    const { error } = await supabaseAdmin.from("contacts").insert(payload);

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath(CONTACTS_PATH);
    return { success: true, error: null, inserted: payload.length };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "นำเข้าข้อมูลคู่ค้าไม่สำเร็จ";
    return { success: false, error: message };
  }
}
