-- ==========================================
-- Migration: Phase 8.5 WHT Foundation (Final Clean)
-- ==========================================

-- 1. เพิ่มเฉพาะคอลัมน์ใหม่สำหรับระบบภาษีบน contacts
ALTER TABLE public.contacts
ADD COLUMN IF NOT EXISTS tax_branch_code VARCHAR(5) DEFAULT '00000',
ADD COLUMN IF NOT EXISTS entity_type VARCHAR(20) CHECK (entity_type IN ('INDIVIDUAL', 'CORPORATE')),
ADD COLUMN IF NOT EXISTS tax_address TEXT,
ADD COLUMN IF NOT EXISTS is_tax_validated BOOLEAN DEFAULT false;

-- 2. เพิ่มเฉพาะคอลัมน์ใหม่สำหรับระบบภาษีบน expenses
ALTER TABLE public.expenses
ADD COLUMN IF NOT EXISTS wht_base_amount DECIMAL(15,2),
ADD COLUMN IF NOT EXISTS wht_doc_no VARCHAR(50);

-- 3. สร้าง Index เพื่อประสิทธิภาพการ Query รายงาน WHT รายเดือน
CREATE INDEX IF NOT EXISTS idx_contacts_tax_id
ON public.contacts(tax_id);

CREATE INDEX IF NOT EXISTS idx_expenses_wht_report
ON public.expenses(expense_date)
WHERE wht_amount > 0;
