/**
 * Document type constants — Sales / Purchases architecture.
 * Kept outside `"use server"` modules — Next.js only allows async function exports there.
 */

/** Canonical document types (DB enum `public.document_type`). */
export const DOCUMENT_TYPES = [
  // Sales
  "QT",
  "SO",
  "INV_DO",
  "TAX_INV",
  "CS_TAX",
  "ABB",
  "DEP_IN",
  "REC",
  "CN",
  "AR_REFUND",
  "AR_WRITEOFF",
  // Purchases
  "PO",
  "AP_TAX",
  "AP_INV",
  "AP_CASH",
  "DEP_OUT",
  "PAY",
  "AP_REFUND",
  "AP_WRITEOFF",
  // Legacy settlement (readable until fully migrated)
  "REFUND",
  "WRITE_OFF",
  // Technician Billing (documents.doc_type)
  "TB",
  // Inventory — Ledger-driven (Phase 14)
  "STK_OB",
  "STK_ADJ",
  // Legacy (readable until fully migrated)
  "DEP",
  "INT_REC",
] as const;

export const DOCUMENT_STATUSES = [
  "DRAFT",
  "ISSUED",
  "COMPLETED",
  "PAID",
  "CANCELLED",
  "VOID",
] as const;

/** Phase 19 — ช่องทางขาย (documents.sales_channel). NULL บนเอกสารเก่า = ถือเป็น STORE */
export const SALES_CHANNELS = [
  "SHOPEE",
  "LAZADA",
  "TIKTOK",
  "STORE",
  "DIRECT",
] as const;

export type SalesChannelCode = (typeof SALES_CHANNELS)[number];

/** แพลตฟอร์ม E-Commerce ที่ต้องกรอก metadata One-Time Customer */
export const ECOMMERCE_PLATFORM_CHANNELS = [
  "SHOPEE",
  "LAZADA",
  "TIKTOK",
] as const;

export type EcommercePlatformChannel =
  (typeof ECOMMERCE_PLATFORM_CHANNELS)[number];

export const DEFAULT_SALES_CHANNEL: SalesChannelCode = "STORE";

/**
 * Phase 19 — Dummy Contact UUIDs (SAP CPD One-Time Customer)
 * ใช้ตอน `contact_id` ว่าง: แพลตฟอร์ม / ขายเงินสดหน้าร้าน
 */
export const SYSTEM_CONTACTS = {
  CASH_STORE: "6c2459c1-360d-4e55-a2df-6ef6c5c9973d",
  SHOPEE: "4e98486a-9ac6-4f73-b05d-165c93160007",
  LAZADA: "d52576b5-6a1a-41e7-87b4-9c62594f16aa",
} as const;

export type SystemContactKey = keyof typeof SYSTEM_CONTACTS;

export function resolveSystemDummyContactId(
  salesChannel: string | null | undefined,
): string | null {
  if (salesChannel === "SHOPEE") return SYSTEM_CONTACTS.SHOPEE;
  if (salesChannel === "LAZADA") return SYSTEM_CONTACTS.LAZADA;
  if (salesChannel === "STORE") return SYSTEM_CONTACTS.CASH_STORE;
  return null;
}

export const SALES_CHANNEL_LABELS: Record<SalesChannelCode, string> = {
  SHOPEE: "Shopee",
  LAZADA: "Lazada",
  TIKTOK: "TikTok Shop",
  STORE: "หน้าร้าน",
  DIRECT: "ขายตรง / B2B",
};

export function isSalesChannel(
  value: string | null | undefined,
): value is SalesChannelCode {
  return (SALES_CHANNELS as readonly string[]).includes(value ?? "");
}

export function isEcommercePlatformChannel(
  value: string | null | undefined,
): value is EcommercePlatformChannel {
  return (ECOMMERCE_PLATFORM_CHANNELS as readonly string[]).includes(
    value ?? "",
  );
}

/** เอกสารเงินสดหน้าร้านที่ใช้ Dummy Contact (SAP CPD) เมื่อไม่ระบุลูกค้า */
export const WALK_IN_CASH_DOC_TYPES = ["ABB", "CS_TAX"] as const;

export function isWalkInCashDocType(docType: string): boolean {
  return (WALK_IN_CASH_DOC_TYPES as readonly string[]).includes(docType);
}

/**
 * เอกสารที่ใช้บัญชีลูกค้ากลาง (One-Time Customer / CPD)
 * — แพลตฟอร์ม E-Commerce หรือใบเงินสดหน้าร้าน (ABB / CS_TAX)
 */
export function usesOneTimeCustomer(
  docType: string,
  salesChannel: string | null | undefined,
): boolean {
  if (isEcommercePlatformChannel(salesChannel)) return true;
  return isWalkInCashDocType(docType);
}

/** UI: ซ่อนช่องค้นหาลูกค้าเฉพาะช่องทาง E-Commerce */
export function shouldHideSalesContactPicker(input: {
  docType: string;
  salesChannel: string | null | undefined;
}): boolean {
  return isEcommercePlatformChannel(input.salesChannel);
}

/** STORE + ABB/CS_TAX — ช่องลูกค้าไม่บังคับ และแสดงฟิลด์ขาจร */
export function shouldShowWalkInOptionalFields(input: {
  docType: string;
  salesChannel: string | null | undefined;
}): boolean {
  const channel = isSalesChannel(input.salesChannel)
    ? input.salesChannel
    : DEFAULT_SALES_CHANNEL;
  return channel === "STORE" && isWalkInCashDocType(input.docType);
}

/** บังคับเลือกลูกค้าจริง — ไม่ใช่ E-Commerce และไม่ใช่เงินสดหน้าร้าน */
export function isSalesContactRequired(input: {
  docType: string;
  salesChannel: string | null | undefined;
}): boolean {
  if (shouldHideSalesContactPicker(input)) return false;
  if (shouldShowWalkInOptionalFields(input)) return false;
  return true;
}

/** Running-number prefix per type → `{PREFIX}-{YYMM}-{XXXX}`. */
export const DOCUMENT_TYPE_PREFIX = {
  QT: "QT",
  SO: "SO",
  INV_DO: "DO",
  TAX_INV: "INV",
  CS_TAX: "CS",
  ABB: "ABB",
  DEP_IN: "DIN",
  REC: "REC",
  CN: "CN",
  AR_REFUND: "SRF",
  AR_WRITEOFF: "SWO",
  PO: "PO",
  AP_TAX: "APT",
  AP_INV: "API",
  AP_CASH: "APC",
  DEP_OUT: "DOUT",
  PAY: "PAY",
  AP_REFUND: "PRF",
  AP_WRITEOFF: "PWO",
  // Legacy
  REFUND: "RFD",
  WRITE_OFF: "WRO",
  TB: "TB",
  STK_OB: "SOB",
  STK_ADJ: "SAD",
  DEP: "DEP",
  INT_REC: "INT",
} as const;

/** Inventory adjustment documents — post to inventory_ledger only. */
export const INVENTORY_DOC_TYPES = ["STK_OB", "STK_ADJ"] as const;

export type InventoryDocType = (typeof INVENTORY_DOC_TYPES)[number];

/**
 * Sales Document List — strict allow-list.
 */
export const SALES_DOC_TYPES = [
  "QT",
  "SO",
  "INV_DO",
  "TAX_INV",
  "CS_TAX",
  "ABB",
  "DEP_IN",
  "REC",
  "CN",
  "AR_REFUND",
  "AR_WRITEOFF",
] as const;

/**
 * ฟอร์มเปิดบิลขาย (`/sales/create`) — เฉพาะ Trading & Services
 * ห้ามผสมเอกสารการเงิน (DEP_IN, REC, CN, AR_REFUND, …)
 */
export const SALES_TRADING_DOC_TYPES = [
  "QT",
  "SO",
  "INV_DO",
  "TAX_INV",
  "CS_TAX",
  "ABB",
] as const;

export type SalesTradingDocType = (typeof SALES_TRADING_DOC_TYPES)[number];

/** Default ของฟอร์มเปิดบิลขาย */
export const DEFAULT_SALES_CREATE_DOC_TYPE: SalesTradingDocType = "INV_DO";

export function isSalesTradingDocType(
  docType: string,
): docType is SalesTradingDocType {
  return (SALES_TRADING_DOC_TYPES as readonly string[]).includes(docType);
}

/**
 * Purchases Document List — strict allow-list.
 */
export const PURCHASE_DOC_TYPES = [
  "PO",
  "AP_TAX",
  "AP_INV",
  "AP_CASH",
  "DEP_OUT",
  "PAY",
  "AP_REFUND",
  "AP_WRITEOFF",
  "TB",
] as const;

/** AR settlement docs (Sales / DEP_IN). */
export const AR_SETTLEMENT_DOC_TYPES = ["AR_REFUND", "AR_WRITEOFF"] as const;

/** AP settlement docs (Purchases / DEP_OUT). */
export const AP_SETTLEMENT_DOC_TYPES = ["AP_REFUND", "AP_WRITEOFF"] as const;

/** All deposit settlement docs (AR + AP + legacy). */
export const SETTLEMENT_DOC_TYPES = [
  "AR_REFUND",
  "AR_WRITEOFF",
  "AP_REFUND",
  "AP_WRITEOFF",
  "REFUND",
  "WRITE_OFF",
] as const;

export const REFUND_DOC_TYPES = ["AR_REFUND", "AP_REFUND", "REFUND"] as const;

export function isRefundDocType(docType: string): boolean {
  return (REFUND_DOC_TYPES as readonly string[]).includes(docType);
}

/** ชื่อเอกสารภาษาไทยสำหรับ Header / Print Engine */
const DOCUMENT_TYPE_TH_LABELS: Record<string, string> = {
  AR_REFUND: "ใบสำคัญจ่ายเงินคืน (Refund Payment)",
  AP_REFUND: "ใบสำคัญรับเงินคืน (Refund Receipt)",
  AR_WRITEOFF: "ใบสำคัญปรับปรุงบัญชี - รับรู้รายได้ (Write-off Income)",
  AP_WRITEOFF: "ใบสำคัญปรับปรุงบัญชี - ตัดเป็นค่าใช้จ่าย (Write-off Expense)",
  REFUND: "ใบสำคัญคืนเงิน (Refund)",
  WRITE_OFF: "ใบสำคัญตัดเศษ (Write-off)",
};

export function getDocumentTypeLabel(docType: string): string {
  const key = String(docType ?? "").trim();
  return DOCUMENT_TYPE_TH_LABELS[key] ?? key;
}

/**
 * เอกสารการเงินที่ไม่มีรายการสินค้า (ไม่ใช้ `document_items`)
 * ใช้ `document_allocations` หรือเป็นเอกสารหัวอย่างเดียว
 */
export const FINANCE_HEADER_ONLY_DOC_TYPES = [
  "AR_WRITEOFF",
  "AP_WRITEOFF",
  "AR_REFUND",
  "AP_REFUND",
  "DEP_IN",
  "DEP_OUT",
] as const;

export function isFinanceHeaderOnlyDocType(docType: string): boolean {
  return (FINANCE_HEADER_ONLY_DOC_TYPES as readonly string[]).includes(
    docType,
  );
}

/**
 * Smart Goods Receipt / Manual Receipt — vendor bill types only.
 */
export const GOODS_RECEIPT_DOC_TYPES = [
  "AP_TAX",
  "AP_INV",
  "AP_CASH",
] as const;

export type GoodsReceiptDocType = (typeof GOODS_RECEIPT_DOC_TYPES)[number];

/**
 * Doc types that deduct stock on complete (sales outflow).
 */
export const STOCK_OUT_DOC_TYPES = [
  "ABB",
  "INV_DO",
  "TAX_INV",
  "CS_TAX",
] as const;

/**
 * Target types allowed by `convertDocument`.
 * QT → SO (ยืนยันคำสั่งซื้อ จองสต็อก MTO)
 * SO → INV_DO / TAX_INV / CS_TAX / ABB (ออกบิลจริง)
 */
export const QT_CONVERT_TARGETS = ["SO"] as const;
export const SO_CONVERT_TARGETS = [
  "INV_DO",
  "TAX_INV",
  "CS_TAX",
  "ABB",
] as const;

/** Union of all convertible target doc types. */
export const CONVERT_TARGET_DOC_TYPES = [
  ...QT_CONVERT_TARGETS,
  ...SO_CONVERT_TARGETS,
] as const;

/** Source doc types that support conversion. */
export const CONVERTIBLE_SOURCE_DOC_TYPES = ["QT", "SO"] as const;

/** Credit invoices — open AR/AP until paid (Knock-off). */
export const CREDIT_DOC_TYPES = [
  "INV_DO",
  "TAX_INV",
  "AP_TAX",
  "AP_INV",
  "TB",
] as const;

/** Cash / settled-on-issue documents. */
export const CASH_DOC_TYPES = ["CS_TAX", "ABB", "AP_CASH"] as const;

/**
 * Phase 19 — ภาษีขาย (ภ.พ.30 Output Tax)
 * ใบกำกับภาษีขาย / ใบกำกับเงินสด / ใบเสร็จอย่างย่อ
 */
export const OUTPUT_TAX_DOC_TYPES = ["TAX_INV", "CS_TAX", "ABB"] as const;

/** DRAFT ไม่เข้าสมุดภาษี — VOID ยังต้องโชว์แถวแต่ยอดเป็น 0 */
export const OUTPUT_TAX_STATUSES = [
  "ISSUED",
  "PAID",
  "COMPLETED",
  "VOID",
] as const;

/**
 * Phase 19 — ภาษีซื้อ (ภ.พ.30 Input Tax)
 * ใบกำกับภาษีซื้อจากซัพพลายเออร์
 */
export const INPUT_TAX_DOC_TYPES = ["AP_TAX"] as const;

export const INPUT_TAX_STATUSES = ["ISSUED", "PAID"] as const;

export const VAT_LEDGER_REPORT_TYPES = ["OUTPUT_TAX", "INPUT_TAX"] as const;

export type VatLedgerReportType = (typeof VAT_LEDGER_REPORT_TYPES)[number];

export function isVatLedgerReportType(
  value: string,
): value is VatLedgerReportType {
  return (VAT_LEDGER_REPORT_TYPES as readonly string[]).includes(value);
}

/**
 * Report Center — ภาษีซื้อ/ขาย + ทะเบียนเอกสาร
 * INV_DO = ใบส่งของ, EXP = ค่าใช้จ่าย (ตาราง expenses), PAY = ใบสำคัญจ่าย (documents)
 */
export const DOCUMENT_REGISTER_REPORT_TYPES = [
  "INV_DO",
  "EXP",
  "PAY",
] as const;

export type DocumentRegisterReportType =
  (typeof DOCUMENT_REGISTER_REPORT_TYPES)[number];

export const FINANCE_REPORT_TYPES = [
  ...VAT_LEDGER_REPORT_TYPES,
  ...DOCUMENT_REGISTER_REPORT_TYPES,
] as const;

export type FinanceReportType = (typeof FINANCE_REPORT_TYPES)[number];

export const FINANCE_REPORT_TYPE_OPTIONS: ReadonlyArray<{
  value: FinanceReportType;
  label: string;
}> = [
  { value: "OUTPUT_TAX", label: "ภาษีขาย" },
  { value: "INPUT_TAX", label: "ภาษีซื้อ" },
  { value: "INV_DO", label: "ทะเบียนใบส่งของ (INV_DO)" },
  { value: "EXP", label: "ทะเบียนค่าใช้จ่าย (EXP)" },
  { value: "PAY", label: "ทะเบียนใบสำคัญจ่าย (PAY)" },
];

export const DOCUMENT_REGISTER_STATUSES = [
  "ISSUED",
  "PAID",
  "COMPLETED",
  "VOID",
] as const;

/** ค่าใช้จ่ายที่ออกเอกสารแล้ว — ไม่ดึง DRAFT / PENDING */
export const EXPENSE_REGISTER_STATUSES = ["ISSUED", "PAID", "VOID"] as const;

export const DOCUMENT_STATUS_TH_LABELS: Record<string, string> = {
  DRAFT: "ร่าง",
  PENDING: "รออนุมัติ",
  ISSUED: "ออกเอกสาร",
  PAID: "ชำระแล้ว",
  COMPLETED: "เสร็จสิ้น",
  VOID: "ยกเลิก",
  CANCELLED: "ยกเลิก",
};

export function isDocumentRegisterReportType(
  value: string,
): value is DocumentRegisterReportType {
  return (DOCUMENT_REGISTER_REPORT_TYPES as readonly string[]).includes(value);
}

export function isFinanceReportType(value: string): value is FinanceReportType {
  return (FINANCE_REPORT_TYPES as readonly string[]).includes(value);
}

export function getDocumentStatusLabel(status: string): string {
  const key = String(status ?? "").trim().toUpperCase();
  return DOCUMENT_STATUS_TH_LABELS[key] ?? (key || "—");
}

/** Sales AR invoice types (customer receivables). */
export const AR_INVOICE_DOC_TYPES = ["INV_DO", "TAX_INV"] as const;

/**
 * บิลขายที่ตัดหนี้ด้วยเงิน/มัดจำได้บนหน้า REC
 * (BN ดึงแยกผ่าน billing notes — ไม่ปนในรายการบิลค้าง)
 */
export const AR_REC_INVOICE_DOC_TYPES = [
  "INV_DO",
  "TAX_INV",
  "CS_TAX",
] as const;

/**
 * บิลขายที่อนุญาตให้ตัดหนี้สูญ (AR Write-off)
 * BN อยู่ที่ `doc_headers` — ใช้เป็นตัวกรองบิล ไม่ใช่เป้าหมาย allocation
 */
export const AR_WRITEOFF_SOURCE_DOC_TYPES = AR_REC_INVOICE_DOC_TYPES;

export function isArWriteoffSourceDocType(docType: string): boolean {
  return (AR_WRITEOFF_SOURCE_DOC_TYPES as readonly string[]).includes(docType);
}

/**
 * Open items บนฟอร์มสร้างใบเสร็จรับเงิน (REC):
 * บิลค้างชำระ + ใบลดหนี้ (CN) ที่ยังใช้ไม่หมด
 * ยอดคงเหลือคำนวณเป็นบวกเสมอ (ห้ามคูณ -1 ที่ DB)
 */
export const AR_OUTSTANDING_DOC_TYPES = [
  ...AR_REC_INVOICE_DOC_TYPES,
  "CN",
] as const;

/**
 * บิลขายต้นทางที่อนุญาตให้ออกใบลดหนี้ (CN) — ห้ามเปิด CN ลอย
 * ครอบคลุมทั้งเครดิต (INV_DO/TAX_INV) และเงินสด (CS_TAX/ABB)
 */
export const CREDIT_NOTE_SOURCE_DOC_TYPES = [
  "INV_DO",
  "TAX_INV",
  "CS_TAX",
  "ABB",
] as const;

export type CreditNoteSourceDocType =
  (typeof CREDIT_NOTE_SOURCE_DOC_TYPES)[number];

export const CREDIT_NOTE_SOURCE_STATUSES = [
  "ISSUED",
  "COMPLETED",
  "PAID",
] as const;

/**
 * AP payables eligible for PAY knock-off.
 * AP_TAX / AP_INV = บิลตั้งหนี้ซัพพลายเออร์ · TB = สรุปวางบิลช่าง (Technician Bill).
 * BR อยู่ที่ `doc_headers` (ใบรับวางบิล) ไม่ใช่เอกสารตั้งหนี้ใน `documents`.
 */
export const AP_PAYABLE_DOC_TYPES = ["AP_TAX", "AP_INV", "TB"] as const;

/**
 * บิลซื้อที่อนุญาตให้ตัดหนี้สูญ / ตัดเศษบัญชี (AP Write-off)
 * BR อยู่ที่ `doc_headers` — ใช้เป็นตัวกรองบิล ไม่ใช่เป้าหมาย allocation
 * ไม่รวม TB (สรุปวางบิลช่าง) — ตัดหนี้สูญเฉพาะบิลตั้งหนี้ซื้อ
 */
export const AP_WRITEOFF_SOURCE_DOC_TYPES = [
  "AP_INV",
  "AP_TAX",
  "AP_CASH",
] as const;

export function isApWriteoffSourceDocType(docType: string): boolean {
  return (AP_WRITEOFF_SOURCE_DOC_TYPES as readonly string[]).includes(docType);
}

export type FinancePaymentStatus = "UNPAID" | "PARTIAL" | "PAID";

/**
 * Initial `payment_status` for a document type.
 * Credit → UNPAID; Cash → PAID; others (QT/SO/PO/…) → UNPAID by default.
 */
export function resolveInitialPaymentStatus(
  docType: string,
): FinancePaymentStatus {
  if ((CASH_DOC_TYPES as readonly string[]).includes(docType)) {
    return "PAID";
  }
  if ((CREDIT_DOC_TYPES as readonly string[]).includes(docType)) {
    return "UNPAID";
  }
  // QT / SO / PO / DEP_* / REC / CN / PAY — no open trade receivable by default
  if (docType === "REC" || docType === "PAY") return "PAID";
  if ((INVENTORY_DOC_TYPES as readonly string[]).includes(docType)) return "PAID";
  return "UNPAID";
}

/**
 * Lifecycle status after issue/save:
 * - QT only → COMPLETED (convertible quotation)
 * - Accounting docs → ISSUED
 */
export function resolveIssuedDocumentStatus(
  docType: string,
): "ISSUED" | "COMPLETED" {
  if (docType === "QT") return "COMPLETED";
  if ((INVENTORY_DOC_TYPES as readonly string[]).includes(docType)) {
    return "COMPLETED";
  }
  return "ISSUED";
}
