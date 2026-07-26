-- =============================================================================
-- Root-cause fix: "permission denied for table mst_brands" (and friends)
-- =============================================================================
-- This is NOT an RLS problem. BYPASSRLS on service_role only skips row-level
-- security POLICIES — it does nothing for missing table-level GRANTs. The base
-- schema migration (20260720083500_...) only ever ran:
--   GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;
-- and later ad-hoc migrations (20260722013000 / 20260722023000 / 20260722114442)
-- patched service_role onto exactly 4 tables (contacts, product_models,
-- products, vendor_product_mapping) as those flows were built and hit this
-- same error one table at a time. mst_brands, mst_categories, mst_genders,
-- mst_colors, mst_sizes (and every other public table) were never covered, so
-- ANY Server Action — no matter how correctly it uses the service-role JWT —
-- gets "permission denied for table X" from Postgres's base ACL check, which
-- runs BEFORE RLS is even evaluated.
--
-- Fix: grant service_role full CRUD on every existing table in `public`, and
-- set default privileges so every table created from now on is automatically
-- covered too — this class of bug cannot recur.
-- =============================================================================

GRANT USAGE ON SCHEMA public TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO service_role;
