"use server";

/**
 * Phase 14 — Payment transaction Tiered Storage metadata (Zero Client-Side Fetching).
 * Source of truth: `payment_transactions` (attachment_url, storage_tier, nas_archive_url).
 */

import { createClient } from "@/lib/supabase/server-admin";
import { resolveStorageDisplayUrl } from "@/lib/utils/storage-tier";
import type { StorageTier } from "@/types/storage-tier";

export type PaymentTransactionDisplayMeta = {
  storage_tier: StorageTier;
  nas_archive_url: string | null;
  attachment_url: string | null;
  /** Resolved URL for UI — NAS http(s) or CLOUD attachment_url */
  display_url: string | null;
  is_browsable: boolean;
  nas_path: string | null;
};

/** @deprecated Use PaymentTransactionDisplayMeta */
export type PaymentSlipStorageMeta = PaymentTransactionDisplayMeta;

function cloudFallbackMeta(
  cloudUrl?: string | null,
): PaymentTransactionDisplayMeta {
  const attachment_url = cloudUrl?.trim() || null;
  const resolved = resolveStorageDisplayUrl({
    storageTier: "CLOUD",
    cloudUrl: attachment_url,
    nasArchiveUrl: null,
  });
  return {
    storage_tier: "CLOUD",
    nas_archive_url: null,
    attachment_url,
    display_url: resolved.url,
    is_browsable: resolved.isBrowsable,
    nas_path: null,
  };
}

function rowToDisplayMeta(
  row: {
    storage_tier?: string | null;
    nas_archive_url?: string | null;
    attachment_url?: string | null;
  } | null,
  cloudFallback?: string | null,
): PaymentTransactionDisplayMeta {
  if (!row) return cloudFallbackMeta(cloudFallback);

  const attachment_url =
    row.attachment_url?.trim() || cloudFallback?.trim() || null;
  const storage_tier: StorageTier =
    row.storage_tier === "NAS" ? "NAS" : "CLOUD";
  const nas_archive_url = row.nas_archive_url?.trim() || null;

  const resolved = resolveStorageDisplayUrl({
    storageTier: storage_tier,
    cloudUrl: attachment_url,
    nasArchiveUrl: nas_archive_url,
  });

  return {
    storage_tier: resolved.tier,
    nas_archive_url,
    attachment_url,
    display_url: resolved.url,
    is_browsable: resolved.isBrowsable,
    nas_path: resolved.nasPath,
  };
}

const TX_TIER_SELECT =
  "storage_tier, nas_archive_url, attachment_url" as const;

/**
 * Lookup payment_transactions by cloud attachment_url.
 */
export async function getPaymentSlipStorageMeta(
  cloudUrl: string | null | undefined,
): Promise<PaymentTransactionDisplayMeta> {
  const url = cloudUrl?.trim() || "";
  if (!url) return cloudFallbackMeta(null);

  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("payment_transactions")
      .select(TX_TIER_SELECT)
      .eq("attachment_url", url)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return cloudFallbackMeta(url);
    return rowToDisplayMeta(data, url);
  } catch {
    return cloudFallbackMeta(url);
  }
}

/**
 * Lookup payment_transactions for a finance document (REC / PAY / DEP_*).
 */
export async function getPaymentTransactionStorageMetaByDocumentId(
  documentId: string,
  cloudFallback?: string | null,
): Promise<PaymentTransactionDisplayMeta> {
  const id = documentId?.trim() || "";
  if (!id) return cloudFallbackMeta(cloudFallback);

  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("payment_transactions")
      .select(TX_TIER_SELECT)
      .eq("document_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return cloudFallbackMeta(cloudFallback);
    return rowToDisplayMeta(data, cloudFallback);
  } catch {
    return cloudFallbackMeta(cloudFallback);
  }
}
