"use server";

/**
 * Phase 14 — Payment Slips Tiered Storage metadata (Zero Client-Side Fetching).
 */

import { createClient } from "@/lib/supabase/server-admin";
import type { StorageTier } from "@/types/storage-tier";

export type PaymentSlipStorageMeta = {
  storage_tier: StorageTier;
  nas_archive_url: string | null;
  slip_image_url: string | null;
};

/**
 * Lookup payment_slips by cloud URL (slip_image_url).
 * Falls back to CLOUD when no matching row (e.g. expense-only slips).
 */
export async function getPaymentSlipStorageMeta(
  cloudUrl: string | null | undefined,
): Promise<PaymentSlipStorageMeta> {
  const fallback: PaymentSlipStorageMeta = {
    storage_tier: "CLOUD",
    nas_archive_url: null,
    slip_image_url: cloudUrl?.trim() || null,
  };

  const url = cloudUrl?.trim() || "";
  if (!url) return fallback;

  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("payment_slips")
      .select("storage_tier, nas_archive_url, slip_image_url")
      .eq("slip_image_url", url)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return fallback;

    return {
      storage_tier: data.storage_tier === "NAS" ? "NAS" : "CLOUD",
      nas_archive_url: data.nas_archive_url?.trim() || null,
      slip_image_url:
        data.slip_image_url == null
          ? url
          : String(data.slip_image_url).trim() || url,
    };
  } catch {
    return fallback;
  }
}
