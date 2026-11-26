import { isSchemaUnavailable, SCHEMA_SETUP_MESSAGE, schemaErrorMessage } from "@/lib/holding/schema-db";
import type { FnbActionResult } from "@/types/fnb";

export function asRows(data: unknown): Record<string, unknown>[] {
  return Array.isArray(data) ? data.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object") : [];
}

export function text(value: unknown): string {
  return String(value ?? "").trim();
}

export function num(value: unknown): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

export function todayBangkok(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
}

export function result<T>(data: T, error: string | null = null, schemaReady = true): FnbActionResult<T> {
  return { data, error, schemaReady };
}

export function fail<T>(data: T, error: { message?: string; code?: string } | null, fallback: string): FnbActionResult<T> {
  return result(data, schemaErrorMessage(error, fallback), !isSchemaUnavailable(error));
}

export function caught<T>(data: T, error: unknown, fallback: string): FnbActionResult<T> {
  if (error instanceof Error && (error.message.includes("NEXT_REDIRECT") || error.message.includes("NEXT_HTTP_ERROR_FALLBACK"))) {
    throw error;
  }
  const digest = typeof error === "object" && error && "digest" in error ? String((error as { digest?: string }).digest ?? "") : "";
  if (digest.includes("NEXT_REDIRECT") || digest.includes("NEXT_HTTP_ERROR_FALLBACK")) throw error;
  return result(data, error instanceof Error ? error.message : fallback, false);
}

export function setupMessage(): string {
  return SCHEMA_SETUP_MESSAGE;
}
