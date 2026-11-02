System Blueprint: Supthavee ERP SuperApp



Version: 24.0 (Phase 24 Completed: Unified Sales Form, Handwritten Bill OCR, Shopee/Lazada Importer \& Krungthai Bank Statement Reconciliation)



Company: บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด สำนักงานใหญ่ (Supthavee Hatyai Co., Ltd.) — เลขประจำตัวผู้เสียภาษี 0905564000520



Document Purpose: System Requirements, Business Logic, and Database Schema for AI Assistants (Gemini, Claude, Cursor)



1\. System Overview (ภาพรวมระบบ)

ระบบ ERP แบบ Web Application สถาปัตยกรรม Full-Code ที่รันบน Supabase Cloud และ Vercel 100% ออกแบบมาเพื่อบริหารจัดการธุรกิจค้าปลีก-ค้าส่ง (เสื้อผ้า, ชุดกีฬา, ถ้วยรางวัล) และงานบริการสั่งทำ (งานปัก, สกรีน, งานเย็บ) ของบริษัท ทรัพย์ทวี หาดใหญ่ จำกัด ครอบคลุม:

\- การรับเข้าบิลซื้อและค่าใช้จ่ายด้วย AI OCR (Shared 7-Model Gemini Pool โควตา 1,100 บิล/วัน)

\- การแยกบัญชี 3 กลุ่มภาษี (`1.1 CORP\_VAT`, `1.2 RECEIPT\_1\_2 / CA01`, `1.3 INTERNAL\_1\_3`)

\- การรวบใบวางบิล (`BR`, `TB`, `BN`), ตัดจ่ายแบบกลุ่มความเร็วสูง (`settle\_ap\_invoices\_bulk\_fast`), และยิงสลิปแจ้งโอนเข้ากลุ่มคู่ค้าผ่าน LINE OA (`@hzr1801v`)

\- ระบบบริหารพนักงาน เงินเดือน และประกันสังคมแบบ 2 มุมมอง (`CORPORATE\_OFFICIAL` 4 ท่าน ส่งสำนักงานบัญชี vs `INTERNAL\_PRIVATE` 1 ท่าน จ่ายส่วนตัว) พร้อมแนบสำเนาบัตรประชาชนพนักงานและใบเสร็จสำนักงานประกันสังคม (`202610\_SSO.pdf`)

\- ระบบขายครบวงจร ทั้งหน้าร้าน (บิลเขียนมือ -> ใบส่งของชั่วคราว -> ใบกำกับภาษีเต็มรูป/อย่างย่อ), E-Commerce (`Shopee SP` / `Lazada LZ`), และการกระทบยอดรายการเดินบัญชีธนาคารกรุงไทย (`202610\_Statement.xls` บัญชี `902-0-74651-0`)



2\. Tech Stack \& Cloud Infrastructure

\- Frontend \& Hosting: Next.js 16 (App Router + Turbopack), React, Tailwind CSS, shadcn/ui บน Vercel Production

\- Backend \& Database: Supabase Cloud (PostgreSQL, Auth, Row Level Security, Storage Buckets, Edge Functions)

\- AI OCR Engine: Shared `parseReceiptOcr` Engine หมุนเวียนโควตาอัตโนมัติ 7 โมเดล (`gemini-3.7-flash`, `3.8-Flash`, `3.6-Flash`, `3.5-Flash`, `3-Flash`, `3.5-Flash-Lite`, `3.1-Flash-Lite`)



3\. Core Modules \& Business Logic



Module A: Master Data, Products \& Smart 2-Phase Matrix (3,811+ SKUs)

\- รหัสสี 3 ตัวอักษร (`WHT`, `BLK`) และรหัสไซส์ 2 ตัวอักษร (`0S`, `XL`, `00` สำหรับวัตถุดิบ/บริการ)

\- แยกสินค้าบริการ (`is\_service = true` หรือ `is\_service\_item = true` ในบรรทัดบิล เช่น ค่าบล็อกสกรีน, ค่าปัก) ออกจากสินค้าตัดสต็อกคลัง



Module B: Smart Procurement, AP Billing Notes (`BR`/`TB`) \& LINE OA Slip Automation

\- จำแนกบิลซื้อเป็น 3 กลุ่ม (`1.1 VAT`, `1.2 ใบรับเงินแนบบัตร ปชช. รันเลข CA01/...`, `1.3 บิลภายใน noVAT`)

\- ผูกบัญชีธนาคารรับโอนของคู่ค้า (`contact\_bank\_accounts`) แสดงปุ่มคัดลอกเลขบัญชีบนหน้าใบวางบิล

###### \- เมื่อตัดจ่ายชำระหนี้และแนบสลิป (แสดงพรีวิวขนาดใหญ่ก่อนบันทึก) สามารถกดส่งข้อความแจ้งโอน 4 บรรทัดพร้อมรูปสลิปจาก Supabase CDN เข้ากลุ่ม LINE OA ของคู่ค้าได้ทันที พร้อมประทับป้าย `💬 ส่ง LINE แล้ว` (`line\_notified\_at`)

###### 

###### Module C: Dual-Lens HR, Payroll \& Social Security (`SSO`) Management (`/finance/payroll`)

###### \- พนักงานในระบบบัญชี (`CORPORATE\_OFFICIAL` 4 คน: ณัฐวัฒน์ 60,000 \[ผู้บริหาร ไม่หัก ม.33], วรัญญา 15,000 \[หัก สปส. 750], สิริพร 10,000 \[หัก สปส. 500], ลลิดา 11,500 \[หัก สปส. 575]): รวมเงินเดือน 96,500 บาท หัก สปส. พนักงาน 1,825 บาท โอนสุทธิ 94,675 บาท และบริษัทสมทบ 1,825 บาท (รวมนำส่ง สปส. 3,650 บาท)

###### \- พนักงานจ่ายส่วนตัว (`INTERNAL\_PRIVATE` 1 คน: มัณฑนา ไชยมิตร): บันทึกแยกในหมวด `INTERNAL\_1\_3` เพื่อคำนวณกำไรสุทธิจริง แต่กรองออกจากไฟล์ Excel ส่งสำนักงานบัญชีและ ภ.ง.ด.1 ก. 100%

###### \- รองรับการแนบสำเนาบัตรประชาชนพนักงาน (`id\_card\_attachment\_url`) และแนบใบเสร็จรับเงินประกันสังคม (`202610\_SSO.pdf`) ในหน้าเงินเดือนพร้อมสร้างรายการค่าใช้จ่าย (`EXP-SSO-YYYYMM`) อัตโนมัติ

###### 

###### Module D: Zero-Draft Expense Management (`/expenses`)

###### \- ใช้มาตรฐานเดียวกับหน้ารับเข้าเอกสารซื้อ: ลากวางไฟล์รูปหรือ PDF (มี Window Drag Guard ป้องกัน Chrome เปิดไฟล์ทับหน้าเว็บ) สแกนด้วย Shared 7-Model OCR Engine

###### \- บันทึกออกเลขจริง `EXP-YYMM-XXXX` ทันทีในคลิกเดียวผ่าน `save\_expense\_direct\_no\_draft` (ไม่มี `DRAFT` ค้าง)

###### \- แก้ไขหมวดหมู่และข้อมูลภาษีของบิลที่ออกแล้วได้ตลอดเวลาผ่าน `update\_expense\_direct`

###### \- ตารางรายการ `/expenses` แสดงวันที่แบบสั้น (`DD/MM/YY`), คอลัมน์คู่ค้า/ผู้รับเงิน (`vendor\_name`) พร้อมตัดคำอัตโนมัติ (`truncate`) และสลับสีบรรทัด (`Zebra Striping`)

###### 

###### Module E: Unified Sales, E-Commerce (`Shopee` / `Lazada`) \& Bank Statement Reconciliation (Phase 24 — Completed)

###### \- สถานะ: Completed — ฟอร์มขายย้อนหลัง/ชื่อเล่น/รายการบริการ/เลข ABB-SP-LZ, สแกนบิลเขียนมือ, นำเข้าออเดอร์ Shopee/Lazada, และชนยอด Statement กรุงไทยขึ้นระบบแล้ว

###### \- ระยะที่ 1 (Phase 24.1 - Unified Sales Form \& Handwritten Bill Workflow):

###### &#x20; - แยกบทบาทพนักงานขายหน้าร้าน (พี่ไก่, พี่นา เขียนบิลมือ) -> ผู้ช่วยขาย (น้องนก คีย์/สแกนเข้าเป็น `ใบส่งของชั่วคราว INV\_DO` ค้นหาลูกค้าด้วย `ชื่อเล่น nickname` เช่น พี่ก๊ก, พี่รัตน์ และเพิ่มรายการ `ค่าทำบล็อกสกรีน` ได้ในบิลเดียวกัน) -> ผู้บริหาร (ตรวจและออกเลขใบกำกับภาษีเรียงตามวันที่ `Chronological Tax Sequencing` ไม่ให้เลขสลับวันแม้คีย์ย้อนหลัง)

###### &#x20; - ใช้แบบฟอร์ม `บิลเงินสด / ใบกำกับภาษีอย่างย่อ (ABB)` ฟอร์มเดียวสำหรับทั้งหน้าร้าน (`ABB-YYMM-XXXX`), Shopee (`SPMM/XX` เช่น `SP09/01`), และ Lazada (`LZMM/XX` เช่น `LZ08/01`)

###### \- ระยะที่ 2 (Phase 24.2 - Handwritten Bill OCR \& 1-Click Shopee/Lazada Auto-Converter):

###### &#x20; - ลากวางรูปบิลเขียนมือเพื่อแปลงเป็น `INV\_DO` ด้วย AI OCR

###### &#x20; - ลากวางไฟล์ `Income.โอนเงินสำเร็จ.xlsx` + `Order.completed.xlsx` + `ShopeeAll.pdf` / `LazadaAll.pdf` + `Shopee-TIV.pdf` เพื่อสร้างบิลขาย `SPMM/XX` และ `LZMM/XX` ด้วยยอดขายเต็ม (Gross Sales ตาม TFRS 15), ดึงชื่อเต็มลูกค้าจากใบปะหน้าพัสดุ, บันทึกค่าใช้จ่ายค่าธรรมเนียมแพลตฟอร์มพร้อมเช็คบิล `TIV` ที่ตกหล่น, และส่งออกไฟล์ Excel รูปแบบเดียวกับที่ส่งสำนักงานบัญชีในคลิกเดียว

###### \- ระยะที่ 3 (Phase 24.3 - Smart Krungthai Statement Reconciliation):

###### &#x20; - ลากวางไฟล์ `202610\_Statement.xls` (ถอดรหัสผ่านเลขผู้เสียภาษี `0905564000520` ของบัญชีกรุงไทย `902-0-74651-0` อัตโนมัติ)

###### &#x20; - จับคู่ยอดเงินโอนเข้ากับบิลขายค้างชำระจาก: 1. ประวัติเลขบัญชีลูกค้าที่โอนมา (เช่น `014-7272061729` = พี่รัตน์), 2. ยอดเงินตรงเป๊ะ (`16,659.90`), หรือ 3. ยอดหลังหัก ณ ที่จ่าย 1% / 3% พร้อมตัดบิลย้อนหลังตามวัน-เวลาที่โอนจริงใน Statement

