"use server";

/**
 * Contact edit / coordinator / Technician Rate Card Server Actions.
 * Zero Client-Side Fetching: Service Role via `createSupabaseServerClient`.
 */

import { revalidatePath } from "next/cache";
import {
  contactSelect,
  normalizeContactRow,
  type Contact,
} from "@/app/contacts/contacts";
import { findDuplicateContactError } from "@/lib/contacts/duplicate-check";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import {
  deleteTechnicianRate as deleteTechnicianRateImpl,
  getServiceModels as getServiceModelsImpl,
  getTechnicianRates as getTechnicianRatesImpl,
  updateTechnicianRate as updateTechnicianRateImpl,
  upsertTechnicianRate as upsertTechnicianRateImpl,
} from "@/lib/actions/technician-rates";
import type {
  GetServiceModelsResult,
  GetTechnicianRatesResult,
  MutateTechnicianRateResult,
  UpsertTechnicianRateInput,
} from "@/types/technician-rate";

/** Skill & Rate Card — contact_id scoped CRUD (Zero Client-Side Fetching) */
export async function getServiceModels(): Promise<GetServiceModelsResult> {
  return getServiceModelsImpl();
}

export async function getTechnicianRates(
  technicianId: string,
): Promise<GetTechnicianRatesResult> {
  return getTechnicianRatesImpl(technicianId);
}

export async function upsertTechnicianRate(
  input: UpsertTechnicianRateInput,
): Promise<MutateTechnicianRateResult> {
  return upsertTechnicianRateImpl(input);
}

export async function updateTechnicianRate(
  rateId: string,
  defaultWage: number,
): Promise<MutateTechnicianRateResult> {
  return updateTechnicianRateImpl(rateId, defaultWage);
}

export async function deleteTechnicianRate(
  rateId: string,
): Promise<MutateTechnicianRateResult> {
  return deleteTechnicianRateImpl(rateId);
}

const CONTACTS_PATH = "/contacts";

export type UpdateContactPayload = {
  companyName?: string;
  taxId?: string | null;
  branchCode?: string | null;
  phone?: string | null;
  address?: string | null;
};

export type AddContactPersonPayload = {
  name?: string;
  phone?: string | null;
  email?: string | null;
  role?: string | null;
};

export type ContactPersonRow = {
  id: string;
  contact_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  department_or_role: string | null;
  is_primary: boolean;
};

export type ActionResult<T> = {
  data: T | null;
  error: string | null;
};

export type ContactDetails = {
  contact: Contact;
  persons: ContactPersonRow[];
};

/** Fetch one contact + all related contact_persons (read-only view). */
export async function getContactDetails(
  contactId: string,
): Promise<ActionResult<ContactDetails>> {
  try {
    const id = contactId?.trim() ?? "";
    if (!id) {
      return { data: null, error: "ไม่พบรหัสคู่ค้า" };
    }

    const supabase = createSupabaseServerClient();

    const { data: contactRow, error: contactError } = await supabase
      .from("contacts")
      .select(contactSelect)
      .eq("id", id)
      .maybeSingle();

    if (contactError) {
      return { data: null, error: contactError.message };
    }
    if (!contactRow) {
      return { data: null, error: "ไม่พบข้อมูลคู่ค้า" };
    }

    const { data: personRows, error: personsError } = await supabase
      .from("contact_persons")
      .select(
        "id, contact_id, name, phone, email, department_or_role, is_primary",
      )
      .eq("contact_id", id)
      .order("is_primary", { ascending: false })
      .order("name", { ascending: true });

    if (personsError) {
      return { data: null, error: personsError.message };
    }

    return {
      data: {
        contact: normalizeContactRow(contactRow),
        persons: (personRows ?? []).map((row) => ({
          id: String(row.id),
          contact_id: String(row.contact_id),
          name: String(row.name),
          phone: (row.phone as string | null) ?? null,
          email: (row.email as string | null) ?? null,
          department_or_role: (row.department_or_role as string | null) ?? null,
          is_primary: row.is_primary === true,
        })),
      },
      error: null,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "โหลดรายละเอียดคู่ค้าไม่สำเร็จ";
    return { data: null, error: message };
  }
}

/** Update main contact fields on `contacts`. */
export async function updateContact(
  contactId: string,
  payload: UpdateContactPayload | Record<string, unknown>,
): Promise<ActionResult<Contact>> {
  try {
    const id = contactId?.trim() ?? "";
    if (!id) {
      return { data: null, error: "ไม่พบรหัสคู่ค้า" };
    }

    const raw = payload as Record<string, unknown>;
    const companyName =
      typeof raw.companyName === "string"
        ? raw.companyName.trim()
        : typeof raw.company_name === "string"
          ? raw.company_name.trim()
          : "";

    if (!companyName) {
      return { data: null, error: "กรุณากรอกชื่อบริษัทหรือชื่อคู่ค้า" };
    }

    const taxId = pickNullableString(raw, "taxId", "tax_id");
    const branchCode = pickNullableString(raw, "branchCode", "branch_code");
    const phone = pickNullableString(raw, "phone");
    const address = pickNullableString(raw, "address");

    const supabase = createSupabaseServerClient();

    const duplicateError = await findDuplicateContactError(supabase, {
      companyName,
      taxId,
      excludeId: id,
    });
    if (duplicateError) {
      return { data: null, error: duplicateError };
    }

    const { data, error } = await supabase
      .from("contacts")
      .update({
        company_name: companyName,
        tax_id: taxId,
        branch_code: branchCode || "สำนักงานใหญ่",
        phone,
        address,
      })
      .eq("id", id)
      .select(contactSelect)
      .single();

    if (error || !data) {
      return {
        data: null,
        error: error?.message ?? "อัปเดตข้อมูลคู่ค้าไม่สำเร็จ",
      };
    }

    revalidatePath(CONTACTS_PATH);
    return { data: normalizeContactRow(data), error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "อัปเดตข้อมูลคู่ค้าไม่สำเร็จ";
    return { data: null, error: message };
  }
}

/** Insert a coordinator into `contact_persons` for the given contact. */
export async function addContactPerson(
  contactId: string,
  payload: AddContactPersonPayload | Record<string, unknown>,
): Promise<ActionResult<ContactPersonRow>> {
  try {
    const id = contactId?.trim() ?? "";
    if (!id) {
      return { data: null, error: "ไม่พบรหัสคู่ค้า" };
    }

    const raw = payload as Record<string, unknown>;
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!name) {
      return { data: null, error: "กรุณากรอกชื่อผู้ประสานงาน" };
    }

    const phone = pickNullableString(raw, "phone");
    const email = pickNullableString(raw, "email");
    const role =
      pickNullableString(raw, "role") ??
      pickNullableString(raw, "departmentOrRole", "department_or_role");

    const supabase = createSupabaseServerClient();

    const { data: contact, error: contactError } = await supabase
      .from("contacts")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (contactError) {
      return { data: null, error: contactError.message };
    }
    if (!contact) {
      return { data: null, error: "ไม่พบข้อมูลคู่ค้า" };
    }

    const { count, error: countError } = await supabase
      .from("contact_persons")
      .select("id", { count: "exact", head: true })
      .eq("contact_id", id);

    if (countError) {
      return { data: null, error: countError.message };
    }

    const { data, error } = await supabase
      .from("contact_persons")
      .insert({
        contact_id: id,
        name,
        phone,
        email,
        department_or_role: role,
        is_primary: (count ?? 0) === 0,
      })
      .select(
        "id, contact_id, name, phone, email, department_or_role, is_primary",
      )
      .single();

    if (error || !data) {
      return {
        data: null,
        error: error?.message ?? "เพิ่มผู้ประสานงานไม่สำเร็จ",
      };
    }

    revalidatePath(CONTACTS_PATH);
    return {
      data: {
        id: String(data.id),
        contact_id: String(data.contact_id),
        name: String(data.name),
        phone: (data.phone as string | null) ?? null,
        email: (data.email as string | null) ?? null,
        department_or_role: (data.department_or_role as string | null) ?? null,
        is_primary: data.is_primary === true,
      },
      error: null,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "เพิ่มผู้ประสานงานไม่สำเร็จ";
    return { data: null, error: message };
  }
}

/** List contact persons for manage UI (Service Role). */
export async function listContactPersons(
  contactId: string,
): Promise<ActionResult<ContactPersonRow[]>> {
  try {
    const id = contactId?.trim() ?? "";
    if (!id) {
      return { data: [], error: null };
    }

    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("contact_persons")
      .select(
        "id, contact_id, name, phone, email, department_or_role, is_primary",
      )
      .eq("contact_id", id)
      .order("is_primary", { ascending: false })
      .order("name", { ascending: true });

    if (error) {
      return { data: [], error: error.message };
    }

    return {
      data: (data ?? []).map((row) => ({
        id: String(row.id),
        contact_id: String(row.contact_id),
        name: String(row.name),
        phone: (row.phone as string | null) ?? null,
        email: (row.email as string | null) ?? null,
        department_or_role: (row.department_or_role as string | null) ?? null,
        is_primary: row.is_primary === true,
      })),
      error: null,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "โหลดผู้ประสานงานไม่สำเร็จ";
    return { data: [], error: message };
  }
}

function pickNullableString(
  payload: Record<string, unknown>,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    if (!(key in payload)) continue;
    const value = payload[key];
    if (value == null) return null;
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
  }
  return null;
}
