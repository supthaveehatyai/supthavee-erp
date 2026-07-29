-- ==============================================================================
-- Migration: Phase 5 - Finance & Services (AP/AR, Payments, Allocations)
-- Description: วางโครงสร้างระบบการเงิน สมุดบัญชี และการตัดยอดหนี้ (WHT, Reconcile, Void)
-- Author: กันต์ (Lead Architect)
-- ==============================================================================

-- 1. สร้าง ENUM สำหรับระบบการเงิน (ใช้ DO BLOCK เพื่อป้องกัน Error หากมีอยู่แล้ว)
DO $$ BEGIN
    CREATE TYPE payment_status_enum AS ENUM ('UNPAID', 'PARTIAL', 'PAID', 'VOIDED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE payment_method_enum AS ENUM ('CASH', 'BANK_TRANSFER', 'CHEQUE', 'CREDIT_CARD', 'OFFSET_DEPOSIT');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. 🧩 Extend `documents` Table (ส่วนขยายไม่กระทบข้อมูล Phase 4)
ALTER TABLE public.documents
ADD COLUMN IF NOT EXISTS payment_status payment_status_enum DEFAULT 'UNPAID',
ADD COLUMN IF NOT EXISTS due_date DATE,
ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(14,4) DEFAULT 0,
ADD COLUMN IF NOT EXISTS is_voided BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS voided_by UUID,
ADD COLUMN IF NOT EXISTS void_reason TEXT;

-- 3. 🏦 Master Data: Bank Accounts (ตารางสมุดบัญชีธนาคารบริษัท)
CREATE TABLE IF NOT EXISTS public.mst_bank_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_name TEXT NOT NULL,      -- เช่น 'KBank', 'SCB', 'BBL'
    account_no TEXT NOT NULL,     -- เลขที่บัญชี
    account_name TEXT NOT NULL,   -- ชื่อบัญชี
    branch_name TEXT,             -- สาขา
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. 💸 Finance Ledger: Payment Transactions (สมุดบันทึกรับ-จ่ายเงินจริง)
CREATE TABLE IF NOT EXISTS public.payment_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE, -- ผูกกับบิล REC/DEP
    payment_method payment_method_enum NOT NULL,
    bank_account_id UUID REFERENCES public.mst_bank_accounts(id), -- โอนเข้าบัญชีไหน
    
    amount NUMERIC(14,4) NOT NULL DEFAULT 0, -- ยอดเงินจริงที่รับเข้า
    reference_no TEXT,                       -- เลขที่สลิป หรือ เลขที่เช็ค
    payment_date TIMESTAMPTZ DEFAULT now(),  -- วันที่ลูกค้าระบุโอน
    attachment_url TEXT,                     -- (Hot Storage) ลิงก์รูปสลิปจาก Supabase 
    
    -- Bank Reconciliation (สำหรับฝ่ายบัญชีกระทบยอด)
    is_reconciled BOOLEAN DEFAULT false,
    reconciled_at TIMESTAMPTZ,
    reconciled_by UUID, 
    
    -- Voiding System (กรณียกเลิกธุรกรรม)
    is_voided BOOLEAN DEFAULT false,
    voided_at TIMESTAMPTZ,
    voided_by UUID,
    void_reason TEXT,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 5. 🎯 AR/AP Allocations: ตารางจับคู่ตัดยอดหนี้ (จัดการ WHT และ เศษสตางค์)
CREATE TABLE IF NOT EXISTS public.document_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_doc_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,  -- ขาถือเงิน (REC/DEP)
    invoice_doc_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,  -- ขาตั้งหนี้ (INV_DO)
    
    allocated_amount NUMERIC(14,4) NOT NULL DEFAULT 0, -- ยอดเงินสด/โอนที่แบ่งมาตัดหนี้
    
    wht_amount NUMERIC(14,4) DEFAULT 0,                -- เครดิตภาษีหัก ณ ที่จ่าย (WHT)
    wht_reference_no TEXT,                             -- เลขที่หนังสือรับรอง 50 ทวิ
    
    adjustment_amount NUMERIC(14,4) DEFAULT 0,         -- ปัดเศษสตางค์ / ค่าธรรมเนียมแบงก์
    adjustment_reason TEXT,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 6. ⚡ Indexes (เพิ่มความเร็วในการค้นหาหน้าบัญชี)
CREATE INDEX IF NOT EXISTS idx_documents_payment_status ON public.documents(payment_status);
CREATE INDEX IF NOT EXISTS idx_payment_tx_doc_id ON public.payment_transactions(document_id);
CREATE INDEX IF NOT EXISTS idx_payment_tx_bank_id ON public.payment_transactions(bank_account_id);
CREATE INDEX IF NOT EXISTS idx_doc_alloc_receipt ON public.document_allocations(receipt_doc_id);
CREATE INDEX IF NOT EXISTS idx_doc_alloc_invoice ON public.document_allocations(invoice_doc_id);

-- 7. ⏱️ Triggers for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS trg_mst_bank_accounts_updated_at ON public.mst_bank_accounts;
CREATE TRIGGER trg_mst_bank_accounts_updated_at BEFORE UPDATE ON public.mst_bank_accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_payment_transactions_updated_at ON public.payment_transactions;
CREATE TRIGGER trg_payment_transactions_updated_at BEFORE UPDATE ON public.payment_transactions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_document_allocations_updated_at ON public.document_allocations;
CREATE TRIGGER trg_document_allocations_updated_at BEFORE UPDATE ON public.document_allocations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 8. 🔐 Row Level Security (RLS) & Policies
ALTER TABLE public.mst_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_allocations ENABLE ROW LEVEL SECURITY;

-- ใช้ USING (true) เพื่อสอดคล้องกับ Phase 1-4 และให้ Server Action จัดการ Logic และความปลอดภัย 100%
CREATE POLICY "Allow All on mst_bank_accounts" ON public.mst_bank_accounts FOR ALL USING (true);
CREATE POLICY "Allow All on payment_transactions" ON public.payment_transactions FOR ALL USING (true);
CREATE POLICY "Allow All on document_allocations" ON public.document_allocations FOR ALL USING (true);

-- 9. 🗄️ สร้าง Storage Bucket ใหม่แบบ Private (เก็บหลักฐานสลิป)
INSERT INTO storage.buckets (id, name, public) 
VALUES ('financial_slips', 'financial_slips', false) 
ON CONFLICT (id) DO NOTHING;

-- Policy สำหรับ Storage (เปิดรับให้ดูรูปได้เฉพาะคนที่เข้าสู่ระบบแอปเราเท่านั้น)
CREATE POLICY "Allow authenticated access to financial_slips" ON storage.objects FOR ALL TO authenticated USING (bucket_id = 'financial_slips');