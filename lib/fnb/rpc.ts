import "server-only";

import { createClient } from "@/lib/supabase/server-admin";

type RpcError = { message?: string; code?: string } | null;

type FnbRpcClient = {
  schema: (name: "fnb") => {
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: RpcError }>;
  };
};

export async function callFnbRpc(
  fn: string,
  args: Record<string, unknown>,
): Promise<{ data: unknown; error: RpcError }> {
  const client = createClient() as unknown as FnbRpcClient;
  return client.schema("fnb").rpc(fn, args);
}
