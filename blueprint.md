# System Blueprint: Supthavee ERP SuperApp

Version: 33.0 (พฤศจิกายน 2026 — จบ Phase 32.4: Customer-Safe `#รูป` vs Internal `#สต็อก` และเตรียมสถาปัตยกรรม Unified Holding ERP Phase 33–37)



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

Module I: Colorway Visual Catalog & LINE Group Sales Bot (Phase 32 / 32.4 — Completed)

- หน้า `/sales/catalog` เมนู «แคตตาล็อกรูป & สต็อก» ค้นรุ่นกับสี กรอง Color Family และหมวดหมู่ และสต็อกพร้อมส่ง
- In-App Catalog Cropper ตัดรูปแยกสี ใบ Catalog และตารางขนาดจากโปสเตอร์ในเว็บ โหมด Free มีมือจับ 8 จุดและกรอบเริ่ม «📏 กรอบตารางขนาด (Free)» เวลาตัดตารางขนาดให้เผื่อขอบบนและล่างของตารางไว้ในกรอบ เพื่อให้ตัวเลขรอบอกและความยาวไม่ชิดขอบรูปเมื่อซูมใน LINE
- ถ้าสียังไม่มีรูปแยก ระบบใช้ `display_image_url` ของโปสเตอร์รวมรุ่น และป้ายบนการ์ดเป็น «โปสเตอร์รวม» เมื่อมีรูปสีแล้วป้ายเป็น «รูปเฉพาะสี»
- B2B Data Masking: ข้อความบอท LINE ไม่แสดง `vendor_id`, `cost_price`, `last_invoice_unit_price` หรือ `wholesale_price` หน้าเว็บพนักงานยังเห็นช่วงราคาปลีกและราคาส่ง
- บอท LINE OA `@hzr1801v` ตอบเฉพาะข้อความที่ขึ้นต้นด้วย `#` เช่น `#รูป ...`, `#พร้อมส่ง ...`, `#แคตตาล็อก ...`, `#ไซส์ ...` ผ่าน Reply Token ข้อความลูกค้า สลิป และแชทบัญชีที่ไม่มี `#` นำหน้าถูกเพิกเฉย 100% จึงไม่ล้างจุดเขียว Unread บน LINE OA Manager
- Phase 32.4: `#รูป <query>` เป็นโหมดส่งลูกค้า (`inStockOnly = false`) ดึงทุกรุ่นรวมสต็อก 0 และแสดงเฉพาะชื่อไซส์ `ไซส์: S M L...` โดยไม่ใส่จำนวน `#สต็อก` / `#พร้อมส่ง` / `#เช็ค` เป็นโหมดภายใน (`inStockOnly = true`) แสดง `พร้อมส่ง: S(qty)...` `#คู่มือ` / `#คำสั่ง` / `#help` ส่งโพยคำสั่ง
- `LineBotCommandGuideCard` เป็นคู่มือ `#` ที่คัดลอกคำสั่งได้ อยู่ที่มาตรฐานเอกสาร กล่องสถานะบอทบน `/sales/catalog` และท้ายหน้าตั้งค่าระบบ

4. Unified Holding ERP Expansion Architecture (Phase 33–37)

สถาปัตยกรรมนี้เป็นแผนขยายบน Supabase Cloud Pro โดยสคีมา `public` ของทรัพย์ทวีหาดใหญ่ยังเป็นระบบที่รันอยู่ ห้ามรบกวนตารางเดิม เวิร์กโฟลว์พนักงาน และธีมสีน้ำเงิน

- 5-Schema Isolation และ 4-Color Workspace: `public` สีน้ำเงิน `bg-blue-700` (เสื้อผ้า ปัก-สกรีน), `fnb` สีแดง `bg-red-700` เส้นทาง `/fnb/*` และ `/liff/fnb/*`, `agri` สีเขียว `bg-emerald-700` เส้นทาง `/plantation/*` และ `/liff/agri/*`, `prop` สีน้ำตาล `bg-amber-900` เส้นทาง `/property/*` และ `/liff/prop/*`, `holding` ศูนย์บัญชาการเส้นทาง `/holding/*` ตัวสลับ 4 สีใน `app/app-shell.tsx` เห็นได้เฉพาะ Super Admin `ณัฐวัฒน์ ลิ่มวรวิวัฒน์`
- Multi-entity และภาษี: ทรัพย์ทวีหาดใหญ่ `0905564000520` อยู่ใน `public` จัสมิน พลัส `0905569002377` ยื่น ภ.พ.30 รวมทุกสาขาในใบเดียว แต่แยกรายงานภาษีซื้อ-ขายและแยกสมุดบัญชีธนาคารรายสาขา ลิ่มวรวิวัฒน์ `0905569008812` บังคับ `business_unit_code` และรองรับบัญชีบุคคลธรรมดาช่วงเปลี่ยนผ่าน
- Corporate Document Vault เก็บ PDF และรูปต่อบริษัทสำหรับเปิดพิมพ์หรือแชร์บนมือถือผ่าน Private Storage และ Signed URL บัญชีธนาคารแนบ QR รับเงินลูกค้าได้ด้วยคอลัมน์ nullable ที่อนุมัติแล้วบน `public.mst_bank_accounts` คือ `qr_image_url` และ `promptpay_note`
- F&B สามกะ: เช้าปรับช็อตเอสเปรสโซ กลางวันฝากเงินเซเว่นพร้อมคิวเบิก 15 บาทให้คุณจวง กลางคืนปิดร้านด้วย Reverse BOM ของของเสียและเช็กชั้นหน้าร้านกับชั้นหลังร้าน วัตถุดิบด่วนท้องถิ่นจับคู่หน่วยนับได้หลายผู้ขาย และแยกสาขาที่รับของเข้าออกจากสาขาที่ออกใบกำกับภาษี
- Property และ Land Estate Grouping: 1 กลุ่มโฉนดมีได้หลายฉบับ ติดสถานะกระทบยอดกับสำนักงานที่ดิน ประเมินและปันส่วนภาษีที่ดินและสิ่งปลูกสร้าง (ภ.ด.ส.) และออกรายงานค่าเช่ารายปี MAT สัญญาเช่าบุคคลหรือนิติบุคคลหัก ณ ที่จ่าย 5% มีมิเตอร์น้ำ-ไฟ และ LIFF ลูกบ้านส่งสลิป 1-ต่อ-1 บน LINE OA บ้านเช่า
- สวนยางโหมดสินค้าเปลี่ยนตามผลผลิตได้ (น้ำยางสด / ยางแผ่น / ขี้ยาง) สงขลาสแกนบิลชั่งรายสายกรีด 40 ใบ สกลนครสรุปโซนขี้ยางหักค่าใช้จ่ายหลายแปลงและโอนหลายสลิป พร้อมตัวติดตามราคากลางรายวันจาก `thainr.com`
- LINE ของธุรกิจใหม่เข้า `/api/line/holding/[channel_code]/webhook` แยกจาก `/api/line/webhook` ของ OA `@hzr1801v` เดิม

