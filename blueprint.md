# System Blueprint: Supthavee ERP SuperApp

**Version:** 5.3 (Billing Note, Document Lineage & Late Numbering Complete)

**Company:** บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด

**Document Purpose:** System Requirements, Business Logic, and Database Schema for AI Assistants (Claude, Cursor, Gemini)

## 1. System Overview (ภาพรวมระบบ)
ระบบ ERP แบบ Web Application สถาปัตยกรรม Full-Code ที่ออกแบบมาเพื่อบริหารจัดการธุรกิจค้าปลีก-ค้าส่ง (เสื้อผ้า, ชุดกีฬา, ถ้วยรางวัล) และงานบริการสั่งทำ (งานปัก, สกรีน) ครอบคลุมการจัดการบิลซื้อ/ขาย, การแยกบัญชี VAT/Non-VAT, ระบบรับเข้าอัจฉริยะ (OCR), การจัดการสต็อกหลายหน่วยนับ, การสร้างรหัสสินค้าแบบชาญฉลาด (Product Matrix & Auto-SKU), การวิเคราะห์กำไรต่อบิล, การจัดการเจ้าหนี้-ลูกหนี้ (AP/AR), และระบบสำรองข้อมูล (Backup/Restore)

## 2. Tech Stack & AI Integration (เทคโนโลยีที่ใช้)
*   **Frontend:** Next.js 16.2.10 (App Router + Turbopack), React, Tailwind CSS, shadcn/ui
*   **Backend & Database:** Supabase (PostgreSQL, RLS) พร้อมระบบ Database Migrations ผ่าน Supabase CLI
*   **Environment:** แยก `.env.development` สำหรับ Local DB (127.0.0.1) และ `.env.production` สำหรับ Cloud อย่างเด็ดขาด
*   **AI Integration:** Gemini Vision AI (Cascade Fallback 3.6 -> 3.5 -> 2.5) สำหรับอ่านเอกสารบิลซื้อ (Smart Goods Receipt) ผ่าน Edge Functions
*   **Development Tools:** Cursor Code Editor, Claude 3.5 Sonnet / Gemini

## 3. User Roles (สิทธิ์การใช้งาน)
*   **Admin (ผู้บริหาร):** เข้าถึงทุกระบบ, ดูรายงานกำไร-ขาดทุน, อนุมัติหนี้สูญ, เข้าถึงประวัติการแก้ไข (Audit Trail)
*   **Sales (พนักงานขาย):** เปิดบิลขาย, รับชำระเงิน/มัดจำ, ติดตามสถานะงานปัก-สกรีน
*   **Warehouse / Production:** ทำรายการรับของเข้า (สแกนบิล), เบิกของออก, เปลี่ยนสถานะงานสั่งทำ

## 4. Core Modules & Business Logic (โมดูลหลักและกฎเกณฑ์)
### Module A: Master Data, Products & Smart 2-Phase Matrix (ฐานข้อมูลหลัก และการสร้างสินค้า)
*   **Master Data UI Rules:** ช่องเลือก Vendor, Brand, Category ต้องเป็น Smart Combobox และรองรับการ "เพิ่มข้อมูลใหม่ (On-the-fly)" รวมไปถึง "Quick Edit Contact"
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
*   **Late Numbering Strategy:** ป้องกันเลขเอกสารแหว่งด้วยการใช้รหัสชั่วคราว (`DRAFT-YYYYMMDDHHmmss`) ตอนสร้าง และดึงเลขรันนิ่งจริงผ่าน RPC (`generate_document_no`) เฉพาะตอนกด "ยืนยัน (ISSUED)"
*   **Cancel & Replace (Inventory Reversal):** ระบบยกเลิกเอกสารต้องคืนสต็อกใน `inventory_ledger` อัตโนมัติ และการโคลนออกเอกสารทดแทนจะล็อกการแก้ไขรายการสินค้า พร้อมผูก `ref_document_id` ไว้เสมอ
*   **Cost & Profit Snapshot:** ดึงราคาต้นทุน (LPP) มาฝังไว้ที่รายการบิล (`unit_cost_price`) ทันทีที่ขาย
*   **Document Lineage:** รองรับการแปลงเอกสาร (เช่น QT -> INV_DO) พร้อมผูก `ref_document_id` อ้างอิงกลับไปยังเอกสารต้นทางเสมอ
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

### Module D: Finance, Accounting & Billing (ระบบการเงินและบัญชี)
*   **Document Taxonomy (Sales vs Purchases):** รหัสเอกสารแยกขาดจากกันชัดเจน
    *   **Sales (AR):** 'QT', 'INV_DO', 'TAX_INV', 'CS_TAX', 'ABB', 'DEP_IN', 'REC', 'CN', 'AR_REFUND' (SRF), 'AR_WRITEOFF' (SWO), 'BN' (Billing Note)
    *   **Purchases (AP):** 'PO', 'AP_TAX', 'AP_INV', 'AP_CASH', 'DEP_OUT', 'PAY', 'AP_REFUND' (PRF), 'AP_WRITEOFF' (PWO), 'BR' (Bill Receipt)
*   **AR/AP Dashboard:** หน้าจอสรุปยอดลูกหนี้และเจ้าหนี้ แบ่งแท็บแยกอิสระ โดยดึงจากฟิลด์ `grand_total` (รวม VAT)
*   **Billing Note (ระบบวางบิล):** สร้างเอกสาร BN/BR แบบ Grouping ผ่าน `billing_note_items` โดยไม่มีผลต่อบัญชีแยกประเภท (GL) พร้อมหน้าตารางสรุปลูกหนี้ค้างชำระ
*   **Knock-off Allocation (ระบบตัดยอดหนี้):** รองรับการดึงเอกสารลูกข่ายผ่าน BN/BR หรือกระจายยอดอิสระแบบ FIFO ทำงานคู่กับ `document_allocations`
*   **Document Attachment & WHT:** รองรับการแนบไฟล์สลิปโอนเงิน (Slip) และหนังสือรับรองการหักภาษี ณ ที่จ่าย (WHT) ลง Supabase Storage
*   **Receipt Status Tracking:** ระบบติดตามและอัปเดตสถานะเอกสารตัวจริง ("รอออกเอกสาร/รอเอกสาร" -> "ออกเอกสารแล้ว/ได้รับแล้ว") พร้อม Database Migration `original_receipt_received`
*   **Deposit Management:** ระบบรับและจ่ายเงินมัดจำ (DEP_IN / DEP_OUT) ทำงานร่วมกับระบบ Allocation สามารถนำยอดคงเหลือไปเป็นส่วนลดในใบเสร็จ (REC/PAY) ได้ รองรับการคืนเงิน (Refund) และตัดเศษบัญชี (Write-off) พร้อมสืบทอดภาษีมูลค่าเพิ่ม (VAT Inheritance)

### Module E: Dashboard & Audit (ระบบรายงานและความปลอดภัย) - [🔥 Next Phase]
*   Executive Dashboard และระบบ Audit Trail บันทึกประวัติการเปลี่ยนแปลง

### Module F: Data Backup & Restore (ระบบสำรองและฟื้นฟูข้อมูล) - [⏳ Planned]
*   Automated PostgreSQL Dump & Storage Backup / Point-in-time Recovery

## 5. Database Schema (PostgreSQL for Supabase)
*(Schema ตาม Blueprint v5.3 ครอบคลุมตาราง `billing_note_items` และการอัปเดต Enum ทั้งหมดเรียบร้อยแล้ว)*