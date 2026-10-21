# Supthavee ERP - Database Schema Reference (Cloud Production Verified)

**CRITICAL INSTRUCTION FOR AI:** STRICTLY use the table names, column names, views, and RPC functions listed below. DO NOT invent, assume, or create new tables. (`bank_accounts` is DEPRECATED — always use `mst_bank_accounts`).

## 1. Master Data (ตารางข้อมูลหลัก)
- `mst_bank_accounts` (สมุดบัญชีธนาคารบริษัท — RLS: `service_role` only)
- `mst_brands` (แบรนด์สินค้า)
- `mst_categories` (หมวดหมู่สินค้า — `parent_id` แม่-ลูก, รหัส Parent = 1 ตัวอักษร, Child = 2 ตัวอักษร; Soft Delete `is_active`)
- `mst_colors` (สีมาตรฐาน — ล็อก 3 ตัวอักษรพิมพ์ใหญ่)
- `mst_expense_categories` (หมวดหมู่ค่าใช้จ่าย)
- `mst_asset_categories` (หมวดหมู่สินทรัพย์ถาวร — `category_code`, `useful_life_years`, `depreciation_rate`)
- `mst_genders` (เพศ/ทรงเสื้อ)
- `mst_sizes` (ไซส์มาตรฐาน Global Size Fixed-2 Characters รวมถึงไซส์ `00` สำหรับวัตถุดิบ/งานบริการ)
- `mst_uom` (หน่วยนับสินค้า — `uom_id`, `uom_code`, `uom_name` เช่น PCS, KGS, MTR, DOZ)
- `mst_wht_rates` (อัตราภาษีหัก ณ ที่จ่ายมาตรฐาน — 1%, 2%, 3%, 5%)
- `mst_carriers` (บริษัทขนส่ง — `carrier_id`, `carrier_code`, `carrier_name`, `contact_id`, `carrier_tier` ['PRIMARY_MONTHLY' | 'OCCASIONAL'], `requires_monthly_receipt`, `tax_id`, `branch_code`, `default_wht_rate`)

## 2. Core Entities (องค์กร, ผู้ใช้, ตั้งค่า)
- `contacts` (คู่ค้า Multi-Role: ใช้ `contact_roles` VARCHAR[] เท่านั้น เช่น Customer, Vendor, Technician, Carrier; มี `default_freight_tax_mode`)
- `contact_persons` (ผู้ติดต่อภายใต้คู่ค้า)
- `user_profiles` (โปรไฟล์พนักงาน/ผู้ใช้งาน — มี `data_access_scope` ['ALL' | 'OWN'], `approval_limit`)
- `app_roles` (สิทธิ์การใช้งาน Dynamic RBAC — มี `accessible_modules` JSONB)
- `system_settings` (ตั้งค่าระบบบริษัท Singleton — ข้อมูลบริษัท, `allow_negative_inventory`, `document_print_settings`)
- `system_parameters` (ค่า config ระบบ — `param_key` PK, `param_value` JSONB, `data_type`)
- `parameter_change_requests` (คำขอแก้ config แบบ Maker-Checker — `param_key` FK, `status` PENDING|APPROVED|REJECTED)

## 3. Products, Inventory & Production (สินค้า, คลัง, ผลิต)
- `product_models` (รุ่นสินค้า — มี `base_uom_id`, `purchasing_uom_id`, `uom_conversion_factor`, `is_raw_material`, `is_service`, `is_manufactured`, `image_url`)
- `products` (สินค้า SKU ย่อย — 3,811+ SKUs; มี `model_id`, `sku`, `color`, `size`, `cost_price`, `retail_price`, `wholesale_price`, `is_active`; มี Index `idx_products_active_sku`)
- `vendor_product_mapping` (การผูกรหัสสินค้าซัพพลายเออร์ — `vendor_id`, `vendor_sku`, `internal_product_id`, `conversion_factor`, `purchase_uom_code`, `default_tax_type`)
- `inventory_ledger` (สมุดบัญชีคลังสินค้า — คอลัมน์จริง: `id`, `created_at`, `product_id`, `doc_header_id`, `document_id` FK -> `documents.id`, `trans_type` VARCHAR ['IN' | 'OUT' | 'ADJUST'], `qty` NUMERIC(14,4), `unit_cost` NUMERIC, `notes` VARCHAR; **หมายเหตุ:** ใช้ชื่อคอลัมน์ `trans_type` และ `qty` เท่านั้น ไม่มี `movement_type` หรือ `qty_in`/`qty_out`)
- `product_boms` (สูตรการผลิต — `finished_model_id`, `raw_material_model_id`, `uom_id`, `quantity_required`, `waste_percent`)
- `production_jobs` (ใบสั่งผลิต / งาน MTO — `job_no`, `document_id` / `ref_document_id` โยง SO, `product_model_id`, `target_quantity`, `status`, `mockup_image_url`, `wage_cost`, `technician_id`, `technician_bill_id`)
- `production_job_items` (รายละเอียดไซส์สินค้าที่ต้องผลิต — `job_id`, `product_id`, `quantity`)
- `production_job_materials` (การจัดสรรวัตถุดิบ WIP — `job_id`, `raw_material_model_id`, `uom_id`, `planned_qty` NUMERIC(14,4), `actual_used_qty` NUMERIC(14,4), `cost_price_snapshot`)
- `production_job_operations` (ขั้นตอนการผลิต In-house Routing — `job_id`, `operation_name`, `technician_id`, `wage_cost`, `technician_bill_id`, `status`)
- `service_tracking` (ติดตามสถานะงานบริการ)
- `technician_rates` (เรตค่าแรงช่างผูกกับ `product_models`)

## 4. Documents & Financials (เอกสารและการเงิน)
- **Document Conversion Lineage:** `QT` -> `SO` -> `INV_DO / TAX_INV / CS_TAX / ABB` -> `REC` (ห้ามข้าม SO เด็ดขาด)
- `documents` (เอกสารหลักทั้งระบบ — ซื้อ, ขาย, มัดจำ, ใบเสร็จ, ใบลดหนี้, ใบวางบิล BN/BR/TB, ปรับปรุงสต็อก STK_OB/STK_ADJ, ตัดหนี้สูญ/คืนเงิน; รองรับ E-Commerce metadata: `sales_channel`, `ecommerce_order_no`, `ecommerce_buyer_name`, `tracking_no`, `one_time_address`; รองรับ Dual-Freight: `freight_cost`, `freight_tax_mode`, `dest_freight_cost`, `carrier_id`, `carrier_tracking_no`, `dest_freight_paid_status`, `carrier_receipt_status`, `carrier_receipt_no`, `carrier_receipt_date`)
- `document_items` (รายการสินค้าในเอกสาร — `document_id`, `product_id`, `qty` NUMERIC(14,4), `uom_used`, `unit_price`, `unit_cost_price`, `prorated_freight`, `technician_id`, `wage_cost`, `technician_bill_id`, `mockup_image_url`, `is_sent_to_production`, `production_status`)
- `doc_headers` / `doc_details` (ตารางเอกสาร Legacy Bridge สำหรับระบบรับของเข้าและ FK ของ `billing_note_items` — ล็อก RLS `service_role` เท่านั้น)
- `document_allocations` (การตัดยอดหนี้ / มัดจำ / ลดหนี้ / คืนเงิน — `receipt_doc_id`, `invoice_doc_id`, `allocated_amount`, `wht_amount`, `original_receipt_received` — ล็อก RLS `service_role` เท่านั้น)
- `billing_note_items` (รายการใบวางบิล — `billing_note_id`, `invoice_id`, `billed_amount` — ล็อก RLS `service_role` เท่านั้น)
- `expenses` (บิลค่าใช้จ่าย / OPEX — `approval_status`, `is_installment`, `total_interest_amount`, `status` IN ('DRAFT', 'PENDING', 'ISSUED', 'VOID', 'PAID'))
- `expense_installments` (งวดผ่อนชำระ TFRS 16)
- `payment_transactions` (ธุรกรรมการรับ/จ่ายเงินสดและธนาคาร — รองรับ `storage_tier`, `nas_archive_url` — ล็อก RLS `service_role` เท่านั้น)
- `payment_allocations` (การตัดยอดหนี้ผ่อนชำระ — ล็อก RLS `service_role` เท่านั้น)
- `approval_logs` (ประวัติการอนุมัติ/ปฏิเสธ Maker-Checker)
- `accounting_periods` (งวดบัญชีรายเดือน Period Lock)
- `fixed_assets` (ทะเบียนสินทรัพย์ถาวร)
- `asset_depreciation_ledger` / `depreciation_ledgers` (สมุดบันทึกค่าเสื่อมราคา)

## 5. System, Views & RPC Functions
- `audit_logs` (ประวัติการเปลี่ยนแปลงข้อมูล JSONB — **Append-Only**: มี Trigger `trg_audit_logs_no_delete` ห้าม UPDATE/DELETE เด็ดขาด)
- **Database Views (`security_invoker = true`, `service_role` only):**
  - `vw_sales_profit_analysis` (กำไรขั้นต้นรายเอกสารขาย)
  - `vw_monthly_profit_summary` (สรุปกำไรสุทธิรายเดือน: Net Revenue - Product COGS - Wage COGS - OPEX)
  - `vw_carrier_freight_summary` (สรุปค่าขนส่งปลายทางแยกตามบริษัทขนส่ง พร้อมคำนวณภาษีหัก ณ ที่จ่าย 1% `estimated_wht_1pct`)
- **Key RPC Functions:**
  - `get_on_hand_qty_by_product_ids(p_product_ids UUID[])` (คำนวณยอดคงเหลือสต็อก `SUM(signed qty)` ใน PostgreSQL ป้องกันปัญหา PostgREST 1,000-row cap)
  - `generate_document_no(p_doc_type TEXT, p_doc_date DATE)`
  - `generate_expense_no(p_expense_date DATE)`
  - `is_period_closed(doc_date DATE)`
  - `issue_credit_note_transaction(...)`
  - `void_document_with_stock_reversal(...)`
  - `calculate_monthly_depreciation(...)`
- `issue_document_transaction(...)` (Atomic RPC ออกเอกสารขาย + รันเลขเอกสาร + ตัดสต็อก `inventory_ledger` OUT)
  - `process_ar_receipt_transaction(...)` (Atomic RPC ออกใบเสร็จรับเงิน `REC` + บันทึก `payment_transactions` + `document_allocations` + อัปเดตบิลขาย/มัดจำ/ใบลดหนี้)
  - `save_manual_goods_receipt_transaction(...)` (Atomic RPC บันทึกรับสินค้า Manual ลง `documents` + `document_items` + `inventory_ledger` IN + อัปเดต `products.cost_price`)
  - `save_goods_receipt_to_ledger_transaction(...)` (Atomic RPC บันทึกรับสินค้า OCR ลง `doc_headers` + `doc_details` + `documents` + `document_items` + `inventory_ledger` IN + อัปเดต `products.cost_price`)