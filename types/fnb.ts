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
  standard_cash_float: number;
  enable_shift_3: boolean;
  opening_time: string | null;
  closing_time: string | null;
  opening_deadline_time: string | null;
  shift_1_start: string | null;
  shift_1_end: string | null;
  shift_2_start: string | null;
  shift_2_end: string | null;
  shift_3_start: string | null;
  shift_3_end: string | null;
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

export const FNB_LIFF_SUSPENDED_MESSAGE = "บัญชีนี้ถูกระงับสิทธิ์การเข้าใช้งานแล้ว กรุณาติดต่อผู้จัดการ";

export const FNB_SOP_STAGES = ["OPENING", "SHIFT_HANDOVER", "CLOSING"] as const;
export const FNB_SOP_STAGE_INSTANCES = ["OPENING", "SHIFT_1", "SHIFT_2", "SHIFT_3", "CLOSING"] as const;
export const FNB_SOP_INPUT_TYPES = ["PHOTO_ONLY", "COFFEE_CALIBRATION", "CASH_FLOAT_CHECK", "PREP_BATCH", "ITEM_PAR_CHECK", "EXPIRY_AUDIT", "NUMBER_METRIC", "PASS_FAIL_PHOTO"] as const;
export const FNB_SOP_SCHEDULES = ["DAILY", "WEEKLY_DAYS", "MONTHLY_DATES"] as const;
export const FNB_BRANCH_CODES = ["LC-HDY", "LC-PSU", "CT-KLN", "CT-BNP", "CT-NMM"] as const;

export type FnbSopStage = (typeof FNB_SOP_STAGES)[number];
export type FnbSopStageInstance = (typeof FNB_SOP_STAGE_INSTANCES)[number];
export type FnbSopInputType = (typeof FNB_SOP_INPUT_TYPES)[number];
export type FnbSopSchedule = (typeof FNB_SOP_SCHEDULES)[number];

export type FnbActorSource = "desktop" | "liff";

export type FnbActor = {
  name: string;
  lineUserId: string | null;
  userId: string | null;
  branchCode: string | null;
  brandCode: FnbBrandCode | null;
  source: FnbActorSource;
};

export type FnbSopTemplate = {
  id: string;
  task_code: string;
  stage_code: FnbSopStage;
  brand_scope: string;
  title_th: string;
  description_instruction: string | null;
  reference_photo_url: string | null;
  input_type: FnbSopInputType;
  linked_item_id: string | null;
  live_camera_only: boolean;
  is_mandatory: boolean;
  schedule_type: FnbSopSchedule;
  schedule_days: number[];
  sort_order: number;
  is_active: boolean;
  branches: string[];
};

export type FnbSopSubmission = {
  id: string;
  template_id: string;
  submitted_by_name: string;
  server_submitted_at: string;
  status_value: string;
  numeric_value: number | null;
  note_text: string | null;
  photo_urls: string[];
  manager_review_status: string;
};

export type FnbSopBoard = {
  session_status: string;
  contributors: { staff_name: string; task_count: number }[];
  mandatory_done: number;
  mandatory_total: number;
  tasks: (FnbSopTemplate & { submission: FnbSopSubmission | null })[];
};

export type FnbParLevelRow = {
  branch_code: string;
  item_id: string;
  short_code: string;
  name_th: string;
  min_par_count_qty: number;
  lead_time_days: number;
  is_below_par: boolean;
  last_observed_count_qty: number | null;
};

export type FnbExpiryAlert = {
  branch_code: string;
  name_th: string;
  expiry_date: string;
  remaining_pack_qty: number;
  days_left: number;
};

export type FnbMenuSalesLine = {
  line_seq: number;
  menu_id: string | null;
  menu_name_th: string;
  category_name: string | null;
  cup_size: string | null;
  qty_sold: number;
  gross_amount: number;
};

export type FnbMenuSalesDraft = {
  summary_only: boolean;
  slip_printed_at: string | null;
  reported_total_qty: number;
  reported_total_amount: number;
  early_print_note: string | null;
  lines: FnbMenuSalesLine[];
};

export type FnbMenuRank = {
  branch_code: string;
  menu_name_th: string;
  cup_size: string | null;
  category_name: string | null;
  qty_sold: number;
  gross_amount: number;
};

export type FnbPromoHint = {
  branch_code: string;
  item_name: string;
  expiry_date: string;
  days_left: number;
  menu_name_th: string;
};

export const FNB_OPEN_SHELF_MODES = ["DAILY_EOD", "HOURS_AFTER_OPEN", "DAYS_AFTER_OPEN", "NONE"] as const;
export const FNB_DAILY_CLEAR_CODES = ["JT", "BT", "MMK", "ML", "LEM"] as const;

export type FnbOpenShelfMode = (typeof FNB_OPEN_SHELF_MODES)[number];

export type FnbOpenShelfRule = {
  id: string | null;
  item_id: string | null;
  short_code: string;
  name_th: string;
  brand_code: "ALL" | "LUCKY_CUP" | "CHATORN";
  open_shelf_life_mode: FnbOpenShelfMode;
  open_shelf_life_value: number;
  require_expiry_clear_photo: boolean;
  locked: boolean;
};

export type FnbWipBatchRow = {
  id: string;
  batch_no: string;
  batch_kind: string;
  prep_base_code: string | null;
  item_id: string | null;
  item_label: string;
  brew_portion_mode: string;
  packs_deducted: number;
  actual_usable_qty: number;
  recipe_uom: string;
  total_issued_cost_thb: number;
  unbrewed_rule_cost_thb: number;
  shelf_life_mode: string;
  opened_at: string;
  expires_at: string;
  sticker_label_text: string | null;
  opened_by_name: string;
  batch_status: string;
  theoretical_full_qty: number;
  waste_qty: number;
  waste_cost_thb: number;
};

export type FnbWipBoard = {
  bases: { base_code: string; base_name_th: string; yield_qty_ml: number }[];
  items: { id: string; short_code: string; name_th: string; count_uom: string }[];
  brews: FnbWipBatchRow[];
  containers: FnbWipBatchRow[];
};

export type FnbClosingWipContext = {
  brews: { code: string; usable: number; full_qty: number; half_qty: number; packs: number; cost: number }[];
  expired: FnbWipBatchRow[];
};

export type FnbWipCostRow = {
  branch_code: string;
  issued_cost: number;
  sold_cogs: number;
  eod_waste: number;
  eod_waste_pct: number;
  franchise_rule_cost: number;
  multi_day_waste: number;
  multi_day_waste_pct: number;
  unexplained: number;
};

export type FnbCashFloatContext = {
  standard_cash_float: number;
  prev_shift_held_cash: number;
  closing_time: string | null;
};

export type FnbPosImportPreview = {
  file_name: string;
  valid_order_count: number;
  cancelled_order_count: number;
  gross_sales_total: number;
  net_sales_total: number;
  cancelled_orders_json: unknown[];
};
