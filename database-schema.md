# Supthavee ERP — Database Schema Reference (Cloud Production Verified - Phase 32)

อัปเดตพฤศจิกายน 2026 จาก `Supabase Snippet-SchemaDump.csv` และคอลัมน์/RPC ของ Phase 32 ที่โค้ดแคตตาล็อกกับบอท LINE เรียกใช้จริงบน Cloud



CRITICAL INSTRUCTION FOR AI: STRICTLY use the table names, column names, views, triggers, and RPC functions listed below. DO NOT invent, assume, or create new tables. (`bank_accounts` is DEPRECATED — always use `mst_bank_accounts`).



1. Master Data (ตารางข้อมูลหลัก)

- `mst_bank_accounts` (สมุดบัญชีธนาคารบริษัท — PK: `id`, UNIQUE: `account_no` เช่น `902-0-74651-0`)

- `mst_brands` (แบรนด์สินค้า — PK: `id`)

- `mst_categories` (หมวดหมู่สินค้า — PK: `id`, Self-FK: `parent_id`; รหัส Parent = 1 ตัวอักษร, Child = 2 ตัวอักษร)

- `mst_colors` (สีมาตรฐาน — PK: `id`, `color_code` VARCHAR(10) ล็อก 3 ตัวอักษรพิมพ์ใหญ่ เช่น `WHT`, `BLK`, `NVY`, `color_name` VARCHAR(50), `is_active` BOOLEAN, `color_family` VARCHAR(30) NOT NULL DEFAULT `OTHER`, `color_family_th` VARCHAR(50) NOT NULL DEFAULT `หลากสี/อื่นๆ`, `hex_code` VARCHAR(7) NULL)

- `mst_expense_categories` (หมวดหมู่ค่าใช้จ่าย — PK: `id`)

- `mst_asset_categories` (หมวดหมู่สินทรัพย์ถาวร — PK: `id`, `category_code`, `useful_life_years`, และคอลัมน์ `depreciation_rate` เป็น `GENERATED ALWAYS` ห้ามส่งค่าตอน Insert/Upsert)

- `mst_genders` (เพศ/ทรงเสื้อ — PK: `id`)

- `mst_sizes` (ไซส์มาตรฐาน Global Size Fixed-2 Characters — PK: `id`, `size_code`, `sort_order` Gap of 10, รวมถึงไซส์ `00` สำหรับวัตถุดิบ/งานบริการ)

- `mst_uom` (หน่วยนับสินค้า — PK: `uom_id`, `uom_code`, `uom_name`)

- `mst_wht_rates` (อัตราภาษีหัก ณ ที่จ่ายมาตรฐาน — PK: `id`, 1%, 2%, 3%, 5%)

- `mst_carriers` (บริษัทขนส่ง — PK: `carrier_id`, `carrier_code`, `carrier_name`, `contact_id`, `carrier_tier` [`PRIMARY_MONTHLY` | `OCCASIONAL`])

- `mst_document_taxonomy` (มาตรฐานเอกสารและขนาดกระดาษเริ่มต้น — PK: `doc_code`, `paper_format` [`A4_PORTRAIT` | `A5_PORTRAIT` | `A5_LANDSCAPE`])



2. Core Entities, LINE OA & HR/Payroll (องค์กร, ผู้ใช้, พนักงานเงินเดือน)

- `contacts` (คู่ค้า Multi-Role — PK: `id`, `company_name`, `nickname` [ชื่อเล่นลูกค้าหน้าร้าน เช่น พี่ก๊ก, พี่รัตน์], `tax_id` 13 หลัก, `branch_code`, `address`, `phone`, `contact_roles` VARCHAR[], `vendor_tax_tier` [`CORP_VAT` | `INDIVIDUAL_ID_1_2` | `INTERNAL_NO_ID_1_3`], `id_card_attachment_url`, `line_target_id`, `line_display_name`, `line_notify_enabled`, `line_oa_chat_url`, `succeeded_by_contact_id` UUID FK → `contacts.id` ON DELETE SET NULL, `successor_note` TEXT)

- `contact_bank_accounts` (บัญชีรับเงิน/โอนเงินของคู่ค้า — PK: `id`, FK: `contact_id` → `contacts.id`, `account_category`, `bank_code`, `bank_name`, `account_no`, `account_name`, `is_default`)

- `contact_persons` (ผู้ติดต่อภายใต้คู่ค้า — PK: `id`, FK: `contact_id`)

- `mst_employees` (ทะเบียนพนักงานเงินเดือน — PK: `id`, UNIQUE: `emp_code` [`EMP-001`..`EMP-005`], `full_name`, `nickname`, `citizen_id`, `address`, `position_title`, `department_type` [`OPEX_ADMIN_SALES` | `COGS_PRODUCTION`], `payroll_channel` [`CORPORATE_OFFICIAL` | `INTERNAL_PRIVATE`], `base_salary`, `is_sso_enrolled`, `bank_code`, `bank_name`, `bank_account_no`, `bank_account_name`, `id_card_attachment_url`, `bank_book_attachment_url`, `is_active`)

- `hr_payroll_periods` (งวดเงินเดือนและประกันสังคม — PK: `id`, UNIQUE: `period_year` + `period_month`, `period_label`, `sso_rate_pct` [5.00], `sso_wage_ceiling` [15000.00], `official_gross_total`, `official_net_total`, `internal_gross_total`, `internal_net_total`, `sso_employee_total`, `sso_employer_total`, `sso_total_remittance`, `sso_payment_status`, `sso_payment_date`, `sso_payment_slip_url`, `sso_receipt_no`, `sso_reference_no`, `sso_employer_account_no` [`9020012177`], `paid_sso_from_account`, `linked_sso_expense_id` FK → `expenses.id`, `status`)

- `hr_payroll_items` (รายการคำนวณเงินเดือนรายบุคคล — PK: `id`, UNIQUE: `payroll_period_id` + `employee_id`, `payroll_channel`, `base_salary`, `ot_amount`, `allowance_amount`, `commission_amount`, `bonus_amount`, `gross_income`, `sso_employee_amount`, `sso_employer_amount`, `wht_tax_amount`, `other_deduction`, `net_pay`, `payment_status`, `payment_date`, `paid_from_account`, `payment_slip_url`, `payment_reference_no`, `linked_expense_id`)

- `line_known_groups` (PK: `group_id` VARCHAR(100), `group_name` VARCHAR(200), `picture_url`, `last_message_preview`, `last_active_at`, `linked_contact_id` → `contacts.id`, `last_reply_token` VARCHAR(200), `reply_token_expires_at`, `updated_at`, `chat_room_url`)

- `line_notification_logs` (ประวัติการส่งสลิปผ่าน LINE OA — PK: `id`, `document_id` FK → `documents.id`, `contact_id` FK → `contacts.id`, `target_id`, `message_text`, `slip_url`, `status`, `error_message`, `created_at` TIMESTAMPTZ; มี Trigger `trg_stamp_document_line_notified` อัปเดต `documents.line_notified_at`)

- `user_profiles`, `app_roles`, `system_settings` (มี `ocr_primary_model = 'gemini-3.7-flash'` และ `ocr_fallback_models`), `system_parameters`, `parameter_change_requests`



3. Products, Inventory & Production (สินค้า, คลัง, ผลิต)

- `product_models` (รูปหลัก `image_url`; ช่องแคตตาล็อก Phase 32: `catalog_name` VARCHAR(200), `catalog_image_url`, `catalog_storage_path`, `size_chart_image_url`, `size_chart_storage_path` — รายละเอียดในข้อ 9), `products` (5,923+ SKUs สำเร็จรูป/งานบริการ; Schema Dump `est_rows=6042`), `vendor_product_mapping` (Schema Dump `est_rows=6357`), `inventory_ledger`, `product_boms`, `production_jobs` (`finished_model_id` nullable, `ref_document_id`, `ref_document_item_id` → `document_items.id` แยกการ์ด Kanban ต่อบรรทัดบริการ, `job_no`, `status`, `target_quantity`, `mockup_image_url`, `remark`), `production_job_items`, `production_job_materials`, `production_job_operations`, `technician_rates`
- `products` แยกราคาตามบิลออกจากทุน TAS 2: `cost_price` = ทุนก่อน VAT (เช่น `40.19 / 44.86 / 49.53`) ใช้ตีสต็อกและกำไรเท่านั้น; `last_invoice_unit_price` NUMERIC NULL และ `last_invoice_vat_mode` VARCHAR(20) NULL = ราคาตามหน้าบิล (เช่น `43.00 / 48.00 / 53.00`) ใช้ Prefill หน้าคีย์รับสินค้าเท่านั้น; `is_inc_vat_cost_normalized` BOOLEAN NOT NULL DEFAULT false. ห้ามนำ `last_invoice_unit_price` ไปคูณ 1.07 ซ้ำ และห้ามใช้เป็นต้นทุนสต็อกหรือกำไร



4. Documents, Expenses & Financials (เอกสาร, ค่าใช้จ่าย, การเงิน)

- `documents` (เอกสารหลักทั้งระบบ 76+ คอลัมน์ — PK: `id`, `doc_no`, `doc_type`, `status`, `doc_date`, `due_date`, `contact_id`, `contact_person_id`, `ref_doc_id`, `ref_document_id`, `sub_total`, `total_amount`, `discount_text`, `discount_amount`, `net_before_vat`, `vat_type` [ENUM: `vat_calculation_type`], `vat_rate`, `vat_amount`, `tax_rate`, `tax_amount`, `wht_rate`, `wht_amount`, `grand_total`, `deposit_deducted`, `deposit_net_deducted`, `deposit_vat_deducted`, `deposit_doc_id`, `paid_amount`, `payment_status`, `accounting_tax_tier` [`CORP_VAT` | `RECEIPT_1_2` | `INTERNAL_1_3`], `cash_receipt_no`, `tax_invoice_status`, `tax_invoice_no`, `tax_invoice_date`, `sales_channel` [`STORE` | `SHOPEE` | `LAZADA` | `TIKTOK`], `ecommerce_order_no`, `ecommerce_buyer_name`, `tracking_no`, `one_time_address`, `attachment_url`, `attached_file_url`, `attachment_urls`, `attachments`, `line_notified_at`, `line_notified_count`, `reference_no`, `handwritten_doc_ref` [Trigger ซิงค์คู่กับ `reference_no`], `notes`)

- `documents.payment_channel` (`COMPANY_BANK` | `CASH` | `OTHER_BANK`), `bank_account_id` → `mst_bank_accounts`, `receiving_bank_label`, `is_swept_to_company`, `swept_to_company_at`, `swept_batch_ref` — แยกช่องทางรับเงินและติดตามยอดเงินสด/บัญชีอื่นที่ยังไม่โอนเข้าบัญชีบริษัท. RPC `get_unswept_receipts_summary()`

- `documents` ค่าขนส่งฝากส่งของบิลขาย: `shipping_fee`, `shipping_method` [`VAN` | `FLASH` | `KERRY` | `THAILAND_POST` | `OTHER`], `shipping_vat_mode` [`EXEMPT` | `NONE`], `shipping_tracking_no`. บวกเข้า `grand_total` หลัง VAT และไม่เข้า `net_before_vat` ตามประมวลรัษฎากร ม.81(1)(ณ). `update_sales_document_direct` รับ `p_shipping_fee`, `p_shipping_method`, `p_shipping_vat_mode`, `p_shipping_tracking_no`

- `documents` ภาษีหัก ณ ที่จ่าย: `wht_rate`, `wht_amount`, `net_received_amount`, `wht_attachment_url`, `wht_status` [`NONE` | `PENDING_CERT` | `RECEIVED`]. ฐานคำนวณคือ `net_before_vat - deposit_net_deducted` ไม่ใช่ `grand_total`. RPC `attach_sales_document_wht_certificate(p_document_id, p_wht_rate, p_wht_amount, p_wht_attachment_url)` ใช้แนบใบ 50 ทวิย้อนหลัง

- `doc_headers` (ตารางคู่ขนาน — `contact_id` ปลด `NOT NULL` แล้วเพื่อรองรับบิลขายหน้าร้าน `ABB` และ E-Commerce, `reference_no` ซิงค์จาก `documents.reference_no` / `handwritten_doc_ref`, `payment_status`, `paid_amount`)

- `document_items` (PK: `id`, `document_id`, `product_id` [Nullable สำหรับรายการบริการหรือวัตถุดิบ], `is_service_item` BOOLEAN, `description`, `qty` NUMERIC(14,4), `uom_used`, `unit_price`, `unit_cost_price`, `unit_cost_ex_vat` NUMERIC NULL [ล็อกทุน TAS 2 ณ วันขาย], `discount_text`, `discount_amount`, `line_total`, `sort_order`, `technician_id`, `wage_cost`, `technician_bill_id`, `mockup_image_url`, `is_sent_to_production`, `production_status`, `material_id` UUID NULL FK → `mst_materials.id` ON DELETE SET NULL, `item_nature` VARCHAR(30) NOT NULL DEFAULT `STOCK_ITEM`, `skip_stock_ledger` BOOLEAN NOT NULL DEFAULT false)

- `sales_item_mappings` (จำคำบนบิลขาย — `source_text`, `normalized_text`, `product_id` [Nullable], `is_service_item` BOOLEAN, `sku`, `description`, `uom_used`)

- `bank_statement_imports` (หัวไฟล์ Statement กรุงไทย — `bank_code` [`KTB`], `account_no`, `file_name`, `source_filename` ส่งคู่กับ `file_name` ทุกครั้งที่นำเข้า, `source_kind`, `row_count`, `created_by`)

- `bank_statement_lines` (รายการเดินบัญชี — FK: `import_id`, `tx_date`, `tx_time`, `tx_code`, `description`, `payer_hint`, `withdrawal_amount`, `deposit_amount`, `tx_direction` [`IN` | `OUT`], `expense_memo`, `balance_amount`, `row_hash` TEXT UNIQUE สำหรับ upsert กันไฟล์ซ้อนวัน, `reconcile_status` [`UNMATCHED` | `PARTIAL` | `MATCHED`], `matched_amount`)

- `bank_reconciliation_allocations` (ชนยอดเงินฝากกับบิลขาย — FK: `statement_line_id`, FK: `document_id`, `allocated_amount`, `platform_fee_diff`, `created_by`)

- `get_reconcile_candidate_documents()` และ Trigger `trg_sync_parent_child_document_settlement` — ยอดตัดได้ของบิลขายคือ `grand_total - deposit_deducted - wht_amount - allocated` โดยไม่หัก `wht_amount` ซ้ำ และไม่แสดง `SO` ที่ถูกแปลงเป็น `CS_TAX` / `TAX_INV` / `INV_DO` / `ABB` ที่ออกเลขแล้ว

- `get_statement_lines_with_matches(p_import_id uuid DEFAULT NULL)` คืนรายการเดินบัญชีพร้อม `matched_doc_nos` และ `matched_documents` (เลขที่บิล, ลูกค้า, อ้างอิงบิลมือ, เลขสลิป, ยอดเต็ม, มัดจำ, หัก ณ ที่จ่าย, ยอดที่ชน, เลขใบสั่งขายต้นทาง)

- `unmatch_statement_line_allocation(p_statement_line_id uuid, p_document_id uuid DEFAULT NULL)` ปลดคู่ชนยอดทั้งบรรทัด หรือเฉพาะบิลที่ระบุ แล้วคืนบิลกลับเข้าลิสต์รอชน

- `reclassify_document_payment_channel(p_document_id, p_new_channel, p_bank_account_id)` (ย้ายบิลออกจากหน้าชนยอด KTB ไปช่องทาง `CASH` หรือ `OTHER_BANK`)

- `expenses` (บิลค่าใช้จ่าย / OPEX — PK: `id`, ซิงก์คอลัมน์เลขเอกสาร `expense_no` = `doc_no` = `document_no`, ซิงก์วันที่ `expense_date` = `doc_date`, ซิงก์รายละเอียด `description` = `remark`, ซิงก์หมวดหมู่ `category` = `expense_category`, `contact_id` FK → `contacts.id`, `vendor_name`, `vendor_tax_id`, `tax_invoice_no`, `reference_no`, `vehicle_plate`, `tax_type` [`INCLUSIVE` | `EXCLUSIVE` | `NO_VAT`], `tax_invoice_status`, `accounting_tax_tier`, `net_amount`, `sub_total`, `amount`, `vat_rate`, `vat_amount`, `wht_rate`, `wht_amount`, `total_amount`, และ **`grand_total` เป็น `GENERATED ALWAYS AS (net_amount + vat_amount) STORED` ห้ามส่งค่าเข้า Insert/Update เด็ดขาด**, `bank_account_id` [Single FK → `mst_bank_accounts.id`], `attachment_url`, `payment_slip_url`, `status`, `payment_status`)

- `expense_items` (รายการย่อยของบิลค่าใช้จ่าย — PK: `id`, FK: `expense_id` → `expenses.id` ON DELETE CASCADE, `line_no`, `item_description`, `quantity`, `unit_name`, `unit_price`, `discount_amount`, `line_total`)

- `document_allocations`, `billing_note_items`, `payment_transactions` (เปิด RLS Policy `FOR ALL TO authenticated` ครบแล้ว), `expense_installments`, `fixed_assets`, `asset_depreciation_ledger`, `accounting_periods`, `approval_logs`, `audit_logs`



5. Supabase Storage Buckets (Public Read CDN & Authenticated Write)

- `document_attachments`, `expense_documents`, `procurement_bills`, `product_assets`, `production_attachments`, `payment-slips`



6. Key Database Triggers & RPC Functions (Phase 22–24)

- `public.settle_ap_invoices_bulk_fast(p_pay_doc_id UUID, p_billing_note_id UUID, p_allocations JSONB)`

- `public.generate_or_sync_payroll_period(p_year INT, p_month INT, p_sso_rate_pct NUMERIC)`

- `public.recalculate_payroll_period_totals(p_period_id UUID)`

- `public.update_employee_id_card_attachment(p_employee_id UUID, p_id_card_url TEXT, p_bank_book_url TEXT)`

- `public.record_sso_remittance_and_expense(p_period_id UUID, p_payment_date DATE, p_receipt_no VARCHAR, p_reference_no VARCHAR, p_slip_url TEXT, p_paid_from_account VARCHAR)`

- `public.save_expense_direct_no_draft(...)` & `public.update_expense_direct(...)`

- `public.fn_sync_expenses_standard_columns()` & `public.fn_auto_fill_expense_vendor_name()`

- `public.update_sales_document_direct(...)`


- `public.generate_abb_channel_doc_no(p_sales_channel TEXT, p_doc_date DATE, p_document_id UUID DEFAULT NULL)` — เลข ABB หน้าร้าน `ABB-YYMM-XXXX`, Shopee `SPMM/XX`, Lazada `LZMM/XX` ตามเดือนของ `doc_date`

- Index `idx_documents_ecom_order_lookup` บน `documents` (`sales_channel`, `ecommerce_order_no`)

- Trigger ซิงค์ `documents.reference_no` กับ `documents.handwritten_doc_ref` และคัดลอก `reference_no` ไป `doc_headers`

7. Factory Materials (Phase 29–30 — ไม่ผูก SKU เสื้อขาย)

- `mst_material_categories` (PK: `code` VARCHAR(40), `name_th`, `name_en`, `default_purchase_uom` DEFAULT `KG`, `default_usage_uom` DEFAULT `KG`, `sort_order`, `is_active`)
- `mst_materials` (PK: `id` UUID, `material_code` VARCHAR(40) NOT NULL, `material_name`, `spec_description`, `category_code` FK → `mst_material_categories.code`, `stock_control_mode` VARCHAR(30) NOT NULL DEFAULT `BOM_BACKFLUSH` [`BOM_BACKFLUSH` | `SHOP_FLOOR_ISSUE` | `DIRECT_CONSUMABLE`], `purchase_uom`, `usage_uom`, `uom_conversion_factor` NUMERIC DEFAULT 1, `reference_purchase_price`, `last_purchase_price`, `moving_avg_usage_cost`, `current_usage_qty`, `reorder_point_usage_qty`, `default_vendor_id` FK → `contacts.id`, `is_active`; Schema Dump `est_rows=22`)
- `material_vendor_mappings` (PK: `id`, `contact_id`, `raw_vendor_code`, `raw_vendor_desc`, `material_id` FK → `mst_materials.id` ON DELETE CASCADE, `last_unit_price`, `lookup_key` VARCHAR(200))
- `product_model_bom_materials` (PK: `id`, `finished_model_id`, `material_id` FK → `mst_materials.id` ON DELETE RESTRICT, `usage_qty_per_unit`, `waste_pct` DEFAULT 0, `notes`, `sort_order`)
- `material_stock_ledger` (PK: `id`, `material_id` FK → `mst_materials.id` ON DELETE RESTRICT, `tx_type` VARCHAR(30), `tx_date`, `document_id`, `finished_model_id`, `production_ref_key`, `purchase_qty`, `usage_qty_delta`, `unit_usage_cost`, `total_cost`, `notes`, `actor_user_id`)
- โหมดควบคุม: `BOM_BACKFLUSH` แปลงหน่วยซื้อเป็นหน่วยใช้ผ่าน `record_material_purchase_inbound` และตัดเมื่อผลิตเสร็จผ่าน `backflush_bom_for_production`; `SHOP_FLOOR_ISSUE` เบิกหน้าเครื่อง; `DIRECT_CONSUMABLE` ตัดต้นทุนทันทีเมื่อซื้อ และแจ้งเตือนเมื่อราคาซื้อเกิน `reference_purchase_price`
- บรรทัดวัตถุดิบบนเอกสารซื้อใช้ `document_items.material_id` โดย `product_id` เป็น NULL, `skip_stock_ledger = true` และไม่ลง `inventory_ledger`

8. Phase 25–31.2 Triggers & RPC (ยืนยันจาก Schema Dump)

- `public.attach_sales_document_wht_certificate(p_document_id uuid, p_wht_rate numeric, p_wht_amount numeric, p_wht_attachment_url text)` RETURNS jsonb
- `public.get_ap_doc_settlement_modes(p_document_ids uuid[])` RETURNS TABLE(`document_id`, `settlement_mode`, `payment_channel`, `bank_label`) — ค่า `settlement_mode` เป็น `'โอน'` หรือ `'สด'`
- `public.recover_inc_vat_unit_price(p_ex_vat_cost numeric)` RETURNS numeric IMMUTABLE — ใช้เมื่อไม่มี `last_invoice_unit_price` เท่านั้น ห้ามเรียกกับราคาตามบิลที่บันทึกแล้ว
- `public.get_erp_financial_kpis_and_profit(p_start_date date, p_end_date date)` RETURNS jsonb SECURITY DEFINER STABLE — แหล่งเดียวของ Executive Dashboard และรายงานการเงิน
- `public.record_material_purchase_inbound(p_document_id uuid, p_material_id uuid, p_purchase_qty numeric, p_net_line_amount numeric, p_tx_date date, p_notes text)` RETURNS jsonb
- `public.backflush_bom_for_production(p_production_ref_key text, p_finished_model_id uuid, p_produced_qty numeric, p_document_id uuid, p_tx_date date)` RETURNS jsonb
- `public.upsert_material_vendor_mapping(p_contact_id uuid, p_raw_vendor_code text, p_raw_vendor_desc text, p_material_id uuid, p_last_unit_price numeric)` RETURNS jsonb
- Trigger `trg_enforce_ap_inv_non_vat_on_insert` BEFORE INSERT ON `documents` EXECUTE `fn_enforce_ap_inv_non_vat_on_insert` — ล็อก `AP_INV` ให้ `vat_amount = 0` และสถานะภาษี `TAX_READY`
- Trigger `trg_snapshot_sales_item_tas2_cost` BEFORE INSERT ON `document_items` EXECUTE `fn_snapshot_sales_item_tas2_cost` — บันทึก `unit_cost_ex_vat` จากทุน TAS 2 ณ วันขาย
- เอกสาร `AP_CN` คือใบลดหนี้ซื้อ หักเจ้าหนี้คงค้างและปรับปรุงภาษีซื้อกับสต็อก เลขใบรับเงินกลุ่ม 1.2 คือ `RCV-YYMM-XXXX` ไม่ใช่ `CA01/XXXX`

9. Colorway Visual Catalog & LINE Sales Bot (Phase 32 — จบแล้ว)

ไม่มีไฟล์ SQL migration ในโปรเจกต์สำหรับชุดนี้ ฟังก์ชันอยู่บน Supabase Cloud และถูกเรียกจาก Server Action / webhook เท่านั้น

- `product_model_color_images` (รูปแยกสีของรุ่น — PK: `id` UUID, `model_id` UUID NOT NULL, `color_id` UUID NOT NULL, `color_code` VARCHAR(10) NOT NULL, `image_url` TEXT NOT NULL, `storage_path` TEXT, `source_poster_url` TEXT, `crop_meta` JSONB NOT NULL DEFAULT `{}`, `sort_order` INTEGER NOT NULL DEFAULT 0, `created_by` UUID, `created_at`, `updated_at`)
- `product_models` ช่องรูปที่ไม่บังคับ: `catalog_name` VARCHAR(200), `catalog_image_url` TEXT, `catalog_storage_path` TEXT, `size_chart_image_url` TEXT, `size_chart_storage_path` TEXT คู่กับรูปหลักเดิม `image_url` ไม่มีคอลัมน์ `main_storage_path`
- `mst_colors.color_family`, `color_family_th`, `hex_code` ใช้กรองตระกูลสีบน `/sales/catalog` หน้าเว็บอ่าน `mst_categories` (`id`, `category_code`, `category_name`, `is_active`) คู่กับสีที่ `is_active = true`
- Storage bucket `product_assets` เท่านั้น พาธ ASCII: รูปแยกสี `colorways/{MODEL}/{COLOR}_{uuid}.webp|jpg|png` และช่องรุ่น `models/{MODEL}/main_|catalog_|sizechart_{uuid}.webp|jpg|png` ไฟล์ไม่เกิน 5MB ชนิด jpeg/png/webp ช่อง `CATALOG` กับ `SIZE_CHART` ส่งออก WebP ขอบยาวไม่เกิน 2048px คุณภาพ 0.92 การคัดลอกรูปหลักไปใบ Catalog ส่ง `p_storage_path` เป็น null เพื่อไม่ให้การลบช่อง Catalog ไปลบไฟล์รูปหลัก
- RPC ที่โค้ดเรียกจริง:
  - `search_colorway_sales_catalog(p_search_text text, p_color_family text, p_category_id uuid, p_in_stock_only boolean, p_limit integer)` RETURNS TABLE ที่รวม `display_image_url`, `colorway_image_url`, `model_poster_url`, `model_main_image_url`, `catalog_image_url`, `size_chart_image_url`, `has_colorway_image`, `total_on_hand_qty`, `in_stock_size_count`, `min_retail_price`, `max_retail_price`, `min_wholesale_price`, `max_wholesale_price`, `sizes_breakdown` jsonb คีย์ที่แอปอ่านคือ `sku`, `size`, `product_id`, `on_hand_qty`, `retail_price`, `wholesale_price` หน้าเว็บใช้ `p_limit` 240 บอทใช้ `p_limit` 12
  - `get_model_colorway_cropper_state(p_model_id uuid)` RETURNS jsonb ก้อน `model` (`model_id`, `model_code`, `name`, `short_name`, `catalog_name`, `main_image_url` / `poster_image_url`, `catalog_image_url`, `size_chart_image_url`) และ `colors[]` (`color_id`, `color_code`, `color_name`, `color_family`, `color_family_th`, `hex_code`, `sku_count`, `colorway_image_url`, `storage_path`, `crop_meta`)
  - `upsert_product_model_color_image(p_model_id uuid, p_color_id uuid, p_image_url text, p_storage_path text, p_source_poster_url text, p_crop_meta jsonb, p_actor_id uuid)` RETURNS jsonb คีย์ที่แอปอ่าน `ok`, `error`, `old_storage_path`
  - `delete_product_model_color_image(p_model_id uuid, p_color_id uuid)` RETURNS jsonb คีย์ที่แอปอ่าน `ok`, `error`, `deleted_storage_path`
  - `update_product_model_catalog_meta(p_model_id uuid, p_catalog_name text)` RETURNS jsonb คีย์ที่แอปอ่าน `ok`, `error`, `catalog_name`
  - `set_product_model_visual_slot(p_model_id uuid, p_slot text, p_image_url text, p_storage_path text)` RETURNS jsonb `p_slot` คือ `MAIN` | `CATALOG` | `SIZE_CHART` คีย์ที่แอปอ่าน `ok`, `error`, `old_storage_path` ช่อง `MAIN` ไม่มี path เก่าให้ลบ
  - `lookup_model_catalog_for_bot(p_query text)` RETURNS TABLE(`model_id`, `model_code`, `model_name`, `model_short_name`, `catalog_name`, `brand_name`, `category_name`, `model_main_image_url`, `catalog_image_url`, `size_chart_image_url`) ใช้เมื่อค้น SKU ไม่เจอแถว
- หน้า `/sales/catalog` แสดง `display_image_url` และป้าย `has_colorway_image` (`รูปเฉพาะสี` หรือ `โปสเตอร์รวม`) พนักงานเห็นช่วงราคาปลีกและราคาส่ง บอท LINE ไม่ส่ง `vendor_id`, `cost_price`, `last_invoice_unit_price`, `wholesale_price`
- `line_webhook_events_log` คอลัมน์ที่ webhook ใช้: `id`, `event_type` VARCHAR(50), `source_type` VARCHAR(30), `source_group_id` VARCHAR(100), `source_user_id` VARCHAR(100), `reply_token` VARCHAR(200), `message_text`, `raw_payload` JSONB, `received_at`, `bot_reply_status` VARCHAR(40), `bot_reply_error` TEXT สถานะที่เขียนจริงคือ `REPLIED_OK`, `REPLIED_FALLBACK`, `SKIPPED`, `FAILED` ข้อความที่ไม่ได้ขึ้นต้นด้วย `#` ได้ `SKIPPED` และไม่มีการ reply
- `system_settings` ที่บอทขายอ่าน/เขียน: `line_oa_basic_id` (ค่าเริ่มต้น `@hzr1801v`), `line_channel_access_token`, `line_channel_secret`, `line_webhook_url`, `line_webhook_last_verified_at` ลิงก์ที่ลงทะเบียนต้องเป็น `https://<VERCEL_PROJECT_PRODUCTION_URL>/api/line/webhook` ห้ามค้างโฮสต์ Vercel แบบ deployment hash
- Webhook `POST /api/line/webhook` บันทึกแถว log ก่อน แล้วตอบเฉพาะคำสั่ง `^#(รูป|พร้อมส่ง|สต็อก|แคตตาล็อก|catalog|เช็ค|ไซส์|ตารางไซส์|ตารางขนาด|size)\s*(.*)$` ผ่าน Reply Token จากนั้นอัปเดต `bot_reply_status` กับ `bot_reply_error` ก่อน HTTP 200 แคร์รูเซลรุ่นเดียวไม่เกิน 12 ใบ หลายรุ่นไม่เกิน 10 ใบ
