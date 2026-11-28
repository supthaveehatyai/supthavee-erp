import type { FnbBrandCode } from "@/types/fnb";

export function listedBranch(branches: { branch_code: string }[], requested: string | undefined): string {
  if (requested && branches.some((item) => item.branch_code === requested)) return requested;
  return branches[0]?.branch_code ?? "";
}

export function preferredBranchCode(brand: FnbBrandCode): string {
  return brand === "CHATORN" ? "CT-KLN" : "LC-HDY";
}

export function branchForBrand<T extends { branch_code: string; brand_code?: string }>(
  branches: T[],
  brand: FnbBrandCode,
  current: string,
): string {
  const row = branches.find((item) => item.branch_code === current);
  if (row && (row.brand_code == null || row.brand_code === brand)) return current;
  return branches.find((item) => item.branch_code === preferredBranchCode(brand))?.branch_code
    ?? branches.find((item) => item.brand_code === brand)?.branch_code
    ?? branches[0]?.branch_code
    ?? "";
}
