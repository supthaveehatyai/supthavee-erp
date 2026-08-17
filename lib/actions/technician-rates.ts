"use server";

/**
 * Technician Skill & Rate Card Server Actions.
 * Zero Client-Side Fetching — Service Role only.
 * Types live in `@/types/technician-rate`.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server-admin";
import type {
  GetServiceModelsResult,
  GetTechnicianRatesResult,
  MutateTechnicianRateResult,
  ServiceModelOption,
  TechnicianRateRow,
  UpsertTechnicianRateInput,
} from "@/types/technician-rate";

const CONTACTS_PATH = "/contacts";
const KANBAN_PATH = "/production/kanban";

const TECHNICIAN_CONTACT_TYPES = ["Vendor", "Technician"] as const;

function toWage(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

/**
 * รุ่นงานบริการ (product_models.is_service = true) สำหรับ Rate Card / Kanban
 */
export async function getServiceModels(): Promise<GetServiceModelsResult> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("product_models")
      .select("id, model_code, name, short_name, is_service, is_active")
      .eq("is_service", true)
      .order("model_code", { ascending: true });

    if (error) {
      console.error("[getServiceModels]", error.message);
      return {
        success: false,
        error: error.message ?? "ดึงรายการงานบริการไม่สำเร็จ",
        data: [],
      };
    }

    const options: ServiceModelOption[] = (data ?? []).map((row) => ({
      id: String(row.id),
      model_code: String(row.model_code ?? "").trim() || "—",
      name:
        String(row.name ?? "").trim() ||
        String(row.short_name ?? "").trim() ||
        String(row.model_code ?? "").trim() ||
        "งานบริการ",
    }));

    return { success: true, data: options };
  } catch (err) {
    console.error("[getServiceModels]", err);
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "ดึงรายการงานบริการไม่สำเร็จ",
      data: [],
    };
  }
}

/**
 * Rate Card ของช่างคนหนึ่ง
 */
export async function getTechnicianRates(
  technicianId: string,
): Promise<GetTechnicianRatesResult> {
  try {
    const id = technicianId?.trim() ?? "";
    if (!id) {
      return { success: false, error: "ไม่พบรหัสช่างรับเหมา", data: [] };
    }

    const supabase = createClient();

    // Do NOT embed product_models(*) — PostgREST fails with
    // "Could not find a relationship between technician_rates and product_models"
    // when the FK is missing from schema cache. Fetch models in a second query.
    const { data, error } = await supabase
      .from("technician_rates")
      .select("id, technician_id, service_model_id, default_wage, created_at")
      .eq("technician_id", id)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[getTechnicianRates]", error.message);
      return {
        success: false,
        error: error.message ?? "ดึง Rate Card ไม่สำเร็จ",
        data: [],
      };
    }

    const modelIds = [
      ...new Set(
        (data ?? [])
          .map((row) => String(row.service_model_id ?? "").trim())
          .filter(Boolean),
      ),
    ];

    const modelById = new Map<
      string,
      { model_code: string; name: string; short_name: string }
    >();

    if (modelIds.length > 0) {
      const { data: models, error: modelsError } = await supabase
        .from("product_models")
        .select("id, model_code, name, short_name")
        .in("id", modelIds);

      if (modelsError) {
        console.error("[getTechnicianRates] product_models", modelsError.message);
      } else {
        for (const model of models ?? []) {
          modelById.set(String(model.id), {
            model_code: String(model.model_code ?? "").trim(),
            name: String(model.name ?? "").trim(),
            short_name: String(model.short_name ?? "").trim(),
          });
        }
      }
    }

    const rows: TechnicianRateRow[] = (data ?? []).map((row) => {
      const modelId = String(row.service_model_id ?? "");
      const model = modelById.get(modelId);
      return {
        id: String(row.id),
        technician_id: String(row.technician_id),
        service_model_id: modelId,
        service_model_code: model?.model_code || "—",
        service_model_name:
          model?.name || model?.short_name || model?.model_code || "งานบริการ",
        default_wage: toWage(row.default_wage),
      };
    });

    return { success: true, data: rows };
  } catch (err) {
    console.error("[getTechnicianRates]", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "ดึง Rate Card ไม่สำเร็จ",
      data: [],
    };
  }
}

/**
 * เพิ่ม / อัปเดตเรตค่าแรง (UNIQUE technician_id + service_model_id)
 */
export async function upsertTechnicianRate(
  input: UpsertTechnicianRateInput,
): Promise<MutateTechnicianRateResult> {
  try {
    const technicianId = input.technician_id?.trim() ?? "";
    const serviceModelId =
      input.service_model_id?.trim() ||
      input.product_model_id?.trim() ||
      "";
    const wage = toWage(input.default_wage);

    if (!technicianId) {
      return { success: false, error: "ไม่พบรหัสช่างรับเหมา" };
    }
    if (!serviceModelId) {
      return { success: false, error: "กรุณาเลือกงานบริการ" };
    }
    if (!Number.isFinite(Number(input.default_wage)) || Number(input.default_wage) < 0) {
      return { success: false, error: "ค่าแรงต้องเป็นตัวเลขมากกว่าหรือเท่ากับ 0" };
    }

    const supabase = createClient();

    const { data: contact, error: contactError } = await supabase
      .from("contacts")
      .select("id, contact_roles")
      .eq("id", technicianId)
      .maybeSingle();

    if (contactError) {
      return {
        success: false,
        error: contactError.message ?? "ตรวจสอบคู่ค้าไม่สำเร็จ",
      };
    }
    const roles = Array.isArray(contact?.contact_roles)
      ? contact.contact_roles
      : [];
    const canEditRates = TECHNICIAN_CONTACT_TYPES.some((role) =>
      roles.includes(role),
    );
    if (!contact || !canEditRates) {
      return {
        success: false,
        error: "ตั้ง Rate Card ได้เฉพาะผู้จำหน่ายหรือช่างรับเหมา",
      };
    }

    const { data: model, error: modelError } = await supabase
      .from("product_models")
      .select("id, is_service")
      .eq("id", serviceModelId)
      .maybeSingle();

    if (modelError) {
      return {
        success: false,
        error: modelError.message ?? "ตรวจสอบงานบริการไม่สำเร็จ",
      };
    }
    if (!model || model.is_service !== true) {
      return {
        success: false,
        error: "ต้องเลือกเฉพาะรุ่นที่ตั้งเป็นงานบริการ (is_service)",
      };
    }

    const nowIso = new Date().toISOString();
    const { error } = await supabase.from("technician_rates").upsert(
      {
        technician_id: technicianId,
        service_model_id: serviceModelId,
        default_wage: wage,
        updated_at: nowIso,
      },
      { onConflict: "technician_id,service_model_id" },
    );

    if (error) {
      console.error("[upsertTechnicianRate]", error.message);
      return {
        success: false,
        error: error.message ?? "บันทึก Rate Card ไม่สำเร็จ",
      };
    }

    revalidatePath(CONTACTS_PATH);
    revalidatePath(KANBAN_PATH);
    return { success: true, error: null };
  } catch (err) {
    console.error("[upsertTechnicianRate]", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "บันทึก Rate Card ไม่สำเร็จ",
    };
  }
}

/**
 * อัปเดตค่าแรงของ Rate Card ตาม id (Update)
 */
export async function updateTechnicianRate(
  rateId: string,
  defaultWage: number,
): Promise<MutateTechnicianRateResult> {
  try {
    const id = rateId?.trim() ?? "";
    if (!id) {
      return { success: false, error: "ไม่พบรหัส Rate Card" };
    }
    if (!Number.isFinite(Number(defaultWage)) || Number(defaultWage) < 0) {
      return { success: false, error: "ค่าแรงต้องเป็นตัวเลขมากกว่าหรือเท่ากับ 0" };
    }

    const supabase = createClient();
    const { data, error } = await supabase
      .from("technician_rates")
      .update({
        default_wage: toWage(defaultWage),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[updateTechnicianRate]", error.message);
      return {
        success: false,
        error: error.message ?? "อัปเดต Rate Card ไม่สำเร็จ",
      };
    }
    if (!data) {
      return { success: false, error: "ไม่พบ Rate Card ที่ต้องการแก้ไข" };
    }

    revalidatePath(CONTACTS_PATH);
    revalidatePath(KANBAN_PATH);
    return { success: true, error: null };
  } catch (err) {
    console.error("[updateTechnicianRate]", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "อัปเดต Rate Card ไม่สำเร็จ",
    };
  }
}

export async function deleteTechnicianRate(
  rateId: string,
): Promise<MutateTechnicianRateResult> {
  try {
    const id = rateId?.trim() ?? "";
    if (!id) {
      return { success: false, error: "ไม่พบรหัส Rate Card" };
    }

    const supabase = createClient();
    const { error } = await supabase
      .from("technician_rates")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("[deleteTechnicianRate]", error.message);
      return {
        success: false,
        error: error.message ?? "ลบ Rate Card ไม่สำเร็จ",
      };
    }

    revalidatePath(CONTACTS_PATH);
    revalidatePath(KANBAN_PATH);
    return { success: true, error: null };
  } catch (err) {
    console.error("[deleteTechnicianRate]", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "ลบ Rate Card ไม่สำเร็จ",
    };
  }
}
