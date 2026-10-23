System Blueprint: Supthavee ERP SuperApp

Version: 22.0 (Phase 22: Full-System Backup/Restore, Unified Goods Receipt, Canonical OCR Matching & Internal Fraud Controls)

Company: บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด สำนักงานใหญ่ (Supthavee Hatyai Co., Ltd.)

Document Purpose: System Requirements, Business Logic, and Database Schema for AI Assistants (Gemini, Claude, Cursor)

1. System Overview (ภาพรวมระบบ)

ระบบ ERP แบบ Web Application สถาปัตยกรรม Full-Code ที่รันบน Supabase Cloud และ Vercel 100% ออกแบบมาเพื่อบริหารจัดการธุรกิจค้าปลีก-ค้าส่ง (เสื้อผ้า, ชุดกีฬา, ถ้วยรางวัล) และงานบริการสั่งทำ (งานปัก, สกรีน, งานเย็บ) ครอบคลุมการจัดการบิลซื้อ/ขาย, การแยกบัญชี VAT/Non-VAT, ระบบรับเข้าอัจฉริยะ (AI OCR + 3-Tier Canonical Matching), การจัดการสต็อกหลายหน่วยนับ, การสร้างรหัสสินค้าแบบชาญฉลาด (Product Matrix & Auto-SKU), การวิเคราะห์กำไรต่อบิล, การจัดการเจ้าหนี้-ลูกหนี้ (AP/AR), การจัดการค่าใช้จ่าย (OPEX/Net Profit), มาตรฐานแบบฟอร์มเอกสาร A5/A4 อัตโนมัติ และระบบสำรอง/กู้คืนข้อมูลแบบ Self-Healing

2. Tech Stack & Cloud Infrastructure (เทคโนโลยีที่ใช้)

Frontend & Hosting: Next.js 16 (App Router + Turbopack), React, Tailwind CSS, shadcn/ui โฮสต์บน Vercel Production

Backend & Database: Supabase Cloud (PostgreSQL, Auth, Row Level Security, Storage Buckets, Edge Functions)

AI Integration: Gemini Vision AI (Cascade Fallback) สำหรับอ่านเอกสารบิลซื้อและบิลค่าใช้จ่าย (Smart OCR) ร่วมกับระบบ Canonical Text Normalization (pg_trgm)

Development Tools: Cursor Code Editor Pro, Gemini Architect

3. User Roles & Internal Controls (สิทธิ์การใช้งานและการควบคุมภายใน)

Dynamic RBAC & ABAC: ควบคุมสิทธิ์ผ่านตาราง app_roles (accessible_modules JSONB) ผูกกับ user_profiles (data_access_scope, approval_limit)

Fast Login (PIN): เข้าสู่ระบบด้วยอีเมลและรหัส PIN 6 หลัก

Soft Delete Policy: ห้ามลบผู้ใช้งานออกจากระบบ (Hard Delete) ให้ใช้ระบบระงับสิทธิ์ (is_active = false) เพื่อรักษา Audit Trail

Issued Document Fraud Guardrail: เอกสารที่ออกแล้ว (ISSUED) ถูกล็อกด้วย Database Trigger ห้ามพนักงานทั่วไปแก้ไขยอดเงินหรือกดยกเลิกโดยพลการ พนักงานต้องกดส่งคำขอเข้า "ศูนย์อนุมัติ" เท่านั้น ส่วนผู้บริหาร (Admin) สามารถใช้ฟีเจอร์ปรับปรุงประเภทภาษี (admin_revise_purchase_vat_mode) หรือยกเลิกและคัดลอกใบใหม่ (Void & Clone) ได้ภายใต้เงื่อนไขว่าเอกสารถูกต้องและยังไม่มีการตัดจ่ายชำระเงิน (UNPAID)

4. Core Modules & Business Logic (โมดูลหลักและกฎเกณฑ์)

Module A: Master Data, Products & Smart 2-Phase Matrix

Smart Category Taxonomy: รหัสหมวดหมู่หลัก (Parent) 1 ตัวอักษร และหมวดหมู่ย่อย (Child) 2 ตัวอักษร

Fixed-3 Color & Fixed-2 Size Standard: รหัสสีล็อก 3 ตัวอักษรพิมพ์ใหญ่ (WHT, BLK) และรหัสไซส์ล็อก 2 ตัวอักษร (0S, XL, 00 สำหรับวัตถุดิบ/งานบริการ) เรียงตาม sort_order (Gap of 10)

SKU Formula: Brand Code + Category Code (2) + Model Code (6) + Gender Code (1) + Color Code (3) + Size Code (2)

Service vs Raw Material: สินค้าบริการ (is_service = true) ขายได้โดยไม่ตัดสต็อก ส่วนวัตถุดิบ (is_raw_material = true) ซ่อนจากหน้าขายและใช้เบิกผลิตตามสูตร BOM

Module B: Document Flow, Master Print Engine & E-Commerce

Document Conversion Lineage: QT -> SO -> INV_DO / TAX_INV / CS_TAX / ABB -> REC (ห้ามข้าม SO)

Master Document Taxonomy & Print Engine (mst_document_taxonomy):

ควบคุมขนาดกระดาษ (A4-แนวตั้ง, A5-แนวตั้ง, A5-แนวนอน) จากศูนย์กลาง โดยเอกสารซื้อ (AP_TAX, AP_CASH) ใช้ค่าเริ่มต้นเป็น A5-แนวตั้ง (A5_PORTRAIT)

หัวกระดาษแสดงชื่อ บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด สำนักงานใหญ่ บรรทัดถัดมา (Supthavee Hatyai Co., Ltd.) ที่อยู่และเลขประจำตัวผู้เสียภาษีจัดขนาดให้จบในบรรทัดเดียว ไม่ตัดคำตกบรรทัด และวางข้อมูลคู่ค้าให้อยู่ในระนาบเดียวกับเลขที่เอกสาร

Omnichannel One-Time Customer (SAP CPD): ออเดอร์จาก Shopee, Lazada, TikTok ใช้รหัสลูกค้ากลางและเก็บ Metadata (sales_channel, ecommerce_order_no, ecommerce_buyer_name, tracking_no) ในตาราง documents พร้อมบันทึกรายได้เต็มจำนวน (Gross Amount ตาม TFRS 15)

Module C: Smart Procurement, Unified Goods Receipt & 3-Tier OCR Matching

Unified Goods Receipt UX (Manual & AI OCR):

หน้าบันทึกรับสินค้าเอง (/purchases/manual-receipt) และหน้าสแกนบิลอัจฉริยะ (/dashboard/procurement/goods-receipt) มีโครงสร้างสอดคล้องกัน 100%

เมื่อเลือกผู้จำหน่าย ระบบดึงโหมดภาษีเริ่มต้น (EXC_VAT, INC_VAT, NONE), ประเภทเอกสารเริ่มต้น และรายการสินค้าเฉพาะผู้จำหน่ายรายนั้นขึ้นมาให้โดยอัตโนมัติผ่าน RPC get_vendor_receipt_defaults

ตารางรายการรับเข้ารองรับ Checkbox ของแถม (ราคาตั้งหนี้ 0 บาท แต่นำจำนวนมารวมถัวเฉลี่ยลดต้นทุนต่อหน่วยตามมาตรฐาน TAS 2) และมีปุ่มถังขยะลบรายการที่เลือกผิดได้ทันที

แสดงหน้าต่าง Pre-Post Document Preview Modal ให้ตรวจทานแบบฟอร์มใบรับสินค้าเสมือนจริงก่อนกดยืนยันออกเลขที่เอกสารจริง

Cloud Bill Attachment (procurement_bills):

รองรับการลากวางรูปบิลหลายหน้า (JPEG, PNG, WebP, PDF) บีบอัดภาพฝั่ง Client อัตโนมัติ (WebP ความกว้างไม่เกิน 1920px) แล้วอัปโหลดขึ้น Supabase Storage Bucket procurement_bills พร้อมปุ่มซูมดูรูปบิลย้อนหลังในหน้ารายการเอกสารซื้อ

3-Tier Canonical & Attribute-Safe OCR SKU Matching:

แก้ปัญหา AI OCR อ่านเว้นวรรคไม่เท่าเดิมแล้วขึ้น Unmatched ด้วยฟังก์ชัน normalize_ocr_text (ยุบช่องว่าง สัญลักษณ์ และปรับคำพ้อง เช่น ไซด์ -> ไซส์, XXL -> 2XL)

รองรับการจับคู่ 3 ชั้น: 1. Exact Match, 2. Canonical Normalized Key Match, 3. Attribute-Safe Fuzzy Match (ความคล้ายคลึงตั้งแต่ 88% ขึ้นไป โดยบังคับว่าไซส์ size_token และสีต้องตรงกัน 100% เท่านั้น ป้องกันการจับคู่ข้ามไซส์)

Dual-Freight Landed Cost & Moving Average (TAS 2):

แยกค่าขนส่งต้นทาง (ผู้ขายเรียกเก็บในบิล) และค่าขนส่งปลายทาง (จ่ายบริษัทขนส่งแยกต่างหาก) นำทั้งคู่มาปันส่วนเข้าฐานต้นทุนสินค้า (Landed Cost Pool) แต่ไม่นำค่าขนส่งปลายทางไปรวมในยอดเจ้าหนี้ผู้ขาย

Module D: Finance, Accounting, Expenses & Fixed Assets

AR/AP Knock-off & Deposit Allocation: รองรับการตัดชำระหนี้หลายบิลพร้อมกัน (Bulk FIFO), การหักเงินมัดจำ (DEP_IN/DEP_OUT), ใบลดหนี้ (CN), การคืนเงิน (AR_REFUND/AP_REFUND), และการตัดหนี้สูญ/เศษบัญชี (AR_WRITEOFF/AP_WRITEOFF)

Expense & TFRS 16 Installments: รองรับการสแกนบิลค่าใช้จ่าย (OPEX), หัก ณ ที่จ่าย (WHT 50 ทวิ), ผ่อนชำระแยกเงินต้นและดอกเบี้ย, และการขึ้นทะเบียนสินทรัพย์ถาวร (fixed_assets) พร้อมคำนวณค่าเสื่อมราคาแบบเส้นตรงรายเดือน (calculate_monthly_depreciation)

Module E: Tabbed Backup & Self-Healing Restore Engine

Segmented Tabs UI: แยกแท็บ สำรองข้อมูล (Backup) และ กู้คืนข้อมูล (Restore) ออกจากกันเพื่อขยายพื้นที่แสดงชื่อตารางเต็มความกว้าง 100%

Self-Healing Restore:

นำเข้าข้อมูลตามลำดับ Foreign Key Dependency (RESTORE_TABLE_ORDER 44 ตาราง) แบบแบ่ง Chunk ละ 500 แถว

จัดการ Primary Key เฉพาะตาราง (param_key, role_code, uom_id, carrier_id) และจัดเรียง mst_categories ให้หมวดหลัก (parent_id IS NULL) เข้าก่อนหมวดย่อยเสมอ

ตัดคอลัมน์คำนวณอัตโนมัติ (GENERATED ALWAYS) ออกล่วงหน้า (depreciation_rate, grand_total, total_installment, current_net_book_value) พร้อมกลไก Auto-Strip Retry อัตโนมัติ