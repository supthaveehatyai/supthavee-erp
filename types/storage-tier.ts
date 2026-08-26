/**
 * Phase 14 — Tiered Storage display types (safe for Client + Server).
 */

import type { Database } from "@/src/types/supabase";

export type StorageTier =
  Database["public"]["Enums"]["storage_tier_type"];

export type ResolveStorageDisplayInput = {
  storageTier?: StorageTier | null;
  /** Supabase Storage public URL (hot) */
  cloudUrl?: string | null;
  /** NAS path or HTTP URL when archived (cold) */
  nasArchiveUrl?: string | null;
};

export type ResolvedStorageDisplay = {
  /** URL suitable for <Image> / <img> when browsable; null if offline NAS path */
  url: string | null;
  tier: StorageTier;
  /** true when url is http(s) and can render in browser */
  isBrowsable: boolean;
  /** Raw NAS path for admin/offline label when not browsable */
  nasPath: string | null;
};
