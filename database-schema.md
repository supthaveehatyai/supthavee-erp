Supthavee ERP - Database Schema Reference (Cloud Production Verified - Phase 24)



CRITICAL INSTRUCTION FOR AI: STRICTLY use the table names, column names, views, triggers, and RPC functions listed below. DO NOT invent, assume, or create new tables. (`bank\_accounts` is DEPRECATED — always use `mst\_bank\_accounts`).



1\. Master Data (ตารางข้อมูลหลัก)

\- `mst\_bank\_accounts` (สมุดบัญชีธนาคารบริษัท — PK: `id`, UNIQUE: `account\_no` เช่น `902-0-74651-0`)

\- `mst\_brands` (แบรนด์สินค้า — PK: `id`)

\- `mst\_categories` (หมวดหมู่สินค้า — PK: `id`, Self-FK: `parent\_id`; รหัส Parent = 1 ตัวอักษร, Child = 2 ตัวอักษร)

\- `mst\_colors` (สีมาตรฐาน — PK: `id`, ล็อกรหัสสี 3 ตัวอักษรพิมพ์ใหญ่ เช่น `WHT`, `BLK`, `NVY`)

\- `mst\_expense\_categories` (หมวดหมู่ค่าใช้จ่าย — PK: `id`)

\- `mst\_asset\_categories` (หมวดหมู่สินทรัพย์ถาวร — PK: `id`, `category\_code`, `useful\_life\_years`, และคอลัมน์ `depreciation\_rate` เป็น `GENERATED ALWAYS` ห้ามส่งค่าตอน Insert/Upsert)

\- `mst\_genders` (เพศ/ทรงเสื้อ — PK: `id`)

\- `mst\_sizes` (ไซส์มาตรฐาน Global Size Fixed-2 Characters — PK: `id`, `size\_code`, `sort\_order` Gap of 10, รวมถึงไซส์ `00` สำหรับวัตถุดิบ/งานบริการ)

\- `mst\_uom` (หน่วยนับสินค้า — PK: `uom\_id`, `uom\_code`, `uom\_name`)

\- `mst\_wht\_rates` (อัตราภาษีหัก ณ ที่จ่ายมาตรฐาน — PK: `id`, 1%, 2%, 3%, 5%)

\- `mst\_carriers` (บริษัทขนส่ง — PK: `carrier\_id`, `carrier\_code`, `carrier\_name`, `contact\_id`, `carrier\_tier` \[`PRIMARY\_MONTHLY` | `OCCASIONAL`])

\- `mst\_document\_taxonomy` (มาตรฐานเอกสารและขนาดกระดาษเริ่มต้น — PK: `doc\_code`, `paper\_format` \[`A4\_PORTRAIT` | `A5\_PORTRAIT` | `A5\_LANDSCAPE`])



2\. Core Entities, LINE OA \& HR/Payroll (องค์กร, ผู้ใช้, พนักงานเงินเดือน)

\- `contacts` (คู่ค้า Multi-Role — PK: `id`, `company\_name`, `nickname` \[ชื่อเล่นลูกค้าหน้าร้าน เช่น พี่ก๊ก, พี่รัตน์], `tax\_id`, `branch\_code`, `address`, `phone`, `contact\_roles` VARCHAR\[], `vendor\_tax\_tier` \[`CORP\_VAT` | `INDIVIDUAL\_ID\_1\_2` | `INTERNAL\_NO\_ID\_1\_3`], `id\_card\_attachment\_url`, `line\_target\_id`, `line\_display\_name`, `line\_notify\_enabled`, `line\_oa\_chat\_url`)

\- `contact\_bank\_accounts` (บัญชีรับเงิน/โอนเงินของคู่ค้า — PK: `id`, FK: `contact\_id` → `contacts.id`, `account\_category`, `bank\_code`, `bank\_name`, `account\_no`, `account\_name`, `is\_default`)

\- `contact\_persons` (ผู้ติดต่อภายใต้คู่ค้า — PK: `id`, FK: `contact\_id`)

\- `mst\_employees` (ทะเบียนพนักงานเงินเดือน — PK: `id`, UNIQUE: `emp\_code` \[`EMP-001`..`EMP-005`], `full\_name`, `nickname`, `citizen\_id`, `address`, `position\_title`, `department\_type` \[`OPEX\_ADMIN\_SALES` | `COGS\_PRODUCTION`], `payroll\_channel` \[`CORPORATE\_OFFICIAL` | `INTERNAL\_PRIVATE`], `base\_salary`, `is\_sso\_enrolled`, `bank\_code`, `bank\_name`, `bank\_account\_no`, `bank\_account\_name`, `id\_card\_attachment\_url`, `bank\_book\_attachment\_url`, `is\_active`)

\- `hr\_payroll\_periods` (งวดเงินเดือนและประกันสังคม — PK: `id`, UNIQUE: `period\_year` + `period\_month`, `period\_label`, `sso\_rate\_pct` \[5.00], `sso\_wage\_ceiling` \[15000.00], `official\_gross\_total`, `official\_net\_total`, `internal\_gross\_total`, `internal\_net\_total`, `sso\_employee\_total`, `sso\_employer\_total`, `sso\_total\_remittance`, `sso\_payment\_status`, `sso\_payment\_date`, `sso\_payment\_slip\_url`, `sso\_receipt\_no`, `sso\_reference\_no`, `sso\_employer\_account\_no` \[`9020012177`], `paid\_sso\_from\_account`, `linked\_sso\_expense\_id` FK → `expenses.id`, `status`)

\- `hr\_payroll\_items` (รายการคำนวณเงินเดือนรายบุคคล — PK: `id`, UNIQUE: `payroll\_period\_id` + `employee\_id`, `payroll\_channel`, `base\_salary`, `ot\_amount`, `allowance\_amount`, `commission\_amount`, `bonus\_amount`, `gross\_income`, `sso\_employee\_amount`, `sso\_employer\_amount`, `wht\_tax\_amount`, `other\_deduction`, `net\_pay`, `payment\_status`, `payment\_date`, `paid\_from\_account`, `payment\_slip\_url`, `payment\_reference\_no`, `linked\_expense\_id`)

\- `line\_known\_groups` (PK: `group\_id`, `group\_name`, `linked\_contact\_id` → `contacts.id`, `last\_reply\_token`, `chat\_room\_url`)

\- `line\_notification\_logs` (ประวัติการส่งสลิปผ่าน LINE OA — PK: `id`, `document\_id` FK → `documents.id`, `contact\_id` FK → `contacts.id`, `target\_id`, `message\_text`, `slip\_url`, `status`, `error\_message`, `created\_at` TIMESTAMPTZ; มี Trigger `trg\_stamp\_document\_line\_notified` อัปเดต `documents.line\_notified\_at`)

\- `user\_profiles`, `app\_roles`, `system\_settings` (มี `ocr\_primary\_model = 'gemini-3.7-flash'` และ `ocr\_fallback\_models`), `system\_parameters`, `parameter\_change\_requests`



3\. Products, Inventory \& Production (สินค้า, คลัง, ผลิต)

\- `product\_models`, `products` (3,811+ SKUs), `vendor\_product\_mapping` (3,917+ แถว), `inventory\_ledger`, `product\_boms`, `production\_jobs` (`finished\_model\_id` nullable, `ref\_document\_id`, `ref\_document\_item\_id` → `document\_items.id` แยกการ์ด Kanban ต่อบรรทัดบริการ, `job\_no`, `status`, `target\_quantity`, `mockup\_image\_url`, `remark`), `production\_job\_items`, `production\_job\_materials`, `production\_job\_operations`, `technician\_rates`



4\. Documents, Expenses \& Financials (เอกสาร, ค่าใช้จ่าย, การเงิน)

\- `documents` (เอกสารหลักทั้งระบบ 76+ คอลัมน์ — PK: `id`, `doc\_no`, `doc\_type`, `status`, `doc\_date`, `due\_date`, `contact\_id`, `contact\_person\_id`, `ref\_doc\_id`, `ref\_document\_id`, `sub\_total`, `total\_amount`, `discount\_text`, `discount\_amount`, `net\_before\_vat`, `vat\_type` \[ENUM: `vat\_calculation\_type`], `vat\_rate`, `vat\_amount`, `tax\_rate`, `tax\_amount`, `wht\_rate`, `wht\_amount`, `grand\_total`, `deposit\_deducted`, `deposit\_net\_deducted`, `deposit\_vat\_deducted`, `deposit\_doc\_id`, `paid\_amount`, `payment\_status`, `accounting\_tax\_tier` \[`CORP\_VAT` | `RECEIPT\_1\_2` | `INTERNAL\_1\_3`], `cash\_receipt\_no`, `tax\_invoice\_status`, `tax\_invoice\_no`, `tax\_invoice\_date`, `sales\_channel` \[`STORE` | `SHOPEE` | `LAZADA` | `TIKTOK`], `ecommerce\_order\_no`, `ecommerce\_buyer\_name`, `tracking\_no`, `one\_time\_address`, `attachment\_url`, `attached\_file\_url`, `attachment\_urls`, `attachments`, `line\_notified\_at`, `line\_notified\_count`, `reference\_no`, `handwritten\_doc\_ref` [Trigger ซิงค์คู่กับ `reference\_no`], `notes`)

\- `documents.payment\_channel` (`COMPANY\_BANK` | `CASH` | `OTHER\_BANK`), `bank\_account\_id` → `mst\_bank\_accounts`, `receiving\_bank\_label`, `is\_swept\_to\_company`, `swept\_to\_company\_at`, `swept\_batch\_ref` — แยกช่องทางรับเงินและติดตามยอดเงินสด/บัญชีอื่นที่ยังไม่โอนเข้าบัญชีบริษัท. RPC `get\_unswept\_receipts\_summary()`

\- `documents` ภาษีหัก ณ ที่จ่าย: `wht\_rate`, `wht\_amount`, `net\_received\_amount`, `wht\_attachment\_url`, `wht\_status` [`NONE` | `PENDING\_CERT` | `RECEIVED`]. ฐานคำนวณคือ `net\_before\_vat - deposit\_net\_deducted` ไม่ใช่ `grand\_total`. RPC `attach\_sales\_document\_wht\_certificate(p\_document\_id, p\_wht\_rate, p\_wht\_amount, p\_wht\_attachment\_url)` ใช้แนบใบ 50 ทวิย้อนหลัง

\- `doc\_headers` (ตารางคู่ขนาน — `contact\_id` ปลด `NOT NULL` แล้วเพื่อรองรับบิลขายหน้าร้าน `ABB` และ E-Commerce, `reference\_no` ซิงค์จาก `documents.reference\_no` / `handwritten\_doc\_ref`, `payment\_status`, `paid\_amount`)

\- `document\_items` (PK: `id`, `document\_id`, `product\_id` \[Nullable สำหรับรายการบริการ], `is\_service\_item` BOOLEAN, `description`, `qty` NUMERIC(14,4), `uom\_used`, `unit\_price`, `unit\_cost\_price`, `discount\_text`, `discount\_amount`, `line\_total`, `sort\_order`, `technician\_id`, `wage\_cost`, `technician\_bill\_id`, `mockup\_image\_url`, `is\_sent\_to\_production`, `production\_status`)

\- `sales\_item\_mappings` (จำคำบนบิลขาย — `source\_text`, `normalized\_text`, `product\_id` [Nullable], `is\_service\_item` BOOLEAN, `sku`, `description`, `uom\_used`)

\- `bank\_statement\_imports` (หัวไฟล์ Statement กรุงไทย — `bank\_code` [`KTB`], `account\_no`, `file\_name`, `source\_filename` ส่งคู่กับ `file\_name` ทุกครั้งที่นำเข้า, `source\_kind`, `row\_count`, `created\_by`)

\- `bank\_statement\_lines` (รายการเดินบัญชี — FK: `import\_id`, `tx\_date`, `tx\_time`, `tx\_code`, `description`, `payer\_hint`, `withdrawal\_amount`, `deposit\_amount`, `tx\_direction` [`IN` | `OUT`], `expense\_memo`, `balance\_amount`, `row\_hash` TEXT UNIQUE สำหรับ upsert กันไฟล์ซ้อนวัน, `reconcile\_status` [`UNMATCHED` | `PARTIAL` | `MATCHED`], `matched\_amount`)

\- `bank\_reconciliation\_allocations` (ชนยอดเงินฝากกับบิลขาย — FK: `statement\_line\_id`, FK: `document\_id`, `allocated\_amount`, `platform\_fee\_diff`, `created\_by`)

\- `get\_reconcile\_candidate\_documents()` และ Trigger `trg\_sync\_parent\_child\_document\_settlement` — ยอดตัดได้ของบิลขายคือ `grand\_total - deposit\_deducted - wht\_amount - allocated` โดยไม่หัก `wht\_amount` ซ้ำ และไม่แสดง `SO` ที่ถูกแปลงเป็น `CS\_TAX` / `TAX\_INV` / `INV\_DO` / `ABB` ที่ออกเลขแล้ว

\- `get\_statement\_lines\_with\_matches(p\_import\_id uuid DEFAULT NULL)` คืนรายการเดินบัญชีพร้อม `matched\_doc\_nos` และ `matched\_documents` (เลขที่บิล, ลูกค้า, อ้างอิงบิลมือ, เลขสลิป, ยอดเต็ม, มัดจำ, หัก ณ ที่จ่าย, ยอดที่ชน, เลขใบสั่งขายต้นทาง)

\- `unmatch\_statement\_line\_allocation(p\_statement\_line\_id uuid, p\_document\_id uuid DEFAULT NULL)` ปลดคู่ชนยอดทั้งบรรทัด หรือเฉพาะบิลที่ระบุ แล้วคืนบิลกลับเข้าลิสต์รอชน

\- `reclassify\_document\_payment\_channel(p\_document\_id, p\_new\_channel, p\_bank\_account\_id)` (ย้ายบิลออกจากหน้าชนยอด KTB ไปช่องทาง `CASH` หรือ `OTHER\_BANK`)

###### \- `expenses` (บิลค่าใช้จ่าย / OPEX — PK: `id`, ซิงก์คอลัมน์เลขเอกสาร `expense\_no` = `doc\_no` = `document\_no`, ซิงก์วันที่ `expense\_date` = `doc\_date`, ซิงก์รายละเอียด `description` = `remark`, ซิงก์หมวดหมู่ `category` = `expense\_category`, `contact\_id` FK → `contacts.id`, `vendor\_name`, `vendor\_tax\_id`, `tax\_invoice\_no`, `reference\_no`, `vehicle\_plate`, `tax\_type` \[`INCLUSIVE` | `EXCLUSIVE` | `NO\_VAT`], `tax\_invoice\_status`, `accounting\_tax\_tier`, `net\_amount`, `sub\_total`, `amount`, `vat\_rate`, `vat\_amount`, `wht\_rate`, `wht\_amount`, `total\_amount`, และ \*\*`grand\_total` เป็น `GENERATED ALWAYS AS (net\_amount + vat\_amount) STORED` ห้ามส่งค่าเข้า Insert/Update เด็ดขาด\*\*, `bank\_account\_id` \[Single FK → `mst\_bank\_accounts.id`], `attachment\_url`, `payment\_slip\_url`, `status`, `payment\_status`)

###### \- `expense\_items` (รายการย่อยของบิลค่าใช้จ่าย — PK: `id`, FK: `expense\_id` → `expenses.id` ON DELETE CASCADE, `line\_no`, `item\_description`, `quantity`, `unit\_name`, `unit\_price`, `discount\_amount`, `line\_total`)

###### \- `document\_allocations`, `billing\_note\_items`, `payment\_transactions` (เปิด RLS Policy `FOR ALL TO authenticated` ครบแล้ว), `expense\_installments`, `fixed\_assets`, `asset\_depreciation\_ledger`, `accounting\_periods`, `approval\_logs`, `audit\_logs`

###### 

###### 5\. Supabase Storage Buckets (Public Read CDN \& Authenticated Write)

###### \- `document\_attachments`, `expense\_documents`, `procurement\_bills`, `product\_assets`, `production\_attachments`, `payment-slips`

###### 

###### 6\. Key Database Triggers \& RPC Functions (Phase 22–24)

###### \- `public.settle\_ap\_invoices\_bulk\_fast(p\_pay\_doc\_id UUID, p\_billing\_note\_id UUID, p\_allocations JSONB)`

###### \- `public.generate\_or\_sync\_payroll\_period(p\_year INT, p\_month INT, p\_sso\_rate\_pct NUMERIC)`

###### \- `public.recalculate\_payroll\_period\_totals(p\_period\_id UUID)`

###### \- `public.update\_employee\_id\_card\_attachment(p\_employee\_id UUID, p\_id\_card\_url TEXT, p\_bank\_book\_url TEXT)`

###### \- `public.record\_sso\_remittance\_and\_expense(p\_period\_id UUID, p\_payment\_date DATE, p\_receipt\_no VARCHAR, p\_reference\_no VARCHAR, p\_slip\_url TEXT, p\_paid\_from\_account VARCHAR)`

###### \- `public.save\_expense\_direct\_no\_draft(...)` \& `public.update\_expense\_direct(...)`

###### \- `public.fn\_sync\_expenses\_standard\_columns()` \& `public.fn\_auto\_fill\_expense\_vendor\_name()`

###### \- `public.update\_sales\_document\_direct(...)`


###### \- `public.generate\_abb\_channel\_doc\_no(p\_sales\_channel TEXT, p\_doc\_date DATE, p\_document\_id UUID DEFAULT NULL)` — เลข ABB หน้าร้าน `ABB-YYMM-XXXX`, Shopee `SPMM/XX`, Lazada `LZMM/XX` ตามเดือนของ `doc\_date`

###### \- Index `idx\_documents\_ecom\_order\_lookup` บน `documents` (`sales\_channel`, `ecommerce\_order\_no`)

###### \- Trigger ซิงค์ `documents.reference\_no` กับ `documents.handwritten\_doc\_ref` และคัดลอก `reference\_no` ไป `doc\_headers`
