/**
 * Phase 11 — Shared A4 print document types (TFRS / company SSOT).
 */

import type { ReactNode } from "react";

/** ข้อมูลบริษัทสำหรับหัวเอกสาร — ค่าจริงมาจาก system_settings */
export type PrintCompanyProfile = {
  companyName: string;
  companyNameEn: string;
  branchCode: string;
  branchName: string;
  address: string;
  taxId: string;
  phone: string;
  email: string;
  logoUrl: string;
};

export type PrintCustomerData = {
  company_name?: string | null;
  tax_id?: string | null;
  branch_code?: string | null;
  branch_name?: string | null;
  address?: string | null;
  phone?: string | null;
  /** Optional — omit / empty when party has no email (conditional print) */
  email?: string | null;
};

export type DocumentPrintHeaderProps = {
  /** ชื่อประเภทเอกสาร เช่น ใบกำกับภาษี / ใบส่งของ */
  title: string;
  documentNo: string;
  /** วันที่เอกสาร (แสดงตามที่ส่งมา หรือ ISO ที่ component จะ format) */
  date: string;
  customerData?: PrintCustomerData | null;
  dueDate?: string | null;
  /** ค่าเริ่มต้น: ลูกค้า / Customer */
  partyLabel?: string;
  status?: string | null;
  referenceNo?: string | null;
  /** รหัสประเภทเอกสาร เช่น AP_TAX — แสดงในกล่องมุมขวา */
  docType?: string | null;
  /** บรรทัดภาษาอังกฤษใต้ชื่อเอกสาร เช่น (GOODS RECEIPT & AP VOUCHER) */
  titleSubtitle?: string | null;
  /** `goods-receipt` จัดหัวเอกสารกระชับสำหรับ A4/A5 */
  headerVariant?: "default" | "goods-receipt";
  /** ขนาดกระดาษที่กำลังแสดง — ใช้จัดหัวบริษัทให้พอดี A5 แนวตั้ง */
  paperSize?: PrintPaperSize;
};

export type DocumentPrintFooterProps = {
  preparedLabel?: string;
  receivedLabel?: string;
  approvedLabel?: string;
  className?: string;
  /** ลดความสูงช่องเซ็น เพื่อให้ฟอร์มอยู่ในหน้าเดียว */
  compact?: boolean;
};

/** ขนาดกระดาษสำหรับ PrintLayout / @page */
export type PrintPaperSize = "A4" | "A5-Portrait" | "A5-Landscape";

/** ประเภท VAT สำหรับสรุปยอดพิมพ์ (TFRS) */
export type PrintVatType = "NONE" | "INCLUSIVE" | "EXCLUSIVE";

export type DocumentPrintSummaryProps = {
  /** ยอดรวม (Σ line_net_amount + freight_cost) ก่อนหักส่วนลดท้ายบิล */
  subtotal: number;
  /** ค่าขนส่งต้นทาง — แสดงแยกบรรทัดเมื่อ > 0 */
  freightCost?: number | null;
  /** ส่วนลดท้ายบิล (บาท) */
  discountAmount: number;
  vatType: PrintVatType;
  /** อัตรา VAT เป็นเปอร์เซ็นต์ เช่น 7 */
  vatRate: number;
  /**
   * เมื่อส่งมา ใช้ยอด VAT นี้แทนการคำนวณซ้ำ
   * (เช่น ผู้ใช้แก้ VAT Amount ใน Goods Receipt)
   */
  vatAmount?: number | null;
  /** ทับข้อความบรรทัด VAT เช่น "ภาษีมูลค่าเพิ่ม 7% (Excluded)" */
  vatLabel?: string | null;
  /** ยอดสุทธิที่แสดงบนเอกสาร */
  grandTotal: number;
  /** ภาษีหัก ณ ที่จ่าย (เอกสารจ่าย / ถ้ามี) */
  withholdingTaxAmount?: number | null;
  /** ข้อความส่วนลด เช่น "10%" — แสดงประกอบบรรทัดส่วนลด */
  discountText?: string | null;
  className?: string;
  /**
   * เมื่อเป็น AR_REFUND / AP_REFUND ให้ถอดฐานภาษีจากยอดสุทธิ (Grand)
   * ตาม vat_type / vat_rate ที่สืบทอดจากมัดจำต้นทาง
   */
  docType?: string | null;
  /** ซ่อนตัวอักษรไทยใต้ยอด เมื่อหน้าเอกสารแสดงไว้ฝั่งซ้ายแล้ว */
  hideBahtText?: boolean;
  /** แสดงส่วนลดและ VAT แม้ยอดเป็น 0 */
  showEmptyRows?: boolean;
};

export type PrintLayoutProps = {
  title: string;
  documentNo: string;
  date: string;
  customerData?: PrintCustomerData | null;
  dueDate?: string | null;
  partyLabel?: string;
  status?: string | null;
  referenceNo?: string | null;
  docType?: string | null;
  titleSubtitle?: string | null;
  headerVariant?: "default" | "goods-receipt";
  /** ไม่ล็อกขนาดกระดาษ เพื่อให้ผู้ใช้เลือก A4 หรือ A5 ในหน้าต่างพิมพ์ */
  respectPrinterPaper?: boolean;
  children: ReactNode;
  /** สรุปยอด — ถูกดันไปชิดล่างคู่กับช่องลายเซ็น */
  bottom?: ReactNode;
  footer?: DocumentPrintFooterProps;
  className?: string;
  /** DOM id สำหรับ @media print — default erp-print-document */
  documentId?: string;
  /** ขนาดกระดาษ — default A4 */
  paperSize?: PrintPaperSize;
};
