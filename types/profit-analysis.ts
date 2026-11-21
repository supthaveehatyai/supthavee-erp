/**
 * Phase 12 — Profit Analysis types.
 * Do NOT put these in `"use server"` files.
 */

export type ProfitMonthKpi = {
  /** YYYY-MM */
  profitMonth: string;
  /** รายได้สุทธิก่อน VAT จาก RPC เดียวกับ Executive Dashboard */
  revenue: number;
  platformFees: number;
  /** ต้นทุนเสื้อสำเร็จรูปซื้อมาขายไป ก่อน VAT */
  garmentCogs: number;
  productCogs: number;
  /** วัตถุดิบผลิตเอง BOM และเบิกหน้างาน */
  bomMaterialCogs: number;
  /** วัสดุสิ้นเปลืองโรงงานสุทธิหลังหัก AP_CN */
  consumablesCogs: number;
  /** ค่าแรงงานบริการ สกรีน / ปัก / บล็อก */
  serviceLaborCost: number;
  wageCogs: number;
  cogs: number;
  grossProfit: number;
  opex: number;
  netProfit: number;
};

export type SalesProfitRow = {
  documentId: string;
  documentNumber: string;
  documentDate: string;
  docType: string;
  contactName: string;
  revenue: number;
  productCogs: number;
  wageCogs: number;
  /** productCogs + wageCogs */
  cogs: number;
  grossProfit: number;
  /** Gross Profit / Revenue × 100 — null when revenue is 0 */
  gpMarginPercent: number | null;
};

export type ProfitAnalysisDashboardResult = {
  success: true;
  month: string;
  kpi: ProfitMonthKpi;
  rows: SalesProfitRow[];
} | {
  success: false;
  month: string;
  error: string;
};
