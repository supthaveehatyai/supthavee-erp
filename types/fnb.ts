export const FNB_BRAND_SCOPES = ["ALL", "LUCKY_CUP", "CHATORN"] as const;
export const FNB_ITEM_CATEGORIES = [
  "RAW_MATERIAL",
  "PACKAGING",
  "BAKERY_FROZEN",
  "ICE_CREAM",
  "MERCHANDISE",
  "CLEANING_SUPPLY",
  "EQUIPMENT_CAPEX",
] as const;
export const FNB_VAT_MODES = ["EX_VAT", "INC_VAT", "EXEMPT"] as const;
export const FNB_RECIPE_UOMS = ["g", "ml", "pcs"] as const;
export const FNB_FRONT_GROUPS = ["BAKERY_CAKE", "ICE_CREAM_FRESH", "MERCHANDISE"] as const;
export const FNB_SHIFT_TYPES = ["MORNING", "AFTERNOON", "FULL_DAY"] as const;
export const FNB_ENTRY_MODES = ["POS_SLIP", "QUICK_SUMMARY", "EXCEL_IMPORT"] as const;
export const FNB_REIMB_MODES = ["STAFF_ADVANCE_REIMBURSE", "HQ_DIRECT_PAY", "SEVEN_ELEVEN_DEPOSIT_FEE"] as const;
export const FNB_DOC_TAX_STATUSES = [
  "PENDING_HQ_MATCH",
  "TAX_INVOICE_READY",
  "WAITING_TAX_INVOICE",
  "NON_TAX_RECEIPT",
] as const;

export const FNB_CATEGORY_LABEL: Record<(typeof FNB_ITEM_CATEGORIES)[number], string> = {
  RAW_MATERIAL: "วัตถุดิบ",
  PACKAGING: "บรรจุภัณฑ์",
  BAKERY_FROZEN: "เบเกอรี่แช่แข็ง",
  ICE_CREAM: "ไอศกรีม",
  MERCHANDISE: "ของพรีเมียม",
  CLEANING_SUPPLY: "ของใช้ทำความสะอาด",
  EQUIPMENT_CAPEX: "อุปกรณ์",
};

export const FNB_FRONT_GROUP_LABEL: Record<(typeof FNB_FRONT_GROUPS)[number], string> = {
  BAKERY_CAKE: "เบเกอรี่และเค้ก",
  ICE_CREAM_FRESH: "ไอศกรีมและของสด",
  MERCHANDISE: "ของพรีเมียม Lucky",
};

export const FNB_SCOOP_HINTS = [
  "CF 20g",
  "MP 10g",
  "MB/SB 25g",
  "CJ 50g",
  "ไซรัป 20g",
  "VI 60g",
] as const;

export const FNB_NOTE_VALUES = [1000, 500, 100, 50, 20, 10, 5, 2, 1] as const;

export type FnbVatMode = (typeof FNB_VAT_MODES)[number];
export type FnbItemCategory = (typeof FNB_ITEM_CATEGORIES)[number];
export type FnbBrandScope = (typeof FNB_BRAND_SCOPES)[number];

export type FnbActionResult<T> = {
  data: T;
  error: string | null;
  schemaReady: boolean;
};

export type FnbBranchOption = {
  branch_code: string;
  branch_name_th: string;
  brand_code: string;
  legal_entity_id: string;
  vat_branch_code: string;
  branch_status: string;
  target_open_date: string | null;
};

export type FnbBrandCode = "LUCKY_CUP" | "CHATORN";

export type FnbSubmitResult = {
  ok: boolean;
  mode: string | null;
  request_no: string | null;
  message: string | null;
};

export type FnbOpeningCard = {
  staff_name: string;
  calibration_shots: number;
  dose_per_shot_g: number;
  extraction_time_sec: number | null;
  liquid_yield_g: number | null;
  total_coffee_used_g: number;
  last_edit_reason: string | null;
};

export type FnbShiftCard = {
  id: string;
  shift_type: string;
  entry_mode: string;
  staff_name: string;
  gross_sales: number;
  discount_total: number;
  net_sales_inc_vat: number;
  cash_pos_amount: number;
  cash_counted_amount: number;
  cash_variance: number | null;
  cash_variance_reason: string | null;
  qr_amount: number;
  lineman_gross_amount: number;
  grab_gross_amount: number;
  webapp_amount: number;
  morning_cash_quick: number;
  afternoon_cash_quick: number;
  deposit_method: string;
  bank_deposit_amount: number;
  seven_eleven_deposit_amount: number;
  seven_eleven_fee_thb: number;
  platform_settlement_status: string;
  lineman_net_payout: number | null;
  grab_net_payout: number | null;
  webapp_net_payout: number | null;
  weather_or_shift_note: string | null;
};

export type FnbWasteCard = {
  staff_name: string;
  total_waste_cost_thb: number;
  last_edit_reason: string | null;
  summary: unknown;
};

export type FnbShelfCard = {
  staff_name: string;
  item_count: number;
  last_edit_reason: string | null;
};

export type FnbDayState = {
  opening: FnbOpeningCard | null;
  shifts: FnbShiftCard[];
  waste: FnbWasteCard | null;
  shelf: FnbShelfCard | null;
  pending: { request_no: string; shift_type: string }[];
};

export type FnbChangeRequestRow = {
  id: string;
  request_no: string;
  branch_code: string;
  work_date: string;
  shift_type: string;
  requested_by_name: string;
  edit_reason: string;
  old_payload: Record<string, unknown>;
  proposed_payload: Record<string, unknown>;
};

export type FnbUnpackLine = {
  id: string;
  gr_no: string;
  branch_code: string;
  item_id: string;
  short_code: string;
  name_th: string;
  received_qty: number;
  allocated_lot_qty: number;
  received_uom: string;
  expiry_tracking_status: string;
  shelf_life_months: number | null;
};

export type FnbExpiryLotRow = {
  id: string;
  branch_code: string;
  item_id: string;
  short_code: string;
  name_th: string;
  pack_qty: number;
  remaining_pack_qty: number;
  pack_uom: string;
  mfg_date: string | null;
  expiry_date: string;
  lot_status: string;
};

export type FnbVendorSheetRow = {
  raw_code: string;
  raw_desc: string;
  received_qty: number;
  received_uom: string;
  unit_price: number;
  external_code: string;
  item_id: string | null;
  item_name: string | null;
};

export type FnbVendorSheetPreview = {
  branch_code: string | null;
  rows: FnbVendorSheetRow[];
};

export type FnbItemRow = {
  id: string;
  short_code: string;
  external_code: string | null;
  brand_scope: string;
  item_category: string;
  name_th: string;
  name_cn: string | null;
  recipe_uom: string;
  count_uom: string;
  recipe_per_count_uom: number;
  default_purchase_uom: string;
  recipe_per_purchase_uom: number;
  specific_gravity: number;
  tare_weight_g: number;
  reference_purchase_price: number;
  default_vat_mode: string;
  moving_avg_cost_per_recipe_unit: number;
  is_front_back_checked: boolean;
  front_back_group: string | null;
  is_active: boolean;
  shelf_life_months: number | null;
  requires_expiry_tracking: boolean;
};

export type FnbVendorPackRow = {
  id: string;
  item_id: string;
  vendor_name: string;
  pack_label: string;
  purchase_uom: string;
  recipe_qty_per_pack: number;
  unit_price: number;
  vat_mode: string;
  moq_qty: number | null;
  under_moq_surcharge_thb: number;
  is_local_urgent_pack: boolean;
  is_preferred: boolean;
  is_active: boolean;
};

export type FnbPrepBaseRow = {
  base_code: string;
  brand_code: string;
  base_name_th: string;
  yield_qty_ml: number;
  shelf_life_hours: number | null;
  is_active: boolean;
};

export type FnbMenuRow = {
  id: string;
  brand_code: string;
  menu_code: string;
  menu_name_th: string;
  cup_size: string;
  temperature: string;
  retail_price: number;
  is_active: boolean;
};

export type FnbMenuBomLineRow = {
  id: string;
  menu_id: string;
  component_type: string;
  item_id: string | null;
  prep_base_code: string | null;
  usage_qty: number;
  usage_uom: string;
  note: string | null;
};

export type FnbBranchKpi = {
  branch_code: string;
  todaySales: number;
  monthSales: number;
  cash: number;
  qr: number;
  lineman: number;
  grab: number;
  wasteCost: number;
  pendingReimburse: number;
};

export type FnbGoodsReceiptRow = {
  id: string;
  gr_no: string;
  receiving_branch_code: string;
  tax_invoice_branch_code: string | null;
  vendor_name: string | null;
  doc_tax_status: string;
  sub_total_ex_vat: number;
  vat_amount: number;
  grand_total: number;
  branch_mismatch_warning: boolean;
  received_date: string;
};

export type FnbGoodsReceiptLineRow = {
  id: string;
  gr_id: string;
  item_id: string;
  item_description: string;
  received_qty: number;
  received_uom: string;
  recipe_qty_per_unit: number;
  unit_price: number;
  line_vat_mode: string;
};

export type FnbReimbursementRow = {
  id: string;
  reimb_no: string;
  branch_code: string;
  staff_name: string;
  reimb_mode: string;
  vendor_or_purpose: string;
  total_amount: number;
  payout_status: string;
  payee_bank_info: string | null;
};

export type FnbStockBalanceRow = {
  branch_code: string;
  item_id: string;
  short_code: string;
  name_th: string;
  count_uom: string;
  recipe_uom: string;
  recipe_per_count_uom: number;
  on_hand_recipe: number;
};

export type FnbExcelPriceRow = {
  external_code: string;
  name_th: string;
  unit_price: number;
  action: "insert" | "update";
};

export type FnbPosImportPreview = {
  file_name: string;
  valid_order_count: number;
  cancelled_order_count: number;
  gross_sales_total: number;
  net_sales_total: number;
  cancelled_orders_json: unknown[];
};
