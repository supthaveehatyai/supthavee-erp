-- ==========================================
-- Migration: system_settings + Rounding GL accounts (Phase 7 future-proof)
-- ==========================================
-- Stores system constants for future General Ledger (GAAP/TFRS) postings.
-- Access: Service Role via Server Actions (Zero Client-Side Fetching).
-- ==========================================

CREATE TABLE IF NOT EXISTS public.system_settings (
  setting_key VARCHAR(50) PRIMARY KEY,
  setting_value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.system_settings IS
  'System-wide constants (GL account codes, feature flags). Service Role only.';

-- รหัสบัญชีตั้งต้นสำหรับส่วนต่างปัดเศษสตางค์ (ตัวอย่างผังบัญชี)
INSERT INTO public.system_settings (setting_key, setting_value, description)
VALUES
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

-- Default Deny for client roles; service_role bypasses via grants
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.system_settings TO service_role;
