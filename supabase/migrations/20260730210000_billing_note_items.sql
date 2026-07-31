-- ==============================================================================
-- Phase 5 — Billing Note: doc_type BN/BR + billing_note_items junction table
-- ==============================================================================

ALTER TABLE doc_headers DROP CONSTRAINT IF EXISTS doc_headers_doc_type_check;
ALTER TABLE doc_headers ADD CONSTRAINT doc_headers_doc_type_check 
    CHECK (doc_type IN (
        'QT', 'INV_DO', 'TAX_INV', 'CS_TAX', 'ABB', 'DEP_IN', 'REC', 'CN', 'AR_REFUND', 'AR_WRITEOFF', 
        'PO', 'AP_TAX', 'AP_INV', 'AP_CASH', 'DEP_OUT', 'PAY', 'AP_REFUND', 'AP_WRITEOFF',
        'BN', 'BR'
    ));
CREATE TABLE billing_note_items (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    billing_note_id UUID NOT NULL REFERENCES doc_headers(id) ON DELETE CASCADE,
    invoice_id UUID NOT NULL REFERENCES doc_headers(id) ON DELETE RESTRICT,
    billed_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_billing_invoice UNIQUE(billing_note_id, invoice_id)
);
CREATE INDEX idx_billing_note_id ON billing_note_items(billing_note_id);
CREATE INDEX idx_billing_invoice_id ON billing_note_items(invoice_id);
ALTER TABLE billing_note_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow authenticated users to read billing_note_items" ON billing_note_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to insert billing_note_items" ON billing_note_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated users to update billing_note_items" ON billing_note_items FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to delete billing_note_items" ON billing_note_items FOR DELETE TO authenticated USING (true);
