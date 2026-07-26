# System Blueprint: Supthavee ERP SuperApp

**Version:** 3.9 (Enterprise Standard, Fixed-3 Color, Multi-Zone Size Weights, OCR Pattern Config, Server Action Refactor, Quick Create SKU)

**Company:** บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด

**Document Purpose:** System Requirements, Business Logic, and Database Schema for AI Assistants (Claude, Cursor, Gemini)

## 1. System Overview (ภาพรวมระบบ)
ระบบ ERP แบบ Web Application สถาปัตยกรรม Full-Code ที่ออกแบบมาเพื่อบริหารจัดการธุรกิจค้าปลีก-ค้าส่ง (เสื้อผ้า, ชุดกีฬา, ถ้วยรางวัล) และงานบริการสั่งทำ (งานปัก, สกรีน) ครอบคลุมการจัดการบิลซื้อ/ขาย, การแยกบัญชี VAT/Non-VAT, ระบบรับเข้าอัจฉริยะ (OCR), การจัดการสต็อกหลายหน่วยนับ, การสร้างรหัสสินค้าแบบชาญฉลาด (Product Matrix & Auto-SKU), การวิเคราะห์กำไรต่อบิล และการจัดการเจ้าหนี้-ลูกหนี้ (AP/AR)[cite: 3, 6]

## 2. Tech Stack & AI Integration (เทคโนโลยีที่ใช้)
*   **Frontend:** Next.js (App Router), React, Tailwind CSS, shadcn/ui[cite: 3, 6]
*   **Backend & Database:** Supabase (PostgreSQL, RLS) พร้อมระบบ Database Migrations ผ่าน Supabase CLI[cite: 3, 6]
*   **Environment:** แยก `.env.development` สำหรับ Local DB (127.0.0.1) และ `.env.production` สำหรับ Cloud อย่างเด็ดขาด[cite: 3, 6]
*   **AI Integration:** Gemini Vision AI สำหรับอ่านเอกสารบิลซื้อ (Smart Goods Receipt) ผ่าน Edge Functions[cite: 3, 6]
*   **Development Tools:** Cursor Code Editor, Claude 3.5 Sonnet / Gemini Ultra[cite: 3, 6]

## 3. User Roles (สิทธิ์การใช้งาน)
*   **Admin (ผู้บริหาร):** เข้าถึงทุกระบบ, ดูรายงานกำไร-ขาดทุน, อนุมัติหนี้สูญ, เข้าถึงประวัติการแก้ไข (Audit Trail)[cite: 3, 6]
*   **Sales (พนักงานขาย):** เปิดบิลขาย, รับชำระเงิน/มัดจำ, ติดตามสถานะงานปัก-สกรีน[cite: 3, 6]
*   **Warehouse / Production:** ทำรายการรับของเข้า (สแกนบิล), เบิกของออก, เปลี่ยนสถานะงานสั่งทำ[cite: 3, 6]

## 4. Core Modules & Business Logic (โมดูลหลักและกฎเกณฑ์)
### Module A: Master Data, Products & Smart 2-Phase Matrix (ฐานข้อมูลหลัก และการสร้างสินค้า)
*   **Master Data UI Rules:** ช่องเลือก Vendor, Brand, Category ต้องเป็น Smart Combobox และรองรับการ "เพิ่มข้อมูลใหม่ (On-the-fly)" โดยไม่ทำให้ Form หลักปิดตัวลง[cite: 3, 6]
*   **Smart Category Taxonomy:** ใช้ระบบรหัส 2 ตัวอักษร อ้างอิงจาก กลุ่มหลัก + กลุ่มย่อย[cite: 3, 6]
*   **Internal Color Standard:** ต้องใช้ "รหัสสีกลางของร้าน" ล็อกความยาวแบบ Fixed Length ที่ 3 ตัวอักษรภาษาอังกฤษพิมพ์ใหญ่เท่านั้น (เช่น WHT, BLK, NVY, RED) เพื่อความสมมาตรของรหัส SKU และความแม่นยำของ AI OCR ในการทำ Regex Parsing[cite: 3, 6]
*   **Size Sort Order:** ตาราง `mst_sizes` ใช้ระบบรหัสตรงตามหน้าแคตตาล็อกโรงงานเพื่อเลี่ยงความสับสนใน Operation (เช่น แยก 2XL และ 2L ออกจากกันเด็ดขาด) และตั้งน้ำหนักการจัดเรียง (`sort_order`) แบบระบุโซนช่วงห่างทีละ 10 (Gap of 10) ดังนี้:
    *   100 - 150: ไซส์เด็กอนุบาลกลุ่ม K (K2S ถึง K2XL)[cite: 3, 6]
    *   160 - 210: ไซส์เด็กประถมกลุ่ม J (J2S ถึง J2XL)[cite: 3, 6]
    *   220 - 300: ไซส์ผู้ใหญ่มาตรฐาน (X2S, 3S, XS, S, M, L, XL)[cite: 3, 6]
    *   310 - 390: ไซส์ผู้ใหญ่พิเศษกลุ่ม XL (2XL ถึง 10XL)[cite: 3, 6]
    *   410 - 500: ไซส์ผู้ใหญ่พิเศษกลุ่ม L (2L ถึง 11L)[cite: 3, 6]
    *   550 - 999: กลุ่ม Free size และไซส์พิเศษตัวอักษรอื่น ๆ[cite: 3, 6]
    *   1000+: กลุ่มไซส์ที่เป็นตัวเลขล้วน (เบอร์ 1 ถึง 72) โดยรันน้ำหนักตามค่าเบอร์จริงคูณ 10[cite: 3, 6]
*   **Data Table UI:** การจัดกลุ่ม 2 ระดับ (Nested Grouping: ชื่อรุ่น -> สี -> ไซส์) เรียงลำดับตามน้ำหนักไซส์จริงจากฐานข้อมูล[cite: 3, 6]
*   **2-Phase Product Matrix Creation:**
    *   **Phase 1 (Base Model):** สร้างโครงร่างสินค้ารุ่น (Draft Model) บันทึกลง `product_models` พร้อมเก็บโครงสร้างราคา `size_pricing_config` แบบ JSONB และผูก `vendor_id` ตั้งแต่แรกเริ่มสร้าง[cite: 3, 6]
    *   **Phase 2 (SKU Generation):** โหลด Model กลับมาใส่สี และ Generate SKU ลง `products` (เช็กซ้ำ Error 409 อัตโนมัติ) และอัปเดตสถานะเป็น ACTIVE[cite: 3, 6]
*   **สูตรการสร้าง SKU:** `Brand Code` + `Category Code (2 หลัก)` + `Model Code (ล็อก 6 หลัก)` + `Gender Code (1 หลัก)` + `Color Code (3 หลัก)` + `Size Code`[cite: 3, 6]

### Module B: Document Flow & Profit Analysis (ระบบเอกสารและการวิเคราะห์กำไร)
*   **Document Types:** QT, PO, ABB, DEP, INV_DO, REC, TAX_INV, และ INT_REC[cite: 3, 6]
*   **Auto-Running Number:** รันเลขที่เอกสารอัตโนมัติแยกตามประเภทและเดือน[cite: 3, 6]
*   **Cost & Profit Snapshot:** ดึงราคาต้นทุนมาฝังไว้ที่รายการบิล (`unit_cost_price`) ทันทีที่ขาย เพื่อคำนวณกำไรขั้นต้น[cite: 3, 6]

### Module C: Smart Procurement & Inventory (ระบบจัดซื้อและคลังสินค้า)
*   **Strict Server-Side Fetching (Architecture Pivot):** การดึงและบันทึกข้อมูลที่เกี่ยวข้องกับ Procurement และ Master Data ทั้งหมด ต้องทำผ่าน Next.js Server Actions และใช้ `createClient` ร่วมกับ `SUPABASE_SERVICE_ROLE_KEY` (Admin Client) เท่านั้น เพื่อหลีกเลี่ยงปัญหา RLS Permission Denied จาก Client Component ในช่วง Local Development[cite: 3, 6]
*   **Smart Goods Receipt (AI OCR):** ระบบอัปโหลดรูปบิลซื้อเข้า -> เรียกใช้ AI OCR ดึงค่าแถวสินค้า -> คืนค่าออกมาเป็น `raw_vendor_sku` พร้อมข้อมูลราคาและส่วนลด[cite: 3, 6]
*   **AI Pattern Memorization:** ที่ตาราง `contacts` มีคอลัมน์ `ocr_pattern_config` (JSONB) สำหรับเก็บโครงสร้าง Prompt และพิกัดตารางบิลของซัพพลายเออร์แต่ละเจ้า เพื่อส่งไปพร้อมภาพบิล ป้องกันการเดาสุ่มของ AI[cite: 3, 6]
*   **On-the-fly Vendor Mapping & Quick Create:** เมื่อ AI อ่านค่า `raw_vendor_sku` ออกมา ระบบจะทำการตรวจสอบในตาราง `vendor_product_mapping`:
    *   หากพบการจับคู่ (Matched): ดึง `internal_product_id` มารองรับและคำนวณราคาต้นทุนสุทธิต่อหน่วยทันที[cite: 3, 6]
    *   หากไม่พบการจับคู่ (Unmatched): แสดงแถบแจ้งเตือนสีแดง และเปิด Smart Combobox ให้พนักงานเลือกสินค้าภายในร้านเพื่อกดจับคู่แบบ On-the-fly[cite: 3, 6]
    *   **Quick Create SKU (กรณีสินค้าใหม่ไซส์/สี):** พนักงานสามารถสร้าง SKU ใหม่กลางอากาศได้ทันทีผ่าน Server Actions โดยดึงข้อมูล Model เดิมมา Auto-fill ป้อนเพียงรหัสสี 3 หลักและไซส์ เพื่อลด Human Error สูงสุด
*   **Net Cost Apportionment:** มีฟังก์ชันประมวลผลคำนวณราคาตั้ง (`unit_price`) และข้อความส่วนลดระดับบรรทัด (`discount_text` เช่น "40%" หรือ "41.8%") ออกมาเป็นราคาต้นทุนที่แท้จริง (`unit_cost_price`) ก่อนบันทึกลงสมุดคลัง[cite: 3, 6]
*   **Inventory Ledger:** ห้ามแก้สต็อกที่ตาราง Products ตรงๆ ต้องบันทึกผ่าน Ledger เสมอ[cite: 3, 6]

## 5. Database Schema (PostgreSQL for Supabase)
*(Schema คงเดิมตาม Blueprint v3.6 ครอบคลุมตารางทั้งหมดรวมถึง `contacts.ocr_pattern_config`, RLS Policies `USING (true)`)*[cite: 3, 6]