/**
 * Phase 14 — payment_transactions tiered storage metadata (Client + Server safe).
 */

import type { StorageTier } from "@/types/storage-tier";

export type PaymentTransactionDisplayMeta = {
  /** True when a matching payment_transactions row was loaded */
  found_in_transactions: boolean;
  storage_tier: StorageTier;
  nas_archive_url: string | null;
  attachment_url: string | null;
  /** Resolved browsable URL (optional convenience from Server Action) */
  display_url: string | null;
  is_browsable: boolean;
  nas_path: string | null;
};

/** @deprecated Use PaymentTransactionDisplayMeta */
export type PaymentSlipStorageMeta = PaymentTransactionDisplayMeta;

/**
 * Resolve preview URL for ExpenseAttachmentPreview / AttachmentSheetViewer.
 * - Meta from payment_transactions + NAS → nas_archive_url
 * - Meta from payment_transactions + CLOUD → attachment_url
 * - No meta row → expense.payment_slip_url fallback
 */
export function resolvePaymentSlipPreviewUrl(
  meta: PaymentTransactionDisplayMeta | null | undefined,
  expensePaymentSlipUrl: string | null | undefined,
): string | null {
  if (meta?.found_in_transactions) {
    if (meta.storage_tier === "NAS") {
      const nas = meta.nas_archive_url?.trim();
      return nas || null;
    }
    const cloud = meta.attachment_url?.trim();
    return cloud || null;
  }

  const fallback = expensePaymentSlipUrl?.trim();
  return fallback || null;
}
