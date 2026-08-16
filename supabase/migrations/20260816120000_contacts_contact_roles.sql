-- Multi-Role contacts: VARCHAR[] for Customer / Vendor / Technician (same person).
-- Keeps legacy contact_type in sync as a primary role for NOT NULL + older joins.

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS contact_roles VARCHAR[] NULL;

-- Backfill from contact_type
UPDATE public.contacts
SET contact_roles = ARRAY[contact_type::text]
WHERE contact_roles IS NULL
  AND contact_type IS NOT NULL;

-- Default for new rows; enforce non-empty array when present
ALTER TABLE public.contacts
  ALTER COLUMN contact_roles SET DEFAULT ARRAY['Customer']::VARCHAR[];

UPDATE public.contacts
SET contact_roles = ARRAY['Customer']::VARCHAR[]
WHERE contact_roles IS NULL OR cardinality(contact_roles) = 0;

ALTER TABLE public.contacts
  ALTER COLUMN contact_roles SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contacts_contact_roles_allowed_check'
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT contacts_contact_roles_allowed_check
      CHECK (
        contact_roles <@ ARRAY['Customer', 'Vendor', 'Technician']::VARCHAR[]
        AND cardinality(contact_roles) >= 1
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contacts_contact_roles
  ON public.contacts
  USING GIN (contact_roles);

COMMENT ON COLUMN public.contacts.contact_roles IS
  'Multi-role tags: Customer, Vendor, Technician (same contact may hold several).';
