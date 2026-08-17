-- =============================================================================
-- Multi-Role hard cutover: drop legacy contacts.contact_type (VARCHAR)
-- App reads/writes contacts.contact_roles (VARCHAR[]) only.
-- =============================================================================

-- Ensure every row has at least one role before dropping contact_type
UPDATE public.contacts
SET contact_roles = ARRAY[contact_type]::VARCHAR[]
WHERE (contact_roles IS NULL OR cardinality(contact_roles) = 0)
  AND contact_type IS NOT NULL;

UPDATE public.contacts
SET contact_roles = ARRAY['Customer']::VARCHAR[]
WHERE contact_roles IS NULL OR cardinality(contact_roles) = 0;

ALTER TABLE public.contacts
  ALTER COLUMN contact_roles SET DEFAULT ARRAY['Customer']::VARCHAR[],
  ALTER COLUMN contact_roles SET NOT NULL;

-- Drop legacy single-role column + its check constraint
ALTER TABLE public.contacts
  DROP CONSTRAINT IF EXISTS contacts_contact_type_check;

ALTER TABLE public.contacts
  DROP COLUMN IF EXISTS contact_type;

COMMENT ON COLUMN public.contacts.contact_roles IS
  'Multi-role tags only: Customer / Vendor / Technician (replaces contact_type).';
