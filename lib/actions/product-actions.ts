"use server";

/**
 * Product Model mutations — delete with usage guardrail.
 * Service Role only. Zero Client-Side Fetching.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server-admin";
import { getCurrentAuthUser } from "@/lib/auth/current-user";
import type { DeleteProductModelResult } from "@/types/product-matrix";

const USAGE_BLOCK_MESSAGE =
  "ไม่อนุญาตให้ลบ: สินค้ารุ่นนี้มีการเดินรายการบัญชีหรือสต็อกแล้ว กรุณาใช้วิธี 'ปิดการใช้งาน (Inactive)' แทน";

const modelIdSchema = z.string().uuid("รหัสรุ่นสินค้าไม่ถูกต้อง");

const PRODUCTS_PATH = "/products";
const IN_CHUNK = 200;

function chunkIds(ids: string[]): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    chunks.push(ids.slice(i, i + IN_CHUNK));
  }
  return chunks;
}

async function hasRowsForProducts(
  table: "inventory_ledger" | "document_items",
  productIds: string[],
): Promise<{ used: boolean; error: string | null }> {
  if (productIds.length === 0) return { used: false, error: null };

  const supabaseAdmin = createClient();
  for (const chunk of chunkIds(productIds)) {
    const { count, error } = await supabaseAdmin
      .from(table)
      .select("id", { count: "exact", head: true })
      .in("product_id", chunk);

    if (error) return { used: false, error: error.message };
    if ((count ?? 0) > 0) return { used: true, error: null };
  }

  return { used: false, error: null };
}

export async function deleteProductModel(
  modelId: string,
): Promise<DeleteProductModelResult> {
  const actor = await getCurrentAuthUser();
  if (!actor) {
    return { success: false, error: "กรุณาเข้าสู่ระบบ" };
  }

  const parsed = modelIdSchema.safeParse(String(modelId ?? "").trim());
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "รหัสรุ่นสินค้าไม่ถูกต้อง",
    };
  }

  const id = parsed.data;

  try {
    const supabaseAdmin = createClient();

    const { data: model, error: modelError } = await supabaseAdmin
      .from("product_models")
      .select("id, model_code, name")
      .eq("id", id)
      .maybeSingle();

    if (modelError) {
      return { success: false, error: modelError.message };
    }
    if (!model) {
      return { success: false, error: "ไม่พบสินค้ารุ่นที่ต้องการลบ" };
    }

    const { data: skuRows, error: skuError } = await supabaseAdmin
      .from("products")
      .select("id")
      .eq("model_id", id);

    if (skuError) {
      return { success: false, error: skuError.message };
    }

    const productIds = (skuRows ?? [])
      .map((row) => String(row.id ?? "").trim())
      .filter(Boolean);

    const ledger = await hasRowsForProducts("inventory_ledger", productIds);
    if (ledger.error) return { success: false, error: ledger.error };
    if (ledger.used) return { success: false, error: USAGE_BLOCK_MESSAGE };

    const docs = await hasRowsForProducts("document_items", productIds);
    if (docs.error) return { success: false, error: docs.error };
    if (docs.used) return { success: false, error: USAGE_BLOCK_MESSAGE };

    const { count: bomAsMaterialCount, error: bomCheckError } =
      await supabaseAdmin
        .from("product_boms")
        .select("id", { count: "exact", head: true })
        .eq("raw_material_model_id", id);

    if (bomCheckError) {
      return { success: false, error: bomCheckError.message };
    }
    if ((bomAsMaterialCount ?? 0) > 0) {
      return { success: false, error: USAGE_BLOCK_MESSAGE };
    }

    // PostgREST ไม่มี multi-statement transaction — ลบลูกก่อนแม่ตามลำดับ
    if (productIds.length > 0) {
      for (const chunk of chunkIds(productIds)) {
        const { error: mappingError } = await supabaseAdmin
          .from("vendor_product_mapping")
          .delete()
          .in("internal_product_id", chunk);
        if (mappingError) {
          return { success: false, error: mappingError.message };
        }
      }
    }

    const { error: ownBomError } = await supabaseAdmin
      .from("product_boms")
      .delete()
      .eq("finished_model_id", id);
    if (ownBomError) {
      return { success: false, error: ownBomError.message };
    }

    const { error: ratesError } = await supabaseAdmin
      .from("technician_rates")
      .delete()
      .eq("service_model_id", id);
    if (ratesError) {
      return { success: false, error: ratesError.message };
    }

    const { error: productsError } = await supabaseAdmin
      .from("products")
      .delete()
      .eq("model_id", id);
    if (productsError) {
      const fkHint = /foreign key|violates/i.test(productsError.message);
      return {
        success: false,
        error: fkHint ? USAGE_BLOCK_MESSAGE : productsError.message,
      };
    }

    const { error: deleteModelError } = await supabaseAdmin
      .from("product_models")
      .delete()
      .eq("id", id);
    if (deleteModelError) {
      const fkHint = /foreign key|violates/i.test(deleteModelError.message);
      return {
        success: false,
        error: fkHint ? USAGE_BLOCK_MESSAGE : deleteModelError.message,
      };
    }

    revalidatePath(PRODUCTS_PATH);
    revalidatePath(PRODUCTS_PATH, "layout");
    return { success: true };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ลบสินค้ารุ่นไม่สำเร็จ";
    return { success: false, error: message };
  }
}
