/**
 * Phase 11 — Shared A4 print document types (TFRS / company SSOT).
 */

import type { ReactNode } from "react";

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
};

export type DocumentPrintFooterProps = {
  preparedLabel?: string;
  receivedLabel?: string;
  approvedLabel?: string;
  className?: string;
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
  /** ยอดสุทธิที่แสดงบนเอกสาร */
  grandTotal: number;
  /** ภาษีหัก ณ ที่จ่าย (เอกสารจ่าย / ถ้ามี) */
  withholdingTaxAmount?: number | null;
  /** ข้อความส่วนลด เช่น "10%" — แสดงประกอบบรรทัดส่วนลด */
  discountText?: string | null;
  className?: string;
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
  children: ReactNode;
  footer?: DocumentPrintFooterProps;
  className?: string;
  /** DOM id สำหรับ @media print — default erp-print-document */
  documentId?: string;
  /** ขนาดกระดาษ — default A4 */
  paperSize?: PrintPaperSize;
};
