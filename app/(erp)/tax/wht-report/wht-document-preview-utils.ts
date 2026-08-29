/**
 * Pure helpers for WHT document preview URL state.
 * No "use client" — safe to import from Server Components.
 */

import type { WHTReportSource } from "@/types/tax";

export const VIEW_WHT_SOURCE_PARAM = "view_wht_source";
export const VIEW_WHT_ID_PARAM = "view_wht_id";

export type WhtDocumentPreviewTarget = {
  source: WHTReportSource;
  documentId: string;
} | null;

export function parseWhtDocumentPreviewTarget(
  rawSource?: string,
  rawId?: string,
): WhtDocumentPreviewTarget {
  const source = rawSource?.trim().toUpperCase();
  const documentId = rawId?.trim() ?? "";
  if (!documentId) return null;
  if (source === "EXP" || source === "TB") {
    return { source, documentId };
  }
  return null;
}

/** Set preview params while preserving year/month and other search params. */
export function buildViewWhtHref(
  pathname: string,
  currentSearch: string,
  source: WHTReportSource,
  documentId: string,
): string {
  const params = new URLSearchParams(currentSearch);
  params.set(VIEW_WHT_SOURCE_PARAM, source);
  params.set(VIEW_WHT_ID_PARAM, documentId);
  return `${pathname}?${params.toString()}`;
}

export function previewTitle(source: WHTReportSource): string {
  return source === "TB"
    ? "สรุปวางบิลช่าง (Technician Bill)"
    : "รายละเอียดค่าใช้จ่าย (Expense)";
}

export function previewDescription(source: WHTReportSource): string {
  return source === "TB"
    ? "Read-only — ตรวจสอบยอดค่าแรงและ WHT โดยไม่ต้องออกจากหน้ารายงาน"
    : "Read-only — ตรวจสอบรายละเอียดและสลิปโดยไม่ต้องออกจากหน้ารายงาน";
}

export function fullPagePreviewHref(
  target: NonNullable<WhtDocumentPreviewTarget>,
): string {
  if (target.source === "TB") {
    return `/purchases/${encodeURIComponent(target.documentId)}`;
  }
  return `/expenses/${target.documentId}`;
}
