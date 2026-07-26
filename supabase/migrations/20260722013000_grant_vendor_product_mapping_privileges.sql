-- Ensure service_role (and authenticated) can write vendor_product_mapping.
-- "permission denied for table" (42501) is a GRANT issue, not an RLS policy miss.
-- service_role still bypasses RLS; it still needs table privileges.

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.vendor_product_mapping
  TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.vendor_product_mapping
  TO authenticated;

GRANT SELECT ON TABLE public.vendor_product_mapping
  TO anon;
