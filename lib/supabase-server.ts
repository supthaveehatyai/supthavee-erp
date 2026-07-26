import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase admin client — Service Role Key only.
 *
 * SECURITY: this used to silently fall back to `NEXT_PUBLIC_SUPABASE_ANON_KEY`
 * whenever `SUPABASE_SERVICE_ROLE_KEY` was falsy. That fallback is exactly
 * why `app/products/actions/product-matrix.ts`'s `listLoadableProductModels()`
 * (which joins `product_models` with `mst_brands`/`mst_categories`) kept
 * throwing "permission denied" even after every other Server Action was
 * fixed — it silently downgraded to the anon role instead of failing loudly.
 * Never falls back to anon / SSR cookie clients — same convention as
 * `lib/actions/master.ts` / `product.ts` / `receipt.ts` / `mapping.ts`.
 */
export function createSupabaseServerClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY (หรือ NEXT_PUBLIC_SUPABASE_URL) — ตั้งค่าใน .env.development แล้วรีสตาร์ท next dev",
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
