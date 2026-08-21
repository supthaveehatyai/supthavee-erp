-- =============================================================================
-- Phase 14 — Align approval_logs to Cloud Maker-Checker schema
-- Cloud columns: document_id, expense_id, action, actor_id, comments, created_at
-- =============================================================================

-- Prefer additive compatibility: if legacy columns exist from earlier migration,
-- keep them nullable; ensure Cloud columns exist.

ALTER TABLE public.approval_logs
  ADD COLUMN IF NOT EXISTS document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS expense_id UUID REFERENCES public.expenses(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS action TEXT,
  ADD COLUMN IF NOT EXISTS actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS comments TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- Backfill action from legacy decision if present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'approval_logs'
      AND column_name = 'decision'
  ) THEN
    EXECUTE $sql$
      UPDATE public.approval_logs
      SET action = decision::text
      WHERE action IS NULL AND decision IS NOT NULL
    $sql$;
  END IF;
END $$;

-- Backfill actor_id from acted_by if present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'approval_logs'
      AND column_name = 'acted_by'
  ) THEN
    EXECUTE $sql$
      UPDATE public.approval_logs
      SET actor_id = acted_by
      WHERE actor_id IS NULL AND acted_by IS NOT NULL
    $sql$;
  END IF;
END $$;

-- Backfill comments from comment if present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'approval_logs'
      AND column_name = 'comment'
  ) THEN
    EXECUTE $sql$
      UPDATE public.approval_logs
      SET comments = comment
      WHERE comments IS NULL AND comment IS NOT NULL
    $sql$;
  END IF;
END $$;

-- Backfill FKs from target_id / target_type if present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'approval_logs'
      AND column_name = 'target_id'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'approval_logs'
      AND column_name = 'target_type'
  ) THEN
    EXECUTE $sql$
      UPDATE public.approval_logs
      SET document_id = target_id
      WHERE document_id IS NULL AND target_type::text = 'DOCUMENT'
    $sql$;
    EXECUTE $sql$
      UPDATE public.approval_logs
      SET expense_id = target_id
      WHERE expense_id IS NULL AND target_type::text = 'EXPENSE'
    $sql$;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_approval_logs_document_id
  ON public.approval_logs (document_id)
  WHERE document_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_approval_logs_expense_id
  ON public.approval_logs (expense_id)
  WHERE expense_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_approval_logs_created_at
  ON public.approval_logs (created_at DESC);

COMMENT ON TABLE public.approval_logs IS
  'Phase 14 Maker-Checker — document_id/expense_id, action, actor_id, comments';
