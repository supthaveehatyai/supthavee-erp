-- =============================================================================
-- Phase 10 — Dynamic RBAC + System Settings (Single Source of Truth)
-- File: 20260805034000_dynamic_rbac_and_settings.sql
-- =============================================================================
-- 1) app_roles master + user_profiles.role_code FK (ไม่ใช้ ENUM)
-- 2) system_settings: company profile + GL constants
-- Access pattern: Server Actions + service_role (Zero Client-Side Fetching)
-- Idempotent: safe on DBs that already applied partial Phase 10 migrations
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
  'Phase 10 — Dynamic RBAC role master (role_code TEXT PK, not ENUM).';

-- ==========================================
-- 2. user_profiles (ผูก auth.users + role_code FK)
-- ==========================================
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role_code TEXT NOT NULL REFERENCES public.app_roles(role_code) DEFAULT 'sales',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.user_profiles IS
  'Phase 10 — ERP user profile; role via FK app_roles.role_code (dynamic RBAC).';
COMMENT ON COLUMN public.user_profiles.role_code IS
  'FK to app_roles — replace hard-coded ENUM / JWT metadata role checks.';
COMMENT ON COLUMN public.user_profiles.is_active IS
  'false = disabled account (e.g. resigned) — block app access at Server Action gate.';

-- กรณีเคยมีคอลัมน์ role แบบ ENUM / TEXT เก่า → ย้ายมาเป็น role_code FK
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_profiles'
      AND column_name = 'role'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_profiles'
      AND column_name = 'role_code'
  ) THEN
    ALTER TABLE public.user_profiles RENAME COLUMN role TO role_code;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_profiles'
      AND column_name = 'role_code'
  ) THEN
    -- ensure TEXT (drop ENUM cast if any)
    ALTER TABLE public.user_profiles
      ALTER COLUMN role_code TYPE TEXT
      USING role_code::text;

    ALTER TABLE public.user_profiles
      ALTER COLUMN role_code SET DEFAULT 'sales';

    ALTER TABLE public.user_profiles
      ALTER COLUMN role_code SET NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_profiles_role_code_fkey'
  ) THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_role_code_fkey
      FOREIGN KEY (role_code) REFERENCES public.app_roles(role_code);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_profiles_role_code
  ON public.user_profiles (role_code);

CREATE INDEX IF NOT EXISTS idx_user_profiles_is_active
  ON public.user_profiles (is_active);

CREATE INDEX IF NOT EXISTS idx_user_profiles_email
  ON public.user_profiles (email);

-- ==========================================
-- 3. Seed 7 roles (ตำแหน่งตั้งต้น)
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
-- 4. Admin helper (กัน RLS recursion)
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
-- 5. RLS: app_roles / user_profiles
-- ==========================================
ALTER TABLE public.app_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.app_roles TO authenticated;
GRANT SELECT, UPDATE, INSERT ON public.user_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_roles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_profiles TO service_role;

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

DROP POLICY IF EXISTS "Allow admins to insert profiles" ON public.user_profiles;
CREATE POLICY "Allow admins to insert profiles"
  ON public.user_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (public.fn_is_admin());

-- ==========================================
-- 6. system_settings (Company + GL constants)
-- ==========================================
CREATE TABLE IF NOT EXISTS public.system_settings (
  setting_key VARCHAR(50) PRIMARY KEY,
  setting_value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.system_settings IS
  'Phase 10 — System-wide settings (company profile, GL codes). Service Role via Server Actions.';

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.system_settings TO service_role;

-- Company profile (Single Source of Truth สำหรับเอกสารพิมพ์ / TFRS templates)
INSERT INTO public.system_settings (setting_key, setting_value, description)
VALUES
  (
    'COMPANY_NAME',
    'บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด',
    'ชื่อบริษัทภาษาไทย (แสดงบนเอกสาร)'
  ),
  (
    'COMPANY_NAME_EN',
    'Supthavee Hat Yai Co., Ltd.',
    'ชื่อบริษัทภาษาอังกฤษ'
  ),
  (
    'COMPANY_ADDRESS',
    '',
    'ที่อยู่บริษัทบนเอกสารพิมพ์'
  ),
  (
    'COMPANY_TAX_ID',
    '',
    'เลขประจำตัวผู้เสียภาษี'
  ),
  (
    'COMPANY_PHONE',
    '',
    'เบอร์โทรศัพท์บริษัท'
  ),
  (
    'COMPANY_EMAIL',
    '',
    'อีเมลบริษัท'
  ),
  (
    'COMPANY_LOGO_URL',
    '',
    'URL โลโก้บริษัท (Supabase Storage)'
  ),
  (
    'GL_ROUNDING_EXPENSE_ACC',
    '5100-99',
    'รหัสบัญชีค่าใช้จ่ายเบ็ดเตล็ด (ปัดเศษสตางค์)'
  ),
  (
    'GL_ROUNDING_INCOME_ACC',
    '4100-99',
    'รหัสบัญชีรายได้เบ็ดเตล็ด (ปัดเศษสตางค์)'
  )
ON CONFLICT (setting_key) DO NOTHING;
