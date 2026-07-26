-- Table privileges for mapping flow (service_role bypasses RLS but still needs GRANTs).
-- Fixes: permission denied for table contacts / product_models / products / vendor_product_mapping

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.contacts TO service_role;
GRANT SELECT ON TABLE public.contacts TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.product_models TO service_role;
GRANT SELECT ON TABLE public.product_models TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.products TO service_role;
GRANT SELECT ON TABLE public.products TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.vendor_product_mapping TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.vendor_product_mapping TO authenticated;
GRANT SELECT ON TABLE public.vendor_product_mapping TO anon;
