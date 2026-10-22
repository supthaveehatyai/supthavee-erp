const VENDOR_DOC_TYPES = new Set([
  "PO",
  "AP_TAX",
  "AP_INV",
  "AP_CASH",
  "PAY",
  "DEP_OUT",
  "AP_REFUND",
  "AP_WRITEOFF",
  "TB",
  "BR",
]);

const HEADINGS: Record<string, { title: string; subtitle: string }> = {
  QT: { title: "ใบเสนอราคา", subtitle: "(QUOTATION)" },
  SO: { title: "ใบสั่งขาย", subtitle: "(SALES ORDER)" },
  INV_DO: { title: "ใบส่งของ / แจ้งหนี้", subtitle: "(DELIVERY ORDER & INVOICE)" },
  TAX_INV: { title: "ใบกำกับภาษี", subtitle: "(TAX INVOICE)" },
  CS_TAX: { title: "ใบกำกับเงินสด", subtitle: "(CASH TAX INVOICE)" },
  ABB: { title: "ใบเสร็จอย่างย่อ", subtitle: "(ABBREVIATED TAX INVOICE)" },
  DEP_IN: { title: "ใบมัดจำรับ", subtitle: "(CUSTOMER DEPOSIT)" },
  BN: { title: "ใบวางบิล", subtitle: "(BILLING NOTE)" },
  BR: { title: "ใบรับวางบิล", subtitle: "(BILL RECEIPT)" },
  REC: { title: "ใบเสร็จรับเงิน", subtitle: "(OFFICIAL RECEIPT)" },
  CN: { title: "ใบลดหนี้", subtitle: "(CREDIT NOTE)" },
  PO: { title: "ใบสั่งซื้อ", subtitle: "(PURCHASE ORDER)" },
  AP_TAX: {
    title: "ใบรับสินค้า / ใบสำคัญตั้งหนี้การค้า",
    subtitle: "(GOODS RECEIPT & AP VOUCHER)",
  },
  AP_INV: {
    title: "ใบรับสินค้า / ใบสำคัญตั้งหนี้การค้า",
    subtitle: "(GOODS RECEIPT & AP VOUCHER)",
  },
  AP_CASH: { title: "บิลเงินสดซื้อ", subtitle: "(CASH PURCHASE)" },
  PAY: { title: "ใบจ่ายชำระ", subtitle: "(PAYMENT VOUCHER)" },
  DEP_OUT: { title: "ใบมัดจำจ่าย", subtitle: "(SUPPLIER DEPOSIT)" },
};

export function documentPrintHeading(docType: string): {
  title: string;
  subtitle: string;
} {
  const code = docType.trim().toUpperCase();
  return HEADINGS[code] ?? { title: code || "เอกสาร", subtitle: "(DOCUMENT)" };
}

export function documentPartyLabel(docType: string): string {
  return VENDOR_DOC_TYPES.has(docType.trim().toUpperCase())
    ? "ผู้จำหน่าย / VENDOR"
    : "ลูกค้า / CUSTOMER";
}
