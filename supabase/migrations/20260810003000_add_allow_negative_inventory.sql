-- Allow negative on-hand inventory (bypass stock check on sales OUT)
ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS allow_negative_inventory BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.system_settings.allow_negative_inventory IS
  'When true, sales stock OUT may drive ledger balance below zero; when false, block with สต็อกไม่เพียงพอ';

UPDATE public.system_settings
SET allow_negative_inventory = COALESCE(allow_negative_inventory, false)
WHERE id = 1;
