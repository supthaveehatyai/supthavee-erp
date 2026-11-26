"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/holding/workspace-access";
import { isSchemaUnavailable, schemaAdmin, schemaErrorMessage } from "@/lib/holding/schema-db";
import {
  VAULT_DOC_CATEGORIES,
  type CorporateDocumentListFilter,
  type CorporateDocumentRow,
  type HoldingActionResult,
  type VaultDocCategory,
  type WorkspaceKey,
} from "@/types/holding";

const WORKSPACES = new Set<WorkspaceKey>(["supthavee", "fnb", "agri", "prop", "holding"]);
const DOC_CATEGORIES = new Set<string>(VAULT_DOC_CATEGORIES);
const MAX_BYTES = 20 * 1024 * 1024;
const DOCUMENT_COLUMNS =
  "id, legal_entity_id, workspace_key, doc_category, title, doc_ref_no, issue_date, expiry_date, file_storage_path, file_mime_type, file_size_bytes, tags, notes, uploaded_by, is_archived, created_at, updated_at";

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

function docCategoryOf(value: unknown): VaultDocCategory | null {
  const text = String(value ?? "").trim();
  return DOC_CATEGORIES.has(text) ? (text as VaultDocCategory) : null;
}

function nullIfBlank(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text || text === "ไม่ระบุนิติบุคคล") return null;
  return text;
}

function asciiPrefix(value: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return cleaned.slice(0, 24) || "doc";
}

function fileExt(file: File): string | null {
  const fromName = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";
  if (file.type === "application/pdf" || fromName === "pdf") return "pdf";
  if (file.type === "image/webp" || fromName === "webp") return "webp";
  if (file.type === "image/png" || fromName === "png") return "png";
  if (file.type === "image/jpeg" || fromName === "jpg" || fromName === "jpeg") return "jpg";
  return null;
}

function tagsOf(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean).slice(0, 20);
  }
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean).slice(0, 20);
}

function mapDocument(row: Record<string, unknown>, entityName: string | null): CorporateDocumentRow | null {
  const id = String(row.id ?? "").trim();
  const fileStoragePath = String(row.file_storage_path ?? "").trim();
  const docCategory = docCategoryOf(row.doc_category);
  if (!id || !fileStoragePath || !docCategory) return null;
  const size = Number(row.file_size_bytes);
  return {
    id,
    legal_entity_id: row.legal_entity_id == null ? null : String(row.legal_entity_id),
    entity_name: entityName,
    workspace_key: workspaceOf(row.workspace_key),
    doc_category: docCategory,
    title: String(row.title ?? "").trim() || "เอกสารบริษัท",
    doc_ref_no: row.doc_ref_no == null ? null : String(row.doc_ref_no),
    issue_date: row.issue_date == null ? null : String(row.issue_date),
    expiry_date: row.expiry_date == null ? null : String(row.expiry_date),
    file_storage_path: fileStoragePath,
    file_mime_type: row.file_mime_type == null ? null : String(row.file_mime_type),
    file_size_bytes: Number.isFinite(size) ? size : null,
    tags: tagsOf(row.tags),
    notes: row.notes == null ? null : String(row.notes),
    uploaded_by: row.uploaded_by == null ? null : String(row.uploaded_by),
    is_archived: row.is_archived === true,
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

export async function listCorporateDocumentsAction(
  filter?: CorporateDocumentListFilter,
): Promise<HoldingActionResult<CorporateDocumentRow[]>> {
  try {
    await requireSuperAdmin();
    const admin = schemaAdmin();
    let query = admin
      .schema("holding")
      .from("corporate_documents")
      .select(DOCUMENT_COLUMNS)
      .eq("is_archived", false);
    const legalEntityId = nullIfBlank(filter?.legalEntityId);
    const docCategory = docCategoryOf(filter?.docCategory);
    if (legalEntityId) query = query.eq("legal_entity_id", legalEntityId);
    if (docCategory) query = query.eq("doc_category", docCategory);
    const listed = await query.order("created_at", { ascending: false }).limit(300);
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
      const legalEntityId = row.legal_entity_id == null ? null : String(row.legal_entity_id);
      const mapped = mapDocument(row, legalEntityId ? names.get(legalEntityId) ?? "ไม่ระบุนิติบุคคล" : null);
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
    const owner = await requireSuperAdmin();
    const file = formData.get("file");
    const docCategory = docCategoryOf(formData.get("doc_category"));
    const workspace = workspaceOf(formData.get("workspace_key"));
    const legalEntityId = nullIfBlank(formData.get("legal_entity_id"));
    if (!docCategory) return empty({ id: null }, "หมวดเอกสารไม่ถูกต้อง");
    if (!(file instanceof File) || file.size <= 0) return empty({ id: null }, "กรุณาเลือกไฟล์ PDF หรือรูปภาพ");
    if (file.size > MAX_BYTES) return empty({ id: null }, "ไฟล์ใหญ่เกิน 20MB");
    const ext = fileExt(file);
    if (!ext) return empty({ id: null }, "รองรับเฉพาะ PDF, JPG, PNG หรือ WebP");
    const title = nullIfBlank(formData.get("title")) ?? (file.name.trim() || "เอกสารบริษัท");

    const path = `vault/${asciiPrefix(String(formData.get("entity_code") ?? ""))}_${crypto.randomUUID()}.${ext}`;
    const admin = schemaAdmin();
    const bytes = Buffer.from(await file.arrayBuffer());
    const uploaded = await admin.storage.from("corporate_vault").upload(path, bytes, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    if (uploaded.error) return empty({ id: null }, uploaded.error.message ?? "อัปโหลดไม่สำเร็จ");

    const inserted = await admin.schema("holding").from("corporate_documents").insert({
      legal_entity_id: legalEntityId,
      workspace_key: workspace,
      doc_category: docCategory,
      title,
      doc_ref_no: nullIfBlank(formData.get("doc_ref_no")),
      issue_date: nullIfBlank(formData.get("issue_date")),
      expiry_date: nullIfBlank(formData.get("expiry_date")),
      file_storage_path: path,
      file_mime_type: file.type || "application/octet-stream",
      file_size_bytes: bytes.byteLength,
      tags: tagsOf(formData.get("tags")),
      notes: nullIfBlank(formData.get("notes")),
      uploaded_by: owner.userId,
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
      .select("file_storage_path")
      .eq("id", documentId)
      .maybeSingle();
    if (found.error) {
      return empty({ url: null }, schemaErrorMessage(found.error, "เปิดเอกสารไม่สำเร็จ"), !isSchemaUnavailable(found.error));
    }
    const storagePath = String((found.data as { file_storage_path?: string } | null)?.file_storage_path ?? "");
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
    const title = nullIfBlank(formData.get("title"));
    const docCategory = docCategoryOf(formData.get("doc_category"));
    if (!id || !title) return empty({ ok: false }, "กรุณาระบุชื่อเอกสาร");
    if (!docCategory) return empty({ ok: false }, "หมวดเอกสารไม่ถูกต้อง");
    const updated = await schemaAdmin()
      .schema("holding")
      .from("corporate_documents")
      .update({
        title,
        doc_category: docCategory,
        workspace_key: workspaceOf(formData.get("workspace_key")),
        legal_entity_id: nullIfBlank(formData.get("legal_entity_id")),
        doc_ref_no: nullIfBlank(formData.get("doc_ref_no")),
        issue_date: nullIfBlank(formData.get("issue_date")),
        expiry_date: nullIfBlank(formData.get("expiry_date")),
        notes: nullIfBlank(formData.get("notes")),
        tags: tagsOf(formData.get("tags")),
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
