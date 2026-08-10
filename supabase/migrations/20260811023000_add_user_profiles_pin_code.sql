-- =============================================================================
-- Phase 13 — user_profiles.pin_code (align Local/Cloud with Production schema)
-- =============================================================================
-- Production already has pin_code; this migration is idempotent for Local /
-- fresh Cloud projects that applied Phase 10 CREATE TABLE without the column.
-- =============================================================================

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS pin_code VARCHAR(6);

COMMENT ON COLUMN public.user_profiles.pin_code IS
  'Optional 6-digit PIN snapshot on profile; Auth password remains source of login truth.';

-- Allow NULL (legacy) or exactly 6 digits — reject other lengths.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_profiles_pin_code_format_chk'
      AND conrelid = 'public.user_profiles'::regclass
  ) THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_pin_code_format_chk
      CHECK (pin_code IS NULL OR pin_code ~ '^[0-9]{6}$');
  END IF;
END $$;
