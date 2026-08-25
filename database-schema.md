# Supthavee ERP - Database Schema Reference

**CRITICAL INSTRUCTION FOR AI:** STRICTLY use the table names listed below. DO NOT invent, assume, or create new tables.

## 1. Master Data (ตารางข้อมูลหลัก)
- `mst_bank_accounts` (สมุดบัญชีธนาคารบริษัท)
- `mst_brands` (แบรนด์สินค้า)
- `mst_categories` (หมวดหมู่สินค้า)
- `mst_colors` (สีมาตรฐาน - ล็อก 3 ตัวอักษรพิมพ์ใหญ่)
- `mst_expense_categories` (หมวดหมู่ค่าใช้จ่าย)
- `mst_asset_categories` (หมวดหมู่สินทรัพย์ถาวร — `category_code`, `useful_life_years`, `depreciation_rate`)
- `mst_genders` (เพศ/ทรงเสื้อ)
- `mst_sizes` (ไซส์มาตรฐาน Global Size รวมถึงไซส์บริการ)

## 2. Core Entities (องค์กร, ผู้ใช้, ตั้งค่า)
- `contacts` (คู่ค้า Multi-Role: `contact_roles` VARCHAR[] เท่านั้น)
- `contact_persons` (ผู้ติดต่อภายใต้คู่ค้า)
- `user_profiles` (โปรไฟล์พนักงาน/ผู้ใช้งาน — `data_access_scope`, `approval_limit`)
- `app_roles` (สิทธิ์การใช้งาน Dynamic RBAC — `accessible_modules` JSONB)
- `system_settings` (ตั้งค่าระบบบริษัท Singleton)

## 3. Products, Inventory & Production (สินค้า, คลัง, ผลิต)
- `product_models` (รุ่นสินค้า - Phase 1 ของการสร้าง Matrix)
- `products` (สินค้า SKU ย่อย - Phase 2)
- `vendor_product_mapping` (การผูกรหัสสินค้าซัพพลายเออร์)
- `inventory_ledger` (สมุดบัญชีคลังสินค้า)
- `production_jobs` (ใบสั่งผลิต / งาน MTO)
- `service_tracking` (ติดตามสถานะงานบริการ)
- `technician_rates` (เรตค่าแรงช่าง)

## 4. Documents & Financials (เอกสารและการเงิน)
- **Document Conversion Lineage:** `QT` -> `SO` -> `INV_DO / TAX_INV / CS_TAX / ABB` -> `REC` (ห้ามข้าม SO เด็ดขาด)
- **SO (ใบสั่งขาย):** ใช้ยืนยันคำสั่งซื้อ, จองสต็อก (Soft Allocation / ATP)
- **Inventory Adjustments:** `STK_OB` และ `STK_ADJ` บันทึกผ่าน `inventory_ledger`
- **Period Closing:** ฟังก์ชัน `is_period_closed(doc_date)`
- `documents` / `doc_headers` / `doc_details` (เอกสารหลัก — `created_by` stamp จาก Auth Session)
- `document_items` (รายการสินค้าในเอกสาร)
- `document_allocations` (การจัดสรรเอกสาร เช่น ตัดมัดจำ)
- `billing_note_items` (รายการใบวางบิล)
- `expenses` (บิลค่าใช้จ่าย / OPEX — `approval_status`, `is_installment`, `total_interest_amount`, **`status` IN ('DRAFT', 'PENDING', 'ISSUED', 'VOID', 'PAID')**)
- `expense_installments` (งวดผ่อนชำระ — `expense_id`, `installment_period`, `due_date`, `principal_amount`, `interest_amount`, `total_installment`, `is_paid`, `payment_transaction_id`)
- `approval_logs` (Phase 14 Maker-Checker — ประวัติอนุมัติ/ปฏิเสธ)
- `accounting_periods` (งวดบัญชีรายเดือน)
- `fixed_assets` (ทะเบียนสินทรัพย์ถาวร — `asset_code`, `asset_name`, `category_id`, `acquisition_date`, `acquisition_cost`, `salvage_value`, `useful_life_months`, `status`, `expense_id`)
- `asset_depreciation_ledger` (สมุดค่าเสื่อมรายเดือน — `asset_id`, `period_id`, `depreciation_date`, `depreciation_amount`, `accumulated_depreciation`, `net_book_value`)
- `payment_transactions` (ธุรกรรมการรับ/จ่าย)
- `payment_allocations` (การตัดยอดหนี้ Knock-off — `expense_id`, `document_id`)
- `payment_slips` (สลิปโอนเงิน)

## 5. System & Auditing (ระบบและการตรวจสอบ)
- `audit_logs` (ประวัติการเปลี่ยนแปลงข้อมูล JSONB)

## 6. Database Views (มุมมองข้อมูลสำหรับ Report)
- `vw_monthly_profit_summary`
- `vw_sales_profit_analysis`