# System Blueprint: Supthavee ERP SuperApp

**Version:** 5.1 (Finance Module - AR/AP Payment Complete, Bulk Knock-off, Receipt Status Tracking, WHT & Slip Attachment, Print Templates)

**Company:** บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด

**Document Purpose:** System Requirements, Business Logic, and Database Schema for AI Assistants (Claude, Cursor, Gemini)

## 1. System Overview (ภาพรวมระบบ)
ระบบ ERP แบบ Web Application สถาปัตยกรรม Full-Code ที่ออกแบบมาเพื่อบริหารจัดการธุรกิจค้าปลีก-ค้าส่ง (เสื้อผ้า, ชุดกีฬา, ถ้วยรางวัล) และงานบริการสั่งทำ (งานปัก, สกรีน) ครอบคลุมการจัดการบิลซื้อ/ขาย, การแยกบัญชี VAT/Non-VAT, ระบบรับเข้าอัจฉริยะ (OCR), การจัดการสต็อกหลายหน่วยนับ, การสร้างรหัสสินค้าแบบชาญฉลาด (Product Matrix & Auto-SKU), การวิเคราะห์กำไรต่อบิล และการจัดการเจ้าหนี้-ลูกหนี้ (AP/AR)

## 2. Tech Stack & AI Integration (เทคโนโลยีที่ใช้)
*   **Frontend:** Next.js 16.2.10 (App Router + Turbopack), React, Tailwind CSS, shadcn/ui
*   **Backend & Database:** Supabase (PostgreSQL, RLS) พร้อมระบบ Database Migrations ผ่าน Supabase CLI
*   **Environment:** แยก `.env.development` สำหรับ Local DB (127.0.0.1) และ `.env.production` สำหรับ Cloud อย่างเด็ดขาด
*   **AI Integration:** Gemini Vision AI สำหรับอ่านเอกสารบิลซื้อ (Smart Goods Receipt) ผ่าน Edge Functions
*   **Development Tools:** Cursor Code Editor, Claude 3.5 Sonnet / Gemini

## 3. User Roles (สิทธิ์การใช้งาน)
*   **Admin (ผู้บริหาร):** เข้าถึงทุกระบบ, ดูรายงานกำไร-ขาดทุน, อนุมัติหนี้สูญ, เข้าถึงประวัติการแก้ไข (Audit Trail)
*   **Sales (พนักงานขาย):** เปิดบิลขาย, รับชำระเงิน/มัดจำ, ติดตามสถานะงานปัก-สกรีน
*   **Warehouse / Production:** ทำรายการรับของเข้า (สแกนบิล), เบิกของออก, เปลี่ยนสถานะงานสั่งทำ

## 4. Core Modules & Business Logic (โมดูลหลักและกฎเกณฑ์)
### Module A: Master Data, Products & Smart 2-Phase Matrix (ฐานข้อมูลหลัก และการสร้างสินค้า)
*   **Master Data UI Rules:** ช่องเลือก Vendor, Brand, Category ต้องเป็น Smart Combobox และรองรับการ "เพิ่มข้อมูลใหม่ (On-the-fly)"
*   **Smart Category Taxonomy:** ใช้ระบบรหัส 2 ตัวอักษร อ้างอิงจาก กลุ่มหลัก + กลุ่มย่อย
*   **Internal Color Standard:** ต้องใช้ "รหัสสีกลางของร้าน" ล็อกความยาวแบบ Fixed Length ที่ 3 ตัวอักษรภาษาอังกฤษพิมพ์ใหญ่เท่านั้น (เช่น WHT, BLK, NVY, RED)
*   **Size Sort Order:** ตาราง `mst_sizes` ใช้ระบบรหัสตรงตามหน้าแคตตาล็อกโรงงานและตั้งน้ำหนักการจัดเรียง (`sort_order`) แบบระบุโซนช่วงห่างทีละ 10 (Gap of 10)
*   **Data Table UI:** การจัดกลุ่ม 2 ระดับ (Nested Grouping: ชื่อรุ่น -> สี -> ไซส์) เรียงลำดับตามน้ำหนักไซส์จริง
*   **2-Phase Product Matrix Creation:**
    *   **Phase 1 (Base Model):** สร้างโครงร่างสินค้ารุ่น (Draft Model) ลง `product_models`
    *   **Phase 2 (SKU Generation):** โหลด Model กลับมาใส่สี และ Generate SKU ลง `products` (เช็กซ้ำ Error 409 อัตโนมัติ)
*   **สูตรการสร้าง SKU:** `Brand Code` + `Category Code (2 หลัก)` + `Model Code (ล็อก 6 หลัก)` + `Gender Code (1 หลัก)` + `Color Code (3 หลัก)` + `Size Code`
*   **Global Size Integrity:** การเพิ่มไซส์ใน Product Matrix บังคับให้ใช้ไซส์มาตรฐานจากตาราง `mst_sizes` ผ่าน Selection Grid เท่านั้น
*   **Net Price Support:** อนุญาตให้เลือกลักษณะส่วนลดเป็น "ราคาเน็ต" เพื่อปลดล็อกช่องให้ผู้ใช้สามารถกรอกราคาต้นทุนเป็นเงินบาทได้โดยตรง

### Module B: Document Flow & Profit Analysis (ระบบเอกสารและการวิเคราะห์กำไร)
*   **Auto-Running Number (Atomic RPC):** รันเลขที่เอกสารอัตโนมัติแยกตามประเภทและเดือนโดยใช้ฟังก์ชัน PostgreSQL RPC (`generate_document_no`) พร้อมระบบ `LOCK TABLE`
*   **Cost & Profit Snapshot:** ดึงราคาต้นทุน (LPP) มาฝังไว้ที่รายการบิล (`unit_cost_price`) ทันทีที่ขาย
*   **Document Summary Engine:** ประมวลผลยอดรวม, ส่วนลดท้ายบิล, และภาษีมูลค่าเพิ่ม (INCLUSIVE, EXCLUSIVE, NONE) แบบ Real-time
*   **Document Lineage:** รองรับการแปลงเอกสาร (เช่น QT -> INV_DO) พร้อมผูก `ref_document_id` อ้างอิงกลับไปยังเอกสารต้นทางเสมอ (รวมถึงการผูกบิลหนี้กับบิลจ่าย/รับ ผ่าน `document_allocations`)
*   **URL-Based State Filter:** ระบบค้นหาและกรองประวัติเอกสารใช้ URL Search Parameters แทน React State
*   **Print Layout A4:** รองรับการสั่งพิมพ์เป็นเอกสารบิล (A4) ผ่าน Browser ด้วย CSS `@media print` พร้อมซ่อน Navbar/Sidebar อัตโนมัติ

### Module C: Smart Procurement & Inventory (ระบบจัดซื้อและคลังสินค้า)
*   **Strict Server-Side Fetching:** บังคับใช้ Server Actions ร่วมกับ Service Role Key (supabaseAdmin) 100% หลีกเลี่ยงปัญหา RLS
*   **Project Guardrails:** บังคับใช้ไฟล์ `.cursorrules` ล็อกสถาปัตยกรรมโค้ด
*   **Smart Goods Receipt (AI OCR):** อัปโหลดรูปบิลเข้า -> AI OCR สกัด `raw_vendor_sku`, ส่วนลด, ภาษี, `document_number`, `document_date`
*   **Duplicate Invoice Early Warning:** ระบบตรวจสอบและดักจับบิลซ้ำซ้อนผ่าน Composite Key (`vendor_id` + `document_number` + `document_date`)
*   **On-the-fly Vendor Mapping & Quick Create:** ตรวจสอบและ UPSERT Mapping อัตโนมัติ รองรับการสร้าง SKU ใหม่กลางอากาศ (Quick Create)
*   **Net Cost Apportionment Engine:** ประมวลผลคำนวณราคาตั้ง ของแถม (FOC) และส่วนลดท้ายบิลแบบสัดส่วน (Prorate)
*   **LPP Auto-Update:** ระบบอัปเดตต้นทุนสั่งซื้อล่าสุด (Last Purchase Price) ทับใน `products.cost_price` อัตโนมัติ
*   **Inventory Ledger:** ห้ามแก้สต็อกที่ตาราง Products ตรงๆ ต้องบันทึกเข้า-ออกผ่าน `inventory_ledger` เสมอ
*   **Document Image Attachment:** รองรับการอัปโหลดไฟล์ภาพบิลซื้อ (Supabase Storage) ผูกเก็บที่หัวเอกสาร

### Module D: Finance, Accounting & Billing (ระบบการเงินและบัญชี)
*   **Document Taxonomy (Sales vs Purchases):** รหัสเอกสารแยกขาดจากกันชัดเจน
    *   **Sales (AR):** 'QT', 'INV_DO', 'TAX_INV', 'CS_TAX', 'ABB', 'DEP_IN', 'REC', 'CN'
    *   **Purchases (AP):** 'PO', 'AP_TAX', 'AP_INV', 'AP_CASH', 'DEP_OUT', 'PAY'
*   **AR/AP Dashboard:** หน้าจอสรุปยอดลูกหนี้และเจ้าหนี้ แบ่งแท็บแยกอิสระ โดยดึงจากฟิลด์ `grand_total` (รวม VAT)
*   **Knock-off Allocation (ระบบตัดยอดหนี้):** รองรับการกระจายยอดเงินรับ/จ่าย เพื่อตัดหนี้แบบ Invoice-by-Invoice พร้อมระบบ Checkbox (Bulk Payment) ทำงานคู่กับ `document_allocations`
*   **Document Attachment & WHT:** รองรับการแนบไฟล์สลิปโอนเงิน (Slip), ใบเสร็จรับเงินตัวจริง (Original Receipt สำหรับ AP) และหนังสือรับรองการหักภาษี ณ ที่จ่าย (WHT สำหรับ AR) ลง Supabase Storage
*   **Receipt Status Tracking:** ระบบติดตามและอัปเดตสถานะเอกสารตัวจริง ("รอออกเอกสาร/รอเอกสาร" -> "ออกเอกสารแล้ว/ได้รับแล้ว") พร้อม Database Migration `original_receipt_received`
*   **[เป้าหมายถัดไป] Deposit Management:** ระบบรับเงินมัดจำ (DEP_IN) และจ่ายมัดจำ (DEP_OUT)
*   **[เป้าหมายถัดไป] Billing Note:** ระบบวางบิล เพื่อรวบรวมเอกสารหนี้ก่อนถึงกำหนดชำระ

## 5. Database Schema (PostgreSQL for Supabase)
*(Schema ตาม Blueprint v5.1 ครอบคลุมตารางทั้งหมดรวมถึง `doc_headers`, `document_allocations`, `payment_transactions`, `inventory_ledger` และ Migration ล่าสุด)*