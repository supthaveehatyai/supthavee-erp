System Blueprint: Supthavee ERP SuperApp
Version: 14.3 (Phase 14 Post-Go-Live Enterprise Enhancements)
Company: บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด
Document Purpose: System Requirements, Business Logic, and Database Schema for AI Assistants (Claude, Cursor, Gemini)
1. System Overview (ภาพรวมระบบ)
ระบบ ERP แบบ Web Application สถาปัตยกรรม Full-Code ที่ออกแบบมาเพื่อบริหารจัดการธุรกิจค้าปลีก-ค้าส่ง (เสื้อผ้า, ชุดกีฬา, ถ้วยรางวัล) และงานบริการสั่งทำ (งานปัก, สกรีน) ครอบคลุมการจัดการบิลซื้อ/ขาย, การแยกบัญชี VAT/Non-VAT, ระบบรับเข้าอัจฉริยะ (OCR), การจัดการสต็อกหลายหน่วยนับ, การสร้างรหัสสินค้าแบบชาญฉลาด (Product Matrix & Auto-SKU), การวิเคราะห์กำไรต่อบิล, การจัดการเจ้าหนี้-ลูกหนี้ (AP/AR), การจัดการค่าใช้จ่าย (OPEX/Net Profit) และระบบสำรองข้อมูล (Backup/Restore)
2. Tech Stack & AI Integration (เทคโนโลยีที่ใช้)
Frontend: Next.js 16.2.10 (App Router + Turbopack), React, Tailwind CSS, shadcn/ui
Backend & Database: Supabase (PostgreSQL, RLS) พร้อมระบบ Database Migrations ผ่าน Supabase CLI
Environment: แยก .env.development สำหรับ Local DB (127.0.0.1) และ .env.production สำหรับ Cloud อย่างเด็ดขาด
AI Integration: Gemini Vision AI (Cascade Fallback 3.6 -> 3.5 -> 2.5) สำหรับอ่านเอกสารบิลซื้อ และบิลค่าใช้จ่าย (Smart OCR) ผ่าน Edge Functions
Development Tools: Cursor Code Editor, Claude 3.5 Sonnet / Gemini
3. User Roles (สิทธิ์การใช้งาน Dynamic RBAC)
โครงสร้างสิทธิ์: ควบคุมสิทธิ์แบบ Dynamic ผ่านตาราง app_roles และผูกกับ auth.users ผ่าน user_profiles พร้อมระบบ Auth Guard (Middleware) ฝั่ง Server
Fast Login (PIN): บังคับใช้ระบบล็อกอินด้วยอีเมลและรหัส PIN 6 หลัก เพื่อความรวดเร็วของพนักงานหน้าสายการผลิต
Soft Delete Policy: ห้ามลบผู้ใช้งานออกจากระบบ (Hard Delete) เพื่อรักษาความสมบูรณ์ของ Audit Trail ให้ใช้ระบบระงับสิทธิ์ (Deactivate/Reactivate) แทน
Admin (ผู้บริหาร): เข้าถึงทุกระบบ, ดูรายงานกำไร-ขาดทุน, อนุมัติหนี้สูญ, เข้าถึงประวัติการแก้ไข (Audit Trail), จัดการการตั้งค่าบริษัทและจัดการผู้ใช้งาน
Sales (พนักงานขาย): เปิดบิลขาย, รับชำระเงิน/มัดจำ, ติดตามสถานะงานปัก-สกรีน
Warehouse / Production: ทำรายการรับของเข้า (สแกนบิล), เบิกของออก, เปลี่ยนสถานะงานสั่งทำ
Specialists (ช่างเฉพาะทาง): พนักงานบัญชี, ช่างสกรีน, ช่างปัก, ช่างเย็บ (แยกสิทธิ์การมองเห็น Kanban และเอกสารชัดเจน)
4. Core Modules & Business Logic (โมดูลหลักและกฎเกณฑ์)
Module A: Master Data, Products & Smart 2-Phase Matrix (ฐานข้อมูลหลัก และการสร้างสินค้า)
Master Data UI Rules: ช่องเลือก Vendor, Brand, Category ต้องเป็น Smart Combobox และรองรับการ "เพิ่มข้อมูลใหม่ (On-the-fly)" รวมไปถึง "Quick Edit Contact" รองรับระบบ Soft Delete (is_active) และป้องกันการบันทึกข้อมูลซ้ำซ้อน
Service Products (งานบริการ): รองรับสินค้าประเภทงานบริการ (is_service = true) ซึ่งสามารถขายได้โดยไม่ต้องคำนวณหรือตัดสต็อก (Bypass Inventory Ledger) ตามมาตรฐาน ERP
Smart Category Taxonomy: ใช้ระบบรหัส 2 ตัวอักษร อ้างอิงจาก กลุ่มหลัก + กลุ่มย่อย
Internal Color Standard: ต้องใช้ "รหัสสีกลางของร้าน" ล็อกความยาวแบบ Fixed Length ที่ 3 ตัวอักษรภาษาอังกฤษพิมพ์ใหญ่เท่านั้น (เช่น WHT, BLK, NVY, RED)
Size Sort Order: ตาราง mst_sizes ใช้ระบบรหัสตรงตามหน้าแคตตาล็อกโรงงานและตั้งน้ำหนักการจัดเรียง (sort_order) แบบระบุโซนช่วงห่างทีละ 10 (Gap of 10)
Data Table UI: การจัดกลุ่ม 2 ระดับ (Nested Grouping: ชื่อรุ่น -> สี -> ไซส์) เรียงลำดับตามน้ำหนักไซส์จริง
2-Phase Product Matrix Creation:
Phase 1 (Base Model): สร้างโครงร่างสินค้ารุ่น (Draft Model) ลง product_models พร้อมแนบรูป Thumbnail (อัปโหลดเข้า Supabase Storage product_assets โดยบีบอัดเป็น WebP ขนาดไม่เกิน 500KB ฝั่ง Client)
Phase 2 (SKU Generation): โหลด Model กลับมาใส่สี และ Generate SKU ลง products (เช็กซ้ำ Error 409 อัตโนมัติ)
Global Size Integrity: การเพิ่มไซส์ใน Product Matrix บังคับให้ใช้ไซส์มาตรฐานจากตาราง mst_sizes ผ่าน Selection Grid เท่านั้น
Net Price Support: อนุญาตให้เลือกลักษณะส่วนลดเป็น "ราคาเน็ต" เพื่อปลดล็อกช่องให้ผู้ใช้สามารถกรอกราคาต้นทุนเป็นเงินบาทได้โดยตรง
Size Sort Order & Code Structure (Fixed-2): ตาราง mst_sizes ใช้ระบบรหัสตรงตามหน้าแคตตาล็อกโรงงานและตั้งน้ำหนักการจัดเรียง (sort_order) แบบระบุโซนช่วงห่างทีละ 10 (Gap of 10) และบังคับให้ size_code มีความยาว 2 ตัวอักษรเท่านั้น (Fixed-2 Characters) เช่น '0S', 'XL', 'JS', 'A4' เพื่อความเสถียรของความยาว SKU
สูตรการสร้าง SKU: Brand Code + Category Code (2 หลัก) + Model Code (ล็อก 6 หลัก) + Gender Code (1 หลัก) + Color Code (3 หลัก) + Size Code (2 หลัก)
Line Item Subcontracting: รองรับการแบ่งงานบริการภายในใบสั่งผลิต (Job) เดียวกัน ให้ช่างหลายคนรับผิดชอบแยกกันเป็นรายบรรทัด (Line Item Assignment) โดยดึงเรตค่าแรงจากตาราง technician_rates มาเป็น Default Wage และอนุญาตให้ปรับปรุงเป็น Actual Cost ได้หน้างาน
Unified Billing Hub (Technician Billing): ระบบสรุปวางบิลช่าง (TB) ถูกรวบรวมไว้ในหน้าจอเดียวกับระบบวางบิลลูกหนี้ (BN) และเจ้าหนี้ (BR) เพื่อให้กระบวนการตั้งเจ้าหนี้ค่าแรง (Accounts Payable) สอดคล้องตามหลักการบัญชี Accrual Basis
Module B: Document Flow & Profit Analysis (ระบบเอกสารและการวิเคราะห์กำไร)
Document Conversion Lineage (SAP-aligned):
QT (ใบเสนอราคา) -> SO (ใบสั่งขาย) -> INV_DO / TAX_INV / CS_TAX / ABB -> REC (ใบเสร็จรับเงิน)
QT ห้ามแปลงเป็นบิลขายตรง — ต้องผ่าน SO เพื่อยืนยันคำสั่งซื้อและจองสต็อกก่อน
SO ใช้ยืนยันคำสั่งซื้อ, จองสต็อก (Soft Allocation / ATP), และส่งงานผลิต (MTO — Send to Production)
One-Active-Child Lock: เอกสารต้นทางจะมีเอกสารต่อยอดที่ active ได้เพียง 1 ฉบับ
Soft Allocation / Available to Promise (ATP):
Available Stock = Physical Stock (Σ inventory_ledger) − Committed Stock (Σ SO ISSUED items ที่ยังไม่ออกบิล)
Smart Matrix Selection แสดงยอด "พร้อมขาย (ATP)" แทน Physical Stock
Guardrail: หาก ATP ไม่เพียงพอ ห้ามบันทึกเอกสาร (bypass ได้ถ้า allow_negative_inventory = true)
Module C: Smart Procurement & Inventory (ระบบจัดซื้อและคลังสินค้า)
Strict Server-Side Fetching: บังคับใช้ Server Actions ร่วมกับ Service Role Key (supabaseAdmin) 100% หลีกเลี่ยงปัญหา RLS
Project Guardrails: บังคับใช้ไฟล์ .cursorrules ล็อกสถาปัตยกรรมโค้ด (Zero Client-Side Fetching, Document Lifecycle) อย่างเคร่งครัด
Smart Goods Receipt (AI OCR): อัปโหลดรูปบิลเข้า -> AI OCR สกัด raw_vendor_sku, ส่วนลด, ภาษี, document_number, document_date
Duplicate Invoice Early Warning: ระบบตรวจสอบและดักจับบิลซ้ำซ้อนผ่าน Composite Key (vendor_id + document_number + document_date)
On-the-fly Vendor Mapping & Quick Create: ตรวจสอบและ UPSERT Mapping อัตโนมัติ รองรับการสร้าง SKU ใหม่กลางอากาศ (Quick Create)
Net Cost Apportionment Engine: ประมวลผลคำนวณราคาตั้ง ของแถม (FOC) และส่วนลดท้ายบิลแบบสัดส่วน (Prorate) พร้อมความละเอียดต้นทุน 4 ทศนิยม
LPP Auto-Update: ระบบอัปเดตต้นทุนสั่งซื้อล่าสุด (Last Purchase Price) ทับใน products.cost_price อัตโนมัติ
Inventory Ledger: ห้ามแก้สต็อกที่ตาราง Products ตรงๆ ต้องบันทึกเข้า-ออกผ่าน inventory_ledger เสมอ
Module D: Finance, Accounting & Billing (ระบบการเงินและบัญชี)
Document Taxonomy (Sales vs Purchases): รหัสเอกสารแยกขาดจากกันชัดเจน
Sales (AR): 'QT', "SO", 'INV_DO', 'TAX_INV', 'CS_TAX', 'ABB', 'DEP_IN', 'REC', 'CN', 'AR_REFUND' (SRF), 'AR_WRITEOFF' (SWO), 'BN' (Billing Note)
Purchases (AP): 'PO', 'AP_TAX', 'AP_INV', 'AP_CASH', 'DEP_OUT', 'PAY', 'AP_REFUND' (PRF), 'AP_WRITEOFF' (PWO), 'BR' (Bill Receipt)
AR/AP Dashboard: หน้าจอสรุปยอดลูกหนี้และเจ้าหนี้ แบ่งแท็บแยกอิสระ โดยดึงจากฟิลด์ grand_total (รวม VAT)
Billing Note (ระบบวางบิล): สร้างเอกสาร BN/BR แบบ Grouping ผ่าน billing_note_items โดยไม่มีผลต่อบัญชีแยกประเภท (GL) พร้อมหน้าตารางสรุปลูกหนี้ค้างชำระ
Knock-off Allocation (ระบบตัดยอดหนี้): รองรับการดึงเอกสารลูกข่ายผ่าน BN/BR หรือกระจายยอดอิสระแบบ FIFO ทำงานคู่กับ document_allocations
Document Attachment & WHT: รองรับการแนบไฟล์สลิปโอนเงิน (Slip) และหนังสือรับรองการหักภาษี ณ ที่จ่าย (WHT) ลง Supabase Storage
Receipt Status Tracking: ระบบติดตามและอัปเดตสถานะเอกสารตัวจริง ("รอออกเอกสาร/รอเอกสาร" -> "ออกเอกสารแล้ว/ได้รับแล้ว") พร้อม Database Migration original_receipt_received
Deposit Management: ระบบรับและจ่ายเงินมัดจำ (DEP_IN / DEP_OUT) ทำงานร่วมกับระบบ Allocation สามารถนำยอดคงเหลือไปเป็นส่วนลดในใบเสร็จ (REC/PAY) ได้ รองรับการคืนเงิน (Refund) และตัดเศษบัญชี (Write-off) พร้อมสืบทอดภาษีมูลค่าเพิ่ม (VAT Inheritance)
Approval Workflow (Maker-Checker): เอกสารที่มีผลกระทบสูง (เช่น Expense > 5,000) จะถูกตั้งค่าเป็น PENDING สถานะหลักต้องถูกล็อกเป็น DRAFT เสมอ และต้องได้รับการอนุมัติจาก Approval Center ก่อนจึงจะรันเลข ISSUED ได้ หากปฏิเสธจะคงสถานะ DRAFT พร้อมบังคับใส่เหตุผลลง approval_logs
Period Closing (Period Lock): ป้องกันการแก้ไขหรือเพิ่มเอกสารในงวดบัญชีที่ถูกปิดไปแล้ว ควบคุมผ่านตาราง accounting_periods
Fixed Asset Register: ทะเบียนสินทรัพย์ถาวรผ่าน fixed_assets + mst_asset_categories (ราคาทุน, อายุใช้งาน, Soft Dispose) — เตรียมฐานสำหรับ Straight-line Depreciation
Module E: Dashboard & Audit (ระบบรายงานและความปลอดภัย)
Executive Dashboard: หน้าจอสรุปยอดขาย (YTD) และยอดหนี้คงค้าง (AR/AP) แบบ Real-time
System Audit Trail: ระบบบันทึกประวัติการเปลี่ยนแปลงข้อมูลสำคัญระดับ Database (JSONB Log)
Human-Readable Parsing: รองรับระบบ Human-Readable แปลงโครงสร้าง JSONB (old_data/new_data) ให้อ่านง่าย เพื่อแสดงความแตกต่าง (Diff) อัตโนมัติ โดยมี Business Dictionary Mapping (เช่น net_amount -> 'ยอดก่อนภาษี') และกรองการเปลี่ยนแปลงที่ไม่จำเป็น (False Positives) ออก
Fixed Asset Logging: จัดการรายละเอียดการบันทึก Audit Trail ของตาราง fixed_assets เป็นกรณีพิเศษ เพื่อแสดงข้อมูล รหัส และชื่อสินทรัพย์
Module F: Inventory UI & Production Workflow (ระบบคลังสินค้าและสายการผลิต)
Stock Card UI: สมุดบัญชีคลังสินค้า จัดกลุ่มตาม Brand -> Model -> Color -> Size ค้นหาผ่าน URL-Driven เรียงลำดับตามน้ำหนักไซส์ (sort_order) แสดงยอดยกมา รับเข้า จ่ายออก ผ่าน Slide-over Sheet
Cycle Counting & Adjustments:
รองรับเอกสาร STK_OB (ยอดยกมา) เพื่อตั้งต้นสต็อก (Clean Slate) พร้อมบันทึกต้นทุน LPP
รองรับเอกสาร STK_ADJ (ปรับปรุงสต็อก) ที่ให้พนักงานคีย์ยอดนับได้จริง (Physical Count) และระบบคำนวณส่วนต่าง (Variance) ให้อัตโนมัติแบบ Real-time ก่อนบันทึกลง Ledger
Service Workflow Kanban: กระดานบอร์ด Kanban 5 สถานะ สำหรับงาน MTO รองรับระบบ Drag & Drop ย้ายสถานะแบบ Real-time
Technician Routing & Rate Card: เชื่อมโยงงานบริการกับช่างรับเหมาผ่านตาราง technician_rates เพื่อดึงค่าแรงมาตรฐาน (Default Wage) มาเป็นต้นทุน (COGS) อัตโนมัติในใบงานผลิต รองรับงาน Multi-service (สกรีน+ปัก) ในใบงานเดียว
Production Attachment: รองรับการแนบไฟล์ภาพ Mockup โลโก้ เข้าสู่ Supabase Storage (production_attachments) เพื่อให้ฝ่ายผลิตดูเป็นแบบอ้างอิง
Job Details & Cancellation: ระบบเปิดดูรายละเอียดใบงานผ่าน URL-Driven Sheet พร้อมปุ่มกดยกเลิกงาน (CANCELLED)
Kanban Auto-Archive: ใช้ pg_cron สร้าง Schedule Job รันทุกคืนเพื่อซ่อนการ์ดที่ 'DELIVERED' และ 'CANCELLED' ที่มีอายุเกิน 7 วันอัตโนมัติ
Module G: Expense Management (ระบบจัดการค่าใช้จ่าย) - [✅ Completed]
Expense Records: ฟอร์มบันทึกค่าใช้จ่ายดำเนินงาน (OPEX) พร้อมระบบแนบใบเสร็จ รองรับ Late Numbering และ Document Lifecycle (DRAFT/ISSUED/VOID) มาตรฐานเดียวกับระบบหลัก
Expense AI OCR: ระบบสแกนและอ่านบิลค่าใช้จ่ายบริษัทผ่าน Gemini Edge Function (มี Resiliency Fallback)
Duplicate Invoice Protection: ตรวจสอบบิลซ้ำซ้อนแบบ On-the-fly และ Database Unique Index (อ้างอิง vendor_id + expense_date + vendor_doc_no)
Withholding Tax (WHT) Foundation: โครงสร้างคำนวณหัก ณ ที่จ่าย หาค่า net_payable อัตโนมัติ พร้อมรองรับแนบสลิปโอนเงิน (Payment Slip)
True Net Profit Engine: Dashboard ดึง OPEX ไปหักลบ Gross Profit เพื่อแสดงกำไรสุทธิแบบ Real-time
AP Installment Engine (TFRS 16): ระบบคำนวณแบ่งจ่ายค่างวดอัตโนมัติ (Auto-Split) พร้อมระบบปัดเศษสตางค์ลงงวดสุดท้าย แยกเงินต้น (principal) และดอกเบี้ยจ่าย (interest) ออกจากกันอย่างเด็ดขาดตามมาตรฐานบัญชี
AP Auto-Clearing (Cash Purchase): สำหรับบิลที่ไม่ผ่อนชำระ เมื่อได้รับการอนุมัติ (Approved) ระบบจะทำการตั้งหนี้และล้างหนี้โดยเปลี่ยนสถานะเอกสารเป็น PAID ทันทีอัตโนมัติ
Installment Knock-off: การบันทึกจ่ายค่างวด จะทำการ INSERT ลงตาราง payment_transactions และเชื่อมสะพานผ่าน payment_allocations เพื่อตัดหนี้รายงวด (ระบบจะอัปเดตบิลหลักเป็น PAID อัตโนมัติเมื่อผ่อนครบ)
Module H: Tax & WHT Management (ระบบจัดการภาษีหัก ณ ที่จ่าย) - [✅ Completed]
WHT Report: หน้าต่างรายงานสรุปยอดภาษีหัก ณ ที่จ่ายประจำเดือน แยกตามประเภท (1%, 2%, 3%, 5%)
Tax Compliance Export: ระบบตรวจสอบความถูกต้อง Master Data (Tax ID, ที่อยู่) และสร้างไฟล์ Excel แบบฟอร์ม ภ.ง.ด.3 / ภ.ง.ด.53
50 Tawi Generation: ระบบพิมพ์หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ) เป็น PDF รองรับการแปลงตัวอักษรภาษาไทย (Thai Baht Text)
Module I: Data Backup & System Environment (ระบบสำรองและตั้งค่า) - [✅ Completed]
Master Data Seed: ระบบดึงข้อมูล Master Data สู่ไฟล์ seed.sql ผ่านสคริปต์ generate-seed.mjs (--column-inserts) เพื่อความเสถียรในการ Reset ฐานข้อมูล
Disaster Recovery (Database): สคริปต์อัตโนมัติ backup-db.mjs สำหรับสำรองโครงสร้าง PostgreSQL ด้วย pg_dump ยิงตรงผ่านพอร์ต 5432 (Pooler) และบีบอัดเป็น .sql.gz ผ่าน Node.js Streams
Disaster Recovery (Storage): สคริปต์อัตโนมัติ backup-storage.mjs ดูดไฟล์จาก Supabase Storage โดยใช้ S3-Compatible API (AWS SDK)
Manual Trigger & Audit: ระบบกด Backup แบบ On-demand ผ่าน Server Actions (Zero Client-Side) คุมสิทธิ์ระดับ Admin และบันทึกประวัติลง audit_logs อัตโนมัติ
Module J: Pre-Go-Live Readiness & System Hardening (เตรียมความพร้อมก่อนขึ้นระบบจริง) - [✅ Completed]
Phase 10 (Enterprise Foundation & Security): การจัดการ Global Standard & UI Pattern Library (ล็อกใน .cursorrules), ระบบตารางตั้งค่าบริษัท (system_settings), Authentication และ Role-Based Access Control (RBAC), การจัดการ Sidebar ตามสิทธิ์
Phase 11 (Operational Refinement): การแสดงรูปสินค้า Thumbnail ในรายการเปิดบิล (Visual Verification), การปรับปรุง Document Templates (ดึงข้อมูลบริษัทอัตโนมัติและอิง TFRS)
Phase 12 (Knowledge Management & UAT): จัดทำคู่มือมาตรฐานระบบ, ระบบตั้งค่า Interactive Knowledge Base, ระบบ PIN Login, ทะลุกำแพง Auth Guard, เปิดสวิตช์ Negative Stock, UAT Testing
Module K: Post Go-Live Enterprise Enhancements (ส่วนต่อขยาย Phase 14)
Physical Inventory: ระบบเอกสารยอดยกมา (STK_OB) และระบบปรับปรุงสต็อก (STK_ADJ) [✅ Completed]
Approval Workflow & Period Closing: ระบบอนุมัติบิล Maker-Checker และการล็อกบัญชีรายเดือน [✅ Completed]
Fixed Asset Management (Direct Capitalization): ทะเบียนสินทรัพย์ถาวร รองรับการดึงข้อมูลราคาทุนจาก AP Invoice โดยตรงผ่าน URL Search Params (?linked_expense_id=...) เข้าสู่ตาราง fixed_assets เพื่อป้องกันการกรอกราคาทุนไม่ตรงกับบิล (Historical Cost Principle) พร้อมระบบดึงเอกสาร document_no แทนที่การใช้ UUID เพื่อแสดงผลใน URL Search Params หน้า fixed_assets และระบบ View Details ผ่าน Slide-over Sheet (URL-Driven) [✅ Register Completed]
Fixed Asset Depreciation: คำนวณค่าเสื่อมราคาแบบเส้นตรง (Straight-line) และโพสต์รายการบัญชีรายเดือน [⏳ Roadmap]
Data Archiving (Tiered Storage): สคริปต์สำรองข้อมูลภาพเย็น (Cold Data) อายุเกิน 1-5 ปี ถ่ายโอนสู่ NAS [⏳ Roadmap]
ABAC (Attribute-Based Access Control): ยกระดับระบบสิทธิ์การเข้าถึงข้อมูลแบบละเอียดรายบุคคล [⏳ Roadmap]
5. Database Schema (PostgreSQL for Supabase)
CRITICAL INSTRUCTION FOR AI: STRICTLY use the table names listed below. DO NOT invent, assume, or create new tables. If a required table is not on this list, STOP and ask the user for clarification.
(Note: bank_accounts is DEPRECATED. ALWAYS use mst_bank_accounts for bank data).
1. Master Data (ตารางข้อมูลหลัก)
mst_bank_accounts (สมุดบัญชีธนาคารบริษัท)
mst_brands (แบรนด์สินค้า)
mst_categories (หมวดหมู่สินค้า)
mst_colors (สีมาตรฐาน - ล็อก 3 ตัวอักษรพิมพ์ใหญ่)
mst_expense_categories (หมวดหมู่ค่าใช้จ่าย)
mst_asset_categories (หมวดหมู่สินทรัพย์ถาวร — category_code, useful_life_years, depreciation_rate)
mst_genders (เพศ/ทรงเสื้อ)
mst_sizes (ไซส์มาตรฐาน Global Size รวมถึงไซส์บริการ)
2. Core Entities (องค์กร, ผู้ใช้, ตั้งค่า)
contacts (คู่ค้า Multi-Role: contact_roles VARCHAR[] เท่านั้น — ไม่ใช้ contact_type)
contact_persons (ผู้ติดต่อภายใต้คู่ค้า)
user_profiles (โปรไฟล์พนักงาน/ผู้ใช้งาน)
app_roles (สิทธิ์การใช้งาน Dynamic RBAC)
system_settings (ตั้งค่าระบบบริษัท Singleton)
3. Products, Inventory & Production (สินค้า, คลัง, ผลิต)
product_models (รุ่นสินค้า - Phase 1 ของการสร้าง Matrix)
products (สินค้า SKU ย่อย - Phase 2)
vendor_product_mapping (การผูกรหัสสินค้าซัพพลายเออร์)
inventory_ledger (สมุดบัญชีคลังสินค้า - ควบคุมการเข้าออกสต็อก)
production_jobs (ใบสั่งผลิต / งาน MTO — อัปเดต: ยกเลิกการเก็บ technician_id และ wage_cost ที่ตารางนี้ ย้ายไประดับ Line Item แทน)
service_tracking (ติดตามสถานะงานบริการ)
technician_rates (เรตค่าแรงช่าง — FK service_model_id -> product_models.id, technician_id -> contacts.id)
4. Documents & Financials (เอกสารและการเงิน)
Document Conversion Lineage: QT -> SO -> INV_DO / TAX_INV / CS_TAX / ABB -> REC (ห้ามข้าม SO เด็ดขาด)
SO (ใบสั่งขาย): ใช้ยืนยันคำสั่งซื้อ, จองสต็อก (Soft Allocation / ATP), และส่งงานผลิต (MTO)
Soft Allocation (ATP): Available Stock = Physical Stock (Σ inventory_ledger) − Committed Stock (Σ SO ISSUED qty ที่ยังไม่ออกบิล)
Inventory Adjustments: STK_OB (ยอดยกมา · Prefix SOB-YYMM-XXXX) และ STK_ADJ (ปรับปรุงสต็อก · Prefix SAD-YYMM-XXXX) บันทึกผ่าน inventory_ledger และสร้าง Audit Trail เสมอ
documents / doc_headers / doc_details (เอกสารหลัก — doc_type รวม TB สรุปวางบิลช่าง)
document_items (รายการสินค้าในเอกสาร — งานบริการเก็บ technician_id, wage_cost, technician_bill_id เพื่อรองรับ Line Item Assignment)
document_allocations (การจัดสรรเอกสาร เช่น ตัดมัดจำ)
billing_note_items (รายการใบวางบิล)
expenses (บิลค่าใช้จ่าย / OPEX — approval_status, is_installment, total_interest_amount, status IN ('DRAFT', 'PENDING', 'ISSUED', 'VOID', 'PAID'))
expense_installments (งวดผ่อนชำระ — expense_id, installment_period, due_date, principal_amount, interest_amount, total_installment, is_paid, payment_transaction_id)
approval_logs (Phase 14 Maker-Checker — ประวัติอนุมัติ/ปฏิเสธ)
accounting_periods (งวดบัญชีรายเดือน)
fixed_assets (ทะเบียนสินทรัพย์ถาวร — asset_code, asset_name, category_id, acquisition_date, acquisition_cost, salvage_value, useful_life_months, status, expense_id)
payment_transactions (ธุรกรรมการรับ/จ่าย)
payment_allocations (การตัดยอดหนี้ Knock-off — expense_id, document_id)
payment_slips (สลิปโอนเงิน)
5. System & Auditing (ระบบและการตรวจสอบ)
audit_logs (ประวัติการเปลี่ยนแปลงข้อมูล JSONB)
6. Database Views (มุมมองข้อมูลสำหรับ Report)
vw_monthly_profit_summary (product_cogs, wage_cogs, cogs = เสื้อเปล่า + ค่าแรง)
vw_sales_profit_analysis (กำไรต่อบิล — product_cogs + document_items.wage_cost = total_cogs)
