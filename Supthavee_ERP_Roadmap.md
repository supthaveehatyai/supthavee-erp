# แผนการพัฒนาระบบ Supthavee ERP SuperApp

อัปเดตล่าสุด: Phase 32.4 (พฤศจิกายน 2026) — Cloud Production · เตรียม Unified Holding ERP v33.0





## Phase 1: Foundation (วางรากฐานฐานข้อมูล) — [✅ เสร็จสมบูรณ์ 100%]


- ออกแบบ Database Schema และ Blueprint โครงสร้างทั้งหมด (✅)

- ตั้งกฎความปลอดภัยและสร้างตารางหลักบน Supabase (✅)




## Phase 2: Product & Master Data (ระบบจัดการสินค้าตั้งต้น) — [✅ เสร็จสมบูรณ์ 100%]


- สร้างหน้าฟอร์ม Product Matrix Generator และ Auto-SKU (✅)

- สร้างหน้ารายการสินค้า จัดกลุ่ม ยืนยันการลบ/แก้ไข (✅)

- ปรับปรุง Data Integrity ล็อก Global Size Grid, 3-Char Color Code และ Net Price (✅)




## Phase 3: Procurement & Inventory (ระบบจัดซื้อและคลังสินค้า) — [✅ เสร็จสมบูรณ์ 100%]


- ระบบผูกรหัสสินค้ากับซัพพลายเออร์ (Smart Bulk Matrix Mapping) (✅)

- ระบบรับของเข้าอัจฉริยะ (Smart Goods Receipt) รองรับการสแกนบิล OCR + On-the-fly Mapping (✅)

- ระบบฟังก์ชันกระจายส่วนลดและคำนวณต้นทุนสุทธิ (Net Cost Apportionment) & LPP Auto-Update (✅)




## Phase 4: Sales & Document Flow (ระบบขายและออกเอกสาร) — [✅ เสร็จสมบูรณ์ 100%]


- วางสถาปัตยกรรม Document Sequence (Atomic RPC) และ Cost Snapshot (✅)

- สร้างระบบคำนวณ VAT แบบ Real-time (✅)

- ระบบแปลงเอกสาร (Document Conversion) และ Print Template ขนาด A4 (✅)

- Ledger-Driven Inventory Deduction ตัดสต็อกผ่าน ledger แทนการแก้ตารางโดยตรง (✅)




## Phase 5: Finance & Services (ระบบการเงินและงานสั่งทำ) — [✅ เสร็จสมบูรณ์ 100%]


- ปรับปรุงโครงสร้างรหัสเอกสาร (Document Taxonomy) แยกฝั่งบัญชีซื้อและขายเด็ดขาด (✅)

- สร้าง Dashboard ระบบลูกหนี้การค้า (AR) และเจ้าหนี้การค้า (AP) (✅)

- สร้างระบบรับชำระเงินและตัดยอดหนี้ลูกหนี้ (AR Knock-off Allocation) (✅)

- สร้างระบบจ่ายชำระหนี้ซัพพลายเออร์ (AP Payment) (✅)

  - เพิ่มเติม: อัปเกรดเป็นระบบ Bulk Payment (Checkbox FIFO) และ Slip Attachment (✅)

  - เพิ่มเติม: เพิ่มระบบ Tracking สถานะใบเสร็จตัวจริง และแนบไฟล์ WHT (✅)

- ระบบรับและจ่ายเงินมัดจำ (Deposit: DEP_IN / DEP_OUT) (✅)

  - เพิ่มเติม: เชื่อมระบบ Allocation (Math.min), Refund, Write-off และ VAT Inheritance (✅)

- ระบบวางบิล (Billing Note: BN / BR) (✅)

  - เพิ่มเติม: สถาปัตยกรรม Grouping Document และเชื่อมต่อระบบรับ/จ่ายชำระเงิน (FIFO Auto-Allocate) แบบลูกโซ่ (✅)




## Phase 6: Dashboard & Audit (รายงานความปลอดภัย) — [✅ เสร็จสมบูรณ์ 100%]


- สร้าง Executive Dashboard สรุปยอดขาย (Gross Profit) และยอดหนี้คงค้าง (✅)

- สร้างหน้า System Audit Trail พร้อมระบบ Parse JSONB ดูรายละเอียด Diff อ่านง่าย (✅)




## Phase 7: Inventory & Production Workflow (ระบบคลังสินค้าและสายการผลิต) — [✅ เสร็จสมบูรณ์ 100%]


- สร้างหน้า UI สมุดบัญชีคลังสินค้า (Inventory Ledger / Stock Card) รองรับ View ตาม Brand/Model (✅)

- สร้างระบบติดตามสถานะงานบริการสั่งทำ (MTO) แบบ Kanban Workflow พร้อมระบบลากวาง Drag & Drop (✅)

- ระบบแนบไฟล์ภาพ Mockup เข้า Supabase Storage และแสดงผลในบอร์ดการผลิต (✅)

- ระบบ Auto-Archive การ์ด Kanban ด้วย pg_cron (✅)

- ระบบกดยกเลิกงานผลิต (Cancel Job) และ UI Job Detail Slide-over Sheet (✅)

- ปลดล็อกเอกสารภาษี (TAX_INV, ABB, CS_TAX) ให้ส่งงานผลิตได้ (✅)




## Phase 8: Expense Management & Net Profit (ระบบจัดการค่าใช้จ่ายและกำไรสุทธิ) — [✅ เสร็จสมบูรณ์ 100%]


- จัดการหมวดหมู่ค่าใช้จ่าย (Expense Categories / Chart of Accounts เบื้องต้น) (✅)

- สร้างฟอร์มบันทึกค่าใช้จ่ายจิปาถะ (OPEX) แบบ Manual พร้อมผูกสมุดบัญชีธนาคาร (✅)

- วางมาตรฐาน Enterprise UI/UX และ Late Numbering สำหรับ Expense (✅)

- ล็อกสเปกสถาปัตยกรรมและ Component มาตรฐานผ่าน .cursorrules (✅)

- สร้างระบบสแกนบิลค่าใช้จ่ายผ่าน AI OCR (Expense Edge Function) แบบมี Resiliency (✅)

- ปรับปรุง Data Table เรียงลำดับตามวันที่บันทึกบัญชี (Posting Date) ป้องกัน Draft สูญหาย (✅)

- สร้างระบบป้องกันบิลซ้ำซ้อน (Duplicate Invoice Early Warning) (✅)

- ฝังระบบหัก ณ ที่จ่าย (Withholding Tax - WHT) คำนวณยอดชำระสุทธิ (Net Payable) และรองรับการแนบสลิปโอนเงิน (Optional Payment Slip) (✅)

- อัปเกรด Dashboard ดึงยอด OPEX หักลบยอดขาย เพื่อแสดงคำนวณ Net Profit ที่แท้จริง (✅)




## Phase 8.5: Tax & WHT Management (ระบบจัดการภาษีหัก ณ ที่จ่าย) — [✅ เสร็จสมบูรณ์ 100%]


- สร้างหน้าต่างรายงาน WHT (WHT Report) สรุปยอดรายเดือน (✅)

- ระบบตรวจสอบข้อมูลผู้จำหน่าย (Tax ID & Address Validation) (✅)

- ระบบ Export ไฟล์ Excel (ภ.ง.ด.3 / ภ.ง.ด.53) ตามมาตรฐานสรรพากร (✅)

- ระบบ Print หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ) เป็น PDF พร้อมฟังก์ชันแปลงเลขเงินเป็นตัวอักษรภาษาไทย (✅)




## Phase 9: Data Backup and Restore (ระบบสำรองและฟื้นฟูข้อมูล) — [✅ เสร็จสมบูรณ์ 100%]


- สร้างสคริปต์อัตโนมัติ (Node.js Stream) สำหรับ Backup ฐานข้อมูล PostgreSQL (pg_dump) (✅)

- สร้างสคริปต์สำรองข้อมูลภาพ (Storage Backup) จาก Supabase (S3 API) (✅)

- พัฒนาระบบ Manual Backup Button บน Next.js ทะลุกำแพง RLS พร้อมบันทึกประวัติลง Audit Trail (✅)




## [PRE-GO-LIVE HARDENING PHASES]





## Phase 10: Enterprise Foundation & Security (รากฐานองค์กรและระบบรักษาความปลอดภัย) — [✅ เสร็จสมบูรณ์ 100%]


- การจัดการ Global Standard และ UI Pattern Library ของระบบ และ ของบริษัท (ล็อกใน .cursorrules) (✅)

- สร้างระบบ/ตารางตั้งค่าบริษัท (system_settings) เพื่อเก็บชื่อ, ที่อยู่, สาขา, โลโก้ ให้เป็น Single Source of Truth (✅)

- ระบบการเข้าใช้ระบบ SUPTHAVEE ERP (Authentication) และตารางสิทธิ์ Dynamic Role (app_roles) (✅)

- การจัดการ Sidebar ซึ่งยังมีหน้า UI ที่ยังไม่ถูกใช้งาน ให้สอดคล้องกับสิทธิ์ (Auth Guard) (✅)




## Phase 11: Operational Refinement & TFRS Compliance (ยกระดับการทำงานและมาตรฐานบัญชี) — [✅ เสร็จสมบูรณ์ 100%]


- ปรับหน้าแบบฟอร์มเอกสาร (ใบเสนอราคา, ใบกำกับภาษี อื่นๆ) ให้เป็นมาตรฐานเดียวกันด้วย Universal Print Engine (✅)

- การใส่รูปสินค้า (Thumbnail & Lightbox Zoom) ในรายการสินค้า และหน้าเปิดบิล เพื่อยืนยันความถูกต้อง (Visual Verification) (✅)

- สร้างระบบบีบอัดรูปภาพ (Client-Side Compression) อัตโนมัติ แปลงเป็น WebP ก่อนอัปโหลดเข้า Storage (✅)




## Phase 12: Knowledge Management & UAT (การจัดการองค์ความรู้และทดสอบระบบ) — [✅ เสร็จสมบูรณ์ 100%]


- จัดทำคู่มือที่ระบุรายละเอียด มาตรฐานต่างๆ ของระบบ เช่น ชื่อเอกสารและตัวย่อเอกสารแต่ละตัว คืออะไร และสามารถต่อยอดไปเป็นเอกสารอะไรได้บ้าง (✅)

- พัฒนาระบบจัดการผู้ใช้งาน (User Management) ด้วย PIN 6 หลัก พร้อมระบบ Deactivate (Soft Delete) (✅)

- พัฒนาระบบอนุญาตสต็อกติดลบ (Negative Inventory) รองรับช่วงเปลี่ยนผ่าน 3-6 เดือนแรก (✅)

- ปรับปรุง UX การเปิดบิลแบบ Model-First Matrix Selection ลดเวลาการค้นหาสินค้า (✅)

- Data Seeding & UAT (User Acceptance Testing) อัดฉีดข้อมูลเพื่อทดสอบระบบเสมือนจริง (✅)




## Phase 13: Deployment & ALM (การขึ้นระบบและแผนบำรุงรักษา) — [✅ เสร็จสมบูรณ์ 100%]


- [✅ เสร็จแล้ว] การ Deploy ระบบขึ้นบน Supabase Cloud (Database Schema & Edge Functions)

- [✅ เสร็จแล้ว] การตั้งค่า Environment Variables บน Vercel

- [✅ เสร็จแล้ว] Master Data Normalization & Guardrails

- [✅ เสร็จแล้ว] Subcontracting & Unified Billing Hub

- [✅ เสร็จแล้ว] วางระบบ Master Data Normalization (Category 1-char Parent, Size '00' สำหรับวัตถุดิบ)

- [✅ เสร็จแล้ว] แยกระบบงานบริการ (is_service) ออกจากสินค้าตัดสต็อก




## [POST-GO-LIVE ENTERPRISE ENHANCEMENTS]





## Phase 14: Enterprise Scalability & Compliance (แผนพัฒนาหลังขึ้นระบบจริง) — [✅ เสร็จสมบูรณ์ 100%]


- [✅ เสร็จแล้ว] Cycle Counting & Stock Adjustment (STK_OB / STK_ADJ)

- [✅ เสร็จแล้ว] Period Closing & Approval Workflow (Maker-Checker)

- [✅ เสร็จแล้ว] Fixed Asset Register & Direct Capitalization

- [✅ เสร็จแล้ว] AP Installment & Auto-Clearing Engine

- [✅ เสร็จแล้ว] Human-Readable Audit Trail Engine

- [✅ เสร็จแล้ว] Fixed Asset Depreciation: เครื่องยนต์คำนวณค่าเสื่อมราคาแบบเส้นตรงรายเดือน (Straight-line Depreciation Engine) พร้อมระบบ Proration (เฉลี่ยรายวันงวดแรก)

- [✅ เสร็จแล้ว] ABAC: ระบบควบคุมสิทธิ์ระดับละเอียด (Data Access Scope, Approval Limit) และ Permission Matrix

- [✅ เสร็จแล้ว] Data Archiving & Tiered Storage: ย้ายไฟล์ภาพ Cold Data ลง NAS




## [B2B END-TO-END EXPANSION]





## Phase 15: Inventory & Material Management (ระบบจัดการคลังวัตถุดิบ) — [✅ เสร็จสมบูรณ์ 100%]


- [✅] วางระบบรับเข้าวัตถุดิบจากผู้จำหน่าย (Goods Receipt for Raw Materials)

- [✅] สถาปัตยกรรม Landed Cost: คำนวณต้นทุนสินค้าเข้าคลังโดยรวมค่าขนส่งต้นทาง (Freight-In)

- [✅] การเชื่อมต่อ Master Data วัตถุดิบ (Size '00') เข้าสู่ Inventory Ledger




## Phase 16: Production Kanban, BOM & WIP (ระบบควบคุมการผลิต) — [✅ เสร็จสมบูรณ์ 100%]


- [✅] สร้างสูตรการผลิต (Bill of Materials - BOM) ผูก Finished Goods กับ Raw Materials พร้อมคำนวณต้นทุนประเมิน

- [✅] ยกระดับ Kanban Board แบบ 4 คอลัมน์ ลากวางลื่นไหลด้วย Optimistic UI (Zero Client-Side Fetching)

- [✅] Slide-over Sheet ดึงรายละเอียดใบสั่งผลิต (MTO) ระดับ SKU และประเมินวัตถุดิบ (WIP) ผ่าน URL Parameter

- [✅] ปรับสถาปัตยกรรม Database MTO ให้รองรับการทำงานผ่านระบบ SO (Sales Order Driven)




## Phase 17: AR & Order-to-Cash (ระบบลูกหนี้และรับชำระเงิน) — [✅ เสร็จสมบูรณ์ 100%]


- [✅] อัปเกรด Sales Order (SO) ให้เชื่อมโยงกับใบสั่งผลิต (MTO) บน Kanban (SO Driven Production)

- [✅] สถาปัตยกรรม In-house Routing (งานเย็บ, แพ็ค) ผูกระบบ Yield Confirmation และ Auto-Confirmation (Backflushing) ตามมาตรฐาน SAP

- [✅] นำต้นทุนค่าแรงช่างผลิต (Routing) และงานบริการลูกค้า (Services) เข้าสู่ Unified Billing Hub (ระบบวางบิลช่าง - TB)

- [✅] วงจรเอกสารขายครบรูปแบบ (QT -> SO -> INV_DO / TAX_INV / ABB)

- [✅] ระบบ Material Backflush ตัดสต็อกวัตถุดิบอัตโนมัติรองรับทศนิยม NUMERIC(14,4)

- [✅] ระบบออกใบเสร็จรับเงิน (REC), ตัดเงินมัดจำ (DEP_IN) และตัดชำระหนี้ (Knock-off AR)




## Phase 18: Exceptions & Reverse Logistics (ระบบข้อยกเว้นและการคืนของ) — [✅ เสร็จสมบูรณ์ 100%]


- [✅] ระบบยกเลิกเอกสาร (VOID) และคืนสต็อกอัตโนมัติ (Inventory Reversal แบบ SAP Standard)

- [✅] ระบบใบลดหนี้ (Credit Note - CN) รองรับการรับคืนสินค้า (Return Goods) และการชดเชยราคา (Price Adjustment)

- [✅] การเชื่อมโยงใบลดหนี้เพื่อเป็นส่วนลดในระบบรับชำระเงิน (CN Knock-off in REC)

- [✅] ระบบตัดหนี้สูญและตัดเศษบัญชีฝั่งลูกหนี้ (AR_WRITEOFF) และระบบ Approval Preview Slide-over

- [✅] ระบบตัดหนี้สูญและตัดเศษบัญชีฝั่งเจ้าหนี้ (AP_WRITEOFF) ผูกกับระบบ AP Payment Knock-off

- [✅] ระบบคืนเงินมัดจำ (AR_REFUND / AP_REFUND) พร้อมระบบถอดฐานภาษี (VAT Inheritance)

- [✅] ยกระดับความปลอดภัย (Cash Outflow Guardrail) บังคับเอกสารคืนเงิน/ตัดหนี้ เข้าสู่ระบบ Maker-Checker 100% พร้อมบันทึก System Audit Trail




## [OMNI-CHANNEL & COMPLIANCE REPORTING]





## Phase 19: E-Commerce Integration & Tax Ledger (ระบบขายออนไลน์และรายงานภาษี) — [✅ เสร็จสมบูรณ์ 100%]


- [✅] สถาปัตยกรรม One-Time Customer (SAP CPD) สำหรับรองรับลูกค้า Shopee, Lazada, TikTok

- [✅] เพิ่มโครงสร้าง Metadata ในเอกสารขาย (Sales Channel, Order No, Buyer Name, Tracking No, One-Time Address) และกราฟสรุปยอดขายตามช่องทางบน Dashboard

- [✅] สร้างศูนย์รายงานภาษี (Universal Tax & Document Report Center) รองรับรายงานภาษีซื้อ-ภาษีขาย (VAT Ledger) และทะเบียนคุมเอกสาร (Document Register) พร้อม Export เป็นไฟล์ Excel มาตรฐานกรมสรรพากร




## Phase 20: Dual-Freight Landed Cost, Carrier Master & Purchase UoM Conversion (ระบบค่าขนส่ง 2 ทิศทางและหน่วยนับจัดซื้อ) — [✅ เสร็จสมบูรณ์ 100%]


- [✅] สร้างทะเบียนบริษัทขนส่ง (mst_carriers) แยกประเภทขนส่งรายเดือน (PRIMARY_MONTHLY) และขนส่งรายครั้ง (OCCASIONAL) พร้อมผูกตาราง contacts อัตโนมัติ

- [✅] สถาปัตยกรรม Dual-Freight (TAS 2): แยกค่าขนส่งต้นทาง (Origin Freight ที่ผู้ขายเรียกเก็บในบิล) และค่าขนส่งปลายทาง (Destination Freight จ่ายบริษัทขนส่ง) โดยนำทั้งคู่มาปันส่วนเข้าต้นทุนสินค้า (Landed Cost) แต่ไม่นำค่าขนส่งปลายทางไปปนกับยอดเจ้าหนี้การค้า (Vendor AP)

- [✅] สร้าง Database View (vw_carrier_freight_summary) คำนวณภาษีหัก ณ ที่จ่ายค่าขนส่ง 1% และติดตามสถานะใบเสร็จขนส่ง

- [✅] ระบบแปลงหน่วยนับจัดซื้อเป็นหน่วยฐานคลังสินค้า (Purchase UoM Conversion Factor) คำนวณจำนวนรับเข้าและต้นทุนต่อหน่วยฐานอัตโนมัติ




## [ENTERPRISE SCALE & TRANSACTION HARDENING]





## Phase 21: High-Volume SKU Audit Remediation & Atomic DB Transactions (ยกระดับความเสถียรระดับ 4,000+ SKUs) — [✅ เสร็จสมบูรณ์ 100%]


- [✅] ทลายเพดาน PostgREST 1,000-row limit ทั้งระบบด้วย RPC `get_on_hand_qty_by_product_ids` และยูทิลิตี้แบ่งหน้าอัตโนมัติ `fetchAllPages` รองรับสินค้า 3,811+ SKUs

- [✅] แก้ไขลำดับการคำนวณต้นทุนถัวเฉลี่ยเคลื่อนที่ (Moving Average Cost) ให้ดึงยอดคงเหลือก่อนบันทึก `inventory_ledger` ทั้งในใบรับสินค้า (OCR/Manual) และใบปรับปรุงสต็อก (STK_ADJ)

- [✅] ล็อก RLS ตารางการเงินและ Views ทั้งหมดให้เป็น Zero Client-Side Fetching 100% พร้อมบังคับตรวจสอบ Session ก่อนเรียก Admin Client ทุกจุด และลบไฟล์ Dead Code 22 ไฟล์

- [✅] ยุบรวม 4 กระบวนการหลัก (`issue_document_transaction`, `process_ar_receipt_transaction`, `save_manual_goods_receipt_transaction`, `save_goods_receipt_to_ledger_transaction`) ให้ทำงานภายใต้ Single PostgreSQL RPC Transaction (ACID 100%)




## Phase 22: Self-Healing Restore, Unified Goods Receipt, Canonical OCR Matching & Fraud Controls — [✅ เสร็จสมบูรณ์ 100%]


- [✅] อัปเกรดหน้าต่าง Backup & Restore เป็นระบบ Segmented Tabs แยกแท็บชัดเจน พร้อมกลไก Self-Healing Auto-Strip ตัดคอลัมน์ GENERATED ALWAYS ทั้ง 4 ตารางอัตโนมัติ กู้คืนข้อมูล 8,598+ แถวสำเร็จ 100%

- [✅] สร้างระบบจัดเก็บรูปบิลอ้างอิงขึ้น Supabase Storage (`procurement_bills`) พร้อมบีบอัดภาพ WebP ฝั่ง Client เชื่อมทั้งหน้า Manual Receipt และ Smart Goods Receipt (AI OCR)

- [✅] ปรับโฉมหน้าบันทึกรับสินค้าเอง (`/purchases/manual-receipt`) ให้สอดคล้องกับหน้า AI OCR ดึงโหมดภาษีและสินค้าเฉพาะผู้จำหน่ายอัตโนมัติ (`get_vendor_receipt_defaults`) เพิ่มปุ่มลบรายการ และหน้าต่างพรีวิวแบบฟอร์มเอกสารก่อนกดยืนยันบันทึกจริง

- [✅] สร้างตาราง `mst_document_taxonomy` และปรับปรุงแบบฟอร์มใบรับสินค้า/ใบตั้งหนี้เป็นขนาด `A5-แนวตั้ง` (`A5-Portrait`) จัดหัวบริษัทให้อยู่บรรทัดเดียวและวางผู้จำหน่ายระนาบเดียวกับเลขที่เอกสาร

- [✅] พัฒนาระบบจับคู่สินค้า AI OCR แบบ 3-Tier Canonical & Attribute-Safe Matching (`normalize_ocr_text` + `size_token`) แก้ปัญหา OCR เว้นวรรคไม่เท่าเดิมแล้วต้องผูกสินค้าซ้ำซ้อน

- [✅] สร้างระบบควบคุมภายในป้องกันการทุจริต (`trg_protect_issued_documents`) ล็อกห้ามพนักงานแก้ไขเอกสารที่ออกแล้วโดยพลการ และสร้างฟังก์ชัน `admin_revise_purchase_vat_mode` ให้ผู้บริหารปรับปรุงโหมดภาษี (`INC_VAT` / `EXC_VAT` / `NONE`) พร้อมคำนวณต้นทุน TAS 2 ใหม่และบันทึก Audit Log อัตโนมัติ



## [AP AUTOMATION, HR/PAYROLL & ZERO-DRAFT EXPENSE ENGINE]



## Phase 22.5: 3-Tier AP Tax Classification, Bulk Settlement & LINE OA Slip Automation — [✅ เสร็จสมบูรณ์ 100%]

- [✅] จำแนกบิลซื้อและคู่ค้าเป็น 3 กลุ่มทางบัญชี (1.1 มีใบกำกับภาษี VAT, 1.2 ใบรับเงินแนบบัตรประชาชน รันเลข CA01/XXXX, 1.3 บิลภายใน noVAT) พร้อมฟังก์ชันสลับโหมดภาษีรายบิล (`convert_purchase_bill_tax_mode`)
- [✅] สร้างฐานข้อมูลบัญชีธนาคารคู่ค้า (`contact_bank_accounts`) แสดงเลขบัญชีรับโอนและปุ่มคัดลอกบนหน้าใบรับวางบิล (`BR`)
- [✅] อัปเกรดระบบตัดจ่ายชำระหนี้แบบกลุ่มความเร็วสูง (`settle_ap_invoices_bulk_fast`) แก้ปัญหา Timeout เมื่อตัดจ่ายบิลจำนวนมาก พร้อมแสดงภาพตัวอย่างสลิปขนาดใหญ่ก่อนยืนยัน
- [✅] เชื่อมต่อระบบ LINE OA (`@hzr1801v`) Webhook & Messaging API ส่งข้อความแจ้งโอน 4 บรรทัดพร้อมรูปสลิปตรงจาก Supabase Public CDN เข้ากลุ่มคู่ค้า และประทับป้ายสถานะ `💬 ส่ง LINE แล้ว` (`line_notified_at`) อัตโนมัติ


## Phase 23: Dual-Lens HR/Payroll & SSO System + Unified Zero-Draft Expense Ingestion — [✅ เสร็จสมบูรณ์ 100%]

- [✅] สร้างระบบบริหารพนักงาน เงินเดือน และประกันสังคม (`/finance/payroll`) แยกมุมมองพนักงานในระบบบัญชี (`CORPORATE_OFFICIAL` 4 คน) ออกจากพนักงานจ่ายส่วนตัว (`INTERNAL_PRIVATE` 1 คน: มัณฑนา ไชยมิตร)
- [✅] ระบบคำนวณเงินสมทบประกันสังคม มาตรา 33 อัตโนมัติ (หักพนักงาน 5% + บริษัทสมทบ 5% เพดาน 15,000 บาท สูงสุด 750 บาท ยกเว้นผู้บริหาร) พร้อมระบบแนบสำเนาบัตรประชาชนพนักงาน (`id_card_attachment_url`)
- [✅] รองรับการแนบใบเสร็จรับเงินสำนักงานประกันสังคม (`202610_SSO.pdf`) ในหน้าเงินเดือน พร้อมซิงก์สร้างรายการค่าใช้จ่าย (`EXP-SSO-YYYYMM`) อัตโนมัติผ่าน `record_sso_remittance_and_expense` และส่งออกไฟล์ Excel 3 ชีต (เงินเดือน, สปส.1-10, ภ.ง.ด.1 ก.) ส่งสำนักงานบัญชี
- [✅] ยุบรวมเครื่องยนต์ AI OCR ของหน้าเพิ่มค่าใช้จ่าย (`/expenses/create`) เข้ากับระบบรับสินค้า (`parseReceiptOcr` พร้อมระบบสลับโมเดลอัตโนมัติ 7 ตัว โควตา 1,100 บิล/วัน) และเพิ่มระบบ Drag & Drop Guard ป้องกัน Chrome เปิดไฟล์ทับหน้าเว็บ
- [✅] เปลี่ยนระบบบันทึกค่าใช้จ่ายเป็น Zero-Draft Direct Posting (`save_expense_direct_no_draft`) ออกเลขจริง `EXP-YYMM-XXXX` ทันที เคารพกฎ Generated Column `grand_total`, เปิดให้แก้ไขบิลที่ออกแล้วผ่าน `update_expense_direct`, และปรับตาราง `/expenses` ให้แสดงวันที่แบบสั้น ชื่อคู่ค้า และสีสลับบรรทัด (Zebra Striping)


## [UNIFIED SALES, E-COMMERCE & SMART BANK RECONCILIATION]

## Phase 24: Unified Sales, Handwritten Bill OCR, Shopee/Lazada Importer & Krungthai Statement Reconciliation — [✅ เสร็จสมบูรณ์ 100%]

- [✅] Unified Sales Form: ค้นหาลูกค้าด้วย `contacts.nickname`, ซิงค์ `documents.handwritten_doc_ref` กับ `documents.reference_no`, และเพิ่มรายการบริการ `document_items.is_service_item` ในบิลเดียวกับสินค้าตัดสต็อก
- [✅] ซีรีส์ใบกำกับภาษีอย่างย่อฟอร์มเดียว: หน้าร้าน `ABB-YYMM-XXXX`, Shopee `SPMM/XX`, Lazada `LZMM/XX` ผ่าน `generate_abb_channel_doc_no` ตาม `sales_channel`
- [✅] สแกนบิลเขียนมือและนำเข้า Shopee/Lazada ด้วยยอดขายเต็ม (Gross Sales ตาม TFRS 15) ตั้งค่าธรรมเนียมแพลตฟอร์มเป็นค่าใช้จ่ายแยก ไม่หักออกจากฐาน VAT
- [✅] ถอดรหัสไฟล์ Statement กรุงไทยบัญชี `902-0-74651-0` และชนยอดกับบิลขายผ่าน `bank_statement_imports`, `bank_statement_lines`, `bank_reconciliation_allocations`
- [✅] ค่าขนส่งฝากส่งยกเว้น VAT เก็บบน `documents.shipping_fee` (โหมด `shipping_vat_mode`) ไม่เข้าฐาน VAT
- [✅] แนบใบ 50 ทวิย้อนหลังผ่าน RPC `attach_sales_document_wht_certificate(p_document_id, p_wht_rate, p_wht_amount, p_wht_attachment_url)`

## [AP CREDIT NOTE & OCR QUOTA]

## Phase 25–26: Purchase Credit Note & Gemini Vision OCR Quota Rotation — [✅ เสร็จสมบูรณ์ 100%]

- [✅] เอกสาร `AP_CN` (ใบลดหนี้ซื้อ / Purchase Credit Note) หักยอดเจ้าหนี้คงค้างและปรับปรุงภาษีซื้อกับสต็อก
- [✅] สลับโควตา Gemini Vision OCR อัตโนมัติ รีเซ็ตรายวัน 14:00 น. เมื่อโมเดลหลักเต็ม `20/20` ให้ข้ามไปรุ่น Flash-Lite โควตา `500/วัน`

## [CONTACT SUCCESSION]

## Phase 27: Legal-Entity Succession & Tax ID Guard — [✅ เสร็จสมบูรณ์ 100%]

- [✅] คู่ค้ารับช่วงต่อผ่าน `contacts.succeeded_by_contact_id` และ `contacts.successor_note` โดยเก็บเอกสารประวัติของนิติบุคคลเดิมไว้ครบ
- [✅] โคลน `vendor_product_mapping` และ `contact_persons` ไปยังนิติบุคคลใหม่
- [✅] แก้สถานะค้างโหลดของ `contact_bank_accounts` และบังคับตรวจเลขผู้เสียภาษีหรือบัตรประชาชน 13 หลัก

## [TIER 1.2 RECEIPT VOUCHER]

## Phase 28: Receipt Voucher RCV & Non-VAT AP Invoice Lock — [✅ เสร็จสมบูรณ์ 100%]

- [✅] กลุ่ม `1.2 บุคคลธรรมดาแนบบัตรประชาชน` เปลี่ยนเลขใบรับเงินจาก `CA01/XXXX` เป็น `RCV-YYMM-XXXX` (Receipt Voucher — ใบสำคัญรับเงิน / ใบรับเงินแนบบัตรประชาชน) ไม่ชนข้ามเดือนและปี
- [✅] รายงานกลุ่ม 1.2 ไม่ถอด VAT 7% เทียม: ฐานสินค้าเท่ากับยอดรวม และภาษีเป็น 0
- [✅] RPC `get_ap_doc_settlement_modes(p_document_ids uuid[])` คืนสถานะ `'โอน'` หรือ `'สด'` ตามรายการจ่ายจริง
- [✅] Trigger `trg_enforce_ap_inv_non_vat_on_insert` เรียก `fn_enforce_ap_inv_non_vat_on_insert` ล็อกเอกสาร `AP_INV` ให้เป็น Non-VAT (`vat_amount = 0`, สถานะภาษี `TAX_READY`) ทุกครั้งที่บันทึกใหม่

## [FACTORY MATERIALS]

## Phase 29–30: Factory Materials, BOM Backflush & Consumables — [✅ เสร็จสมบูรณ์ 100%]

วัตถุดิบและวัสดุสิ้นเปลืองโรงงานไม่ผูก SKU เสื้อขาย ใช้ตารางแยกจาก `products`:

- [✅] `mst_material_categories` และ `mst_materials` (โหมด `stock_control_mode`)
- [✅] `material_vendor_mappings` มี `lookup_key` และ RPC `upsert_material_vendor_mapping(p_contact_id, p_raw_vendor_code, p_raw_vendor_desc, p_material_id, p_last_unit_price)`
- [✅] `product_model_bom_materials` (`finished_model_id`, `material_id`, `usage_qty_per_unit`, `waste_pct`)
- [✅] `material_stock_ledger` (`tx_type`, `usage_qty_delta`, `purchase_qty`, `unit_usage_cost`, `total_cost`, `production_ref_key`)
- [✅] ขยาย `document_items` ด้วย `material_id`, `item_nature`, `skip_stock_ledger`
- [✅] `BOM_BACKFLUSH`: แปลงหน่วยซื้อเป็นหน่วยใช้ (เช่น `ROLL -> M`, `DOZ -> PCS`) ผ่าน `record_material_purchase_inbound` และตัดสต็อกเมื่อผลิตเสร็จผ่าน `backflush_bom_for_production`
- [✅] `SHOP_FLOOR_ISSUE`: เบิกยกขวด ม้วน หรือถุงหน้าเครื่อง เช่น หมึกและฟิล์ม DTF
- [✅] `DIRECT_CONSUMABLE`: ตัดเป็นต้นทุนวัสดุสิ้นเปลืองทันทีเมื่อซื้อ เช่น สียางสกรีนและเคมีบล็อก และแจ้งเตือนเมื่อราคาซื้อเกิน `mst_materials.reference_purchase_price`

## [TAS 2 BILL PRICE VS STOCK COST]

## Phase 31–31.2: Bill Price Memory, TAS 2 Cost & Financial KPI RPC — [✅ เสร็จสมบูรณ์ 100%]

- [✅] กฎเหล็ก: `products.last_invoice_unit_price` และ `products.last_invoice_vat_mode` เก็บราคาตามหน้าบิล (เช่น `43.00 / 48.00 / 53.00`) สำหรับ Prefill หน้าคีย์รับสินค้าเท่านั้น ห้ามนำไปตีมูลค่าสต็อกหรือคำนวณกำไร
- [✅] `products.cost_price` เก็บต้นทุนก่อน VAT ตาม TAS 2 (เช่น `40.19 / 44.86 / 49.53`) สำหรับสต็อกและกำไรเท่านั้น
- [✅] `products.is_inc_vat_cost_normalized` และฟังก์ชัน `recover_inc_vat_unit_price(p_ex_vat_cost)` ใช้เมื่อต้องคืนราคาตามบิลจากทุนก่อน VAT โดยไม่คูณ 7% ทับราคาตามบิลที่มีอยู่แล้ว
- [✅] `document_items.unit_cost_ex_vat` และ Trigger `trg_snapshot_sales_item_tas2_cost` (`fn_snapshot_sales_item_tas2_cost`) ล็อกต้นทุน TAS 2 ณ วันขาย
- [✅] RPC `get_erp_financial_kpis_and_profit(p_start_date date, p_end_date date)` เป็นแหล่งเดียวของ Executive Dashboard และรายงานการเงิน: รวม `CS_TAX`, บวกฐานเงินมัดจำตาม TFRS 15, หัก `CN` และ `AP_CN`, หักต้นทุนเสื้อ วัตถุดิบ BOM วัสดุสิ้นเปลือง ค่าแรงบริการ และ OPEX และแสดงสกุลเงิน `฿`
- [✅] หน้า `/purchases/manual-receipt` เป็นเลย์เอาต์คู่ขนาน 50:50 (`Smart SKU Picker` คู่ `Material Combobox`) และแถวรายการรับเข้าเหลือ 2 บรรทัดโดยไม่พิมพ์รหัส SKU ซ้ำ

สเกลปัจจุบันจาก Schema Dump: ตาราง `products` ประมาณ 6,042 แถว (ใช้งานจริง 5,923+ SKUs สำเร็จรูปและงานบริการ), `vendor_product_mapping` ประมาณ 6,357 แถว, `mst_materials` ประมาณ 22 รายการ

## [VISUAL CATALOG & LINE OA SALES BOT]

## Phase 32: Colorway Visual Catalog & LINE Group Sales Bot — [✅ เสร็จสมบูรณ์ 100%]

- [✅] หน้า `/sales/catalog` ค้นรูปแยกสีตามรุ่น กรอง Color Family หมวดหมู่ และสต็อกพร้อมส่ง ถ้าสียังไม่ถูกตัดรูป การ์ดใช้โปสเตอร์รวมของรุ่น
- [✅] In-App Catalog Cropper ตัดรูปแยกสี ใบ Catalog และตารางขนาดในเว็บ โหมด Free ขยายแนวนอนได้แม้กรอบชิดขอบล่าง และกรอบ «📏 กรอบตารางขนาด (Free)» ให้เผื่อขอบบน-ล่างของตารางขนาด ไฟล์ Catalog กับตารางขนาดเป็น WebP ขอบยาว 2048px คุณภาพ 0.92 ในถัง `product_assets`
- [✅] B2B Data Masking บนบอท LINE: ไม่ส่ง `vendor_id`, `cost_price`, `last_invoice_unit_price` หรือ `wholesale_price` หน้าเว็บพนักงานยังเห็นราคาปลีกและราคาส่ง
- [✅] บอท OA `@hzr1801v` ตอบเฉพาะคำสั่งที่ขึ้นต้นด้วย `#` เช่น `#รูป PS031S` และ `#รูป คอกลมสั้น แดง` ด้วย Reply Token แคร์รูเซลสูงสุด 12 ใบต่อรุ่น ข้อความและสลิปที่ไม่มี `#` นำหน้าได้สถานะ `SKIPPED` และไม่ล้างจุดเขียว Unread ของฝ่ายบัญชี
- [✅] Webhook ถาวรชี้ `https://<VERCEL_PROJECT_PRODUCTION_URL>/api/line/webhook` บันทึกใน `system_settings.line_webhook_url` และเขียน `bot_reply_status` / `bot_reply_error` ลง `line_webhook_events_log` ก่อนตอบ HTTP 200

## Phase 32.4: Customer-Safe `#รูป` vs Internal `#สต็อก` & Command Guide UI — [✅ เสร็จสมบูรณ์ 100%]

- [✅] `#รูป <query>` ส่งลูกค้าได้: `inStockOnly = false` ดึงทุกรุ่นรวมสต็อก 0 และแสดงเฉพาะชื่อไซส์ `ไซส์: S M L...` โดยไม่ใส่จำนวน
- [✅] `#สต็อก` / `#พร้อมส่ง` / `#เช็ค` ใช้ภายในร้าน: `inStockOnly = true` แสดง `พร้อมส่ง: S(qty)...` และถ้าของหน้าร้านเป็น 0 ให้แนะนำ `#รูป` เพื่อสั่งโรงงานโดยไม่ยิงรูปทิ้ง
- [✅] `#คู่มือ` / `#คำสั่ง` / `#help` ส่งโพยคำสั่งกลับในแชท และการ์ด `LineBotCommandGuideCard` อยู่ที่มาตรฐานเอกสาร กล่องสถานะบอทบน `/sales/catalog` และท้ายหน้าตั้งค่าระบบ
- [✅] ข้อความและสลิปที่ไม่มี `#` นำหน้ายังได้ `SKIPPED` และไม่ reply

## Unified Holding ERP Master Roadmap (Phase 33–37 / Step 1–5) — [⏳ กำลังดำเนินการ — เริ่ม Step 1]

- [⏳] Step 1 / Phase 33: แยก 5 สคีมา (`public`, `holding`, `fnb`, `prop`, `agri`) และตัวสลับเวิร์กสเปซ 4 สี โดยพนักงานทรัพย์ทวีที่ไม่ใช่ Super Admin ยังเห็นเฉพาะสีน้ำเงิน และห้ามเปลี่ยนตาราง `public` เดิม
- [ ] Step 2 / Phase 34: ทะเบียนนิติบุคคล ภาษีหลายบริษัท (ภ.พ.30 ของจัสมิน พลัสรวมใบแต่แยกสมุดรายสาขา, `business_unit_code` ของลิ่มวรวิวัฒน์), QR รับเงิน และ Corporate Document Vault
- [ ] Step 3 / Phase 35: ร้านเครื่องดื่มสามกะ (ปรับช็อตเช้า, ฝากเซเว่นและคิวเบิก 15 บาทคุณจวง, ปิดร้าน Reverse BOM) แยกสาขารับของกับสาขาออกใบกำกับ
- [ ] Step 4 / Phase 36: บ้านเช่า ห้องเช่า ที่ดิน และ Land Estate Grouping (หลายโฉนดต่อกลุ่ม, ภ.ด.ส., รายงาน MAT, LIFF สลิปลูกบ้าน)
- [ ] Step 5 / Phase 37: สวนยางน้ำยางสด/ยางแผ่น/ขี้ยาง สงขลาและสกลนคร พร้อมราคากลางรายวันจาก `thainr.com`
