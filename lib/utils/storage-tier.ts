/**
 * Phase 14 — Resolve display URL from storage_tier (CLOUD | NAS).
 * Pure helper — call from Server Actions / Server Components (Zero Client Fetch).
 */

import type {
  ResolveStorageDisplayInput,
  ResolvedStorageDisplay,
  StorageTier,
} from "@/types/storage-tier";

export function isHttpUrl(value: string | null | undefined): boolean {
  const v = (value ?? "").trim();
  return /^https?:\/\//i.test(v);
}

function normalizeTier(value: StorageTier | null | undefined): StorageTier {
  return value === "NAS" ? "NAS" : "CLOUD";
}

/**
 * Single-file resolve: CLOUD → cloudUrl, NAS → nasArchiveUrl (if http(s)).
 */
export function resolveStorageDisplayUrl(
  input: ResolveStorageDisplayInput,
): ResolvedStorageDisplay {
  const tier = normalizeTier(input.storageTier);
  const cloud = (input.cloudUrl ?? "").trim() || null;
  const nas = (input.nasArchiveUrl ?? "").trim() || null;

  if (tier === "NAS") {
    if (nas && isHttpUrl(nas)) {
      return { url: nas, tier, isBrowsable: true, nasPath: nas };
    }
    return { url: null, tier, isBrowsable: false, nasPath: nas };
  }

  return {
    url: cloud,
    tier: "CLOUD",
    isBrowsable: Boolean(cloud && isHttpUrl(cloud)),
    nasPath: null,
  };
}

/**
 * Production mockups: CLOUD uses attachment_paths[]; NAS uses nas_archive_url
 * (supports comma / newline separated list for multi-file archives).
 */
export function resolveProductionAttachmentUrls(input: {
  storageTier?: StorageTier | null;
  attachmentPaths?: string[] | null;
  nasArchiveUrl?: string | null;
}): string[] {
  const tier = normalizeTier(input.storageTier);

  if (tier === "NAS") {
    const raw = (input.nasArchiveUrl ?? "").trim();
    if (!raw) return [];
    return raw
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  return (input.attachmentPaths ?? []).map((s) => String(s).trim()).filter(Boolean);
}
