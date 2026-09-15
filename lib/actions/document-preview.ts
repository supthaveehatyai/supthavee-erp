"use server";

/**
 * Approval Center — document preview (read-only).
 * Zero Client-Side Fetching: Service Role via createSupabaseServerClient.
 */

import { requireAdmin } from "@/lib/auth/require-admin";
import {
  INVENTORY_DOC_TYPES,
  PURCHASE_DOC_TYPES,
} from "@/lib/constants/document";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { roundMoney } from "@/lib/utils/payment-fifo";
import type { GetDocumentPreviewResult } from "@/types/document-preview";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ContactJoin = {
  company_name?: string | null;
};

type InvoiceDocJoin = {
  doc_no?: string | null;
  doc_type?: string | null;
};

function toMoney(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function unwrapOne<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function resolveDocumentDetailHref(docNo: string, docType: string): string {
  const encoded = encodeURIComponent(docNo);
  if ((INVENTORY_DOC_TYPES as readonly string[]).includes(docType)) {
    return "/inventory/adjustments";
  }
  if ((PURCHASE_DOC_TYPES as readonly string[]).includes(docType)) {
    return `/purchases/${encoded}`;
  }
  return `/sales/${encoded}`;
}

export async function getDocumentPreview(
  documentId: string,
): Promise<GetDocumentPreviewResult> {
  try {
    const id = documentId?.trim() ?? "";
    if (!id || !UUID_RE.test(id)) {
      return { data: null, error: "รหัสเอกสารไม่ถูกต้อง" };
    }

    const gate = await requireAdmin({
      forbiddenMessage:
        "Forbidden: เฉพาะ Admin เท่านั้นที่เข้าถึง Approval Center ได้",
    });
    if (!gate.ok) {
      return { data: null, error: gate.error };
    }

    const supabaseAdmin = createSupabaseServerClient();

    const { data: header, error: headerError } = await supabaseAdmin
      .from("documents")
      .select(
        `
        id,
        doc_no,
        doc_type,
        doc_date,
        status,
        approval_status,
        grand_total,
        remark,
        notes,
        attachment_url,
        attached_file_url,
        contacts!documents_contact_id_fkey (
          company_name
        )
      `,
      )
      .eq("id", id)
      .maybeSingle();

    if (headerError) {
      return { data: null, error: headerError.message };
    }
    if (!header) {
      return { data: null, error: "ไม่พบเอกสารที่ระบุ" };
    }

    const [itemsResult, allocResult] = await Promise.all([
      supabaseAdmin
        .from("document_items")
        .select("id, description, qty, unit_price, line_total")
        .eq("document_id", id)
        .order("sort_order", { ascending: true }),
      supabaseAdmin
        .from("document_allocations")
        .select(
          `
          id,
          allocated_amount,
          adjustment_reason,
          documents!document_allocations_invoice_doc_id_fkey (
            doc_no,
            doc_type
          )
        `,
        )
        .eq("receipt_doc_id", id)
        .order("created_at", { ascending: true }),
    ]);

    if (itemsResult.error) {
      return { data: null, error: itemsResult.error.message };
    }
    if (allocResult.error) {
      return { data: null, error: allocResult.error.message };
    }

    const contact = unwrapOne(header.contacts as ContactJoin | ContactJoin[] | null);
    const docNo = String(header.doc_no ?? "");
    const docType = String(header.doc_type ?? "");

    return {
      data: {
        id: String(header.id),
        doc_no: docNo,
        doc_type: docType,
        doc_date: String(header.doc_date ?? ""),
        status: String(header.status ?? ""),
        approval_status: String(header.approval_status ?? ""),
        grand_total: roundMoney(toMoney(header.grand_total)),
        remark: header.remark ? String(header.remark) : null,
        notes: header.notes ? String(header.notes) : null,
        contact_name: contact?.company_name?.trim() || null,
        detail_href: resolveDocumentDetailHref(docNo, docType),
        attachment_url: header.attachment_url
          ? String(header.attachment_url)
          : null,
        attached_file_url: header.attached_file_url
          ? String(header.attached_file_url)
          : null,
        items: (itemsResult.data ?? []).map((row) => ({
          id: String(row.id),
          description: row.description ? String(row.description) : null,
          qty: toMoney(row.qty),
          unit_price: roundMoney(toMoney(row.unit_price)),
          line_total: roundMoney(toMoney(row.line_total)),
        })),
        allocations: (allocResult.data ?? []).map((row) => {
          const invoice = unwrapOne(
            row.documents as InvoiceDocJoin | InvoiceDocJoin[] | null,
          );
          return {
            id: String(row.id),
            target_doc_no: String(invoice?.doc_no ?? "—"),
            target_doc_type: String(invoice?.doc_type ?? ""),
            allocated_amount: roundMoney(toMoney(row.allocated_amount)),
            adjustment_reason: row.adjustment_reason
              ? String(row.adjustment_reason)
              : null,
          };
        }),
      },
      error: null,
    };
  } catch (err) {
    return {
      data: null,
      error:
        err instanceof Error ? err.message : "โหลดรายละเอียดเอกสารไม่สำเร็จ",
    };
  }
}
