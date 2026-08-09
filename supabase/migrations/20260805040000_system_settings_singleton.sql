-- =============================================================================
-- Phase 10 — system_settings Singleton (id = 1 always)
-- File: 20260805040000_system_settings_singleton.sql
-- =============================================================================
-- Migrates key-value system_settings → single-row company profile (SSOT).
-- Access: Service Role via Server Actions (Zero Client-Side Fetching).
-- =============================================================================

-- 1) Rename legacy KV table (if still key-value shape)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'system_settings'
      AND column_name = 'setting_key'
  ) THEN
    ALTER TABLE public.system_settings RENAME TO system_settings_kv_legacy;
  END IF;
END $$;

-- 2) Singleton company settings
CREATE TABLE IF NOT EXISTS public.system_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  company_name TEXT NOT NULL DEFAULT '',
  company_name_en TEXT NOT NULL DEFAULT '',
  tax_id TEXT NOT NULL DEFAULT '',
  branch_code TEXT NOT NULL DEFAULT '00000',
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  logo_url TEXT NOT NULL DEFAULT '',
  vat_rate NUMERIC(5, 2) NOT NULL DEFAULT 7.00,
  gl_rounding_expense_acc TEXT NOT NULL DEFAULT '5100-99',
  gl_rounding_income_acc TEXT NOT NULL DEFAULT '4100-99',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.system_settings IS
  'Phase 10 — Company / system SSOT. Singleton row locked to id = 1.';
COMMENT ON COLUMN public.system_settings.id IS
  'Always 1 — enforced by CHECK (id = 1).';
COMMENT ON COLUMN public.system_settings.vat_rate IS
  'Standard VAT rate (%) used as document default (e.g. 7.00).';

-- 3) Seed from legacy KV when present, else default company row
DO $$
DECLARE
  v_company_name TEXT := 'บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด';
  v_company_name_en TEXT := 'Supthavee Hat Yai Co., Ltd.';
  v_tax_id TEXT := '';
  v_address TEXT := '';
  v_phone TEXT := '';
  v_email TEXT := '';
  v_logo_url TEXT := '';
  v_gl_exp TEXT := '5100-99';
  v_gl_inc TEXT := '4100-99';
BEGIN
  IF to_regclass('public.system_settings_kv_legacy') IS NOT NULL THEN
    SELECT setting_value INTO v_company_name
    FROM public.system_settings_kv_legacy
    WHERE setting_key = 'COMPANY_NAME'
    LIMIT 1;

    SELECT setting_value INTO v_company_name_en
    FROM public.system_settings_kv_legacy
    WHERE setting_key = 'COMPANY_NAME_EN'
    LIMIT 1;

    SELECT setting_value INTO v_tax_id
    FROM public.system_settings_kv_legacy
    WHERE setting_key = 'COMPANY_TAX_ID'
    LIMIT 1;

    SELECT setting_value INTO v_address
    FROM public.system_settings_kv_legacy
    WHERE setting_key = 'COMPANY_ADDRESS'
    LIMIT 1;

    SELECT setting_value INTO v_phone
    FROM public.system_settings_kv_legacy
    WHERE setting_key = 'COMPANY_PHONE'
    LIMIT 1;

    SELECT setting_value INTO v_email
    FROM public.system_settings_kv_legacy
    WHERE setting_key = 'COMPANY_EMAIL'
    LIMIT 1;

    SELECT setting_value INTO v_logo_url
    FROM public.system_settings_kv_legacy
    WHERE setting_key = 'COMPANY_LOGO_URL'
    LIMIT 1;

    SELECT setting_value INTO v_gl_exp
    FROM public.system_settings_kv_legacy
    WHERE setting_key = 'GL_ROUNDING_EXPENSE_ACC'
    LIMIT 1;

    SELECT setting_value INTO v_gl_inc
    FROM public.system_settings_kv_legacy
    WHERE setting_key = 'GL_ROUNDING_INCOME_ACC'
    LIMIT 1;
  END IF;

  INSERT INTO public.system_settings (
    id,
    company_name,
    company_name_en,
    tax_id,
    branch_code,
    address,
    phone,
    email,
    logo_url,
    vat_rate,
    gl_rounding_expense_acc,
    gl_rounding_income_acc
  )
  VALUES (
    1,
    COALESCE(NULLIF(TRIM(v_company_name), ''), 'บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด'),
    COALESCE(NULLIF(TRIM(v_company_name_en), ''), 'Supthavee Hat Yai Co., Ltd.'),
    COALESCE(v_tax_id, ''),
    '00000',
    COALESCE(v_address, ''),
    COALESCE(v_phone, ''),
    COALESCE(v_email, ''),
    COALESCE(v_logo_url, ''),
    7.00,
    COALESCE(NULLIF(TRIM(v_gl_exp), ''), '5100-99'),
    COALESCE(NULLIF(TRIM(v_gl_inc), ''), '4100-99')
  )
  ON CONFLICT (id) DO NOTHING;
END $$;

-- 4) Drop legacy KV
DROP TABLE IF EXISTS public.system_settings_kv_legacy;

-- 5) RLS + grants (Default Deny for client; service_role for Server Actions)
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.system_settings FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.system_settings TO service_role;
