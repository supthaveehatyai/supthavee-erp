# System Blueprint: Supthavee ERP SuperApp

**Version:** 9.1 (Phase 13 Deployment in Progress)

**Company:** บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด

**Document Purpose:** System Requirements, Business Logic, and Database Schema for AI Assistants (Claude, Cursor, Gemini)

## 1. System Overview (ภาพรวมระบบ)
ระบบ ERP แบบ Web Application สถาปัตยกรรม Full-Code ที่ออกแบบมาเพื่อบริหารจัดการธุรกิจค้าปลีก-ค้าส่ง (เสื้อผ้า, ชุดกีฬา, ถ้วยรางวัล) และงานบริการสั่งทำ (งานปัก, สกรีน) ครอบคลุมการจัดการบิลซื้อ/ขาย, การแยกบัญชี VAT/Non-VAT, ระบบรับเข้าอัจฉริยะ (OCR), การจัดการสต็อกหลายหน่วยนับ, การสร้างรหัสสินค้าแบบชาญฉลาด (Product Matrix & Auto-SKU), การวิเคราะห์กำไรต่อบิล, การจัดการเจ้าหนี้-ลูกหนี้ (AP/AR), การจัดการค่าใช้จ่าย (OPEX/Net Profit) และระบบสำรองข้อมูล (Backup/Restore)[cite: 3, 4]

## 2. Tech Stack & AI Integration (เทคโนโลยีที่ใช้)
*   **Frontend:** Next.js 16.2.10 (App Router + Turbopack), React, Tailwind CSS, shadcn/ui[cite: 3, 4]
*   **Backend & Database:** Supabase (PostgreSQL, RLS) พร้อมระบบ Database Migrations ผ่าน Supabase CLI[cite: 3, 4]
*   **Environment:** แยก `.env.development` สำหรับ Local DB (127.0.0.1) และ `.env.production` สำหรับ Cloud อย่างเด็ดขาด[cite: 3, 4]
*   **AI Integration:** Gemini Vision AI (Cascade Fallback 3.6 -> 3.5 -> 2.5) สำหรับอ่านเอกสารบิลซื้อ และบิลค่าใช้จ่าย (Smart OCR) ผ่าน Edge Functions[cite: 3, 4]
*   **Development Tools:** Cursor Code Editor, Claude 3.5 Sonnet / Gemini[cite: 3, 4]

## 3. User Roles (สิทธิ์การใช้งาน Dynamic RBAC)
*   **โครงสร้างสิทธิ์:** ควบคุมสิทธิ์แบบ Dynamic ผ่านตาราง `app_roles` และผูกกับ `auth.users` ผ่าน `user_profiles` พร้อมระบบ Auth Guard (Middleware) ฝั่ง Server[cite: 3, 4]
*   **Fast Login (PIN):** บังคับใช้ระบบล็อกอินด้วยอีเมลและรหัส PIN 6 หลัก เพื่อความรวดเร็วของพนักงานหน้าสายการผลิต[cite: 3, 4]
*   **Soft Delete Policy:** ห้ามลบผู้ใช้งานออกจากระบบ (Hard Delete) เพื่อรักษาความสมบูรณ์ของ Audit Trail ให้ใช้ระบบระงับสิทธิ์ (Deactivate/Reactivate) แทน[cite: 3, 4]
*   **Admin (ผู้บริหาร):** เข้าถึงทุกระบบ, ดูรายงานกำไร-ขาดทุน, อนุมัติหนี้สูญ, เข้าถึงประวัติการแก้ไข (Audit Trail), จัดการการตั้งค่าบริษัทและจัดการผู้ใช้งาน[cite: 3, 4]
*   **Sales (พนักงานขาย):** เปิดบิลขาย, รับชำระเงิน/มัดจำ, ติดตามสถานะงานปัก-สกรีน[cite: 3, 4]
*   **Warehouse / Production:** ทำรายการรับของเข้า (สแกนบิล), เบิกของออก, เปลี่ยนสถานะงานสั่งทำ[cite: 3, 4]
*   **Specialists (ช่างเฉพาะทาง):** พนักงานบัญชี, ช่างสกรีน, ช่างปัก, ช่างเย็บ (แยกสิทธิ์การมองเห็น Kanban และเอกสารชัดเจน)[cite: 3, 4]

## 4. Core Modules & Business Logic (โมดูลหลักและกฎเกณฑ์)
### Module A: Master Data, Products & Smart 2-Phase Matrix (ฐานข้อมูลหลัก และการสร้างสินค้า)
*   **Master Data UI Rules:** ช่องเลือก Vendor, Brand, Category ต้องเป็น Smart Combobox และรองรับการ "เพิ่มข้อมูลใหม่ (On-the-fly)" รวมไปถึง "Quick Edit Contact" รองรับระบบ Soft Delete (`is_active`) และป้องกันการบันทึกข้อมูลซ้ำซ้อน[cite: 3, 4]
*   **Service Products (งานบริการ):** รองรับสินค้าประเภทงานบริการ (`is_service = true`) ซึ่งสามารถขายได้โดยไม่ต้องคำนวณหรือตัดสต็อก (Bypass Inventory Ledger) ตามมาตรฐาน ERP
*   **Smart Category Taxonomy:** ใช้ระบบรหัส 2 ตัวอักษร อ้างอิงจาก กลุ่มหลัก + กลุ่มย่อย[cite: 3, 4]
*   **Internal Color Standard:** ต้องใช้ "รหัสสีกลางของร้าน" ล็อกความยาวแบบ Fixed Length ที่ 3 ตัวอักษรภาษาอังกฤษพิมพ์ใหญ่เท่านั้น (เช่น WHT, BLK, NVY, RED)[cite: 3, 4]
*   **Size Sort Order:** ตาราง `mst_sizes` ใช้ระบบรหัสตรงตามหน้าแคตตาล็อกโรงงานและตั้งน้ำหนักการจัดเรียง (`sort_order`) แบบระบุโซนช่วงห่างทีละ 10 (Gap of 10)[cite: 3, 4]
*   **Data Table UI:** การจัดกลุ่ม 2 ระดับ (Nested Grouping: ชื่อรุ่น -> สี -> ไซส์) เรียงลำดับตามน้ำหนักไซส์จริง[cite: 3, 4]
*   **2-Phase Product Matrix Creation:**
    *   **Phase 1 (Base Model):** สร้างโครงร่างสินค้ารุ่น (Draft Model) ลง `product_models` พร้อมแนบรูป Thumbnail (อัปโหลดเข้า Supabase Storage `product_assets` โดยบีบอัดเป็น WebP ขนาดไม่เกิน 500KB ฝั่ง Client)[cite: 3, 4]
    *   **Phase 2 (SKU Generation):** โหลด Model กลับมาใส่สี และ Generate SKU ลง `products` (เช็กซ้ำ Error 409 อัตโนมัติ)[cite: 3, 4]
*   **สูตรการสร้าง SKU:** `Brand Code` + `Category Code (2 หลัก)` + `Model Code (ล็อก 6 หลัก)` + `Gender Code (1 หลัก)` + `Color Code (3 หลัก)` + `Size Code`[cite: 3, 4]
*   **Global Size Integrity:** การเพิ่มไซส์ใน Product Matrix บังคับให้ใช้ไซส์มาตรฐานจากตาราง `mst_sizes` ผ่าน Selection Grid เท่านั้น[cite: 3, 4]
*   **Net Price Support:** อนุญาตให้เลือกลักษณะส่วนลดเป็น "ราคาเน็ต" เพื่อปลดล็อกช่องให้ผู้ใช้สามารถกรอกราคาต้นทุนเป็นเงินบาทได้โดยตรง[cite: 3, 4]

### Module B: Document Flow & Profit Analysis (ระบบเอกสารและการวิเคราะห์กำไร)
*   *(คงเนื้อหาเดิมตาม Blueprint ข้อ B - E อ้างอิงจาก[cite: 3, 4])*

### Module F: Inventory UI & Production Workflow (ระบบคลังสินค้าและสายการผลิต)
*   **Stock Card UI:** สมุดบัญชีคลังสินค้า จัดกลุ่มตาม Brand -> Model -> Color -> Size ค้นหาผ่าน URL-Driven เรียงลำดับตามน้ำหนักไซส์ (`sort_order`) แสดงยอดยกมา รับเข้า จ่ายออก ผ่าน Slide-over Sheet[cite: 3, 4]
*   **Service Workflow Kanban:** กระดานบอร์ด Kanban 5 สถานะ สำหรับงาน MTO รองรับระบบ Drag & Drop ย้ายสถานะแบบ Real-time[cite: 3, 4]
*   **Technician Routing & Rate Card:** เชื่อมโยงงานบริการกับช่างรับเหมาผ่านตาราง `technician_rates` เพื่อดึงค่าแรงมาตรฐาน (Default Wage) มาเป็นต้นทุน (COGS) อัตโนมัติในใบงานผลิต
*   **Production Attachment:** รองรับการแนบไฟล์ภาพ Mockup โลโก้ เข้าสู่ `Supabase Storage (production_attachments)` เพื่อให้ฝ่ายผลิตดูเป็นแบบอ้างอิง[cite: 3, 4]
*   **Job Details & Cancellation:** ระบบเปิดดูรายละเอียดใบงานผ่าน URL-Driven Sheet พร้อมปุ่มกดยกเลิกงาน (CANCELLED)[cite: 3, 4]
*   **Kanban Auto-Archive:** ใช้ `pg_cron` สร้าง Schedule Job รันทุกคืนเพื่อซ่อนการ์ดที่ 'DELIVERED' และ 'CANCELLED' ที่มีอายุเกิน 7 วันอัตโนมัติ[cite: 3, 4]

### Module G - K: *(คงเนื้อหาเดิมตาม Blueprint ข้อ G - K อ้างอิงจาก[cite: 3, 4])*