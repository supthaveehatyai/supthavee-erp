"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/holding/workspace-access";
import { isSchemaUnavailable, schemaAdmin, schemaErrorMessage } from "@/lib/holding/schema-db";
import {
  VAULT_CATEGORIES,
  VAULT_CATEGORY_SLUG,
  type CorporateDocumentRow,
  type HoldingActionResult,
  type VaultCategory,
  type WorkspaceKey,
} from "@/types/holding";

const WORKSPACES = new Set<WorkspaceKey>(["supthavee", "fnb", "agri", "prop", "holding"]);
const MAX_BYTES = 20 * 1024 * 1024;

function rethrowNavigation(error: unknown): void {
  const digest = error && typeof error === "object" && "digest" in error
    ? String((error as { digest?: unknown }).digest ?? "")
    : "";
  if (digest.includes("NEXT_REDIRECT") || digest.includes("NEXT_HTTP_ERROR_FALLBACK")) throw error;
}

function empty<T>(data: T, error: string | null = null, schemaReady = true): HoldingActionResult<T> {
  return { data, error, schemaReady };
}

function asRows(data: unknown): Record<string, unknown>[] {
  return Array.isArray(data)
    ? data.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    : [];
}

function workspaceOf(value: unknown): WorkspaceKey {
  const key = String(value ?? "holding");
  return WORKSPACES.has(key as WorkspaceKey) ? (key as WorkspaceKey) : "holding";
}

function asciiToken(value: string, fallback: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return cleaned.slice(0, 40) || fallback;
}

function fileExt(file: File): string | null {
  if (file.type === "application/pdf") return "pdf";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/png") return "png";
  if (file.type === "image/jpeg") return "jpg";
  return null;
}

function mapDocument(row: Record<string, unknown>, entityName: string | null): CorporateDocumentRow | null {
  const id = String(row.id ?? "").trim();
  const storagePath = String(row.storage_path ?? "").trim();
  if (!id || !storagePath) return null;
  return {
    id,
    entity_id: row.entity_id == null ? null : String(row.entity_id),
    entity_name: entityName,
    workspace_key: workspaceOf(row.workspace_key),
    category: String(row.category ?? "อื่นๆ"),
    title: String(row.title ?? "").trim() || "เอกสารบริษัท",
    storage_path: storagePath,
    mime_type: row.mime_type == null ? null : String(row.mime_type),
    issue_date: row.issue_date == null ? null : String(row.issue_date),
    expiry_date: row.expiry_date == null ? null : String(row.expiry_date),
    notes: row.notes == null ? null : String(row.notes),
    is_archived: row.is_archived === true,
    created_at: String(row.created_at ?? ""),
  };
}

export async function listCorporateDocumentsAction(): Promise<HoldingActionResult<CorporateDocumentRow[]>> {
  try {
    await requireSuperAdmin();
    const admin = schemaAdmin();
    const listed = await admin
      .schema("holding")
      .from("corporate_documents")
      .select("id, entity_id, workspace_key, category, title, storage_path, mime_type, issue_date, expiry_date, notes, is_archived, created_at")
      .eq("is_archived", false)
      .order("created_at", { ascending: false })
      .limit(300);
    if (listed.error) {
      return empty([], schemaErrorMessage(listed.error, "อ่านคลังเอกสารไม่สำเร็จ"), !isSchemaUnavailable(listed.error));
    }
    const entities = await admin
      .schema("holding")
      .from("legal_entities")
      .select("id, legal_name")
      .limit(100);
    const names = new Map<string, string>();
    if (!entities.error) {
      for (const row of asRows(entities.data)) {
        names.set(String(row.id), String(row.legal_name ?? ""));
      }
    }
    const docs = asRows(listed.data).flatMap((row) => {
      const mapped = mapDocument(row, row.entity_id == null ? null : names.get(String(row.entity_id)) ?? null);
      return mapped ? [mapped] : [];
    });
    return empty(docs);
  } catch (error) {
    rethrowNavigation(error);
    return empty([], error instanceof Error ? error.message : "อ่านคลังเอกสารไม่สำเร็จ", false);
  }
}

export async function uploadCorporateDocumentAction(
  formData: FormData,
): Promise<HoldingActionResult<{ id: string | null }>> {
  try {
    await requireSuperAdmin();
    const title = String(formData.get("title") ?? "").trim();
    const category = String(formData.get("category") ?? "").trim();
    const workspace = workspaceOf(formData.get("workspace_key"));
    const entityId = String(formData.get("entity_id") ?? "").trim();
    const entityCode = asciiToken(String(formData.get("entity_code") ?? ""), "entity");
    const file = formData.get("file");
    if (!title) return empty({ id: null }, "กรุณาระบุชื่อเอกสาร");
    if (!VAULT_CATEGORIES.includes(category as VaultCategory)) {
      return empty({ id: null }, "หมวดเอกสารไม่ถูกต้อง");
    }
    if (!(file instanceof File) || file.size <= 0) return empty({ id: null }, "กรุณาเลือกไฟล์ PDF หรือรูปภาพ");
    if (file.size > MAX_BYTES) return empty({ id: null }, "ไฟล์ใหญ่เกิน 20MB");
    const ext = fileExt(file);
    if (!ext) return empty({ id: null }, "รองรับเฉพาะ PDF, JPG, PNG หรือ WebP");

    const slug = VAULT_CATEGORY_SLUG[category as VaultCategory];
    const path = `vault/${entityCode}/${slug}_${crypto.randomUUID()}.${ext}`;
    const admin = schemaAdmin();
    const uploaded = await admin.storage.from("corporate_vault").upload(path, Buffer.from(await file.arrayBuffer()), {
      contentType: file.type,
      upsert: false,
    });
    if (uploaded.error) return empty({ id: null }, uploaded.error.message ?? "อัปโหลดไม่สำเร็จ");

    const inserted = await admin.schema("holding").from("corporate_documents").insert({
      entity_id: entityId || null,
      workspace_key: workspace,
      category,
      title,
      storage_path: path,
      mime_type: file.type,
      issue_date: String(formData.get("issue_date") ?? "").trim() || null,
      expiry_date: String(formData.get("expiry_date") ?? "").trim() || null,
      notes: String(formData.get("notes") ?? "").trim() || null,
      is_archived: false,
    });
    if (inserted.error) {
      await admin.storage.from("corporate_vault").remove([path]);
      return empty({ id: null }, schemaErrorMessage(inserted.error, "บันทึกคลังเอกสารไม่สำเร็จ"), !isSchemaUnavailable(inserted.error));
    }
    revalidatePath("/holding/vault");
    return empty({ id: null });
  } catch (error) {
    rethrowNavigation(error);
    return empty({ id: null }, error instanceof Error ? error.message : "อัปโหลดไม่สำเร็จ", false);
  }
}

export async function getCorporateDocumentSignedUrlAction(
  documentId: string,
): Promise<HoldingActionResult<{ url: string | null }>> {
  try {
    await requireSuperAdmin();
    const admin = schemaAdmin();
    const found = await admin
      .schema("holding")
      .from("corporate_documents")
      .select("storage_path")
      .eq("id", documentId)
      .maybeSingle();
    if (found.error) {
      return empty({ url: null }, schemaErrorMessage(found.error, "เปิดเอกสารไม่สำเร็จ"), !isSchemaUnavailable(found.error));
    }
    const storagePath = String((found.data as { storage_path?: string } | null)?.storage_path ?? "");
    if (!storagePath) return empty({ url: null }, "ไม่พบไฟล์เอกสาร");
    const signed = await admin.storage.from("corporate_vault").createSignedUrl(storagePath, 3600);
    if (signed.error || !signed.data?.signedUrl) {
      return empty({ url: null }, signed.error?.message ?? "สร้างลิงก์ชั่วคราวไม่สำเร็จ");
    }
    return empty({ url: signed.data.signedUrl });
  } catch (error) {
    rethrowNavigation(error);
    return empty({ url: null }, error instanceof Error ? error.message : "เปิดเอกสารไม่สำเร็จ", false);
  }
}

export async function archiveCorporateDocumentAction(
  documentId: string,
): Promise<HoldingActionResult<{ ok: boolean }>> {
  try {
    await requireSuperAdmin();
    const updated = await schemaAdmin()
      .schema("holding")
      .from("corporate_documents")
      .update({ is_archived: true })
      .eq("id", documentId);
    if (updated.error) {
      return empty({ ok: false }, schemaErrorMessage(updated.error, "เก็บเอกสารเข้าแฟ้มไม่สำเร็จ"), !isSchemaUnavailable(updated.error));
    }
    revalidatePath("/holding/vault");
    return empty({ ok: true });
  } catch (error) {
    rethrowNavigation(error);
    return empty({ ok: false }, error instanceof Error ? error.message : "เก็บเอกสารเข้าแฟ้มไม่สำเร็จ", false);
  }
}

export async function updateCorporateDocumentMetaAction(
  formData: FormData,
): Promise<HoldingActionResult<{ ok: boolean }>> {
  try {
    await requireSuperAdmin();
    const id = String(formData.get("id") ?? "").trim();
    const title = String(formData.get("title") ?? "").trim();
    const category = String(formData.get("category") ?? "").trim();
    if (!id || !title) return empty({ ok: false }, "กรุณาระบุชื่อเอกสาร");
    if (!VAULT_CATEGORIES.includes(category as VaultCategory)) return empty({ ok: false }, "หมวดเอกสารไม่ถูกต้อง");
    const updated = await schemaAdmin()
      .schema("holding")
      .from("corporate_documents")
      .update({
        title,
        category,
        workspace_key: workspaceOf(formData.get("workspace_key")),
        issue_date: String(formData.get("issue_date") ?? "").trim() || null,
        expiry_date: String(formData.get("expiry_date") ?? "").trim() || null,
        notes: String(formData.get("notes") ?? "").trim() || null,
      })
      .eq("id", id);
    if (updated.error) {
      return empty({ ok: false }, schemaErrorMessage(updated.error, "แก้ไขเอกสารไม่สำเร็จ"), !isSchemaUnavailable(updated.error));
    }
    revalidatePath("/holding/vault");
    return empty({ ok: true });
  } catch (error) {
    rethrowNavigation(error);
    return empty({ ok: false }, error instanceof Error ? error.message : "แก้ไขเอกสารไม่สำเร็จ", false);
  }
}
