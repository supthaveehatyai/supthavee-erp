# Supthavee ERP - Database Schema Reference

**CRITICAL INSTRUCTION FOR AI:** STRICTLY use the table names listed below. DO NOT invent, assume, or create new tables. If a required table is not on this list, STOP and ask the user for clarification.

*(Note:* `bank_accounts` *is DEPRECATED. ALWAYS use* `mst_bank_accounts` *for bank data).*

## 1. Master Data (ตารางข้อมูลหลัก)
- `mst_bank_accounts` (สมุดบัญชีธนาคารบริษัท)
- `mst_brands` (แบรนด์สินค้า)
- `mst_categories` (หมวดหมู่สินค้า)
- `mst_colors` (สีมาตรฐาน - ล็อก 3 ตัวอักษรพิมพ์ใหญ่)
- `mst_expense_categories` (หมวดหมู่ค่าใช้จ่าย)
- `mst_wht_rates` (อัตราหัก ณ ที่จ่ายมาตรฐาน — `wht_name`, `wht_rate`, `is_active`; RLS: authenticated SELECT)
- `mst_asset_categories` (หมวดหมู่สินทรัพย์ถาวร — `category_code`, `useful_life_years`, `depreciation_rate`)
- `mst_genders` (เพศ/ทรงเสื้อ)
- `mst_sizes` (ไซส์มาตรฐาน Global Size รวมถึงไซส์บริการ)

## 2. Core Entities (องค์กร, ผู้ใช้, ตั้งค่า)
- `contacts` (คู่ค้า Multi-Role: `contact_roles` VARCHAR[] เท่านั้น — ไม่ใช้ `contact_type`)
- `contact_persons` (ผู้ติดต่อภายใต้คู่ค้า)
- `user_profiles` (โปรไฟล์พนักงาน/ผู้ใช้งาน — `data_access_scope` IN ('ALL','OWN'), `approval_limit`)
- `app_roles` (สิทธิ์การใช้งาน Dynamic RBAC — `accessible_modules` JSONB: sales, purchases, inventory, finance, settings)
- `system_settings` (ตั้งค่าระบบบริษัท Singleton)
- `system_parameters` (ค่า config ปัจจุบัน — `param_key` PK, `param_value` JSONB, `data_type`; RLS: authenticated SELECT, write ผ่าน service_role)
- `parameter_change_requests` (คำขอแก้ config แบบ Maker-Checker — `param_key` FK, `status` PENDING|APPROVED|REJECTED; RLS: service_role only)

## 3. Products, Inventory & Production (สินค้า, คลัง, ผลิต)
- `product_models` (รุ่นสินค้า - Phase 1 ของการสร้าง Matrix)
- `products` (สินค้า SKU ย่อย - Phase 2)
- `vendor_product_mapping` (การผูกรหัสสินค้าซัพพลายเออร์)
- `inventory_ledger` (สมุดบัญชีคลังสินค้า - ควบคุมการเข้าออกสต็อก)
- `production_jobs` (ใบสั่งผลิต / งาน MTO — *อัปเดต: ยกเลิกการเก็บ technician_id และ wage_cost ที่ตารางนี้ ย้ายไประดับ Line Item แทน*; Phase 14 Tiered Storage: `storage_tier` ENUM `storage_tier_type` ('CLOUD','NAS') default CLOUD, `nas_archive_url`)
- `service_tracking` (ติดตามสถานะงานบริการ)
- `technician_rates` (เรตค่าแรงช่าง — FK `service_model_id` → `product_models.id`, `technician_id` → `contacts.id`)

## 4. Documents & Financials (เอกสารและการเงิน)
- **Document Conversion Lineage:** `QT` → `SO` → `INV_DO / TAX_INV / CS_TAX / ABB` → `REC` (ห้ามข้าม SO เด็ดขาด)
- **SO (ใบสั่งขาย):** ใช้ยืนยันคำสั่งซื้อ, จองสต็อก (Soft Allocation / ATP), และส่งงานผลิต (MTO)
- **Soft Allocation (ATP):** `Available Stock = Physical Stock (Σ inventory_ledger) − Committed Stock (Σ SO ISSUED qty ที่ยังไม่ออกบิล)`
- **Inventory Adjustments:** `STK_OB` (ยอดยกมา · Prefix **SOB-YYMM-XXXX**) และ `STK_ADJ` (ปรับปรุงสต็อก · Prefix **SAD-YYMM-XXXX**) บันทึกผ่าน `inventory_ledger` และสร้าง Audit Trail เสมอ
- **Period Closing:** ฟังก์ชัน `is_period_closed(doc_date)` — หากงวดถูกปิด (`accounting_periods.is_closed = true`) ห้าม INSERT/UPDATE/DELETE เอกสารและค่าใช้จ่ายในเดือนนั้น
- `documents` / `doc_headers` / `doc_details` (เอกสารหลัก — `doc_type` รวม `TB` สรุปวางบิลช่าง; มี `approval_status`, `approved_by`, `approved_at`, `created_by`)
- `document_items` (รายการสินค้าในเอกสาร — งานบริการเก็บ `technician_id`, `wage_cost`, `technician_bill_id` เพื่อรองรับ Line Item Assignment)
- `document_allocations` (การจัดสรรเอกสาร เช่น ตัดมัดจำ)
- `billing_note_items` (รายการใบวางบิล)
- `expenses` (บิลค่าใช้จ่าย / OPEX — มี `approval_status`, `approved_by`, `approved_at`, `is_installment`, `total_interest_amount`)
- `expense_installments` (งวดผ่อนชำระ — `expense_id`, `installment_period`, `due_date`, `principal_amount`, `interest_amount`, `total_installment`, `is_paid`)
- `approval_logs` (Phase 14 Maker-Checker — ประวัติอนุมัติ/ปฏิเสธ: `document_id`, `expense_id`, `action`, `actor_id`, `comments`, `created_at` — RLS: service_role only)
- `accounting_periods` (งวดบัญชีรายเดือน — Period Closing: `period_year`, `period_month`, `is_closed`, `closed_at`, `closed_by`)
- `fixed_assets` (ทะเบียนสินทรัพย์ถาวร — `asset_code`, `asset_name`, `category_id`, `location`, `acquisition_date`, `acquisition_cost`, `salvage_value`, `useful_life_months`, `accumulated_depreciation`, `net_book_value`, `status`, `expense_id`, `warranty_expiry_date`, `attachment_urls`)
- `asset_depreciation_ledger` (สมุดค่าเสื่อมรายเดือน — `asset_id`, `period_id` → `accounting_periods`, `depreciation_date`, `depreciation_amount`, `accumulated_depreciation`, `net_book_value`, `is_prorated`)
- `payment_transactions` (ธุรกรรมการรับ/จ่าย)
- `payment_allocations` (การตัดยอดหนี้ Knock-off)
- `payment_slips` (สลิปโอนเงิน — Phase 14 Tiered Storage: `storage_tier` ENUM `storage_tier_type` ('CLOUD','NAS') default CLOUD, `nas_archive_url`)

## 5. System & Auditing (ระบบและการตรวจสอบ)
- `audit_logs` (ประวัติการเปลี่ยนแปลงข้อมูล JSONB)

## 6. Database Views (มุมมองข้อมูลสำหรับ Report)
- `vw_monthly_profit_summary` (`product_cogs`, `wage_cogs`, `cogs` = เสื้อเปล่า + ค่าแรง)
- `vw_sales_profit_analysis` (กำไรต่อบิล — `product_cogs` + `document_items.wage_cost` = `total_cogs`)
