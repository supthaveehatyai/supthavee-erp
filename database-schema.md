# Supthavee ERP - Database Schema Reference

**CRITICAL INSTRUCTION FOR AI:** STRICTLY use the table names listed below. DO NOT invent, assume, or create new tables. If a required table is not on this list, STOP and ask the user for clarification.

*(Note:* `bank_accounts` *is DEPRECATED. ALWAYS use* `mst_bank_accounts` *for bank data).*

## 1. Master Data (ตารางข้อมูลหลัก)

- `mst_bank_accounts` (สมุดบัญชีธนาคารบริษัท)

- `mst_brands` (แบรนด์สินค้า)

- `mst_categories` (หมวดหมู่สินค้า)

- `mst_colors` (สีมาตรฐาน - ล็อก 3 ตัวอักษรพิมพ์ใหญ่)

- `mst_expense_categories` (หมวดหมู่ค่าใช้จ่าย)

- `mst_genders` (เพศ/ทรงเสื้อ)

- `mst_sizes` (ไซส์มาตรฐาน Global Size รวมถึงไซส์บริการ)

## 2. Core Entities (องค์กร, ผู้ใช้, ตั้งค่า)

- `contacts` (คู่ค้า Multi-Role: `contact_roles` VARCHAR[] เท่านั้น — ไม่ใช้ `contact_type`)

- `contact_persons` (ผู้ติดต่อภายใต้คู่ค้า)

- `user_profiles` (โปรไฟล์พนักงาน/ผู้ใช้งาน)

- `app_roles` (สิทธิ์การใช้งาน Dynamic RBAC)

- `system_settings` (ตั้งค่าระบบบริษัท Singleton)

## 3. Products, Inventory & Production (สินค้า, คลัง, ผลิต)

- `product_models` (รุ่นสินค้า - Phase 1 ของการสร้าง Matrix)

- `products` (สินค้า SKU ย่อย - Phase 2)

- `vendor_product_mapping` (การผูกรหัสสินค้าซัพพลายเออร์)

- `inventory_ledger` (สมุดบัญชีคลังสินค้า - ควบคุมการเข้าออกสต็อก)

- `production_jobs` (ใบสั่งผลิต / งาน MTO — `technician_id` → `contacts.id`, `wage_cost` ค่าแรงจริง, `technician_bill_id` → `documents.id` เมื่อวางบิลช่างแล้ว)

- `service_tracking` (ติดตามสถานะงานบริการ)

- `technician_rates` (เรตค่าแรงช่าง — FK `service_model_id` → `product_models.id`, `technician_id` → `contacts.id`)

## 4. Documents & Financials (เอกสารและการเงิน)

- `documents` / `doc_headers` / `doc_details` (เอกสารหลัก — `doc_type` รวม `TB` สรุปวางบิลช่าง)

- `document_items` (รายการสินค้าในเอกสาร)

- `document_allocations` (การจัดสรรเอกสาร เช่น ตัดมัดจำ)

- `billing_note_items` (รายการใบวางบิล)

- `expenses` (บิลค่าใช้จ่าย / OPEX)

- `payment_transactions` (ธุรกรรมการรับ/จ่าย)

- `payment_allocations` (การตัดยอดหนี้ Knock-off)

- `payment_slips` (สลิปโอนเงิน)

## 5. System & Auditing (ระบบและการตรวจสอบ)

- `audit_logs` (ประวัติการเปลี่ยนแปลงข้อมูล JSONB)

## 6. Database Views (มุมมองข้อมูลสำหรับ Report)

- `vw_monthly_profit_summary` (`product_cogs`, `wage_cogs`, `cogs` = เสื้อเปล่า + ค่าแรง)

- `vw_sales_profit_analysis` (กำไรต่อบิล — `product_cogs` + `wage_cogs` = `total_cogs`)