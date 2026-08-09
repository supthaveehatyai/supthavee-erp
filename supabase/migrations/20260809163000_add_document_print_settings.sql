-- Phase KB — Configurable print paper size per document type
-- Stores overrides as JSONB map: { "INV_DO": "A5-Landscape", "TAX_INV": "A4", ... }

ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS document_print_settings JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.system_settings.document_print_settings IS
  'Print paper size overrides by doc_type (PrintPaperSize: A4 | A5-Portrait | A5-Landscape)';

UPDATE public.system_settings
SET document_print_settings = COALESCE(document_print_settings, '{}'::jsonb)
WHERE id = 1;
