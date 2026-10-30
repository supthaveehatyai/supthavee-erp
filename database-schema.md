Supthavee ERP - Database Schema Reference (Cloud Production Verified - Phase 22)

CRITICAL INSTRUCTION FOR AI: STRICTLY use the table names, column names, views, triggers, and RPC functions listed below. DO NOT invent, assume, or create new tables. (bank_accounts is DEPRECATED — always use mst_bank_accounts).

1. Master Data (ตารางข้อมูลหลัก)

mst_bank_accounts (สมุดบัญชีธนาคารบริษัท — PK: id, UNIQUE: account_no)

mst_brands (แบรนด์สินค้า — PK: id)

mst_categories (หมวดหมู่สินค้า — PK: id, Self-FK: parent_id; รหัส Parent = 1 ตัวอักษร, Child = 2 ตัวอักษร; ตอน Restore ต้องเรียง parent_id IS NULL ขึ้นก่อนเสมอ)

mst_colors (สีมาตรฐาน — PK: id, ล็อกรหัสสี 3 ตัวอักษรพิมพ์ใหญ่ เช่น WHT, BLK, NVY)

mst_expense_categories (หมวดหมู่ค่าใช้จ่าย — PK: id)

mst_asset_categories (หมวดหมู่สินทรัพย์ถาวร — PK: id, category_code, useful_life_years, และคอลัมน์ depreciation_rate เป็น GENERATED ALWAYS ห้ามส่งค่าตอน Insert/Upsert)

mst_genders (เพศ/ทรงเสื้อ — PK: id)

mst_sizes (ไซส์มาตรฐาน Global Size Fixed-2 Characters — PK: id, size_code, sort_order Gap of 10, รวมถึงไซส์ 00 สำหรับวัตถุดิบ/งานบริการ)

mst_uom (หน่วยนับสินค้า — PK: uom_id, uom_code, uom_name เช่น PCS, KGS, MTR, DZN)

mst_wht_rates (อัตราภาษีหัก ณ ที่จ่ายมาตรฐาน — PK: id, 1%, 2%, 3%, 5%)

mst_carriers (บริษัทขนส่ง — PK: carrier_id, carrier_code, carrier_name, contact_id, carrier_tier [PRIMARY_MONTHLY | OCCASIONAL], requires_monthly_receipt, tax_id, branch_code, default_wht_rate)

mst_document_taxonomy (มาตรฐานเอกสารและขนาดกระดาษเริ่มต้น — PK: doc_code, doc_name_th, doc_name_en, module_group, paper_format [A4_PORTRAIT | A5_PORTRAIT | A5_LANDSCAPE], max_items_per_page, show_signature_block)

2. Core Entities (องค์กร, ผู้ใช้, ตั้งค่า)

contacts (คู่ค้า Multi-Role — PK: id, ใช้ contact_roles VARCHAR[] เท่านั้น; มี default_doc_type, default_vat_mode, default_credit_days, default_freight_tax_mode, vendor_tax_tier [CORP_VAT | INDIVIDUAL_ID_1_2 | INTERNAL_NO_ID_1_3], id_card_attachment_url)

contact_bank_accounts (บัญชีรับเงินของคู่ค้าแบบหลายบัญชี — PK: id, FK: contact_id → contacts.id ON DELETE CASCADE, account_category [CORPORATE_TAX | PERSONAL_NON_TAX | PROMPTPAY | OTHER], bank_code, bank_name, account_no, account_name, branch_name, qr_image_url, notes, is_default, is_active, created_by, created_at, updated_at; บัญชีหลักแยกตาม account_category ผ่าน Trigger trg_sync_default_contact_bank_account; บันทึกผ่าน RPC upsert_contact_bank_account)

contact_persons (ผู้ติดต่อภายใต้คู่ค้า — PK: id, FK: contact_id)

user_profiles (โปรไฟล์พนักงาน/ผู้ใช้งาน — PK: id, role_code, data_access_scope [ALL | OWN], approval_limit, is_active)

app_roles (สิทธิ์การใช้งาน Dynamic RBAC — PK: role_code, accessible_modules JSONB)

system_settings (ตั้งค่าระบบบริษัท Singleton — PK: id = 1, company_name, company_name_en = 'Supthavee Hatyai Co., Ltd.', branch_code = '00000', allow_negative_inventory, document_print_settings, line_channel_access_token, line_channel_secret, line_oa_account_uid, line_webhook_url, line_webhook_last_verified_at)

line_known_groups (PK: group_id, group_name, picture_url, last_message_preview, last_active_at, linked_contact_id → contacts.id, last_reply_token, reply_token_expires_at, chat_room_url, created_at, updated_at)

line_webhook_events_log (id, event_type, source_type, source_group_id, source_user_id, reply_token, message_text, raw_payload jsonb, received_at)

public.get_line_webhook_status_summary() RETURNS jsonb (known_groups จาก line_known_groups ไม่เกิน 50 กลุ่ม และ recent_events 10 รายการล่าสุด)

system_parameters (ค่า config ระบบ — PK: param_key, param_value JSONB, data_type)

parameter_change_requests (คำขอแก้ไขค่าพารามิเตอร์/เอกสารแบบ Maker-Checker — PK: id, param_key, status [PENDING | APPROVED | REJECTED])

3. Products, Inventory & Production (สินค้า, คลัง, ผลิต)

product_models (รุ่นสินค้า — PK: id, base_uom_id, purchasing_uom_id, uom_conversion_factor, is_raw_material, is_service, is_manufactured, image_url)

products (สินค้า SKU ย่อย 3,811+ SKUs — PK: id, model_id, sku, color, size, cost_price, last_purchase_price, retail_price, wholesale_price, is_active)

vendor_product_mapping (การผูกรหัสสินค้าซัพพลายเออร์ 3,917+ แถว — PK: id, vendor_id, raw_vendor_sku / vendor_sku, internal_product_id / product_id, normalized_key [สร้างอัตโนมัติผ่าน Trigger trg_compute_vendor_mapping_normalized_key], size_token, conversion_factor, purchase_uom_code, default_tax_type; มี Trigram Index idx_vpm_normalized_trgm)

inventory_ledger (สมุดบัญชีคลังสินค้า — PK: id, created_at, product_id, doc_header_id [ตรวจสอบความถูกต้องร่วมระหว่าง doc_headers และ documents ผ่าน Trigger trg_validate_inventory_ledger_doc_header], document_id FK -> documents.id, trans_type VARCHAR [IN | OUT | ADJUST], qty NUMERIC(14,4), unit_cost NUMERIC, notes VARCHAR)

product_boms (สูตรการผลิต — PK: id, finished_model_id, raw_material_model_id, uom_id, quantity_required, waste_percent)

production_jobs (ใบสั่งผลิต / งาน MTO — PK: id, job_no, document_id / ref_document_id โยง SO, product_model_id, target_quantity, status, mockup_image_url, wage_cost, technician_id, technician_bill_id)

production_job_items (รายละเอียดไซส์งานผลิต — PK: id, job_id, product_id, quantity)

production_job_materials (วัตถุดิบ WIP — PK: id, job_id, raw_material_model_id, uom_id, planned_qty NUMERIC(14,4), actual_used_qty NUMERIC(14,4), cost_price_snapshot)

production_job_operations (ขั้นตอนการผลิต In-house Routing — PK: id, job_id, operation_name, technician_id, wage_cost, technician_bill_id, status)

technician_rates (เรตค่าแรงช่างผูกกับ product_models — PK: id)

4. Documents & Financials (เอกสารและการเงิน)

documents (เอกสารหลักทั้งระบบ — PK: id, doc_no, doc_type, doc_date, contact_id, vat_type [ENUM: vat_calculation_type], sub_total [มีขีดล่าง _ คั่น], discount_amount, vat_amount, grand_total, status [DRAFT | PENDING | ISSUED | VOID | PAID], payment_status [UNPAID | PARTIAL | PAID], accounting_tax_tier [CORP_VAT | RECEIPT_1_2 | INTERNAL_1_3], cash_receipt_no เช่น CA01/0001, attachment_urls TEXT[], attachments JSONB, freight_cost / origin_freight_amount, dest_freight_cost / dest_freight_amount, dest_freight_paid_status [NOT NULL, Default 'NONE' ควบคุมผ่าน Trigger trg_sanitize_document_defaults], carrier_id, sales_channel, ecommerce_order_no, ecommerce_buyer_name, tracking_no, one_time_address, created_by)

document_items (รายการสินค้าในเอกสาร — PK: id, document_id, product_id, qty NUMERIC(14,4), uom_used, unit_price, unit_cost_price, net_unit_cost, line_total, prorated_freight, technician_id, wage_cost, technician_bill_id, mockup_image_url)

doc_headers / doc_details (ตารางเอกสารคู่ขนานสำหรับระบบรับสินค้าและ FK ของ billing_note_items — มีคอลัมน์ attachment_urls TEXT[], attachments JSONB)

document_allocations (การตัดยอดหนี้ / มัดจำ / ลดหนี้ / คืนเงิน — PK: id, receipt_doc_id, invoice_doc_id, allocated_amount, wht_amount, original_receipt_received)

billing_note_items (รายการใบวางบิล — PK: id, billing_note_id, invoice_id, billed_amount)

expenses (บิลค่าใช้จ่าย / OPEX — PK: id, net_amount, vat_amount, และคอลัมน์ grand_total เป็น GENERATED ALWAYS AS (net_amount + vat_amount) ห้ามส่งค่าตอน Insert/Upsert)

expense_installments (งวดผ่อนชำระ TFRS 16 — PK: id, principal_amount, interest_amount, และคอลัมน์ total_installment เป็น GENERATED ALWAYS AS (principal_amount + interest_amount) ห้ามส่งค่าตอน Insert/Upsert)

payment_transactions (ธุรกรรมการรับ/จ่ายเงินสดและธนาคาร — PK: id)

payment_allocations (การตัดยอดหนี้ผ่อนชำระ — PK: id, expense_id, document_id)

approval_logs (ประวัติการอนุมัติ/ปฏิเสธ Maker-Checker — PK: id)

accounting_periods (งวดบัญชีรายเดือน Period Lock — PK: id)

fixed_assets (ทะเบียนสินทรัพย์ถาวร — PK: id, acquisition_cost, current_accumulated_depreciation, และคอลัมน์ current_net_book_value เป็น GENERATED ALWAYS AS (acquisition_cost - current_accumulated_depreciation) ห้ามส่งค่าตอน Insert/Upsert)

asset_depreciation_ledger / depreciation_ledgers (สมุดบันทึกค่าเสื่อมราคา — PK: id)

audit_logs (ประวัติการเปลี่ยนแปลงข้อมูล JSONB แบบ Append-Only — PK: id)

5. Supabase Storage Buckets

product_assets (รูปภาพสินค้าระดับรุ่น product_models)

procurement_bills (รูปบิลซื้อ/ใบส่งของอ้างอิงจากหน้า Manual Receipt และ AI OCR — รองรับ JPEG, PNG, WebP, PDF ขนาดไม่เกิน 10MB)

production_attachments (รูปภาพ Mockup งานสั่งผลิต MTO บนบอร์ด Kanban)

payment_slips / เอกสารแนบการเงิน (สลิปโอนเงินและหนังสือรับรองหัก ณ ที่จ่าย 50 ทวิ)

6. Key Database Triggers, Functions & RPCs

public.is_admin() (ตรวจสอบสิทธิ์ผู้บริหารจาก user_profiles แบบ SECURITY DEFINER)

public.normalize_ocr_text(p_text TEXT) & public.extract_size_token(p_text TEXT) (ฟังก์ชันยุบช่องว่าง/สัญลักษณ์และสกัดรหัสไซส์สำหรับจับคู่สินค้า AI OCR)

public.get_vendor_receipt_defaults(p_vendor_id UUID) (ดึงค่าเริ่มต้นโหมดภาษี ประเภทเอกสาร และรายการสินค้าที่ผูกกับผู้จำหน่าย)

public.admin_revise_purchase_vat_mode(p_doc_no TEXT, p_new_vat_mode TEXT, p_reason TEXT) (RPC สำหรับ Admin ปรับปรุงประเภทภาษี INC_VAT/EXC_VAT/NONE ของเอกสารซื้อที่ออกแล้ว คำนวณฐานต้นทุน TAS 2 ใหม่ รองรับการ Cast ENUM vat_calculation_type และบันทึก audit_logs)

public.trg_protect_issued_documents() (Trigger ล็อกเอกสารสถานะ ISSUED ห้ามพนักงานที่ไม่ใช่ Admin แก้ไขยอดเงินหรือกดยกเลิก และห้ามแก้ไขเอกสารที่ชำระเงินแล้ว)

public.trg_sanitize_document_defaults() (Trigger แปลงค่า NULL ใน dest_freight_paid_status เป็น 'NONE' หรือ 'UNPAID' อัตโนมัติ)

public.validate_inventory_ledger_doc_header() (Trigger ตรวจสอบรหัสหัวเอกสารใน inventory_ledger ให้รองรับทั้ง doc_headers และ documents)

public.get_on_hand_qty_by_product_ids(p_product_ids UUID[])

public.issue_document_transaction(...)

public.process_ar_receipt_transaction(...)

public.generate_tier_1_2_cash_receipt_numbers(p_start_date DATE, p_end_date DATE, p_prefix VARCHAR DEFAULT 'CA01') (รันเลขใบรับเงิน CA ให้บิลซื้อกลุ่ม RECEIPT_1_2 / คู่ค้า INDIVIDUAL_ID_1_2)

public.convert_purchase_bill_tax_mode(p_document_id UUID, p_target_tier VARCHAR) (สลับบิลซื้อเป็น CORP_VAT / RECEIPT_1_2 / INTERNAL_1_3 และคำนวณยอดใหม่)

public.save_manual_goods_receipt_transaction(...)

public.save_goods_receipt_to_ledger_transaction(...)