"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FNB_BRAND_THEME, type FnbBrandCode } from "@/types/fnb";

export function FnbBrandBar({ isSuperAdmin, brand }: { isSuperAdmin: boolean; brand: FnbBrandCode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  if (!isSuperAdmin) return null;
  function choose(next: FnbBrandCode) {
    const query = new URLSearchParams(params.toString());
    query.set("brand", next);
    router.replace(`${pathname}?${query.toString()}`);
  }
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => choose("LUCKY_CUP")} className={`rounded-full px-4 py-2 text-sm font-semibold ${brand === "LUCKY_CUP" ? "bg-[#DC2626] text-white" : "border border-[#DC2626] bg-white text-[#DC2626]"}`}>{FNB_BRAND_THEME.LUCKY_CUP.badge}</button>
      <button type="button" onClick={() => choose("CHATORN")} className={`rounded-full px-4 py-2 text-sm font-semibold ${brand === "CHATORN" ? "bg-[#6B0F1A] text-white hover:bg-[#520B13]" : "border border-[#6B0F1A] bg-white text-[#6B0F1A]"}`}>{FNB_BRAND_THEME.CHATORN.badge}</button>
    </div>
  );
}
