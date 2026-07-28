# System Blueprint: Supthavee ERP SuperApp

**Version:** 4.2 (Enterprise Standard, Fixed-3 Color, Multi-Zone Size Weights, OCR Pattern Config, Server Action Refactor, Quick Create SKU, Invoice Extraction, System Guardrails, Net Cost Engine, LPP Auto-Update, Document Flow, Auto-Running Number, Document Lineage, Document Attachment)

**Company:** บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด

**Document Purpose:** System Requirements, Business Logic, and Database Schema for AI Assistants (Claude, Cursor, Gemini)

## 1. System Overview (ภาพรวมระบบ)
ระบบ ERP แบบ Web Application สถาปัตยกรรม Full-Code ที่ออกแบบมาเพื่อบริหารจัดการธุรกิจค้าปลีก-ค้าส่ง (เสื้อผ้า, ชุดกีฬา, ถ้วยรางวัล) และงานบริการสั่งทำ (งานปัก, สกรีน) ครอบคลุมการจัดการบิลซื้อ/ขาย, การแยกบัญชี VAT/Non-VAT, ระบบรับเข้าอัจฉริยะ (OCR), การจัดการสต็อกหลายหน่วยนับ, การสร้างรหัสสินค้าแบบชาญฉลาด (Product Matrix & Auto-SKU), การวิเคราะห์กำไรต่อบิล และการจัดการเจ้าหนี้-ลูกหนี้ (AP/AR)

## 2. Tech Stack & AI Integration (เทคโนโลยีที่ใช้)
*   **Frontend:** Next.js (App Router), React, Tailwind CSS, shadcn/ui
*   **Backend & Database:** Supabase (PostgreSQL, RLS) พร้อมระบบ Database Migrations ผ่าน Supabase CLI
*   **Environment:** แยก `.env.development` สำหรับ Local DB (127.0.0.1) และ `.env.production` สำหรับ Cloud อย่างเด็ดขาด
*   **AI Integration:** Gemini Vision AI สำหรับอ่านเอกสารบิลซื้อ (Smart Goods Receipt) ผ่าน Edge Functions
*   **Development Tools:** Cursor Code Editor, Claude 3.5 Sonnet / Gemini Ultra

## 3. User Roles (สิทธิ์การใช้งาน)
*   **Admin (ผู้บริหาร):** เข้าถึงทุกระบบ, ดูรายงานกำไร-ขาดทุน, อนุมัติหนี้สูญ, เข้าถึงประวัติการแก้ไข (Audit Trail)
*   **Sales (พนักงานขาย):** เปิดบิลขาย, รับชำระเงิน/มัดจำ, ติดตามสถานะงานปัก-สกรีน
*   **Warehouse / Production:** ทำรายการรับของเข้า (สแกนบิล), เบิกของออก, เปลี่ยนสถานะงานสั่งทำ

## 4. Core Modules & Business Logic (โมดูลหลักและกฎเกณฑ์)
### Module A: Master Data, Products & Smart 2-Phase Matrix (ฐานข้อมูลหลัก และการสร้างสินค้า)
*   **Master Data UI Rules:** ช่องเลือก Vendor, Brand, Category ต้องเป็น Smart Combobox และรองรับการ "เพิ่มข้อมูลใหม่ (On-the-fly)" โดยไม่ทำให้ Form หลักปิดตัวลง
*   **Smart Category Taxonomy:** ใช้ระบบรหัส 2 ตัวอักษร อ้างอิงจาก กลุ่มหลัก + กลุ่มย่อย
*   **Internal Color Standard:** ต้องใช้ "รหัสสีกลางของร้าน" ล็อกความยาวแบบ Fixed Length ที่ 3 ตัวอักษรภาษาอังกฤษพิมพ์ใหญ่เท่านั้น (เช่น WHT, BLK, NVY, RED) เพื่อความสมมาตรของรหัส SKU และความแม่นยำของ AI OCR ในการทำ Regex Parsing
*   **Size Sort Order:** ตาราง `mst_sizes` ใช้ระบบรหัสตรงตามหน้าแคตตาล็อกโรงงานเพื่อเลี่ยงความสับสนใน Operation (เช่น แยก 2XL และ 2L ออกจากกันเด็ดขาด) และตั้งน้ำหนักการจัดเรียง (`sort_order`) แบบระบุโซนช่วงห่างทีละ 10 (Gap of 10) ดังนี้:
    *   100 - 150: ไซส์เด็กอนุบาลกลุ่ม K (K2S ถึง K2XL)
    *   160 - 210: ไซส์เด็กประถมกลุ่ม J (J2S ถึง J2XL)
    *   220 - 300: ไซส์ผู้ใหญ่มาตรฐาน (X2S, 3S, XS, S, M, L, XL)
    *   310 - 390: ไซส์ผู้ใหญ่พิเศษกลุ่ม XL (2XL ถึง 10XL)
    *   410 - 500: ไซส์ผู้ใหญ่พิเศษกลุ่ม L (2L ถึง 11L)
    *   550 - 999: กลุ่ม Free size และไซส์พิเศษตัวอักษรอื่น ๆ
    *   1000+: กลุ่มไซส์ที่เป็นตัวเลขล้วน (เบอร์ 1 ถึง 72) โดยรันน้ำหนักตามค่าเบอร์จริงคูณ 10
*   **Data Table UI:** การจัดกลุ่ม 2 ระดับ (Nested Grouping: ชื่อรุ่น -> สี -> ไซส์) เรียงลำดับตามน้ำหนักไซส์จริงจากฐานข้อมูล
*   **2-Phase Product Matrix Creation:**
    *   **Phase 1 (Base Model):** สร้างโครงร่างสินค้ารุ่น (Draft Model) บันทึกลง `product_models` พร้อมเก็บโครงสร้างราคา `size_pricing_config` แบบ JSONB และผูก `vendor_id` ตั้งแต่แรกเริ่มสร้าง
    *   **Phase 2 (SKU Generation):** โหลด Model กลับมาใส่สี และ Generate SKU ลง `products` (เช็กซ้ำ Error 409 อัตโนมัติ) และอัปเดตสถานะเป็น ACTIVE
*   **สูตรการสร้าง SKU:** `Brand Code` + `Category Code (2 หลัก)` + `Model Code (ล็อก 6 หลัก)` + `Gender Code (1 หลัก)` + `Color Code (3 หลัก)` + `Size Code`
*   **[เพิ่มเติม] Global Size Integrity:** การเพิ่มไซส์ใน Product Matrix บังคับให้ใช้ไซส์มาตรฐานจากตาราง `mst_sizes` ผ่าน Selection Grid เท่านั้น ไม่อนุญาตให้สร้างไซส์หรือกรอก Sort Order เองแบบ On-the-fly เพื่อป้องกัน Data Regression
*   **[เพิ่มเติม] Net Price Support:** อนุญาตให้เลือกลักษณะส่วนลดเป็น "ราคาเน็ต" เพื่อปลดล็อกช่องให้ผู้ใช้สามารถกรอกราคาต้นทุนเป็นเงินบาทได้โดยตรงตอนสร้าง SKU

### Module B: Document Flow & Profit Analysis (ระบบเอกสารและการวิเคราะห์กำไร)
*   **Document Types:** QT, PO, ABB, DEP, INV_DO, REC, TAX_INV, และ INT_REC
*   **[อัปเดต] Auto-Running Number (Atomic RPC):** รันเลขที่เอกสารอัตโนมัติแยกตามประเภทและเดือน (เช่น QT-2607-0001) โดยใช้ฟังก์ชัน PostgreSQL RPC (`generate_document_no`) พร้อมระบบ `LOCK TABLE` ป้องกันการแย่งกันรันเลข (Race Condition) 100%
*   **[อัปเดต] Cost & Profit Snapshot:** ดึงราคาต้นทุน (LPP) มาฝังไว้ที่รายการบิล (`unit_cost_price`) ทันทีที่ขาย เพื่อคำนวณกำไรขั้นต้นอย่างแม่นยำ ไม่ว่าต้นทุนในอนาคตจะเปลี่ยนไปอย่างไร
*   **[เพิ่มเติม] Document Summary Engine:** ระบบประมวลผลคำนวณยอดรวม, ส่วนลดท้ายบิล, และภาษีมูลค่าเพิ่ม 3 รูปแบบ (INCLUSIVE, EXCLUSIVE, NONE) แบบ Real-time พร้อมถอดฐานภาษีได้อย่างแม่นยำ
*   **[เพิ่มเติม] Document Lineage (สายสัมพันธ์เอกสาร):** รองรับการแปลงเอกสาร (Document Conversion) เช่น ดึงใบเสนอราคา (QT) มาสร้างเป็นใบส่งของ (INV_DO) เพื่อรักษาสถานะและผูก `ref_document_id` อ้างอิงกลับไปยังเอกสารต้นทางเสมอ
*   **[เพิ่มเติม] URL-Based State Filter:** ระบบค้นหาและกรองประวัติเอกสารใช้ URL Search Parameters แทน React State เพื่อให้สามารถแชร์ลิงก์ได้ และสอดคล้องกับโครงสร้าง Server Components (Zero Client-Side Fetching)
*   **[เพิ่มเติม] Print Layout A4:** รองรับการสั่งพิมพ์เป็นเอกสารบิล (A4) ผ่าน Browser ด้วย CSS `@media print` โดยซ่อน UI ส่วนเกินของแอปพลิเคชันอย่างสมบูรณ์แบบ

### Module C: Smart Procurement & Inventory (ระบบจัดซื้อและคลังสินค้า)
*   **Strict Server-Side Fetching (Architecture Pivot):** การดึงและบันทึกข้อมูลที่เกี่ยวข้องกับ Procurement และ Master Data ทั้งหมด ต้องทำผ่าน Next.js Server Actions และใช้ `createClient` ร่วมกับ `SUPABASE_SERVICE_ROLE_KEY` (Admin Client) เท่านั้น เพื่อหลีกเลี่ยงปัญหา RLS Permission Denied จาก Client Component ในช่วง Local Development
*   **Project Guardrails (AI Code Regression Prevention):** บังคับใช้ไฟล์ `.cursorrules` และระบบ Git Checkpoint เพื่อล็อกโค้ดโมดูลที่สมบูรณ์แล้ว 100% ป้องกัน AI เข้าไปปรับแก้หรือทำลายโครงสร้างโดยพลการ
*   **Smart Goods Receipt (AI OCR):** ระบบอัปโหลดรูปบิลซื้อเข้า -> เรียกใช้ AI OCR ดึงค่าแถวสินค้า -> คืนค่าออกมาเป็น `raw_vendor_sku` พร้อมข้อมูลราคาและส่วนลด รวมถึงดึง `document_number` (เลขที่เอกสาร) และ `document_date` (วันที่เอกสาร) แบบอัตโนมัติ
*   **AI Pattern Memorization:** ที่ตาราง `contacts` มีคอลัมน์ `ocr_pattern_config` (JSONB) สำหรับเก็บโครงสร้าง Prompt และพิกัดตารางบิล รวมถึงคำใบ้เลขที่บิล (`invoice_no_hint`) และวันที่ (`invoice_date_hint`) ของซัพพลายเออร์แต่ละเจ้า เพื่อส่งไปพร้อมภาพบิล ป้องกันการเดาสุ่มของ AI
*   **Duplicate Invoice Early Warning:** ระบบตรวจสอบและดักจับบิลซ้ำซ้อนทันทีก่อนการบันทึก โดยอ้างอิงจาก Composite Key 3 ปัจจัย: `vendor_id` + `document_number` + `document_date` เพื่อรองรับซัพพลายเออร์ที่รีเซ็ตเลขที่บิลรายเดือน
*   **On-the-fly Vendor Mapping & Quick Create:** เมื่อ AI อ่านค่า `raw_vendor_sku` ออกมา ระบบจะทำการตรวจสอบในตาราง `vendor_product_mapping`:
    *   หากพบการจับคู่ (Matched): ดึง `internal_product_id` มารองรับและคำนวณราคาต้นทุนสุทธิต่อหน่วยทันที
    *   หากไม่พบการจับคู่ (Unmatched): แสดงแถบแจ้งเตือนสีแดง และเปิด Smart Combobox ให้พนักงานเลือกสินค้าภายในร้านเพื่อกดจับคู่แบบ On-the-fly
    *   **UPSERT Mapping Protection:** กรณีที่ซัพพลายเออร์พิมพ์รหัส `raw_vendor_sku` เดียวกันมาหลายบรรทัดบนบิลเดียว ระบบจะใช้คำสั่ง UPSERT ในการบันทึก Mapping เพื่ออัปเดตข้อมูลทับของเดิมโดยไม่เกิด Error ชนกัน
    *   **Quick Create SKU (กรณีสินค้าใหม่ไซส์/สี):** พนักงานสามารถสร้าง SKU ใหม่กลางอากาศได้ทันทีผ่าน Server Actions โดยดึงข้อมูล Model เดิมมา Auto-fill ป้อนเพียงรหัสสี 3 หลักและไซส์ เพื่อลด Human Error สูงสุด
*   **Net Cost Apportionment:** มีฟังก์ชันประมวลผลคำนวณราคาตั้ง (`unit_price`) และข้อความส่วนลดระดับบรรทัด (`discount_text` เช่น "40%" หรือ "41.8%") ออกมาเป็นราคาต้นทุนที่แท้จริง (`unit_cost_price`) ก่อนบันทึกลงสมุดคลัง
*   **Inventory Ledger:** ห้ามแก้สต็อกที่ตาราง Products ตรงๆ ต้องบันทึกผ่าน Ledger เสมอ การบันทึกรับของเข้าคลังใช้ระบบ 2-Step Confirmation ยืนยันรายการสินค้าและหัวเอกสารเพื่อความถูกต้อง (ขา IN สำหรับซื้อ, ขา OUT สำหรับขาย เฉพาะเอกสารที่ตัดสต็อกจริง)
*   **[เพิ่มเติม] Apportionment Math Engine:** สมการบัญชีในระบบรองรับการคำนวณของแถม (FOC), ส่วนลดเหมาบรรทัด, ส่วนลดขั้นบันได (20+5), และการกระจายส่วนลดท้ายบิลแบบสัดส่วน (Prorate) พร้อมปัดเศษทศนิยม 4 ตำแหน่ง
*   **[เพิ่มเติม] LPP Auto-Update:** ระบบอัปเดตต้นทุนสั่งซื้อล่าสุด (Last Purchase Price) วิ่งกลับไปบันทึกทับใน `products.cost_price` อัตโนมัติเมื่อทำรายการรับของเข้าคลังสำเร็จ
*   **[เพิ่มเติม] OCR UI Text Wrap:** หน้า Dropdown จับคู่สินค้า OCR บังคับแสดงข้อความแบบห่อบรรทัด (Text Wrap) ป้องกันชื่อสินค้าและไซส์โดนตัดคำ
*   **[เพิ่มเติม] AI Document Intelligence (OCR Upgrade):** ขยายขีดความสามารถ Gemini Vision AI ให้อ่านและระบุ "ประเภทเอกสาร" (`doc_type`) และ "ประเภทภาษี" (`vat_type`) อัตโนมัติ เพื่อทำ Auto-fill (Human-in-the-loop) ลงฟอร์มบัญชี
*   **[เพิ่มเติม] Manual Goods Receipt:** เพิ่มระบบรับสินค้าเข้าคลังแบบกรอกข้อมูลเอง (Manual) ที่ใช้ฟอร์มมาตรฐานเดียวกับระบบ OCR เพื่อประมวลผลและอัปเดตราคาต้นทุน LPP
*   **[เพิ่มเติม] Document Image Attachment:** รองรับการอัปโหลดไฟล์ภาพบิลซื้อ (Supabase Storage) พร้อมผูก `attachment_url` เก็บไว้ที่หัวเอกสารเพื่อเป็นหลักฐานอ้างอิง

## 5. Database Schema (PostgreSQL for Supabase)
*(Schema คงเดิมตาม Blueprint v4.1 ครอบคลุมตารางทั้งหมดรวมถึง `contacts.ocr_pattern_config`, เพิ่มเติมตาราง `documents`, `document_items`, `inventory_ledger`, Enum Document/VAT Types และ RLS Policies `USING (true)`)*