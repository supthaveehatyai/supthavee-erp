-- Replace the global UNIQUE(doc_no) constraint on doc_headers with a
-- composite UNIQUE(contact_id, doc_no, doc_date).
--
-- Business rule: a "duplicate invoice" is defined by the combination of
-- vendor + invoice number + invoice date — NOT invoice number alone.
-- Many vendors reset their own invoice numbering every month (e.g. starting
-- back at "001"), so the same doc_no legitimately recurs for the same
-- vendor across different months, and unrelated vendors may coincidentally
-- share a doc_no too. A global UNIQUE(doc_no) would reject all of these
-- valid cases with a 23505 error.
--
-- doc_headers is currently only written to by the Smart Goods Receipt flow
-- (doc_type = 'REC') in lib/actions/receipt.ts — safe to broaden here.
ALTER TABLE public.doc_headers
  DROP CONSTRAINT IF EXISTS doc_headers_doc_no_key;

ALTER TABLE public.doc_headers
  ADD CONSTRAINT doc_headers_contact_doc_no_date_key
  UNIQUE (contact_id, doc_no, doc_date);
