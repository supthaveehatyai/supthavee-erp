"use client";

import { useState } from "react";
import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type LineItemProductThumbProps = {
  imageUrl?: string | null;
  alt?: string;
  className?: string;
  /** Tailwind size — default w-10 h-10 */
  size?: "sm" | "md";
};

/**
 * Phase 11 Visual Verification — thumbnail ใน Search Dropdown / ตาราง Line Items
 * ใช้ `<img>` (ยังไม่ตั้ง remotePatterns ของ next/image สำหรับ Storage)
 */
export function LineItemProductThumb({
  imageUrl,
  alt = "รูปสินค้า",
  className,
  size = "sm",
}: LineItemProductThumbProps) {
  const [broken, setBroken] = useState(false);
  const src = (imageUrl ?? "").trim().split("?")[0];
  const box = size === "md" ? "h-12 w-12" : "h-10 w-10";

  if (!src || broken) {
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-300",
          box,
          className,
        )}
        aria-hidden
      >
        <ImageIcon className={size === "md" ? "size-5" : "size-4"} />
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- Storage URL; no next/image remotePatterns yet
    <img
      src={src}
      alt={alt}
      className={cn("shrink-0 rounded-md object-cover", box, className)}
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}
