# System Blueprint: Supthavee ERP SuperApp

Version: 31.2 (พฤศจิกายน 2026 — จบ Phase 31.2: TAS 2 bill price แยกจาก cost_price, KPI RPC, วัตถุดิบโรงงาน)



Company: บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด สำนักงานใหญ่ (Supthavee Hatyai Co., Ltd.) — เลขประจำตัวผู้เสียภาษี 0905564000520



Document Purpose: System Requirements, Business Logic, and Database Schema for AI Assistants (Gemini, Claude, Cursor)



1. System Overview (ภาพรวมระบบ)

ระบบ ERP แบบ Web Application สถาปัตยกรรม Full-Code ที่รันบน Supabase Cloud และ Vercel 100% ออกแบบมาเพื่อบริหารจัดการธุรกิจค้าปลีก-ค้าส่ง (เสื้อผ้า, ชุดกีฬา, ถ้วยรางวัล) และงานบริการสั่งทำ (งานปัก, สกรีน, งานเย็บ) ของบริษัท ทรัพย์ทวี หาดใหญ่ จำกัด ครอบคลุม:

- การรับเข้าบิลซื้อและค่าใช้จ่ายด้วย AI OCR (Shared 7-Model Gemini Pool โควตา 1,100 บิล/วัน)

- การแยกบัญชี 3 กลุ่มภาษี (`1.1 CORP_VAT`, `1.2 RECEIPT_1_2 / RCV-YYMM-XXXX`, `1.3 INTERNAL_1_3`)

- การรวบใบวางบิล (`BR`, `TB`, `BN`), ตัดจ่ายแบบกลุ่มความเร็วสูง (`settle_ap_invoices_bulk_fast`), และยิงสลิปแจ้งโอนเข้ากลุ่มคู่ค้าผ่าน LINE OA (`@hzr1801v`)

- ระบบบริหารพนักงาน เงินเดือน และประกันสังคมแบบ 2 มุมมอง (`CORPORATE_OFFICIAL` 4 ท่าน ส่งสำนักงานบัญชี vs `INTERNAL_PRIVATE` 1 ท่าน จ่ายส่วนตัว) พร้อมแนบสำเนาบัตรประชาชนพนักงานและใบเสร็จสำนักงานประกันสังคม (`202610_SSO.pdf`)

- ระบบขายครบวงจร ทั้งหน้าร้าน (บิลเขียนมือ -> ใบส่งของชั่วคราว -> ใบกำกับภาษีเต็มรูป/อย่างย่อ), E-Commerce (`Shopee SP` / `Lazada LZ`), และการกระทบยอดรายการเดินบัญชีธนาคารกรุงไทย (`202610_Statement.xls` บัญชี `902-0-74651-0`)



2. Tech Stack & Cloud Infrastructure

- Frontend & Hosting: Next.js 16 (App Router + Turbopack), React, Tailwind CSS, shadcn/ui บน Vercel Production

- Backend & Database: Supabase Cloud (PostgreSQL, Auth, Row Level Security, Storage Buckets, Edge Functions)

- AI OCR Engine: Shared `parseReceiptOcr` Engine หมุนเวียนโควตาอัตโนมัติ 7 โมเดล (`gemini-3.7-flash`, `3.8-Flash`, `3.6-Flash`, `3.5-Flash`, `3-Flash`, `3.5-Flash-Lite`, `3.1-Flash-Lite`)



3. Core Modules & Business Logic



Module A: Master Data, Products & Smart 2-Phase Matrix (5,923+ SKUs)

- รหัสสี 3 ตัวอักษร (`WHT`, `BLK`) และรหัสไซส์ 2 ตัวอักษร (`0S`, `XL`, `00` สำหรับวัตถุดิบ/บริการ)

- แยกสินค้าบริการ (`is_service = true` หรือ `is_service_item = true` ในบรรทัดบิล เช่น ค่าบล็อกสกรีน, ค่าปัก) ออกจากสินค้าตัดสต็อกคลัง



Module B: Smart Procurement, AP Billing Notes (`BR`/`TB`) & LINE OA Slip Automation

- จำแนกบิลซื้อเป็น 3 กลุ่ม (`1.1 VAT`, `1.2 ใบรับเงินแนบบัตรประชาชน รันเลข RCV-YYMM-XXXX`, `1.3 บิลภายใน noVAT`)

- ผูกบัญชีธนาคารรับโอนของคู่ค้า (`contact_bank_accounts`) แสดงปุ่มคัดลอกเลขบัญชีบนหน้าใบวางบิล

- เมื่อตัดจ่ายชำระหนี้และแนบสลิป (แสดงพรีวิวขนาดใหญ่ก่อนบันทึก) สามารถกดส่งข้อความแจ้งโอน 4 บรรทัดพร้อมรูปสลิปจาก Supabase CDN เข้ากลุ่ม LINE OA ของคู่ค้าได้ทันที พร้อมประทับป้าย `💬 ส่ง LINE แล้ว` (`line_notified_at`)



Module C: Dual-Lens HR, Payroll & Social Security (`SSO`) Management (`/finance/payroll`)

- พนักงานในระบบบัญชี (`CORPORATE_OFFICIAL` 4 คน: ณัฐวัฒน์ 60,000 [ผู้บริหาร ไม่หัก ม.33], วรัญญา 15,000 [หัก สปส. 750], สิริพร 10,000 [หัก สปส. 500], ลลิดา 11,500 [หัก สปส. 575]): รวมเงินเดือน 96,500 บาท หัก สปส. พนักงาน 1,825 บาท โอนสุทธิ 94,675 บาท และบริษัทสมทบ 1,825 บาท (รวมนำส่ง สปส. 3,650 บาท)

- พนักงานจ่ายส่วนตัว (`INTERNAL_PRIVATE` 1 คน: มัณฑนา ไชยมิตร): บันทึกแยกในหมวด `INTERNAL_1_3` เพื่อคำนวณกำไรสุทธิจริง แต่กรองออกจากไฟล์ Excel ส่งสำนักงานบัญชีและ ภ.ง.ด.1 ก. 100%

- รองรับการแนบสำเนาบัตรประชาชนพนักงาน (`id_card_attachment_url`) และแนบใบเสร็จรับเงินประกันสังคม (`202610_SSO.pdf`) ในหน้าเงินเดือนพร้อมสร้างรายการค่าใช้จ่าย (`EXP-SSO-YYYYMM`) อัตโนมัติ



Module D: Zero-Draft Expense Management (`/expenses`)

- ใช้มาตรฐานเดียวกับหน้ารับเข้าเอกสารซื้อ: ลากวางไฟล์รูปหรือ PDF (มี Window Drag Guard ป้องกัน Chrome เปิดไฟล์ทับหน้าเว็บ) สแกนด้วย Shared 7-Model OCR Engine

- บันทึกออกเลขจริง `EXP-YYMM-XXXX` ทันทีในคลิกเดียวผ่าน `save_expense_direct_no_draft` (ไม่มี `DRAFT` ค้าง)

- แก้ไขหมวดหมู่และข้อมูลภาษีของบิลที่ออกแล้วได้ตลอดเวลาผ่าน `update_expense_direct`

- ตารางรายการ `/expenses` แสดงวันที่แบบสั้น (`DD/MM/YY`), คอลัมน์คู่ค้า/ผู้รับเงิน (`vendor_name`) พร้อมตัดคำอัตโนมัติ (`truncate`) และสลับสีบรรทัด (`Zebra Striping`)



Module E: Unified Sales, E-Commerce (`Shopee` / `Lazada`) & Bank Statement Reconciliation (Phase 24 — Completed)

- สถานะ: Completed — ฟอร์มขายย้อนหลัง/ชื่อเล่น/รายการบริการ/เลข ABB-SP-LZ, สแกนบิลเขียนมือ, นำเข้าออเดอร์ Shopee/Lazada, และชนยอด Statement กรุงไทยขึ้นระบบแล้ว

- ระยะที่ 1 (Phase 24.1 - Unified Sales Form & Handwritten Bill Workflow):

  - แยกบทบาทพนักงานขายหน้าร้าน (พี่ไก่, พี่นา เขียนบิลมือ) -> ผู้ช่วยขาย (น้องนก คีย์/สแกนเข้าเป็น `ใบส่งของชั่วคราว INV_DO` ค้นหาลูกค้าด้วย `ชื่อเล่น nickname` เช่น พี่ก๊ก, พี่รัตน์ และเพิ่มรายการ `ค่าทำบล็อกสกรีน` ได้ในบิลเดียวกัน) -> ผู้บริหาร (ตรวจและออกเลขใบกำกับภาษีเรียงตามวันที่ `Chronological Tax Sequencing` ไม่ให้เลขสลับวันแม้คีย์ย้อนหลัง)

  - ใช้แบบฟอร์ม `บิลเงินสด / ใบกำกับภาษีอย่างย่อ (ABB)` ฟอร์มเดียวสำหรับทั้งหน้าร้าน (`ABB-YYMM-XXXX`), Shopee (`SPMM/XX` เช่น `SP09/01`), และ Lazada (`LZMM/XX` เช่น `LZ08/01`)

- ระยะที่ 2 (Phase 24.2 - Handwritten Bill OCR & 1-Click Shopee/Lazada Auto-Converter):

  - ลากวางรูปบิลเขียนมือเพื่อแปลงเป็น `INV_DO` ด้วย AI OCR

  - ลากวางไฟล์ `Income.โอนเงินสำเร็จ.xlsx` + `Order.completed.xlsx` + `ShopeeAll.pdf` / `LazadaAll.pdf` + `Shopee-TIV.pdf` เพื่อสร้างบิลขาย `SPMM/XX` และ `LZMM/XX` ด้วยยอดขายเต็ม (Gross Sales ตาม TFRS 15), ดึงชื่อเต็มลูกค้าจากใบปะหน้าพัสดุ, บันทึกค่าใช้จ่ายค่าธรรมเนียมแพลตฟอร์มพร้อมเช็คบิล `TIV` ที่ตกหล่น, และส่งออกไฟล์ Excel รูปแบบเดียวกับที่ส่งสำนักงานบัญชีในคลิกเดียว

- ระยะที่ 3 (Phase 24.3 - Smart Krungthai Statement Reconciliation):

  - ลากวางไฟล์ `202610_Statement.xls` (ถอดรหัสผ่านเลขผู้เสียภาษี `0905564000520` ของบัญชีกรุงไทย `902-0-74651-0` อัตโนมัติ)

  - จับคู่ยอดเงินโอนเข้ากับบิลขายค้างชำระจาก: 1. ประวัติเลขบัญชีลูกค้าที่โอนมา (เช่น `014-7272061729` = พี่รัตน์), 2. ยอดเงินตรงเป๊ะ (`16,659.90`), หรือ 3. ยอดหลังหัก ณ ที่จ่าย 1% / 3% พร้อมตัดบิลย้อนหลังตามวัน-เวลาที่โอนจริงใน Statement
  - ค่าขนส่งฝากส่งอยู่ที่ `documents.shipping_fee` และไม่เข้าฐาน VAT ใบ 50 ทวิย้อนหลังใช้ `attach_sales_document_wht_certificate`

Module F: Purchase Credit Note, OCR Quota, Contact Succession & Receipt Voucher (Phase 25–28 — Completed)

- เอกสาร `AP_CN` หักเจ้าหนี้คงค้างและปรับปรุงภาษีซื้อกับสต็อก
- โควตา Gemini Vision OCR รีเซ็ตรายวัน 14:00 น. เมื่อโมเดลหลักเต็ม `20/20` ให้ข้ามไป Flash-Lite โควตา `500/วัน`
- นิติบุคคลรับช่วงต่อใช้ `contacts.succeeded_by_contact_id` และ `contacts.successor_note` เอกสารของบริษัทเดิมคงอยู่ และโคลน `vendor_product_mapping` กับ `contact_persons` ไปยังนิติบุคคลใหม่
- เลขผู้เสียภาษีและบัตรประชาชนต้องครบ 13 หลัก
- กลุ่ม 1.2 ใช้เลข `RCV-YYMM-XXXX` ไม่ถอด VAT 7% เทียม RPC `get_ap_doc_settlement_modes` คืน `'โอน'` หรือ `'สด'` และ Trigger `trg_enforce_ap_inv_non_vat_on_insert` ล็อก `AP_INV` เป็น Non-VAT

Module G: Factory Materials (Phase 29–30 — Completed)

- ทะเบียนแยกจาก SKU เสื้อ: `mst_material_categories`, `mst_materials`, `material_vendor_mappings.lookup_key`, `product_model_bom_materials`, `material_stock_ledger`
- บรรทัดเอกสารใช้ `document_items.material_id`, `item_nature`, `skip_stock_ledger` และไม่ลง `inventory_ledger`
- `BOM_BACKFLUSH` รับเข้าด้วย `record_material_purchase_inbound` และตัดเมื่อผลิตเสร็จด้วย `backflush_bom_for_production`
- `SHOP_FLOOR_ISSUE` เบิกหน้าเครื่อง `DIRECT_CONSUMABLE` ตัดต้นทุนทันทีเมื่อซื้อ และเตือนเมื่อเกิน `reference_purchase_price`
- จับคู่รหัสผู้ขายวัตถุดิบด้วย `upsert_material_vendor_mapping`

Module H: TAS 2 Bill Price vs Stock Cost & Financial KPI (Phase 31–31.2 — Completed)

- `products.last_invoice_unit_price` + `last_invoice_vat_mode` + `is_inc_vat_cost_normalized` เก็บราคาตามบิลรวม VAT (เช่น 43.00 / 48.00 / 53.00) สำหรับ Prefill หน้าคีย์เท่านั้น
- `products.cost_price` เก็บทุนก่อน VAT (เช่น 40.19 / 44.86 / 49.53) สำหรับสต็อกและกำไรเท่านั้น ห้ามปะปนสองตัวแปรนี้
- `recover_inc_vat_unit_price` ใช้เมื่อยังไม่มีราคาตามบิล ห้ามคูณ 7% ทับ `last_invoice_unit_price`
- `document_items.unit_cost_ex_vat` ถูกเติมโดย Trigger `trg_snapshot_sales_item_tas2_cost`
- RPC `get_erp_financial_kpis_and_profit(p_start_date, p_end_date)` เป็นแหล่งเดียวของ Executive Dashboard และรายงานการเงิน รวม `CS_TAX` บวกฐานมัดจำตาม TFRS 15 หัก `CN` และ `AP_CN` หักต้นทุนเสื้อ วัตถุดิบ BOM วัสดุสิ้นเปลือง ค่าแรงบริการ และ OPEX แสดงสกุลเงิน `฿`
- หน้า `/purchases/manual-receipt` เป็นกริด 50:50 ของ Smart SKU Picker กับ Material Combobox และแถวรับเข้าเหลือ 2 บรรทัด

Module I: Next — Colorway Catalog & LINE Group Sales Bot (Phase 32)

- รูปแยกตามรุ่นและสี Fallback ไปโปสเตอร์รุ่น และ In-App Catalog Cropper
- Color Family, กรองสต็อกพร้อมส่ง, ปิดบังซัพพลายเออร์และราคาทุน
- กลุ่ม LINE ของร้านมี LINE ส่วนตัว 3 คน ดึง OA `@hzr1801v` เข้ากลุ่ม แบ่งงานตามประเภทสินค้า และมีบัญชี 1 คนดูสลิป เพื่อไม่ให้ปุ่ม Unread หายบนแอป LINE OA
- คำสั่งในกลุ่มเช่น `#รูป คอกลมสั้น แดง` ตอบ Flex Carousel ผ่าน Reply Token คู่กับ Quick Sales Catalog บนเว็บ

Module J: Next — Shop-Floor Requisition to PO (Phase 33)

- ช่างขอซื้อจาก Dropdown `mst_materials` โดยซ่อนราคาทุนตามสิทธิ์
- ศูนย์อนุมัติออก `PO-YYMM-XXXX` แล้วดึงใบสั่งซื้อมารับเข้าคลังในคลิกเดียว

