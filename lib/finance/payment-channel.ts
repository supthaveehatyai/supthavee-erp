export const PAYMENT_CHANNELS = ["COMPANY_BANK", "CASH", "OTHER_BANK"] as const;

export type PaymentChannel = (typeof PAYMENT_CHANNELS)[number];

export const COMPANY_BANK_LABEL = "โอนเข้าบัญชีบริษัท (KTB x-6510)";
export const CASH_RECEIPT_LABEL = "เงินสดหน้าร้าน";
export const OTHER_BANK_LABEL = "โอนเข้าบัญชีอื่น (รอโอนเข้าบริษัท)";

export const RECEIPT_REGISTER_DOC_TYPES = [
  "DEP_IN",
  "CS_TAX",
  "ABB",
  "TAX_INV",
  "INV_DO",
] as const;

export function isPaymentChannel(
  value: string | null | undefined,
): value is PaymentChannel {
  return (PAYMENT_CHANNELS as readonly string[]).includes(
    String(value ?? "").trim(),
  );
}

export function paymentChannelLabel(
  channel: string | null | undefined,
  otherBankName?: string | null,
): string {
  if (channel === "COMPANY_BANK") return COMPANY_BANK_LABEL;
  if (channel === "CASH") return CASH_RECEIPT_LABEL;
  if (channel === "OTHER_BANK") {
    const name = String(otherBankName ?? "").trim();
    return name ? `โอนเข้าบัญชีอื่น (${name})` : OTHER_BANK_LABEL;
  }
  return "—";
}

export function otherBankNameFromLabel(
  label: string | null | undefined,
): string {
  const text = String(label ?? "").trim();
  if (!text || text === OTHER_BANK_LABEL || text === COMPANY_BANK_LABEL) return "";
  const wrapped = text.match(/^โอนเข้าบัญชีอื่น \((.+)\)$/);
  if (wrapped && wrapped[1] !== "รอโอนเข้าบริษัท") return wrapped[1];
  if (text.startsWith("โอนเข้าบัญชี")) return "";
  return text;
}

export function receiptMethodText(input: {
  payment_channel?: string | null;
  receiving_bank_label?: string | null;
  is_swept_to_company?: boolean | null;
}): string {
  const channel = String(input.payment_channel ?? "").trim();
  const stored = String(input.receiving_bank_label ?? "").trim();
  if (channel === "COMPANY_BANK") return `🏦 ${stored || COMPANY_BANK_LABEL}`;
  if (channel === "CASH") {
    return input.is_swept_to_company
      ? "💵 เงินสดหน้าร้าน (โอนเข้าบริษัทแล้ว)"
      : "💵 เงินสดหน้าร้าน (รอโอนเข้าบริษัท)";
  }
  if (channel === "OTHER_BANK") {
    if (stored && !stored.startsWith("โอนเข้าบัญชีอื่น")) {
      return `📱 โอนเข้าบัญชีอื่น (${stored})`;
    }
    return `📱 ${stored || OTHER_BANK_LABEL}`;
  }
  return stored;
}

export function isSweptOnReceipt(channel: PaymentChannel): boolean {
  return channel === "COMPANY_BANK";
}

export type UnsweptReceiptRow = {
  id: string;
  doc_no: string;
  doc_date: string;
  doc_type: string;
  contact_name: string;
  payment_channel: "CASH" | "OTHER_BANK";
  amount: number;
  receiving_bank_label: string | null;
};

export type SlipPayeeHint = {
  channel: "COMPANY_BANK" | "OTHER_BANK";
  otherBankName: string;
  notice: string;
};

/** ถ้าสลิประบุบัญชีบริษัท ให้เลือกบริษัท ถ้าเป็นชื่อบัญชีอื่นให้สลับเป็นบัญชีอื่น */
export function classifySlipPayee(
  payeeName: string | null | undefined,
  payeeAccount: string | null | undefined,
): SlipPayeeHint | null {
  const name = String(payeeName ?? "").trim();
  const account = String(payeeAccount ?? "").replace(/\s+/g, "");
  const digits = account.replace(/\D/g, "");
  const isCompany =
    name.includes("ทรัพย์ทวี") ||
    account.includes("6510") ||
    digits.includes("6510");
  if (isCompany) {
    return {
      channel: "COMPANY_BANK",
      otherBankName: "",
      notice: "ตรวจพบสลิปเข้าบัญชีบริษัท (KTB x-6510) — เลือกช่องทางนี้ให้อัตโนมัติ",
    };
  }
  if (name) {
    return {
      channel: "OTHER_BANK",
      otherBankName: name.slice(0, 80),
      notice: `ตรวจพบสลิปเข้าบัญชีอื่น (${name}) — สลับเป็นรอโอนเข้าบริษัท`,
    };
  }
  return null;
}
