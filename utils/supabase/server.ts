import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase-server";

/**
 * Server Supabase client for Server Actions.
 * Re-exports Service Role admin client — required for `generate_document_no`
 * (EXECUTE granted to service_role only) and Zero Client-Side Fetching.
 */
export function createClient(): SupabaseClient {
  return createSupabaseServerClient();
}
