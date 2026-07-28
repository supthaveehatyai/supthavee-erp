-- =============================================================================
-- Phase 4 — Documents Schema (Sales / Purchases Document Engine)
-- =============================================================================
-- New tables: public.documents + public.document_items
-- Enums:      document_type, document_status
-- Access:     Service Role only (RLS ON, no anon/authenticated policies)
--
-- Note: Legacy doc_headers / doc_details remain untouched (Goods Receipt path).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'document_type' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.document_type AS ENUM (
      'QT',
      'PO',
      'ABB',
      'DEP',
      'INV_DO',
      'REC',
      'TAX_INV',
      'INT_REC'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'document_status' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.document_status AS ENUM (
      'DRAFT',
      'ISSUED',
      'PAID',
      'CANCELLED',
      'VOID'
    );
  END IF;
END $$;

COMMENT ON TYPE public.document_type IS
  'Blueprint Module B — QT, PO, ABB, DEP, INV_DO, REC, TAX_INV, INT_REC';
COMMENT ON TYPE public.document_status IS
  'Document lifecycle — DRAFT → ISSUED → PAID | CANCELLED | VOID';

-- ---------------------------------------------------------------------------
-- documents (header)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  doc_no VARCHAR(50) NOT NULL,
  doc_type public.document_type NOT NULL,
  status public.document_status NOT NULL DEFAULT 'DRAFT',
  doc_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id),
  contact_person_id UUID REFERENCES public.contact_persons(id),
  ref_doc_id UUID REFERENCES public.documents(id),
  sub_total DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  discount_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  tax_rate DECIMAL(5, 2) NOT NULL DEFAULT 7.00,
  tax_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  wht_rate DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
  wht_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  grand_total DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  deposit_deducted DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  payment_status VARCHAR(50) NOT NULL DEFAULT 'Pending',
  notes TEXT,
  attached_file_url TEXT,
  original_file_name TEXT,
  CONSTRAINT documents_doc_no_key UNIQUE (doc_no)
);

CREATE INDEX IF NOT EXISTS idx_documents_contact_id
  ON public.documents (contact_id);
CREATE INDEX IF NOT EXISTS idx_documents_doc_type_date
  ON public.documents (doc_type, doc_date DESC);
CREATE INDEX IF NOT EXISTS idx_documents_status
  ON public.documents (status);
CREATE INDEX IF NOT EXISTS idx_documents_doc_no_prefix
  ON public.documents (doc_no);

COMMENT ON TABLE public.documents IS
  'Phase 4 document headers — running numbers e.g. INV-YYMM-XXXX';

-- ---------------------------------------------------------------------------
-- document_items (lines)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.document_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id),
  description VARCHAR(255),
  qty NUMERIC(12, 4) NOT NULL DEFAULT 1,
  uom_used VARCHAR(50),
  unit_price DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  unit_cost_price DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  discount_text VARCHAR(50),
  discount_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  line_total DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_document_items_document_id
  ON public.document_items (document_id);
CREATE INDEX IF NOT EXISTS idx_document_items_product_id
  ON public.document_items (product_id);

COMMENT ON COLUMN public.document_items.unit_cost_price IS
  'Cost snapshot at sell time — Blueprint Module B profit analysis';

-- ---------------------------------------------------------------------------
-- Privileges — Service Role only
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.documents FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.document_items FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.documents TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.document_items TO service_role;

-- ---------------------------------------------------------------------------
-- RLS — deny anon/authenticated; service_role bypasses RLS by default
-- ---------------------------------------------------------------------------
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_items ENABLE ROW LEVEL SECURITY;

-- Explicit service_role policies (defence in depth; BYPASSRLS still applies)
DROP POLICY IF EXISTS "documents_service_role_all" ON public.documents;
CREATE POLICY "documents_service_role_all"
  ON public.documents
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "document_items_service_role_all" ON public.document_items;
CREATE POLICY "document_items_service_role_all"
  ON public.document_items
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
