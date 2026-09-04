System Blueprint: Supthavee ERP SuperApp

Version: 16.1 (Phase 16 Production Kanban \& BOM / Transition to Phase 17)

Company: บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด

Document Purpose: System Requirements, Business Logic, and Database Schema for AI Assistants (Claude, Cursor, Gemini)



1. System Overview (ภาพรวมระบบ)
ระบบ ERP แบบ Web Application สถาปัตยกรรม Full-Code ที่ออกแบบมาเพื่อบริหารจัดการธุรกิจค้าปลีก-ค้าส่ง (เสื้อผ้า, ชุดกีฬา, ถ้วยรางวัล) และงานบริการสั่งทำ (งานปัก, สกรีน) ครอบคลุมการจัดการบิลซื้อ/ขาย, การแยกบัญชี VAT/Non-VAT, ระบบรับเข้าอัจฉริยะ (OCR), การจัดการสต็อกหลายหน่วยนับ, การสร้างรหัสสินค้าแบบชาญฉลาด (Product Matrix \& Auto-SKU), การวิเคราะห์กำไรต่อบิล, การจัดการเจ้าหนี้-ลูกหนี้ (AP/AR), การจัดการค่าใช้จ่าย (OPEX/Net Profit) และระบบสำรองข้อมูล (Backup/Restore)
2. Tech Stack \& AI Integration (เทคโนโลยีที่ใช้)
Frontend: Next.js 16.2.10 (App Router + Turbopack), React, Tailwind CSS, shadcn/ui
Backend \& Database: Supabase (PostgreSQL, RLS) พร้อมระบบ Database Migrations ผ่าน Supabase CLI
Environment: แยก .env.development สำหรับ Local DB (127.0.0.1) และ .env.production สำหรับ Cloud อย่างเด็ดขาด
AI Integration: Gemini Vision AI (Cascade Fallback 3.6 -> 3.5 -> 2.5) สำหรับอ่านเอกสารบิลซื้อ และบิลค่าใช้จ่าย (Smart OCR) ผ่าน Edge Functions
Development Tools: Cursor Code Editor, Claude 3.5 Sonnet / Gemini



3\. User Roles (สิทธิ์การใช้งาน Dynamic RBAC)

โครงสร้างสิทธิ์: ควบคุมสิทธิ์แบบ Dynamic ผ่านตาราง app\_roles (Permission Matrix: accessible\_modules) และผูกกับ auth.users ผ่าน user\_profiles (ABAC: data\_access\_scope, approval\_limit) พร้อมระบบ Auth Guard (Middleware) ฝั่ง Server
Fast Login (PIN): บังคับใช้ระบบล็อกอินด้วยอีเมลและรหัส PIN 6 หลัก เพื่อความรวดเร็วของพนักงานหน้าสายการผลิต
Soft Delete Policy: ห้ามลบผู้ใช้งานออกจากระบบ (Hard Delete) เพื่อรักษาความสมบูรณ์ของ Audit Trail ให้ใช้ระบบระงับสิทธิ์ (Deactivate/Reactivate) แทน
Admin (ผู้บริหาร): เข้าถึงทุกระบบ, ดูรายงานกำไร-ขาดทุน, อนุมัติหนี้สูญ, เข้าถึงประวัติการแก้ไข (Audit Trail), จัดการการตั้งค่าบริษัทและจัดการผู้ใช้งาน
Sales (พนักงานขาย): เปิดบิลขาย, รับชำระเงิน/มัดจำ, ติดตามสถานะงานปัก-สกรีน
Warehouse / Production: ทำรายการรับของเข้า (สแกนบิล), เบิกของออก, เปลี่ยนสถานะงานสั่งทำ
Specialists (ช่างเฉพาะทาง): พนักงานบัญชี, ช่างสกรีน, ช่างปัก, ช่างเย็บ (แยกสิทธิ์การมองเห็น Kanban และเอกสารชัดเจน)





4\. Core Modules \& Business Logic (โมดูลหลักและกฎเกณฑ์)
Module A: Master Data, Products \& Smart 2-Phase Matrix (ฐานข้อมูลหลัก และการสร้างสินค้า)
Master Data UI Rules: ช่องเลือก Vendor, Brand, Category ต้องเป็น Smart Combobox และรองรับการ "เพิ่มข้อมูลใหม่ (On-the-fly)" รวมไปถึง "Quick Edit Contact" รองรับระบบ Soft Delete (is\_active) และป้องกันการบันทึกข้อมูลซ้ำซ้อน
Service Products (งานบริการ): รองรับสินค้าประเภทงานบริการ (is\_service = true) ซึ่งสามารถขายได้โดยไม่ต้องคำนวณหรือตัดสต็อก (Bypass Inventory Ledger) ตามมาตรฐาน ERP
Smart Category Taxonomy: ใช้ระบบรหัส 2 ตัวอักษร อ้างอิงจาก กลุ่มหลัก + กลุ่มย่อย
Internal Color Standard: ต้องใช้ "รหัสสีกลางของร้าน" ล็อกความยาวแบบ Fixed Length ที่ 3 ตัวอักษรภาษาอังกฤษพิมพ์ใหญ่เท่านั้น (เช่น WHT, BLK, NVY, RED)
Size Sort Order: ตาราง mst\_sizes ใช้ระบบรหัสตรงตามหน้าแคตตาล็อกโรงงานและตั้งน้ำหนักการจัดเรียง (sort\_order) แบบระบุโซนช่วงห่างทีละ 10 (Gap of 10)
Data Table UI: การจัดกลุ่ม 2 ระดับ (Nested Grouping: ชื่อรุ่น -> สี -> ไซส์) เรียงลำดับตามน้ำหนักไซส์จริง
2-Phase Product Matrix Creation:
Phase 1 (Base Model): สร้างโครงร่างสินค้ารุ่น (Draft Model) ลง product\_models พร้อมแนบรูป Thumbnail (อัปโหลดเข้า Supabase Storage product\_assets โดยบีบอัดเป็น WebP ขนาดไม่เกิน 500KB ฝั่ง Client)
Phase 2 (SKU Generation): โหลด Model กลับมาใส่สี และ Generate SKU ลง products (เช็กซ้ำ Error 409 อัตโนมัติ)
Global Size Integrity: การเพิ่มไซส์ใน Product Matrix บังคับให้ใช้ไซส์มาตรฐานจากตาราง mst\_sizes ผ่าน Selection Grid เท่านั้น
Net Price Support: อนุญาตให้เลือกลักษณะส่วนลดเป็น "ราคาเน็ต" เพื่อปลดล็อกช่องให้ผู้ใช้สามารถกรอกราคาต้นทุนเป็นเงินบาทได้โดยตรง
Size Sort Order \& Code Structure (Fixed-2): ตาราง mst\_sizes ใช้ระบบรหัสตรงตามหน้าแคตตาล็อกโรงงานและตั้งน้ำหนักการจัดเรียง (sort\_order) แบบระบุโซนช่วงห่างทีละ 10 (Gap of 10) และบังคับให้ size\_code มีความยาว 2 ตัวอักษรเท่านั้น (Fixed-2 Characters) เช่น '0S', 'XL', 'JS', 'A4' เพื่อความเสถียรของความยาว SKU
สูตรการสร้าง SKU: Brand Code + Category Code (2 หลัก) + Model Code (ล็อก 6 หลัก) + Gender Code (1 หลัก) + Color Code (3 หลัก) + Size Code (2 หลัก)
Line Item Subcontracting: รองรับการแบ่งงานบริการภายในใบสั่งผลิต (Job) เดียวกัน ให้ช่างหลายคนรับผิดชอบแยกกันเป็นรายบรรทัด (Line Item Assignment) โดยดึงเรตค่าแรงจากตาราง technician\_rates มาเป็น Default Wage และอนุญาตให้ปรับปรุงเป็น Actual Cost ได้หน้างาน
Unified Billing Hub (Technician Billing): ระบบสรุปวางบิลช่าง (TB) ถูกรวบรวมไว้ในหน้าจอเดียวกับระบบวางบิลลูกหนี้ (BN) และเจ้าหนี้ (BR) เพื่อให้กระบวนการตั้งเจ้าหนี้ค่าแรง (Accounts Payable) สอดคล้องตามหลักการบัญชี Accrual Basis
Module B: Document Flow \& Profit Analysis (ระบบเอกสารและการวิเคราะห์กำไร)
Document Conversion Lineage (SAP-aligned):
QT (ใบเสนอราคา) -> SO (ใบสั่งขาย) -> INV\_DO / TAX\_INV / CS\_TAX / ABB -> REC (ใบเสร็จรับเงิน)
QT ห้ามแปลงเป็นบิลขายตรง — ต้องผ่าน SO เพื่อยืนยันคำสั่งซื้อและจองสต็อกก่อน
SO ใช้ยืนยันคำสั่งซื้อ, จองสต็อก (Soft Allocation / ATP), และส่งงานผลิต (MTO — Send to Production)
One-Active-Child Lock: เอกสารต้นทางจะมีเอกสารต่อยอดที่ active ได้เพียง 1 ฉบับ
Soft Allocation / Available to Promise (ATP):
Available Stock = Physical Stock (Σ inventory\_ledger) − Committed Stock (Σ SO ISSUED items ที่ยังไม่ออกบิล)
Smart Matrix Selection แสดงยอด "พร้อมขาย (ATP)" แทน Physical Stock
Guardrail: หาก ATP ไม่เพียงพอ ห้ามบันทึกเอกสาร (bypass ได้ถ้า allow\_negative\_inventory = true)
Module C: Smart Procurement \& Inventory (ระบบจัดซื้อและคลังสินค้า)
Strict Server-Side Fetching: บังคับใช้ Server Actions ร่วมกับ Service Role Key (supabaseAdmin) 100% หลีกเลี่ยงปัญหา RLS
Project Guardrails: บังคับใช้ไฟล์ .cursorrules ล็อกสถาปัตยกรรมโค้ด (Zero Client-Side Fetching, Document Lifecycle) อย่างเคร่งครัด
Smart Goods Receipt (AI OCR): อัปโหลดรูปบิลเข้า -> AI OCR สกัด raw\_vendor\_sku, ส่วนลด, ภาษี, document\_number, document\_date
Duplicate Invoice Early Warning: ระบบตรวจสอบและดักจับบิลซ้ำซ้อนผ่าน Composite Key (vendor\_id + document\_number + document\_date)
On-the-fly Vendor Mapping \& Quick Create: ตรวจสอบและ UPSERT Mapping อัตโนมัติ รองรับการสร้าง SKU ใหม่กลางอากาศ (Quick Create)
Net Cost Apportionment Engine: ประมวลผลคำนวณราคาตั้ง ของแถม (FOC) และส่วนลดท้ายบิลแบบสัดส่วน (Prorate) พร้อมความละเอียดต้นทุน 4 ทศนิยม
LPP Auto-Update: ระบบอัปเดตต้นทุนสั่งซื้อล่าสุด (Last Purchase Price) ทับใน products.cost\_price อัตโนมัติ
Inventory Ledger: ห้ามแก้สต็อกที่ตาราง Products ตรงๆ ต้องบันทึกเข้า-ออกผ่าน inventory\_ledger เสมอ
Module D: Finance, Accounting \& Billing (ระบบการเงินและบัญชี)
Document Taxonomy (Sales vs Purchases): รหัสเอกสารแยกขาดจากกันชัดเจน
Sales (AR): 'QT', "SO", 'INV\_DO', 'TAX\_INV', 'CS\_TAX', 'ABB', 'DEP\_IN', 'REC', 'CN', 'AR\_REFUND' (SRF), 'AR\_WRITEOFF' (SWO), 'BN' (Billing Note)
Purchases (AP): 'PO', 'AP\_TAX', 'AP\_INV', 'AP\_CASH', 'DEP\_OUT', 'PAY', 'AP\_REFUND' (PRF), 'AP\_WRITEOFF' (PWO), 'BR' (Bill Receipt)
AR/AP Dashboard: หน้าจอสรุปยอดลูกหนี้และเจ้าหนี้ แบ่งแท็บแยกอิสระ โดยดึงจากฟิลด์ grand\_total (รวม VAT)
Billing Note (ระบบวางบิล): สร้างเอกสาร BN/BR แบบ Grouping ผ่าน billing\_note\_items โดยไม่มีผลต่อบัญชีแยกประเภท (GL) พร้อมหน้าตารางสรุปลูกหนี้ค้างชำระ
Knock-off Allocation (ระบบตัดยอดหนี้): รองรับการดึงเอกสารลูกข่ายผ่าน BN/BR หรือกระจายยอดอิสระแบบ FIFO ทำงานคู่กับ document\_allocations
Document Attachment \& WHT: รองรับการแนบไฟล์สลิปโอนเงิน (Slip) และหนังสือรับรองการหักภาษี ณ ที่จ่าย (WHT) ลง Supabase Storage
Receipt Status Tracking: ระบบติดตามและอัปเดตสถานะเอกสารตัวจริง ("รอออกเอกสาร/รอเอกสาร" -> "ออกเอกสารแล้ว/ได้รับแล้ว") พร้อม Database Migration original\_receipt\_received
Deposit Management: ระบบรับและจ่ายเงินมัดจำ (DEP\_IN / DEP\_OUT) ทำงานร่วมกับระบบ Allocation สามารถนำยอดคงเหลือไปเป็นส่วนลดในใบเสร็จ (REC/PAY) ได้ รองรับการคืนเงิน (Refund) และตัดเศษบัญชี (Write-off) พร้อมสืบทอดภาษีมูลค่าเพิ่ม (VAT Inheritance)
Approval Workflow (Maker-Checker): เอกสารที่มีผลกระทบสูง (เช่น Expense > 5,000) จะถูกตั้งค่าเป็น PENDING สถานะหลักต้องถูกล็อกเป็น DRAFT เสมอ และต้องได้รับการอนุมัติจาก Approval Center ก่อนจึงจะรันเลข ISSUED ได้ หากปฏิเสธจะคงสถานะ DRAFT พร้อมบังคับใส่เหตุผลลง approval\_logs
Period Closing (Period Lock): ป้องกันการแก้ไขหรือเพิ่มเอกสารในงวดบัญชีที่ถูกปิดไปแล้ว ควบคุมผ่านตาราง accounting\_periods
Fixed Asset Register: ทะเบียนสินทรัพย์ถาวรผ่าน fixed\_assets + mst\_asset\_categories (ราคาทุน, อายุใช้งาน, Soft Dispose) — เตรียมฐานสำหรับ Straight-line Depreciation
Module E: Dashboard \& Audit (ระบบรายงานและความปลอดภัย)
Executive Dashboard: หน้าจอสรุปยอดขาย (YTD) และยอดหนี้คงค้าง (AR/AP) แบบ Real-time
System Audit Trail: ระบบบันทึกประวัติการเปลี่ยนแปลงข้อมูลสำคัญระดับ Database (JSONB Log)
Human-Readable Parsing: รองรับระบบ Human-Readable แปลงโครงสร้าง JSONB (old\_data/new\_data) ให้อ่านง่าย เพื่อแสดงความแตกต่าง (Diff) อัตโนมัติ โดยมี Business Dictionary Mapping (เช่น net\_amount -> 'ยอดก่อนภาษี') และกรองการเปลี่ยนแปลงที่ไม่จำเป็น (False Positives) ออก
Fixed Asset Logging: จัดการรายละเอียดการบันทึก Audit Trail ของตาราง fixed\_assets เป็นกรณีพิเศษ เพื่อแสดงข้อมูล รหัส และชื่อสินทรัพย์
Module F: Inventory UI \& Production Workflow (ระบบคลังสินค้าและสายการผลิต)
Stock Card UI: สมุดบัญชีคลังสินค้า จัดกลุ่มตาม Brand -> Model -> Color -> Size ค้นหาผ่าน URL-Driven เรียงลำดับตามน้ำหนักไซส์ (sort\_order) แสดงยอดยกมา รับเข้า จ่ายออก ผ่าน Slide-over Sheet
Cycle Counting \& Adjustments:
รองรับเอกสาร STK\_OB (ยอดยกมา) เพื่อตั้งต้นสต็อก (Clean Slate) พร้อมบันทึกต้นทุน LPP
รองรับเอกสาร STK\_ADJ (ปรับปรุงสต็อก) ที่ให้พนักงานคีย์ยอดนับได้จริง (Physical Count) และระบบคำนวณส่วนต่าง (Variance) ให้อัตโนมัติแบบ Real-time ก่อนบันทึกลง Ledger
Service Workflow Kanban: กระดานบอร์ด Kanban 5 สถานะ สำหรับงาน MTO รองรับระบบ Drag \& Drop ย้ายสถานะแบบ Real-time
Technician Routing \& Rate Card: เชื่อมโยงงานบริการกับช่างรับเหมาผ่านตาราง technician\_rates เพื่อดึงค่าแรงมาตรฐาน (Default Wage) มาเป็นต้นทุน (COGS) อัตโนมัติในใบงานผลิต รองรับงาน Multi-service (สกรีน+ปัก) ในใบงานเดียว
Production Attachment: รองรับการแนบไฟล์ภาพ Mockup โลโก้ เข้าสู่ Supabase Storage (production\_attachments) เพื่อให้ฝ่ายผลิตดูเป็นแบบอ้างอิง
Job Details \& Cancellation: ระบบเปิดดูรายละเอียดใบงานผ่าน URL-Driven Sheet พร้อมปุ่มกดยกเลิกงาน (CANCELLED)
Kanban Auto-Archive: ใช้ pg\_cron สร้าง Schedule Job รันทุกคืนเพื่อซ่อนการ์ดที่ 'DELIVERED' และ 'CANCELLED' ที่มีอายุเกิน 7 วันอัตโนมัติ
Module G: Expense Management (ระบบจัดการค่าใช้จ่าย) - \[✅ Completed]
Expense Records: ฟอร์มบันทึกค่าใช้จ่ายดำเนินงาน (OPEX) พร้อมระบบแนบใบเสร็จ รองรับ Late Numbering และ Document Lifecycle (DRAFT/ISSUED/VOID) มาตรฐานเดียวกับระบบหลัก
Expense AI OCR: ระบบสแกนและอ่านบิลค่าใช้จ่ายบริษัทผ่าน Gemini Edge Function (มี Resiliency Fallback)
Duplicate Invoice Protection: ตรวจสอบบิลซ้ำซ้อนแบบ On-the-fly และ Database Unique Index (อ้างอิง vendor\_id + expense\_date + vendor\_doc\_no)
Withholding Tax (WHT) Foundation: โครงสร้างคำนวณหัก ณ ที่จ่าย หาค่า net\_payable อัตโนมัติ พร้อมรองรับแนบสลิปโอนเงิน (Payment Slip)
True Net Profit Engine: Dashboard ดึง OPEX ไปหักลบ Gross Profit เพื่อแสดงกำไรสุทธิแบบ Real-time
AP Installment Engine (TFRS 16): ระบบคำนวณแบ่งจ่ายค่างวดอัตโนมัติ (Auto-Split) พร้อมระบบปัดเศษสตางค์ลงงวดสุดท้าย แยกเงินต้น (principal) และดอกเบี้ยจ่าย (interest) ออกจากกันอย่างเด็ดขาดตามมาตรฐานบัญชี
AP Auto-Clearing (Cash Purchase): สำหรับบิลที่ไม่ผ่อนชำระ เมื่อได้รับการอนุมัติ (Approved) ระบบจะทำการตั้งหนี้และล้างหนี้โดยเปลี่ยนสถานะเอกสารเป็น PAID ทันทีอัตโนมัติ
Installment Knock-off: การบันทึกจ่ายค่างวด จะทำการ INSERT ลงตาราง payment\_transactions และเชื่อมสะพานผ่าน payment\_allocations เพื่อตัดหนี้รายงวด (ระบบจะอัปเดตบิลหลักเป็น PAID อัตโนมัติเมื่อผ่อนครบ)
Module H: Tax \& WHT Management (ระบบจัดการภาษีหัก ณ ที่จ่าย) - \[✅ Completed]
WHT Report: หน้าต่างรายงานสรุปยอดภาษีหัก ณ ที่จ่ายประจำเดือน แยกตามประเภท (1%, 2%, 3%, 5%)
Tax Compliance Export: ระบบตรวจสอบความถูกต้อง Master Data (Tax ID, ที่อยู่) และสร้างไฟล์ Excel แบบฟอร์ม ภ.ง.ด.3 / ภ.ง.ด.53
50 Tawi Generation: ระบบพิมพ์หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ) เป็น PDF รองรับการแปลงตัวอักษรภาษาไทย (Thai Baht Text)
Module I: Data Backup \& System Environment (ระบบสำรองและตั้งค่า) - \[✅ Completed]
Master Data Seed: ระบบดึงข้อมูล Master Data สู่ไฟล์ seed.sql ผ่านสคริปต์ generate-seed.mjs (--column-inserts) เพื่อความเสถียรในการ Reset ฐานข้อมูล
Disaster Recovery (Database): สคริปต์อัตโนมัติ backup-db.mjs สำหรับสำรองโครงสร้าง PostgreSQL ด้วย pg\_dump ยิงตรงผ่านพอร์ต 5432 (Pooler) และบีบอัดเป็น .sql.gz ผ่าน Node.js Streams
Disaster Recovery (Storage): สคริปต์อัตโนมัติ backup-storage.mjs ดูดไฟล์จาก Supabase Storage โดยใช้ S3-Compatible API (AWS SDK)
Manual Trigger \& Audit: ระบบกด Backup แบบ On-demand ผ่าน Server Actions (Zero Client-Side) คุมสิทธิ์ระดับ Admin และบันทึกประวัติลง audit\_logs อัตโนมัติ
Module J: Pre-Go-Live Readiness \& System Hardening (เตรียมความพร้อมก่อนขึ้นระบบจริง) - \[✅ Completed]



Module K: Post Go-Live Enterprise Enhancements (ส่วนต่อขยาย Phase 14)

Physical Inventory: ระบบเอกสารยอดยกมา (STK\_OB) และระบบปรับปรุงสต็อก (STK\_ADJ) \[✅ Completed]

Approval Workflow \& Period Closing: ระบบอนุมัติบิล Maker-Checker และการล็อกบัญชีรายเดือน \[✅ Completed]

Fixed Asset Management (Direct Capitalization): ทะเบียนสินทรัพย์ถาวรพร้อมระบบดึงข้อมูลจากบิล AP (Asset Clearing) ผ่าน URL Search Params แบบไร้รอยต่อ \[✅ Register Completed]

Fixed Asset Depreciation: คำนวณค่าเสื่อมราคาแบบเส้นตรง (Straight-line) ผูก Period Closing พร้อมระบบ Proration เฉลี่ยรายวันงวดแรก และ Ledger UI \[✅ Completed]

ABAC (Attribute-Based Access Control): ยกระดับระบบสิทธิ์การเข้าถึงข้อมูลแบบละเอียดด้วย Data Access Scope (ALL/OWN), Maker-Checker Approval Limit, และระบบ Role Permission Matrix (JSONB) เพื่อแบ่งแยกหน้าที่ (SoD) \[✅ Completed]

Data Archiving (Tiered Storage): สคริปต์สำรองข้อมูลภาพเย็น (Cold Data) อายุเกิน 1-5 ปี ถ่ายโอนสู่ NAS \[⏳ Roadmap]



Module L: Production \& Order-to-Cash (ส่วนขยาย Phase 16-17)

\- Production Kanban \& MTO: ระบบติดตามงานผลิตแบบลากวาง (Zero Client-Side Fetching) แบ่งเป็น 4 สถานะ (PLANNED, IN\_PROGRESS, QA, COMPLETED)

\- BOM Snapshot \& Estimated Cost: ระบบถอดสูตรการผลิต (BOM) อัตโนมัติเพื่อคำนวณวัตถุดิบที่ต้องใช้ (WIP) และดึงราคาต้นทุนล่าสุด (LPP) มาประเมินต้นทุน 

\- Sales Order Driven Production: ยึดเอกสารใบสั่งขาย (SO) เป็นจุดศูนย์กลางในการเปิดงานผลิต เพื่อควบคุม Job Costing (Matching Principle) ลดความผิดพลาดในการกรอกข้อมูล



5\. Database Schema (PostgreSQL for Supabase)

CRITICAL INSTRUCTION FOR AI: STRICTLY use the table names listed below. DO NOT invent, assume, or create new tables. If a required table is not on this list, STOP and ask the user for clarification.

(Note: bank\_accounts is DEPRECATED. ALWAYS use mst\_bank\_accounts for bank data).

1\. Master Data (ตารางข้อมูลหลัก)

(คงข้อมูลเดิม)

2\. Core Entities (องค์กร, ผู้ใช้, ตั้งค่า)

contacts (คู่ค้า Multi-Role: contact\_roles VARCHAR\[] เท่านั้น — ไม่ใช้ contact\_type)

contact\_persons (ผู้ติดต่อภายใต้คู่ค้า)

user\_profiles (โปรไฟล์พนักงาน/ผู้ใช้งาน — เพิ่ม data\_access\_scope, approval\_limit)

app\_roles (สิทธิ์การใช้งาน Dynamic RBAC — เพิ่ม accessible\_modules JSONB)

system\_settings (ตั้งค่าระบบบริษัท Singleton)



3\. Products, Inventory \& Production (สินค้า, คลัง, ผลิต)

mst\_categories (หมวดหมู่สินค้า — Hierarchy parent\_id, Parent 1-char, Child 2-char)

mst\_uom (หน่วยนับ — uom\_code เช่น PCS, KGS, MTR)

mst\_sizes (ขนาด — มี system size '00' สำหรับ N/A)

product\_models (รุ่นสินค้า — เพิ่ม is\_raw\_material, is\_service แยกประเภทชัดเจน, base\_uom\_id)

products (สินค้า SKU ย่อย)

product\_boms (สูตรการผลิต — finished\_model\_id, raw\_material\_model\_id, quantity\_required, waste\_percent)

production\_jobs (ใบสั่งผลิต / งาน MTO — job\_no, ref\_document\_id (โยง SO), finished\_model\_id, target\_quantity, status, estimated\_completion\_date, mockup\_image\_url, remark)

production\_job\_items (รายละเอียดไซส์งานผลิต — job\_id, product\_id, quantity)

production\_job\_materials (วัตถุดิบ WIP — job\_id, raw\_material\_model\_id, uom\_id, planned\_qty, actual\_used\_qty, cost\_price\_snapshot)



4\. Documents \& Financials (เอกสารและการเงิน)

Document Conversion Lineage: QT -> SO -> INV\_DO / TAX\_INV / CS\_TAX / ABB -> REC (ห้ามข้าม SO เด็ดขาด)

SO (ใบสั่งขาย): ใช้ยืนยันคำสั่งซื้อ, จองสต็อก (Soft Allocation / ATP), และส่งงานผลิต (MTO) โดยต้องระบุรายละเอียดไซส์และแนบรูป Mockup ได้



Soft Allocation (ATP): Available Stock = Physical Stock (Σ inventory\_ledger) − Committed Stock (Σ SO ISSUED qty ที่ยังไม่ออกบิล)

Inventory Adjustments: STK\_OB (ยอดยกมา · Prefix SOB-YYMM-XXXX) และ STK\_ADJ (ปรับปรุงสต็อก · Prefix SAD-YYMM-XXXX) บันทึกผ่าน inventory\_ledger และสร้าง Audit Trail เสมอ

documents / doc\_headers / doc\_details (เอกสารหลัก — doc\_type รวม TB สรุปวางบิลช่าง, เพิ่ม created\_by สำหรับทำ ABAC Ownership)

document\_items (รายการสินค้าในเอกสาร — งานบริการเก็บ technician\_id, wage\_cost, technician\_bill\_id เพื่อรองรับ Line Item Assignment)

document\_allocations (การจัดสรรเอกสาร เช่น ตัดมัดจำ)

billing\_note\_items (รายการใบวางบิล)

expenses (บิลค่าใช้จ่าย / OPEX — approval\_status, is\_installment, total\_interest\_amount, status IN ('DRAFT', 'PENDING', 'ISSUED', 'VOID', 'PAID'))

expense\_installments (งวดผ่อนชำระ — expense\_id, installment\_period, due\_date, principal\_amount, interest\_amount, total\_installment, is\_paid, payment\_transaction\_id)

approval\_logs (Phase 14 Maker-Checker — ประวัติอนุมัติ/ปฏิเสธ)

accounting\_periods (งวดบัญชีรายเดือน)

fixed\_assets (ทะเบียนสินทรัพย์ถาวร — asset\_code, asset\_name, category\_id, acquisition\_date, acquisition\_cost, salvage\_value, useful\_life\_months, status, expense\_id)

asset\_depreciation\_ledger (ประวัติการตัดค่าเสื่อมรายเดือน — asset\_id, period\_id, depreciation\_date, depreciation\_amount, accumulated\_depreciation, net\_book\_value)

payment\_transactions (ธุรกรรมการรับ/จ่าย)

payment\_allocations (การตัดยอดหนี้ Knock-off — expense\_id, document\_id)

payment\_slips (สลิปโอนเงิน)



5\. System \& Auditing (ระบบและการตรวจสอบ)

audit\_logs (ประวัติการเปลี่ยนแปลงข้อมูล JSONB)

6\. Database Views (มุมมองข้อมูลสำหรับ Report)

vw\_monthly\_profit\_summary (product\_cogs, wage\_cogs, cogs = เสื้อเปล่า + ค่าแรง)

vw\_sales\_profit\_analysis (กำไรต่อบิล — product\_cogs + document\_items.wage\_cost = total\_cogs)

