-- ==============================================================================
-- Phase 5 — Official REFUND / WRITE_OFF document types (ENUM document_type)
-- Created via: `supabase migration new document_type_refund_writeoff_official`
--
-- Official finance documents for deposit settlement:
--   REFUND    = คืนเงินมัดจำ
--   WRITE_OFF = ตัดเศษบัญชี
--
-- Linked via document_allocations:
--   receipt_doc_id = REFUND | WRITE_OFF document id  (allocated / new doc)
--   invoice_doc_id = DEP_IN | DEP_OUT document id    (source deposit)
--   adjustment_reason = 'REFUND' | 'WRITE_OFF' (+ optional remark)
--
-- Schema/Enum only — no DML in this file.
-- PostgreSQL: do not use newly added enum values in the same transaction.
-- ==============================================================================

ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'REFUND';
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'WRITE_OFF';

COMMENT ON TYPE public.document_type IS
  'Sales: QT SO INV_DO TAX_INV CS_TAX ABB DEP_IN REC CN | Purchases: PO AP_TAX AP_INV AP_CASH DEP_OUT PAY | Finance: REFUND WRITE_OFF';
