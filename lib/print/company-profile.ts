import type { PrintCompanyProfile } from "@/types/print-document";

const FALLBACK: PrintCompanyProfile = {
  companyName: "บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด",
  companyNameEn: "Supthavee Hatyai Co., Ltd.",
  branchCode: "00000",
  branchName: "สำนักงานใหญ่",
  address: "234-235 ถนนเพชรเกษม ตำบลหาดใหญ่ อำเภอหาดใหญ่ จังหวัดสงขลา 90110",
  taxId: "090556400052",
  phone: "0864808693",
  email: "supthaveehatyai@gmail.com",
  logoUrl: "",
};

export function toPrintCompanyProfile(
  settings: {
    company_name?: string | null;
    company_name_en?: string | null;
    branch_code?: string | null;
    branch_name?: string | null;
    address?: string | null;
    tax_id?: string | null;
    phone?: string | null;
    email?: string | null;
    logo_url?: string | null;
  } | null
  | undefined,
): PrintCompanyProfile {
  return {
    companyName: settings?.company_name?.trim() || FALLBACK.companyName,
    companyNameEn: settings?.company_name_en?.trim() || FALLBACK.companyNameEn,
    branchCode: settings?.branch_code?.trim() || FALLBACK.branchCode,
    branchName: settings?.branch_name?.trim() || FALLBACK.branchName,
    address: (settings?.address ?? "").replace(/\s+/g, " ").trim() || FALLBACK.address,
    taxId: (settings?.tax_id ?? "").replace(/\D/g, "") || FALLBACK.taxId,
    phone: settings?.phone?.trim() || FALLBACK.phone,
    email: settings?.email?.trim() || FALLBACK.email,
    logoUrl: settings?.logo_url?.trim().split("?")[0] || "",
  };
}
