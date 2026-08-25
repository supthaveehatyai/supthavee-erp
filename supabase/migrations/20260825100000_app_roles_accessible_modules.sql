-- =============================================================================
-- Phase 10 — Dynamic RBAC Permission Matrix
-- Cloud-First: รันบน Supabase Cloud หากคอลัมน์ยังไม่มี
-- =============================================================================

ALTER TABLE public.app_roles
  ADD COLUMN IF NOT EXISTS accessible_modules JSONB;

COMMENT ON COLUMN public.app_roles.accessible_modules IS
  'Permission Matrix — { sales, purchases, inventory, finance, settings } เป็น boolean';

UPDATE public.app_roles
SET accessible_modules = jsonb_build_object(
  'sales', true,
  'purchases', true,
  'inventory', true,
  'finance', true,
  'settings', true
)
WHERE accessible_modules IS NULL;

UPDATE public.app_roles
SET accessible_modules = jsonb_build_object(
  'sales', true,
  'purchases', true,
  'inventory', true,
  'finance', true,
  'settings', true
)
WHERE lower(role_code) = 'admin';
