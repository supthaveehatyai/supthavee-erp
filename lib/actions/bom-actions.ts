"use server";

/**
 * Bill of Materials (product_boms) Server Actions.
 * Zero Client-Side Fetching — Service Role (`supabaseAdmin`) only.
 * Types live in `@/types/bom`.
 */

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSessionUserId } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server-admin";
import type {
  AddBOMItemPayload,
  BOMItemRow,
  GetBOMByModelIdResult,
  MutateBOMItemResult,
  RawMaterialModelOption,
  SearchRawMaterialModelsResult,
} from "@/types/bom";

const PRODUCTS_PATH = "/products";

const POSTGRES_UNIQUE_VIOLATION = "23505";
const POSTGRES_UNDEFINED_TABLE = "42P01";
const POSTGRES_FOREIGN_KEY_VIOLATION = "23503";

/** Untyped admin client — product_boms may not be in generated Database types yet. */
function getSupabaseAdmin(): SupabaseClient {
  return createClient() as unknown as SupabaseClient;
}

function escapeIlikePattern(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

type ProductBomDbRow = {
  id: string;
  model_id: string;
  raw_material_model_id: string;
  uom_id: string;
  quantity_required: number | string | null;
  waste_percent: number | string | null;
  created_by: string | null;
  created_at: string | null;
};

function toQuantityRequired(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

function toWastePercent(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function mapBomDuplicateError(): string {
  return "วัตถุดิบนี้มีในสูตรการผลิตแล้ว — ไม่สามารถเพิ่มซ้ำได้";
}

function mapInsertBomError(error: { code?: string; message?: string }): string {
  if (error.code === POSTGRES_UNDEFINED_TABLE) {
    return "ยังไม่มีตาราง product_boms — รัน migration ก่อน";
  }
  if (error.code === POSTGRES_UNIQUE_VIOLATION) {
    return mapBomDuplicateError();
  }
  if (error.code === POSTGRES_FOREIGN_KEY_VIOLATION) {
    return "รุ่นสินค้า วัตถุดิบ หรือหน่วยนับไม่พบในระบบ";
  }
  return error.message?.trim() || "เพิ่มรายการสูตรการผลิตไม่สำเร็จ";
}

/**
 * ค้นหารุ่นวัตถุดิบ (is_raw_material = true) สำหรับ BOM ComboBox
 */
export async function searchRawMaterialModels(
  keyword: string,
): Promise<SearchRawMaterialModelsResult> {
  try {
    const trimmed = keyword?.trim() ?? "";
    const supabaseAdmin = getSupabaseAdmin();

    if (trimmed.length > 0) {
      const pattern = `%${escapeIlikePattern(trimmed)}%`;
      const [byName, byCode] = await Promise.all([
        supabaseAdmin
          .from("product_models")
          .select("id, model_code, name, base_uom_id")
          .eq("is_raw_material", true)
          .eq("is_active", true)
          .ilike("name", pattern)
          .order("model_code", { ascending: true })
          .limit(20),
        supabaseAdmin
          .from("product_models")
          .select("id, model_code, name, base_uom_id")
          .eq("is_raw_material", true)
          .eq("is_active", true)
          .ilike("model_code", pattern)
          .order("model_code", { ascending: true })
          .limit(20),
      ]);

      if (byName.error) {
        return {
          success: false,
          error: byName.error.message ?? "ค้นหาวัตถุดิบไม่สำเร็จ",
          data: [],
        };
      }
      if (byCode.error) {
        return {
          success: false,
          error: byCode.error.message ?? "ค้นหาวัตถุดิบไม่สำเร็จ",
          data: [],
        };
      }

      const byId = new Map<string, typeof byName.data extends (infer R)[] ? R : never>();
      for (const row of [...(byName.data ?? []), ...(byCode.data ?? [])]) {
        if (row?.id) byId.set(String(row.id), row);
      }
      const rows = [...byId.values()].slice(0, 20);
      return await mapRawMaterialRows(supabaseAdmin, rows);
    }

    const { data, error } = await supabaseAdmin
      .from("product_models")
      .select("id, model_code, name, base_uom_id")
      .eq("is_raw_material", true)
      .eq("is_active", true)
      .order("model_code", { ascending: true })
      .limit(20);

    if (error) {
      console.error("[searchRawMaterialModels]", error.message);
      return {
        success: false,
        error: error.message ?? "ค้นหาวัตถุดิบไม่สำเร็จ",
        data: [],
      };
    }

    return await mapRawMaterialRows(supabaseAdmin, data ?? []);
  } catch (err) {
    console.error("[searchRawMaterialModels]", err);
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "ค้นหาวัตถุดิบไม่สำเร็จ",
      data: [],
    };
  }
}

async function mapRawMaterialRows(
  supabaseAdmin: SupabaseClient,
  rows: Array<{
    id: string;
    model_code: string;
    name: string;
    base_uom_id: string | null;
  }>,
): Promise<SearchRawMaterialModelsResult> {
  const uomIds = [
    ...new Set(
      rows
        .map((row) => String(row.base_uom_id ?? "").trim())
        .filter(Boolean),
    ),
  ];

  const uomById = new Map<string, { uom_code: string; uom_name: string }>();
  if (uomIds.length > 0) {
    const { data: uoms, error: uomError } = await supabaseAdmin
      .from("mst_uom")
      .select("uom_id, uom_code, uom_name")
      .in("uom_id", uomIds);

    if (uomError) {
      return {
        success: false,
        error: uomError.message ?? "ดึงหน่วยนับวัตถุดิบไม่สำเร็จ",
        data: [],
      };
    }

    for (const uom of uoms ?? []) {
      uomById.set(String(uom.uom_id), {
        uom_code: String(uom.uom_code ?? "").trim(),
        uom_name: String(uom.uom_name ?? "").trim(),
      });
    }
  }

  const options: RawMaterialModelOption[] = rows.map((row) => {
    const baseUomId = row.base_uom_id ? String(row.base_uom_id) : null;
    const uom = baseUomId ? uomById.get(baseUomId) : undefined;
    return {
      id: String(row.id),
      model_code: String(row.model_code ?? "").trim() || "—",
      name: String(row.name ?? "").trim() || String(row.model_code ?? "").trim(),
      base_uom_id: baseUomId,
      uom_code: uom?.uom_code ?? null,
      uom_name: uom?.uom_name ?? null,
    };
  });

  return { success: true, data: options };
}

/**
 * ดึงสูตรการผลิต (BOM) ของรุ่นสินค้า พร้อมชื่อ/รหัสวัตถุดิบและหน่วยนับ
 */
export async function getBOMByModelId(
  modelId: string,
): Promise<GetBOMByModelIdResult> {
  try {
    const id = modelId?.trim() ?? "";
    if (!id) {
      return { success: false, error: "ไม่พบรหัสรุ่นสินค้า", data: [] };
    }

    const supabaseAdmin = getSupabaseAdmin();

    const { data: rows, error } = await supabaseAdmin
      .from("product_boms")
      .select(
        "id, model_id, raw_material_model_id, uom_id, quantity_required, waste_percent, created_by, created_at",
      )
      .eq("model_id", id)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[getBOMByModelId]", error.message);
      if (error.code === POSTGRES_UNDEFINED_TABLE) {
        return {
          success: false,
          error: "ยังไม่มีตาราง product_boms — รัน migration ก่อน",
          data: [],
        };
      }
      return {
        success: false,
        error: error.message ?? "ดึงสูตรการผลิตไม่สำเร็จ",
        data: [],
      };
    }

    const bomRows = (rows ?? []) as ProductBomDbRow[];
    if (bomRows.length === 0) {
      return { success: true, data: [] };
    }

    const rawMaterialIds = [
      ...new Set(
        bomRows
          .map((row) => String(row.raw_material_model_id ?? "").trim())
          .filter(Boolean),
      ),
    ];
    const uomIds = [
      ...new Set(
        bomRows
          .map((row) => String(row.uom_id ?? "").trim())
          .filter(Boolean),
      ),
    ];

    const [modelsRes, uomsRes] = await Promise.all([
      rawMaterialIds.length > 0
        ? supabaseAdmin
            .from("product_models")
            .select("id, model_code, name")
            .in("id", rawMaterialIds)
        : Promise.resolve({ data: [], error: null }),
      uomIds.length > 0
        ? supabaseAdmin
            .from("mst_uom")
            .select("uom_id, uom_code, uom_name")
            .in("uom_id", uomIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (modelsRes.error) {
      return {
        success: false,
        error: modelsRes.error.message ?? "ดึงข้อมูลวัตถุดิบไม่สำเร็จ",
        data: [],
      };
    }
    if (uomsRes.error) {
      return {
        success: false,
        error: uomsRes.error.message ?? "ดึงข้อมูลหน่วยนับไม่สำเร็จ",
        data: [],
      };
    }

    const modelById = new Map(
      (modelsRes.data ?? []).map((row) => [
        String(row.id),
        {
          model_code: String(row.model_code ?? "").trim(),
          name: String(row.name ?? "").trim(),
        },
      ]),
    );
    const uomById = new Map(
      (uomsRes.data ?? []).map((row) => [
        String(row.uom_id),
        {
          uom_code: String(row.uom_code ?? "").trim(),
          uom_name: String(row.uom_name ?? "").trim(),
        },
      ]),
    );

    const data: BOMItemRow[] = bomRows.map((row) => {
      const rawMaterial = modelById.get(String(row.raw_material_model_id));
      const uom = uomById.get(String(row.uom_id));
      const quantityRequired = toQuantityRequired(row.quantity_required) ?? 0;
      const wastePercent = toWastePercent(row.waste_percent) ?? 0;

      return {
        id: String(row.id),
        model_id: String(row.model_id),
        raw_material_model_id: String(row.raw_material_model_id),
        raw_material_model_code: rawMaterial?.model_code || "—",
        raw_material_model_name:
          rawMaterial?.name || rawMaterial?.model_code || "วัตถุดิบ",
        uom_id: String(row.uom_id),
        uom_code: uom?.uom_code || "—",
        uom_name: uom?.uom_name || uom?.uom_code || "—",
        quantity_required: quantityRequired,
        waste_percent: wastePercent,
        created_by: row.created_by ? String(row.created_by) : null,
        created_at: row.created_at ? String(row.created_at) : null,
      };
    });

    return { success: true, data };
  } catch (err) {
    console.error("[getBOMByModelId]", err);
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "ดึงสูตรการผลิตไม่สำเร็จ",
      data: [],
    };
  }
}

/**
 * เพิ่มวัตถุดิบลงในสูตรการผลิต — stamp `created_by` จาก Auth session
 */
export async function addBOMItem(
  payload: AddBOMItemPayload,
): Promise<MutateBOMItemResult> {
  try {
    const owner = await requireSessionUserId();
    if (!owner.ok) {
      return { success: false, error: owner.error };
    }

    const modelId = payload.model_id?.trim() ?? "";
    const rawMaterialModelId = payload.raw_material_model_id?.trim() ?? "";
    const quantityRequired = toQuantityRequired(payload.quantity_required);
    const wastePercent = toWastePercent(payload.waste_percent ?? 0);

    if (!modelId) {
      return { success: false, error: "กรุณาระบุรุ่นสินค้าสำเร็จรูป (model_id)" };
    }
    if (!rawMaterialModelId) {
      return { success: false, error: "กรุณาเลือกวัตถุดิบ (raw_material_model_id)" };
    }
    if (quantityRequired === null) {
      return {
        success: false,
        error: "ปริมาณที่ใช้ต้องเป็นตัวเลขมากกว่า 0",
      };
    }
    if (wastePercent === null) {
      return {
        success: false,
        error: "%เผื่อเสียต้องอยู่ระหว่าง 0 ถึง 100",
      };
    }
    if (modelId === rawMaterialModelId) {
      return {
        success: false,
        error: "ไม่สามารถใส่รุ่นสินค้าเป็นวัตถุดิบของตัวเองได้",
      };
    }

    const supabaseAdmin = getSupabaseAdmin();

    const [parentModelRes, rawModelRes] = await Promise.all([
      supabaseAdmin
        .from("product_models")
        .select("id, is_raw_material, is_service")
        .eq("id", modelId)
        .maybeSingle(),
      supabaseAdmin
        .from("product_models")
        .select("id, is_raw_material, base_uom_id")
        .eq("id", rawMaterialModelId)
        .maybeSingle(),
    ]);

    if (parentModelRes.error) {
      return {
        success: false,
        error: parentModelRes.error.message ?? "ตรวจสอบรุ่นสินค้าไม่สำเร็จ",
      };
    }
    if (!parentModelRes.data) {
      return { success: false, error: "ไม่พบรุ่นสินค้าสำเร็จรูปที่เลือก" };
    }
    if (parentModelRes.data.is_service === true) {
      return {
        success: false,
        error: "งานบริการ (is_service) ไม่รองรับสูตรการผลิต",
      };
    }
    if (parentModelRes.data.is_raw_material === true) {
      return {
        success: false,
        error: "วัตถุดิบไม่สามารถมีสูตรการผลิต (BOM) ได้",
      };
    }

    if (rawModelRes.error) {
      return {
        success: false,
        error: rawModelRes.error.message ?? "ตรวจสอบวัตถุดิบไม่สำเร็จ",
      };
    }
    if (!rawModelRes.data || rawModelRes.data.is_raw_material !== true) {
      return {
        success: false,
        error: "ต้องเลือกเฉพาะรุ่นที่ตั้งเป็นวัตถุดิบ (is_raw_material)",
      };
    }

    const uomId = String(rawModelRes.data.base_uom_id ?? "").trim();
    if (!uomId) {
      return {
        success: false,
        error: "วัตถุดิบที่เลือกยังไม่ได้กำหนดหน่วยนับหลัก (base_uom_id)",
      };
    }

    const { data: uomRow, error: uomError } = await supabaseAdmin
      .from("mst_uom")
      .select("uom_id")
      .eq("uom_id", uomId)
      .maybeSingle();

    if (uomError) {
      return {
        success: false,
        error: uomError.message ?? "ตรวจสอบหน่วยนับไม่สำเร็จ",
      };
    }
    if (!uomRow) {
      return { success: false, error: "ไม่พบหน่วยนับของวัตถุดิบ" };
    }

    const { data, error } = await supabaseAdmin
      .from("product_boms")
      .insert({
        model_id: modelId,
        raw_material_model_id: rawMaterialModelId,
        uom_id: uomId,
        quantity_required: quantityRequired,
        waste_percent: wastePercent,
        created_by: owner.userId,
      })
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[addBOMItem]", error.message);
      return { success: false, error: mapInsertBomError(error) };
    }

    revalidatePath(PRODUCTS_PATH);
    return {
      success: true,
      error: null,
      id: data?.id ? String(data.id) : undefined,
    };
  } catch (err) {
    console.error("[addBOMItem]", err);
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "เพิ่มรายการสูตรการผลิตไม่สำเร็จ",
    };
  }
}

/**
 * ลบรายการออกจากสูตรการผลิต
 */
export async function removeBOMItem(bomId: string): Promise<MutateBOMItemResult> {
  try {
    const id = bomId?.trim() ?? "";
    if (!id) {
      return { success: false, error: "ไม่พบรหัสรายการสูตรการผลิต" };
    }

    const owner = await requireSessionUserId();
    if (!owner.ok) {
      return { success: false, error: owner.error };
    }

    const supabaseAdmin = getSupabaseAdmin();

    const { data, error } = await supabaseAdmin
      .from("product_boms")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[removeBOMItem]", error.message);
      if (error.code === POSTGRES_UNDEFINED_TABLE) {
        return {
          success: false,
          error: "ยังไม่มีตาราง product_boms — รัน migration ก่อน",
        };
      }
      return {
        success: false,
        error: error.message ?? "ลบรายการสูตรการผลิตไม่สำเร็จ",
      };
    }

    if (!data) {
      return { success: false, error: "ไม่พบรายการสูตรการผลิตที่ต้องการลบ" };
    }

    revalidatePath(PRODUCTS_PATH);
    return { success: true, error: null, id: String(data.id) };
  } catch (err) {
    console.error("[removeBOMItem]", err);
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "ลบรายการสูตรการผลิตไม่สำเร็จ",
    };
  }
}
