import type { ContactBankCategory } from "@/types/contact-bank-account";

export const VENDOR_BANK_OPTIONS = [
  { code: "KBANK", name: "กสิกรไทย" },
  { code: "KTB", name: "กรุงไทย" },
  { code: "SCB", name: "ไทยพาณิชย์" },
  { code: "BBL", name: "กรุงเทพ" },
  { code: "BAY", name: "กรุงศรีอยุธยา" },
  { code: "TTB", name: "ทหารไทยธนชาต" },
  { code: "GSB", name: "ออมสิน" },
  { code: "BAAC", name: "ธ.ก.ส." },
  { code: "UOB", name: "ยูโอบี" },
  { code: "CIMB", name: "ซีไอเอ็มบีไทย" },
  { code: "LHBANK", name: "แลนด์ แอนด์ เฮ้าส์" },
  { code: "KKP", name: "เกียรตินาคินภัทร" },
  { code: "TISCO", name: "ทิสโก้" },
  { code: "PROMPTPAY", name: "พร้อมเพย์" },
] as const;

export function vendorBankName(code: string): string {
  return VENDOR_BANK_OPTIONS.find((bank) => bank.code === code)?.name ?? code;
}

export function accountDigits(accountNo: string): string {
  const digits = accountNo.replace(/\D/g, "");
  return digits || accountNo.trim();
}

export function contactBankCategoryMeta(category: string): {
  label: string;
  className: string;
} {
  if (category === "CORPORATE_TAX") {
    return {
      label: "🏢 บัญชีบริษัท (ออกใบกำกับภาษี / มี VAT)",
      className: "bg-blue-50 text-blue-800 ring-emerald-200",
    };
  }
  if (category === "PERSONAL_NON_TAX") {
    return {
      label: "👤 บัญชีบุคคลธรรมดา (ไม่ออกใบกำกับภาษี / โอนส่วนตัว)",
      className: "bg-orange-50 text-purple-800 ring-orange-200",
    };
  }
  if (category === "PROMPTPAY") {
    return {
      label: "📲 พร้อมเพย์ (PromptPay)",
      className: "bg-sky-50 text-sky-800 ring-sky-200",
    };
  }
  return {
    label: "บัญชีอื่น",
    className: "bg-slate-50 text-slate-700 ring-slate-200",
  };
}

export function isContactBankCategory(value: string): value is ContactBankCategory {
  return (
    value === "CORPORATE_TAX" ||
    value === "PERSONAL_NON_TAX" ||
    value === "PROMPTPAY" ||
    value === "OTHER"
  );
}
