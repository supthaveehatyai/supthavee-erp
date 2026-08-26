"use client";

/**
 * Phase 14 — Tiered Storage image (next/image).
 * Expects URL already resolved on the Server (Zero Client-Side Fetching).
 */

import { useState } from "react";
import Image from "next/image";
import { HardDrive, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { isHttpUrl } from "@/lib/utils/storage-tier";
import type { StorageTier } from "@/types/storage-tier";

export type TieredStorageImageProps = {
  /** Resolved display URL from resolveStorageDisplayUrl / resolveProductionAttachmentUrls */
  src: string | null | undefined;
  alt: string;
  storageTier?: StorageTier | null;
  /** Offline NAS path label when src is not browsable */
  nasPath?: string | null;
  className?: string;
  /** Fixed box — use with fill */
  fill?: boolean;
  width?: number;
  height?: number;
  sizes?: string;
  /** object-fit */
  objectFit?: "cover" | "contain";
  priority?: boolean;
  showTierBadge?: boolean;
};

export function TieredStorageImage({
  src,
  alt,
  storageTier = "CLOUD",
  nasPath = null,
  className,
  fill = false,
  width,
  height,
  sizes,
  objectFit = "cover",
  priority = false,
  showTierBadge = false,
}: TieredStorageImageProps) {
  const [broken, setBroken] = useState(false);
  const url = (src ?? "").trim();
  const tier = storageTier === "NAS" ? "NAS" : "CLOUD";
  const browsable = Boolean(url && isHttpUrl(url) && !broken);

  if (!browsable) {
    return (
      <div
        className={cn(
          "relative flex flex-col items-center justify-center gap-1.5 bg-slate-100 text-slate-400",
          fill ? "absolute inset-0" : className,
          !fill && className,
        )}
        style={
          !fill && width && height
            ? { width, height }
            : undefined
        }
        title={nasPath ?? undefined}
      >
        {tier === "NAS" ? (
          <>
            <HardDrive className="size-5 text-amber-600/80" aria-hidden />
            <span className="max-w-[90%] truncate px-1 text-center text-[10px] font-semibold text-amber-800">
              เก็บถาวรบน NAS
            </span>
            {nasPath ? (
              <span className="max-w-[90%] truncate px-1 text-center text-[9px] text-slate-500">
                {nasPath}
              </span>
            ) : null}
          </>
        ) : (
          <ImageIcon className="size-5" aria-hidden />
        )}
      </div>
    );
  }

  const fitClass =
    objectFit === "contain" ? "object-contain" : "object-cover";

  // Supabase / http NAS gateway — next/image; unknown hosts use unoptimized
  const needsUnoptimized =
    tier === "NAS" ||
    (!url.includes("supabase.co") && !url.includes("127.0.0.1"));

  return (
    <span
      className={cn(
        "block overflow-hidden",
        fill ? "absolute inset-0" : "relative",
        !fill && className,
      )}
    >
      {fill ? (
        <Image
          src={url}
          alt={alt}
          fill
          sizes={sizes ?? "100vw"}
          className={cn(fitClass, className)}
          priority={priority}
          unoptimized={needsUnoptimized}
          onError={() => setBroken(true)}
        />
      ) : (
        <Image
          src={url}
          alt={alt}
          width={width ?? 80}
          height={height ?? 80}
          sizes={sizes}
          className={cn(fitClass, className)}
          priority={priority}
          unoptimized={needsUnoptimized}
          onError={() => setBroken(true)}
        />
      )}
      {showTierBadge && tier === "NAS" ? (
        <span className="absolute bottom-1 right-1 inline-flex items-center gap-0.5 rounded bg-amber-600/90 px-1 py-0.5 text-[9px] font-bold text-white">
          <HardDrive className="size-2.5" />
          NAS
        </span>
      ) : null}
    </span>
  );
}
