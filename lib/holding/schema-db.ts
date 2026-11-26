import { createClient } from "@/lib/supabase/server-admin";

export const SCHEMA_SETUP_MESSAGE =
  "ยังเปิดสคีมา holding, fnb, prop หรือ agri ใน Supabase Data API ไม่ครบ (PGRST106) เพิ่มสคีมาในหน้า API settings แล้วรีโหลดหน้านี้";

type QueryError = { code?: string; message?: string } | null;

type FilterBuilder = Promise<{ data: unknown; error: QueryError }> & {
  eq: (column: string, value: string | boolean | number | null) => FilterBuilder;
  gte: (column: string, value: string | number) => FilterBuilder;
  lte: (column: string, value: string | number) => FilterBuilder;
  order: (column: string, options?: { ascending?: boolean }) => FilterBuilder;
  limit: (count: number) => FilterBuilder;
  maybeSingle: () => Promise<{ data: unknown; error: QueryError }>;
};

export type SchemaTable = {
  select: (columns: string) => FilterBuilder;
  insert: (row: Record<string, unknown> | Record<string, unknown>[]) => Promise<{
    data: unknown;
    error: QueryError;
  }>;
  update: (values: Record<string, unknown>) => FilterBuilder;
  delete: () => FilterBuilder;
};

export type SchemaAdmin = {
  schema: (name: "holding" | "fnb" | "prop" | "agri") => {
    from: (table: string) => SchemaTable;
  };
  from: (table: string) => SchemaTable;
  storage: {
    from: (bucket: string) => {
      upload: (
        path: string,
        body: Buffer,
        options: { contentType: string; upsert: boolean },
      ) => Promise<{ error: { message?: string } | null }>;
      remove: (paths: string[]) => Promise<{ error: { message?: string } | null }>;
      createSignedUrl: (
        path: string,
        expiresIn: number,
        options?: { download?: string | boolean },
      ) => Promise<{ data: { signedUrl: string } | null; error: { message?: string } | null }>;
      getPublicUrl: (path: string) => { data: { publicUrl: string } };
    };
  };
};

export function schemaAdmin(): SchemaAdmin {
  return createClient() as unknown as SchemaAdmin;
}

export function isSchemaUnavailable(error: QueryError): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  const message = String(error.message ?? "");
  return code === "PGRST106" || /PGRST106|invalid schema|schema must be one of/i.test(message);
}

export function schemaErrorMessage(error: QueryError, fallback: string): string {
  if (isSchemaUnavailable(error)) return SCHEMA_SETUP_MESSAGE;
  return error?.message || fallback;
}
