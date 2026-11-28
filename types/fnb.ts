export const FNB_BRAND_SCOPES = ["LUCKY_CUP", "CHATORN"] as const;
export const FNB_BRAND_THEME = {
  LUCKY_CUP: {
    label: "Lucky Cup",
    badge: "🔴 Lucky Cup",
    color: "#DC2626",
    hover: "#B91C1C",
    tint: "#FEF2F2",
    shellClass: "bg-[#DC2626]",
    frameClass: "border-[#DC2626]",
    tintClass: "bg-red-50",
  },
  CHATORN: {
    label: "ชาทรตะโหมด",
    badge: "🍷 ชาทรตะโหมด",
    color: "#6B0F1A",
    hover: "#520B13",
    tint: "#FDF2F4",
    shellClass: "bg-[#6B0F1A]",
    frameClass: "border-[#6B0F1A]",
    tintClass: "bg-[#FDF2F4]",
  },
} as const;
export const FNB_STOCK_SHEET_GROUPS = [
  { key: "RAW_MATERIAL", label: "วัตถุดิบชง" },
  { key: "BAKERY_FROZEN", label: "เบเกอรี่และเค้ก" },
  { key: "ICE_CREAM", label: "ไอศกรีม" },
  { key: "MERCHANDISE", label: "ของพรีเมียม" },
  { key: "PACKAGING", label: "บรรจุภัณฑ์" },
  { key: "CLEANING_SUPPLY", label: "น้ำยาและของใช้สิ้นเปลือง" },
  { key: "EQUIPMENT_CAPEX", label: "อุปกรณ์" },
] as const;
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

export const FNB_BACKROOM_SCHEDULES = ["DAILY", "EVERY_3_DAYS", "WEEKLY_2X", "WEEKLY_1X", "MONTHLY_ONLY"] as const;
export const FNB_BACKROOM_SCHEDULE_LABEL: Record<(typeof FNB_BACKROOM_SCHEDULES)[number], string> = {
  DAILY: "นับทุกคืน",
  EVERY_3_DAYS: "นับทุก 3 วัน",
  WEEKLY_2X: "สัปดาห์ละ 2 ครั้ง",
  WEEKLY_1X: "สัปดาห์ละ 1 ครั้ง",
  MONTHLY_ONLY: "นับเฉพาะรอบเดือน",
};
export const FNB_WEEKDAY_OPTIONS = [
  { day: 1, label: "จันทร์" },
  { day: 2, label: "อังคาร" },
  { day: 3, label: "พุธ" },
  { day: 4, label: "พฤหัส" },
  { day: 5, label: "ศุกร์" },
  { day: 6, label: "เสาร์" },
  { day: 0, label: "อาทิตย์" },
] as const;
export const FNB_FRONT_DISPLAY_CATEGORIES = ["MERCHANDISE", "BAKERY_FROZEN", "ICE_CREAM"] as const;

export const FNB_DISPLAY_SUB_GROUPS = [
  { code: "CROISSANT", label: "กลุ่มครัวซองต์", cabinet: "BAKERY", walk: 10 },
  { code: "PUFF_PIE", label: "กลุ่มพัฟและพาย", cabinet: "BAKERY", walk: 20 },
  { code: "CAKE_MOUSSE", label: "กลุ่มเค้กบอกซ์และมูส", cabinet: "BAKERY", walk: 30 },
  { code: "HANJUKU", label: "กลุ่มฮานจุกุชีสเค้ก", cabinet: "BAKERY", walk: 40 },
  { code: "ICECREAM_CONE", label: "ตู้ไอศกรีมและโคนหน้าบาร์", cabinet: "ICE", walk: 50 },
  { code: "MERCH_DISPLAY", label: "ชั้นโชว์ของพรีเมียมหน้าร้าน", cabinet: "MERCH", walk: 60 },
  { code: "OTHER_DISPLAY", label: "รายการโชว์อื่น", cabinet: "MERCH", walk: 90 },
] as const;

export const FNB_WRITE_OFF_REASONS = [
  { code: "EXPIRED_DISPLAY", label: "หมดอายุคาตู้โชว์หน้าร้าน" },
  { code: "TRANSIT_BROKEN", label: "แตกหัก / บุบเสียหายจากการขนส่ง" },
  { code: "MOLD_SPOILED", label: "ขึ้นรา / เสื่อมสภาพก่อนวันหมดอายุ" },
  { code: "STAFF_HANDLING_DROP", label: "ตกหล่น / เสียหายระหว่างทำงานหน้าร้าน" },
] as const;
export const FNB_SAUCE_OPEN_DAYS: Record<string, number> = {
  SB: 2, MB: 5, CS: 6, BS: 14, PF: 4, PS: 4, X: 9, CJ: 6, WMK: 3, CW: 1, CWT: 1, CMK: 1,
};
export const FNB_PREP_BASES = [
  { code: "JT", yieldMl: 1950, label: "น้ำชามะลิ JT" },
  { code: "BT", yieldMl: 2800, label: "น้ำชาดำ BT" },
  { code: "ML", yieldMl: 750, label: "มัทฉะเข้มข้น ML (50g + น้ำ 750ml)" },
  { code: "MMK", yieldMl: 1000, label: "เบสนมมัทฉะ MMK (50g + นม 1,000ml)" },
] as const;

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
  max_staff_per_shift: number;
  coffee_dose_min_g?: number | null;
  coffee_dose_max_g?: number | null;
  espresso_time_min_s?: number | null;
  espresso_time_max_s?: number | null;
  espresso_yield_min_g?: number | null;
  espresso_yield_max_g?: number | null;
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
  alias_codes: string[];
  track_front_display_daily: boolean;
  backroom_count_schedule: string;
  backroom_count_weekdays: number[];
  allow_decimal_count_qty: boolean;
  display_shelf_life_days: number | null;
  display_sub_group: string | null;
  display_walk_order: number;
  is_catch_weight_produce: boolean;
  piece_uom_label: string;
  avg_gross_grams_per_piece: number;
  prep_yield_pct: number;
  default_date_stamp_mode: string;
  shelf_life_value: number;
  shelf_life_unit: string;
  shelf_life_text: string;
  usage_tolerance_pct: number;
  image_urls: string[];
  image_captions: string[];
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
  menu_category: string;
  is_active: boolean;
  is_bom_pending: boolean;
  is_auto_discovered: boolean;
  theoretical_cost_thb: number | null;
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
  line_tolerance_pct: number;
  is_user_customized: boolean;
  is_packaging: boolean;
};

export type FnbBomCatalogItem = {
  id: string;
  short_code: string;
  name_th: string;
  recipe_uom: string;
  count_uom: string;
  unit_cost: number;
};

export type FnbPrepBaseCost = {
  base_code: string;
  cost_per_ml: number;
};

export type FnbBomVarianceRow = {
  item_id: string;
  short_code: string;
  name_th: string;
  count_uom: string;
  tolerance_pct: number;
  theoretical_recipe_qty: number;
  theoretical_cost_thb: number | null;
  actual_used_recipe_qty: number;
  actual_cost_thb: number | null;
  variance_pct: number;
  is_over_tolerance: boolean;
  on_hand_count_qty: number;
  forecast_need_count_qty: number;
  recommended_order_count_qty: number;
};

export type FnbStockCardMovement = {
  id: string;
  tx_datetime_th: string;
  location_name_th: string;
  actor_name: string;
  tx_type: string;
  notes: string;
  in_count_qty: number;
  out_count_qty: number;
  balance_count_qty: number;
  in_recipe_qty: number;
  out_recipe_qty: number;
  balance_recipe_qty: number;
};

export type FnbStockCardLot = {
  location_code: string;
  entry_mode: string;
  mfg_date: string;
  expiry_date: string;
  qty: number;
  uom: string;
};

export type FnbStockCard = {
  ok: boolean;
  short_code: string;
  name_th: string;
  count_uom: string;
  recipe_uom: string;
  recipe_per_count_uom: number;
  from_date: string;
  to_date: string;
  brought_forward_count_qty: number;
  brought_forward_recipe_qty: number;
  closing_count_qty: number;
  closing_recipe_qty: number;
  movements: FnbStockCardMovement[];
  expiry_lots: FnbStockCardLot[];
};

export type FnbExecutiveExpiryLot = {
  location_code: string;
  mfg_date: string;
  expiry_date: string;
  qty: number;
  uom: string;
};

export type FnbExecutiveInventoryItem = {
  item_id: string;
  short_code: string;
  name_th: string;
  item_category: string;
  image_urls: string[];
  image_captions: string[];
  recipe_uom: string;
  count_uom: string;
  recipe_per_count_uom: number;
  reorder_point_count_qty: number;
  total_recipe_qty: number;
  total_count_qty: number;
  by_location_count_qty: Record<string, number>;
  total_stock_value_thb: number | null;
  nearest_expiry_date: string;
  expiry_lots: FnbExecutiveExpiryLot[];
  last_counted_at: string;
  last_counted_by: string;
  open_pack_net_recipe_qty: number;
};

export type FnbExecutiveInventory = {
  branch_code: string;
  branch_name_th: string;
  locations: { location_code: string; location_name_th: string }[];
  items: FnbExecutiveInventoryItem[];
  stock_value_thb: number | null;
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
  piece_on_hand: number;
  alias_codes?: string[];
  external_code?: string | null;
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
  alert_enabled: boolean;
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
  bases: { base_code: string; base_name_th: string; yield_qty_ml: number; sort_order: number }[];
  items: { id: string; short_code: string; name_th: string; count_uom: string; alias_codes: string[]; external_code: string | null; allow_decimal_count_qty: boolean; item_category: string; has_open_shelf_rule: boolean; is_catch_weight_produce?: boolean; piece_uom_label?: string; avg_gross_grams_per_piece?: number; prep_yield_pct?: number }[];
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

export type FnbStorageZone = {
  id: string;
  branchCode: string;
  locationCode: string;
  locationNameTh: string;
  zoneType: string;
  defaultCountSchedule: string;
  countWeekdays: number[];
  isDefaultGrTarget: boolean;
  sortOrder: number;
};

export type FnbCleaningSpot = {
  id: string;
  branchCode: string;
  stageCode: "OPENING" | "CLOSING";
  spotNameTh: string;
  sortOrder: number;
  photoUrl: string | null;
  scheduleType: "DAILY" | "WEEKLY";
  weekdays: number[];
};

export type FnbZoneCountLine = {
  itemId: string;
  shortCode: string;
  nameTh: string;
  aliases: string[];
  locationCode: string;
  openingQty: number;
  replenishedQty: number;
  posSoldQty: number;
  expectedQty: number;
  countedQty: number | null;
  nearestExpiry: string | null;
  shrinkageQty: number;
  suggestReplenishQty: number;
  belowLastClose: boolean;
  dueTonight: boolean;
  countUom: string;
  allowDecimal: boolean;
  category: string;
  displaySubGroup: string;
  displayWalkOrder: number;
  shelfLifeDays: number;
  writeOffQty: number;
  isCatchWeight?: boolean;
  pieceLabel?: string;
  avgGrossGrams?: number;
};

export type FnbDisplayLot = {
  id: string;
  itemId: string;
  remainingQty: number;
  displayExpiryDate: string;
  effectiveDay1: string;
};

export type FnbStageConfirmation = {
  id: string;
  sectionKey: string;
  sectionTitle: string;
  stageCode: "OPENING" | "CLOSING";
  statusFlag: string;
  numericAmount: number | null;
  expectedAmount: number | null;
  varianceReason: string | null;
  photoUrls: string[];
  confirmedByName: string;
  confirmedAt: string;
  lastEditReason: string | null;
  payload: Record<string, unknown>;
};

export type FnbOpenContainer = {
  id: string;
  qty: number;
  uom: string;
  expiresAt: string | null;
  sticker: string | null;
};

export type FnbSauceWatch = {
  code: string;
  itemId: string | null;
  nameTh: string;
  countUom: string;
  openDays: number;
  batchId: string | null;
  expiresAt: string | null;
  sticker: string | null;
  batches: FnbOpenContainer[];
};

export type FnbStoreDayBoard = {
  locations: FnbStorageZone[];
  openingSpots: FnbCleaningSpot[];
  closingSpots: FnbCleaningSpot[];
  frontOpeningLines: FnbZoneCountLine[];
  frontLines: FnbZoneCountLine[];
  backroomLines: FnbZoneCountLine[];
  warehouseLines: FnbZoneCountLine[];
  warehouseDue: boolean;
  sauces: FnbSauceWatch[];
  displayLots: FnbDisplayLot[];
  calibration: {
    grinderDoseG: number | null;
    espressoTimeSec: number | null;
    espressoYieldG: number | null;
    syrupRandomG: number | null;
    syrupActualG: number | null;
    syrupAdjusted: boolean;
  } | null;
};

export const FNB_QA_SECTIONS = [
  { key: "grinder_and_syrup_calibration", label: "ข้อมูลจูนเครื่องบดกาแฟ & เครื่องจ่ายน้ำเชื่อมอัตโนมัติ", defaultOn: true },
  { key: "espresso_shot_calibration", label: "ข้อมูลเช็คช็อตกาแฟ (โดส / เวลาสกัด / น้ำกาแฟ)", defaultOn: true },
  { key: "open_sauce_bar_expiry", label: "บันทึกป้ายวันหมดอายุซอสและวัตถุดิบเปิดใช้หน้าบาร์", defaultOn: true },
  { key: "backroom_fefo_expiry_lots", label: "ตารางล็อตวันหมดอายุวัตถุดิบคลังหลังร้าน (FEFO)", defaultOn: true },
  { key: "cleaning_spot_photos", label: "รูปถ่ายความสะอาดตามจุดพร้อมเวลาและผู้ตรวจ", defaultOn: true },
  { key: "prep_base_wip_logs", label: "บันทึกการต้มเบสเตรียมขาย WIP", defaultOn: false },
  { key: "bakery_display_waves", label: "ล็อตวันหมดอายุตู้โชว์เบเกอรี่", defaultOn: false },
  { key: "expired_destruction_photos", label: "บันทึกการทำลายสินค้าหมดอายุ", defaultOn: false },
] as const;

export type FnbQaSectionKey = (typeof FNB_QA_SECTIONS)[number]["key"];

export type FnbAuditPhoto = {
  url: string;
  staff: string;
  at: string;
  caption: string;
  confirmationId: string | null;
  submissionId: string | null;
};

export type FnbInspectorMatrixRow = {
  branchCode: string;
  branchName: string;
  openingDone: number;
  openingFinishedAt: string | null;
  staffNames: string[];
  shift1Crew: string[];
  shift2Crew: string[];
  wipCount: number;
  wipAt: string | null;
  shift1Staff: string | null;
  shift1At: string | null;
  shift2Staff: string | null;
  shift2At: string | null;
  closingDone: boolean;
  closingAt: string | null;
};

export type FnbAuditAnomaly = { branchCode: string; kind: string; detail: string };

export type FnbInspectorOpeningCard = {
  no: number;
  title: string;
  staff: string;
  at: string;
  lines: string[];
  zeroNote: string;
  photos: { url: string; caption: string }[];
};

export type FnbInspectorReportPhoto = { group: string; url: string };

export type FnbInspectorShiftCard = {
  shift: "MORNING" | "AFTERNOON";
  staff: string;
  closedByName: string;
  at: string;
  orderCount: number;
  grossSales: number;
  promoDiscount: number;
  deliveryDiscount: number;
  storeDiscount: number;
  netSales: number;
  cash: number;
  qr: number;
  kshop: number;
  lineman: number;
  linemanApp: number;
  grab: number;
  grabGp: number;
  grabNet: number;
  webapp: number;
  openingFloat: number;
  drawerCounted: number;
  cashHandover: number;
  cashVariance: number;
  handoverStatus: string;
  handoverAcceptedByName: string;
  handoverAcceptedAt: string;
  handoverCounted: number;
  handoverAckNote: string;
  depositChannel: string;
  sevenAmount: number;
  sevenFee: number;
  sevenSlipUrl: string;
  eodDeposit: number;
  photos: FnbInspectorReportPhoto[];
};

export type FnbInspectorMenuLine = { shift: string; name: string; size: string; qty: number; amount: number };

export type FnbInspectorShrinkRow = {
  item: string;
  uom: string;
  group: "BAKERY" | "ICE" | "MERCH";
  walkOrder: number;
  opening: number;
  replenished: number;
  sold: number;
  wasted: number;
  expected: number;
  counted: number | null;
  missing: boolean;
};

export type FnbInspectorVoidRow = {
  id: string;
  label: string;
  qtyLabel: string;
  stockSummary: string;
  reason: string;
  staff: string;
  at: string;
};

export type FnbShiftIncidentView = {
  remakes: { id: string; shift: string; menu: string; qty: number; category: string; staff: string; cost: number; summary: string; photos: string[] }[];
  writeOffs: { id: string; shift: string; item: string; reason: string; qty: number; cost: number; staff: string; photos: string[] }[];
};

export type FnbInspectorRemake = {
  id: string;
  shift: string;
  menu: string;
  qty: number;
  category: string;
  staff: string;
  cost: number;
  summary: string;
  photos: string[];
  at: string;
};

export type FnbInspectorDetail = {
  sections: { key: string; title: string; staff: string; at: string; status: string; photos: string[] }[];
  openingCards: FnbInspectorOpeningCard[];
  wip: { label: string; portion: string; staff: string; at: string; sticker: string; photos: string[] }[];
  prepRows: { id: string; label: string; portion: string; yieldLabel: string; qtyLabel: string; sourceRefType: string; staff: string; at: string; badge: string; photos: string[] }[];
  openRows: { id: string; label: string; qtyLabel: string; badge: string; expiryLabel: string; sourceRefType: string; staff: string; at: string; photos: string[] }[];
  replenishments: { item: string; qty: number; at: string; staff: string; photo: string }[];
  writeOffs: { id: string; item: string; reason: string; qty: number; shift: string; cost: number; staff: string; at: string; photos: string[] }[];
  voidedWip: FnbInspectorVoidRow[];
  remakes: FnbInspectorRemake[];
  shiftCards: FnbInspectorShiftCard[];
  menus: FnbInspectorMenuLine[];
  closingCash: { amount: number; expected: number; staff: string; at: string; photos: { url: string; caption: string }[] } | null;
  closingSpots: { name: string; url: string; staff: string; at: string }[];
  closingSpotTotal: number;
  closingSpotDone: number;
  shrinkage: FnbInspectorShrinkRow[];
  wasteLogs: { staff: string; cost: number; notes: string; photos: string[] }[];
  shifts: { shift: string; staff: string; variance: number }[];
  photos: FnbAuditPhoto[];
};

export type FnbAuditPeriodRow = {
  year: number;
  month: number;
  isLocked: boolean;
  lockedByName: string;
  lockedAt: string | null;
  lastBackupAt: string | null;
};

export type FnbAuditProfile = {
  profileCode: string;
  profileName: string;
  sections: Record<string, boolean>;
  spotIds: string[];
  extraTopics: string[];
  headerTitle: string;
  signoffTitles: string[];
  spots: { id: string; branchCode: string; name: string }[];
};

export type FnbQaPack = {
  headerTitle: string;
  signoffTitles: string[];
  extraTopics: string[];
  equipment: { branchCode: string; workDate: string; doseG: number | null; shotSec: number | null; shotG: number | null; syrupTargetG: number | null; syrupActualG: number | null }[];
  sauces: { branchCode: string; label: string; openedAt: string; expiresAt: string; sticker: string }[];
  lots: { branchCode: string; item: string; qty: number; uom: string; expiry: string }[];
  cleaning: { branchCode: string; spot: string; staff: string; at: string; status: string; photos: string[] }[];
  wip: { branchCode: string; label: string; portion: string; staff: string; at: string; photos: string[] }[];
  displayLots: { branchCode: string; item: string; qty: number; expiry: string }[];
  destructions: { branchCode: string; item: string; reason: string; qty: number; destroyed: boolean; photos: string[] }[];
};

export type FnbPosImportPreview = {
  file_name: string;
  valid_order_count: number;
  cancelled_order_count: number;
  gross_sales_total: number;
  net_sales_total: number;
  cancelled_orders_json: unknown[];
};

/** Group 1 — missing keys stay closed. */
export const FNB_MODULE_PERMISSION_DEFS = [
  { key: "store_portal", label: "พอร์ทัลหน้าร้านมือถือ (เปิดร้าน / ส่งเงินกะ / WIP / ปิดร้าน)" },
  { key: "goods_receipt_expiry", label: "รับสินค้าเข้าสาขา & แกะล็อตวันหมดอายุ (FEFO)" },
  { key: "branch_inventory_transfer", label: "คลังสาขา โอนสินค้าระหว่างสาขา & นับสต็อก" },
  { key: "own_branch_menu_sales", label: "ดูยอดขายรายเมนู (เฉพาะสาขาที่สังกัด)" },
  { key: "hq_tax_reimburse", label: "ชนบิลภาษี โอนคืนพนักงาน 15฿ & กระทบยอดแพลตฟอร์ม" },
  { key: "master_items_bom", label: "ทะเบียนวัตถุดิบ หลายแหล่งซื้อ & สูตรชง (BOM)" },
  { key: "sop_shift_settings", label: "ตั้งค่าระเบียบ SOP เงินทอนเก๊ะ & กะสาขา" },
  { key: "people_payroll", label: "บุคลากร รหัสล็อกอิน & เตรียมเงินเดือน" },
  { key: "all_branch_analytics", label: "แดชบอร์ดยอดขายรวม & วิเคราะห์โปรโมชั่นทุกสาขา" },
  { key: "tax_accounting_reports", label: "รายงานภาษีซื้อ-ขายรายสาขา & สรุป ภ.พ.30 (เตรียมเชื่อมเฟสถัดไป)" },
] as const;

/** Group 2 — confidentiality and internal control. Missing keys use defaultValue. */
export const FNB_GUARDRAIL_PERMISSION_DEFS = [
  { key: "can_view_cost_price", label: "แสดงราคาทุนวัตถุดิบและต้นทุนสูตร BOM", defaultValue: false },
  { key: "enforce_blind_count", label: "บังคับซ่อนยอดคงเหลือในระบบตอนนับสต็อก (Blind Count)", defaultValue: true },
  { key: "can_approve_financial_edits", label: "สิทธิ์อนุมัติแก้ตัวเลขปิดกะ & อนุมัติงวดเงินเดือน", defaultValue: false },
] as const;

export type FnbModulePermissionKey = (typeof FNB_MODULE_PERMISSION_DEFS)[number]["key"];
export type FnbGuardrailPermissionKey = (typeof FNB_GUARDRAIL_PERMISSION_DEFS)[number]["key"];
export type FnbModulePermissions = Record<FnbModulePermissionKey, boolean>;
export type FnbGuardrailPermissions = Record<FnbGuardrailPermissionKey, boolean>;

export type FnbRolePermissionRow = {
  roleCode: string;
  appRoleCode: string;
  roleNameTh: string;
  description: string;
  isSystemBuiltin: boolean;
  isActive: boolean;
  modulePermissions: FnbModulePermissions;
  guardrailPermissions: FnbGuardrailPermissions;
  brandCode: string;
};

export type FnbScopedMenuSale = {
  menuName: string;
  categoryName: string;
  qtySold: number;
  grossAmount: number;
  qtyR: number;
  qtyL: number;
  estimatedBomCost?: number;
};

export type FnbScopedMenuCategory = {
  name: string;
  qtySold: number;
  grossAmount: number;
};

export type FnbScopedMenuSales = {
  branchCode: string;
  totalCups: number;
  totalAmount: number;
  menus: FnbScopedMenuSale[];
  categories: FnbScopedMenuCategory[];
  showCost: boolean;
};

export function fnbModulePermissionsFrom(raw: unknown): FnbModulePermissions {
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const next = {} as FnbModulePermissions;
  for (const def of FNB_MODULE_PERMISSION_DEFS) next[def.key] = source[def.key] === true;
  return next;
}

export function fnbGuardrailPermissionsFrom(raw: unknown): FnbGuardrailPermissions {
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const next = {} as FnbGuardrailPermissions;
  for (const def of FNB_GUARDRAIL_PERMISSION_DEFS) {
    next[def.key] = source[def.key] === undefined ? def.defaultValue : source[def.key] === true;
  }
  return next;
}

export function allFnbModulePermissions(enabled: boolean): FnbModulePermissions {
  const next = {} as FnbModulePermissions;
  for (const def of FNB_MODULE_PERMISSION_DEFS) next[def.key] = enabled;
  return next;
}

export const FNB_SUPER_ADMIN_GUARDRAILS: FnbGuardrailPermissions = {
  can_view_cost_price: true,
  enforce_blind_count: false,
  can_approve_financial_edits: true,
};

/** Used only when fnb.role_permissions cannot be read. Matches the cloud seed. */
export const FNB_BUILTIN_ROLE_DEFAULTS: Record<string, { modules: unknown; guards: unknown }> = {
  FNB_STORE_STAFF: {
    modules: { store_portal: true, goods_receipt_expiry: true },
    guards: { can_view_cost_price: false, enforce_blind_count: true, can_approve_financial_edits: false },
  },
  FNB_BRANCH_MANAGER: {
    modules: { store_portal: true, goods_receipt_expiry: true, branch_inventory_transfer: true, own_branch_menu_sales: true },
    guards: { can_view_cost_price: false, enforce_blind_count: true, can_approve_financial_edits: false },
  },
  FNB_ACCOUNTANT: {
    modules: { goods_receipt_expiry: true, hq_tax_reimburse: true, master_items_bom: true, tax_accounting_reports: true },
    guards: { can_view_cost_price: true, enforce_blind_count: false, can_approve_financial_edits: false },
  },
  FNB_HR: {
    modules: { people_payroll: true },
    guards: { can_view_cost_price: false, enforce_blind_count: true, can_approve_financial_edits: false },
  },
  FNB_HR_ACCOUNTANT: {
    modules: { people_payroll: true, goods_receipt_expiry: true, hq_tax_reimburse: true, master_items_bom: true, tax_accounting_reports: true },
    guards: { can_view_cost_price: true, enforce_blind_count: false, can_approve_financial_edits: false },
  },
};

export type FnbCrewMember = {
  userId: string;
  staffName: string;
  role: string;
  checkedInAt: string;
};

export type FnbShiftRoster = {
  shiftSlot: "SHIFT_1" | "SHIFT_2";
  maxSeats: number;
  members: FnbCrewMember[];
};

export type FnbLivePrepBase = {
  baseCode: string;
  baseNameTh: string;
  yieldQtyMl: number;
  sortOrder: number;
};

export type FnbLiveZoneStock = {
  itemId: string;
  locationCode: string;
  countedQty: number;
  countStage: string;
  staffName: string;
  shortCode: string;
  nameTh: string;
  itemCategory: string;
  countUom: string;
  displaySubGroup: string;
  displayWalkOrder: number;
};

export type FnbLiveCleaningLog = {
  id: string;
  spotId: string;
  stageCode: "OPENING" | "CLOSING";
  spotNameTh: string;
  statusFlag: string;
  photoUrls: string[];
  checkedByName: string;
  checkedAt: string;
};

export type FnbPosFinancialSlip = {
  windowStart: string;
  windowEnd: string;
  isFullDayCumulative: boolean;
  orderCount: number;
  grossSales: number;
  discountTotal: number;
  promoCouponDiscount: number;
  deliveryPriceDiffDiscount: number;
  storeManualDiscount: number;
  cashAmount: number;
  thaiQrAmount: number;
  linemanAmount: number;
  grabfoodAmount: number;
  webAppAmount: number;
};

export type FnbPosMenuSlipLine = {
  rawMenuName: string;
  cupSize: string;
  qtySold: number;
  salesAmount: number;
  posCategoryName: string;
  menuId: string | null;
  matchedName: string;
  isNewMenu: boolean;
};

export type FnbPosSlipExtract = {
  slipKind: "FINANCIAL_SUMMARY" | "MENU_SALES";
  financial: FnbPosFinancialSlip | null;
  lines: FnbPosMenuSlipLine[];
  totalQtyReported: number;
  totalAmountReported: number;
  isCategoryOnlyWarning: boolean;
};

export type FnbShiftHandoverInput = {
  branchCode: string;
  workDate: string;
  shiftType: "MORNING" | "AFTERNOON";
  posSlipMode: "SHIFT_ONLY" | "CUMULATIVE_FULL_DAY";
  menuSlipIsCumulative: boolean;
  orderCount: number;
  grossSales: number;
  discountTotal: number;
  cashPos: number;
  qr: number;
  lineman: number;
  grab: number;
  webapp: number;
  drawerTotal: number;
  breakdown: { face: number; qty: number }[];
  kshopApp: number;
  linemanApp: number;
  grabGp: number;
  grabNet: number;
  depositChannel: string;
  sevenAmount: number;
  sevenSlipUrl: string;
  posSlipUrls: string[];
  menuSlipUrls: string[];
  appScreenUrls: string[];
  linemanScreenUrls?: string[];
  grabScreenUrls?: string[];
  promoCouponDiscount?: number;
  deliveryDiscount?: number;
  storeManualDiscount?: number;
  noShiftWasteConfirmed?: boolean;
  menuLines: { raw_menu_name: string; cup_size: string; qty_sold: number; sales_amount: number; pos_category_name: string }[];
  note: string;
  overrideReason: string;
  actorSource: string;
  brandLock: FnbBrandCode | null;
};

export type FnbCashHandoverAckInput = {
  branchCode: string;
  workDate: string;
  countedDrawerCash: number;
  photoUrl: string;
  note: string;
  actorSource: string;
  brandLock: FnbBrandCode | null;
};

export type FnbLiveShiftClosing = {
  shiftType: string;
  staffName: string;
  netSalesIncVat: number;
  orderCount: number;
  grossSales: number;
  discountTotal: number;
  cashPosAmount: number;
  cashCountedAmount: number;
  qrAmount: number;
  linemanAmount: number;
  grabAmount: number;
  webappAmount: number;
  drawerTotal: number;
  cashHandover: number;
  handoverStatus: string;
  handoverAcceptedByName: string;
  handoverAcceptedAt: string;
  handoverCounted: number;
  openingFloat: number;
  morningCashForward: number;
  eodDeposit: number;
  depositChannel: string;
  sevenAmount: number;
  sevenFee: number;
  sevenSlipUrl: string;
  posSlipMode: string;
  kshopAmount: number;
  linemanAppAmount: number;
  grabNet: number;
};

export type FnbLiveShiftMenuSale = {
  shiftType: string;
  menuId: string;
  rawMenuName: string;
  cupSize: string;
  qtySold: number;
  salesAmount: number;
  cumulativeQty: number | null;
  cumulativeAmount: number | null;
  categoryName: string;
  wasAutoCreated: boolean;
};

export type FnbShiftBehaviorMenu = {
  name: string;
  category: string;
  cupSize: string;
  morningQty: number;
  afternoonQty: number;
  totalQty: number;
  peak: "MORNING" | "AFTERNOON" | "TIE";
};

export type FnbShiftBehavior = {
  branchCode: string;
  morningSales: number;
  afternoonSales: number;
  morningOrders: number;
  afternoonOrders: number;
  morningCups: number;
  afternoonCups: number;
  morningStore: number;
  afternoonStore: number;
  morningDelivery: number;
  afternoonDelivery: number;
  morningApp: number;
  afternoonApp: number;
  menus: FnbShiftBehaviorMenu[];
};

export type FnbLiveSnapshot = {
  branchCode: string;
  workDate: string;
  brandCode: string;
  maxStaffPerShift: number;
  viewer: { userId: string; name: string; isSupervisor: boolean; isSuperAdmin: boolean; workspaceRole: string };
  rosters: FnbShiftRoster[];
  confirmations: FnbStageConfirmation[];
  prepBases: FnbLivePrepBase[];
  lemonItemId: string;
  wipBatches: { id: string; batchKind: string; prepBaseCode: string; itemId: string; packsDeducted: number; openedByName: string; batchStatus: string; photoUrls: string[] }[];
  calibration: FnbStoreDayBoard["calibration"];
  zoneCounts: { itemId: string; locationCode: string; countedQty: number; countStage: string; staffName: string }[];
  zoneStockCounts: FnbLiveZoneStock[];
  cleaningSpotLogs: FnbLiveCleaningLog[];
  displayLots: { itemId: string; remainingQty: number; displayExpiryDate: string; placedByName: string }[];
  closings: FnbLiveShiftClosing[];
  shiftMenuSales: FnbLiveShiftMenuSale[];
  waste: { staffName: string; totalWasteCostThb: number }[];
  writeOffs: { itemId: string; reason: string; qty: number; staffName: string; photoUrls: string[] }[];
  menuSales: { submittedByName: string; reportedTotalAmount: number } | null;
  staffOptions: { userId: string; name: string }[];
};
