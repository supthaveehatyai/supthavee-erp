-- ==============================================================================
-- Phase 5 — Deposit Refund / Write-off document types
-- Stub documents REFUND / WRITE_OFF are linked via document_allocations:
--   receipt_doc_id = REFUND|WRITE_OFF doc
--   invoice_doc_id = DEP_IN|DEP_OUT doc
--   adjustment_reason = 'REFUND' | 'WRITE_OFF'
--
-- Schema/Enum only — no DML. Do not use new enum values in the same transaction.
-- ==============================================================================

ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'REFUND';
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'WRITE_OFF';

COMMENT ON TYPE public.document_type IS
  'Sales: QT SO INV_DO TAX_INV CS_TAX ABB DEP_IN REC CN | Purchases: PO AP_TAX AP_INV AP_CASH DEP_OUT PAY | Finance stubs: REFUND WRITE_OFF';
