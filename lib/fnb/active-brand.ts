import type { FnbBrandCode } from "@/types/fnb";

export function resolveActiveBrand(isSuperAdmin: boolean, assignedBrand: string | null | undefined, requested: string | null | undefined): FnbBrandCode {
  if (!isSuperAdmin) return assignedBrand === "CHATORN" ? "CHATORN" : "LUCKY_CUP";
  return requested === "CHATORN" ? "CHATORN" : "LUCKY_CUP";
}

export function fnbToneClass(brand: FnbBrandCode): string {
  return brand === "CHATORN" ? "fnb-chatorn" : "fnb-lucky";
}
