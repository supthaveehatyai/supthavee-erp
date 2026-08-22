-- Expense installment payout knock-off + Auto-Complete EXP (PAID)
-- Run on Supabase Cloud, then regenerate types.

-- 1) Allow expenses.status = PAID when every installment is paid
ALTER TABLE public.expenses
  DROP CONSTRAINT IF EXISTS expenses_status_check;

ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_status_check
  CHECK (status IN ('DRAFT', 'ISSUED', 'PAID', 'VOID'));

COMMENT ON CONSTRAINT expenses_status_check ON public.expenses IS
  'DRAFT / ISSUED / PAID (ผ่อนครบทุกงวด) / VOID';

-- 2) document_allocations: link PAY knock-off → expenses
ALTER TABLE public.document_allocations
  ADD COLUMN IF NOT EXISTS expense_id UUID
    REFERENCES public.expenses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_document_allocations_expense_id
  ON public.document_allocations (expense_id)
  WHERE expense_id IS NOT NULL;

COMMENT ON COLUMN public.document_allocations.expense_id IS
  'Knock-off ไปยังบิลค่าใช้จ่าย (OPEX) — ใช้เมื่อ PAY จ่ายงวดผ่อน';

-- 3) payment_allocations: link PAY document + expense (Cloud knock-off)
ALTER TABLE public.payment_allocations
  ADD COLUMN IF NOT EXISTS document_id UUID
    REFERENCES public.documents(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS expense_id UUID
    REFERENCES public.expenses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_transaction_id UUID
    REFERENCES public.payment_transactions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payment_allocations_document_id
  ON public.payment_allocations (document_id)
  WHERE document_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_allocations_expense_id
  ON public.payment_allocations (expense_id)
  WHERE expense_id IS NOT NULL;

COMMENT ON COLUMN public.payment_allocations.document_id IS
  'เอกสาร PAY ที่ตัดชำระ';
COMMENT ON COLUMN public.payment_allocations.expense_id IS
  'บิลค่าใช้จ่ายที่ถูก knock-off';
