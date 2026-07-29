-- ==============================================================================
-- Migration: Document Types Architecture v2 (Sales / Purchases)
-- Sales: QT, SO, INV_DO, TAX_INV, CS_TAX, ABB, DEP_IN, REC, CN
-- Purchases: PO, AP_TAX, AP_INV, AP_CASH, DEP_OUT, PAY
--
-- Schema/Enum only — no DML (UPDATE) in this file.
-- PostgreSQL forbids using a newly added enum value in the same transaction
-- as ALTER TYPE ... ADD VALUE ("unsafe use of new value").
-- ==============================================================================

ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'SO';
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'CS_TAX';
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'DEP_IN';
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'CN';
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'AP_TAX';
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'AP_INV';
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'AP_CASH';
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'DEP_OUT';
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'PAY';

COMMENT ON TYPE public.document_type IS
  'Sales: QT SO INV_DO TAX_INV CS_TAX ABB DEP_IN REC CN | Purchases: PO AP_TAX AP_INV AP_CASH DEP_OUT PAY';
