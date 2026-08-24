/**
 * Phase 14 — Straight-line Depreciation Engine types.
 * Kept outside `"use server"` modules (Turbopack / type separation).
 */

export type CalculateDepreciationResult = {
  success: boolean;
  error: string | null;
  message: string | null;
  processedCount: number | null;
  totalAmount: number | null;
};
