-- =============================================================================
-- Phase 10 — Enterprise Foundation & Security
-- File: 20260805032907_phase10_app_roles_user_profiles.sql
-- =============================================================================
-- Master roles (app_roles) + user profiles bound to auth.users (user_profiles).
-- RLS: authenticated can read; admins manage. Mutations from App UI still go
-- through Server Actions + service_role (Zero Client-Side Fetching).
-- =============================================================================

-- ==========================================
-- 1. app_roles (Master Data สำหรับสิทธิ์)
-- ==========================================
CREATE TABLE IF NOT EXISTS public.app_roles (
  role_code TEXT PRIMARY KEY, -- เช่น 'admin', 'sales', 'accountant'
  role_name_th TEXT NOT NULL, -- ชื่อสิทธิ์ภาษาไทยที่แสดงบน UI
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.app_roles IS
  'Phase 10 — RBAC role master (Single Source of Truth for role_code).';

-- ==========================================
-- 2. user_profiles (ผูกกับ auth.users ของ Supabase)
-- ==========================================
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role_code TEXT NOT NULL REFERENCES public.app_roles(role_code) DEFAULT 'sales',
  is_active BOOLEAN DEFAULT true, -- พนักงานลาออก → ปิดสิทธิ์เข้าสู่ระบบ
  pin_code VARCHAR(6), -- PIN 6 หลัก (nullable สำหรับแถวเก่า / ตั้งค่าทีหลัง)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.user_profiles IS
  'Phase 10 — ERP user profile + role binding to auth.users.';
COMMENT ON COLUMN public.user_profiles.is_active IS
  'false = disabled account (e.g. resigned) — block app access at Server Action gate.';
COMMENT ON COLUMN public.user_profiles.pin_code IS
  'Optional 6-digit PIN snapshot on profile; Auth password remains source of login truth.';

CREATE INDEX IF NOT EXISTS idx_user_profiles_role_code
  ON public.user_profiles (role_code);

CREATE INDEX IF NOT EXISTS idx_user_profiles_is_active
  ON public.user_profiles (is_active);

CREATE INDEX IF NOT EXISTS idx_user_profiles_email
  ON public.user_profiles (email);

-- ==========================================
-- 3. Data Seeding (Role ตั้งต้น + แผนกตาม Blueprint)
-- ==========================================
INSERT INTO public.app_roles (role_code, role_name_th, description) VALUES
  ('admin', 'ผู้บริหาร (Admin)', 'เข้าถึงทุกระบบ'),
  ('sales', 'พนักงานขาย (Sales)', 'เปิดบิล รับชำระเงิน'),
  ('warehouse', 'คลังสินค้า (Warehouse)', 'รับของ เบิกของ'),
  ('accountant', 'พนักงานบัญชี (Accountant)', 'จัดการภาษี หัก ณ ที่จ่าย และ GL'),
  ('screen_printer', 'ช่างสกรีน (Screen Printer)', 'อัปเดตสถานะงานสกรีนบนบอร์ด Kanban'),
  ('embroiderer', 'ช่างปัก (Embroidery)', 'อัปเดตสถานะงานปักบนบอร์ด Kanban'),
  ('seamstress', 'ช่างเย็บ (Seamstress)', 'อัปเดตสถานะงานเย็บบนบอร์ด Kanban')
ON CONFLICT (role_code) DO UPDATE
SET
  role_name_th = EXCLUDED.role_name_th,
  description = EXCLUDED.description;

-- ==========================================
-- 4. Helper: admin check (avoids RLS recursion on user_profiles)
-- ==========================================
CREATE OR REPLACE FUNCTION public.fn_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles
    WHERE id = auth.uid()
      AND role_code = 'admin'
      AND is_active = true
  );
$$;

COMMENT ON FUNCTION public.fn_is_admin() IS
  'Phase 10 — SECURITY DEFINER admin gate for RLS (no recursion on user_profiles).';

GRANT EXECUTE ON FUNCTION public.fn_is_admin() TO authenticated, service_role;

-- ==========================================
-- 5. Row Level Security (RLS)
-- ==========================================
ALTER TABLE public.app_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- Table-level grants (RLS still filters rows for authenticated)
GRANT SELECT ON public.app_roles TO authenticated;
GRANT SELECT, UPDATE, INSERT ON public.user_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_roles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_profiles TO service_role;

-- ------------------------------------------
-- RLS: app_roles
-- ------------------------------------------
DROP POLICY IF EXISTS "Allow authenticated to read roles" ON public.app_roles;
CREATE POLICY "Allow authenticated to read roles"
  ON public.app_roles
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Allow admins to manage roles" ON public.app_roles;
CREATE POLICY "Allow admins to manage roles"
  ON public.app_roles
  FOR ALL
  TO authenticated
  USING (public.fn_is_admin())
  WITH CHECK (public.fn_is_admin());

-- ------------------------------------------
-- RLS: user_profiles
-- ------------------------------------------
DROP POLICY IF EXISTS "Allow authenticated users to read profiles" ON public.user_profiles;
CREATE POLICY "Allow authenticated users to read profiles"
  ON public.user_profiles
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Allow admins to update profiles" ON public.user_profiles;
CREATE POLICY "Allow admins to update profiles"
  ON public.user_profiles
  FOR UPDATE
  TO authenticated
  USING (public.fn_is_admin())
  WITH CHECK (public.fn_is_admin());

-- Admin insert via Auth UI later (bootstrap first admin still uses service_role / SQL)
DROP POLICY IF EXISTS "Allow admins to insert profiles" ON public.user_profiles;
CREATE POLICY "Allow admins to insert profiles"
  ON public.user_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (public.fn_is_admin());
