System Blueprint: Supthavee ERP SuperApp

Version: 14.4 (Phase 14 Post-Go-Live Enterprise Enhancements)

Company: บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด

Document Purpose: System Requirements, Business Logic, and Database Schema for AI Assistants (Claude, Cursor, Gemini)



1\. System Overview (ภาพรวมระบบ)

(คงข้อมูลเดิม)



2\. Tech Stack \& AI Integration (เทคโนโลยีที่ใช้)

(คงข้อมูลเดิม)



3\. User Roles (สิทธิ์การใช้งาน Dynamic RBAC \& ABAC)

โครงสร้างสิทธิ์: ควบคุมสิทธิ์แบบ Dynamic ผ่านตาราง app\_roles (Permission Matrix: accessible\_modules) และผูกกับ auth.users ผ่าน user\_profiles (ABAC: data\_access\_scope, approval\_limit) พร้อมระบบ Auth Guard (Middleware) ฝั่ง Server

(คงข้อมูลเดิมในส่วนอื่น)



4\. Core Modules \& Business Logic (โมดูลหลักและกฎเกณฑ์)

(คงข้อมูลเดิม Module A - J)



Module K: Post Go-Live Enterprise Enhancements (ส่วนต่อขยาย Phase 14)

Physical Inventory: ระบบเอกสารยอดยกมา (STK\_OB) และระบบปรับปรุงสต็อก (STK\_ADJ) \[✅ Completed]

Approval Workflow \& Period Closing: ระบบอนุมัติบิล Maker-Checker และการล็อกบัญชีรายเดือน \[✅ Completed]

Fixed Asset Management (Direct Capitalization): ทะเบียนสินทรัพย์ถาวรพร้อมระบบดึงข้อมูลจากบิล AP (Asset Clearing) ผ่าน URL Search Params แบบไร้รอยต่อ \[✅ Register Completed]

Fixed Asset Depreciation: คำนวณค่าเสื่อมราคาแบบเส้นตรง (Straight-line) ผูก Period Closing พร้อมระบบ Proration เฉลี่ยรายวันงวดแรก และ Ledger UI \[✅ Completed]

ABAC (Attribute-Based Access Control): ยกระดับระบบสิทธิ์การเข้าถึงข้อมูลแบบละเอียดด้วย Data Access Scope (ALL/OWN), Maker-Checker Approval Limit, และระบบ Role Permission Matrix (JSONB) เพื่อแบ่งแยกหน้าที่ (SoD) \[✅ Completed]

Data Archiving (Tiered Storage): สคริปต์สำรองข้อมูลภาพเย็น (Cold Data) อายุเกิน 1-5 ปี ถ่ายโอนสู่ NAS \[⏳ Roadmap]



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

(คงข้อมูลเดิม)

4\. Documents \& Financials (เอกสารและการเงิน)

Document Conversion Lineage: QT -> SO -> INV\_DO / TAX\_INV / CS\_TAX / ABB -> REC (ห้ามข้าม SO เด็ดขาด)

SO (ใบสั่งขาย): ใช้ยืนยันคำสั่งซื้อ, จองสต็อก (Soft Allocation / ATP), และส่งงานผลิต (MTO)

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

