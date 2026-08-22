"use server";

/**
 * Phase 14 — Maker-Checker Approval Server Actions.
 * Zero Client-Side Fetching: Service Role (`supabaseAdmin`) only.
 * Types live in `@/types/approval`.
 *
 * Cloud `approval_logs` columns (source of truth from generated types):
 * document_id | expense_id | action | actor_id | comments | created_at
 */

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { insertAuditLog } from "@/lib/supabase/auditService";
import { createClient } from "@/lib/supabase/server-admin";
import { generateDocumentNumber } from "@/lib/actions/document-actions";
import {
  PURCHASE_DOC_TYPES,
  INVENTORY_DOC_TYPES,
  resolveIssuedDocumentStatus,
} from "@/lib/constants/document";
import { isTemporaryDraftDocNo } from "@/lib/utils/draft-document-no";
import { settleExpenseCashPurchase } from "@/lib/actions/finance/expense-cash-settlement";
import type { Database } from "@/src/types/supabase";
import type { DocumentType } from "@/types/document";
import type {
  ApprovalDecision,
  ApprovalTargetType,
  GetPendingApprovalsResult,
  PendingApprovalItem,
  PendingApprovalsPayload,
  ProcessApprovalResult,
} from "@/types/approval";

const APPROVALS_PATH = "/approvals";

type ApprovalStatus = Database["public"]["Enums"]["approval_status"];

const EMPTY_PAYLOAD: PendingApprovalsPayload = {
  documents: [],
  expenses: [],
};

type ApprovalLogInsert = {
  document_id?: string | null;
  expense_id?: string | null;
  action: ApprovalDecision;
  actor_id: string;
  comments: string | null;
};

function emptyResult(error: string): GetPendingApprovalsResult {
  return { success: false, data: EMPTY_PAYLOAD, error };
}

function toMoney(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function resolveDocumentDetailHref(
  docNo: string,
  docType: string | null,
): string {
  const encoded = encodeURIComponent(docNo);
  if (
    docType &&
    (INVENTORY_DOC_TYPES as readonly string[]).includes(docType)
  ) {
    return "/inventory/adjustments";
  }
  if (
    docType &&
    (PURCHASE_DOC_TYPES as readonly string[]).includes(docType)
  ) {
    return `/purchases/${encoded}`;
  }
  return `/sales/${encoded}`;
}

async function insertApprovalLog(
  payload: ApprovalLogInsert,
): Promise<{ error: string | null }> {
  try {
    const supabaseAdmin = createClient();
    const { error } = await supabaseAdmin.from("approval_logs").insert(payload);
    return { error: error?.message ?? null };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "บันทึก approval_logs ไม่สำเร็จ",
    };
  }
}

async function resolveUserDisplay(
  userIds: string[],
): Promise<Map<string, { name: string | null; email: string | null }>> {
  const map = new Map<string, { name: string | null; email: string | null }>();
  if (userIds.length === 0) return map;

  const supabaseAdmin = createClient();
  const { data: profiles } = await supabaseAdmin
    .from("user_profiles")
    .select("id, full_name, email")
    .in("id", userIds);

  for (const profile of profiles ?? []) {
    map.set(profile.id, {
      name: profile.full_name?.trim() || null,
      email: profile.email?.trim() || null,
    });
  }

  return map;
}

async function resolveDocumentCreators(
  documentIds: string[],
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (documentIds.length === 0) return map;

  const supabaseAdmin = createClient();
  const { data: rows } = await supabaseAdmin
    .from("audit_logs")
    .select("record_id, changed_by")
    .eq("table_name", "documents")
    .eq("action", "INSERT")
    .in("record_id", documentIds);

  for (const row of rows ?? []) {
    if (!map.has(row.record_id) && row.changed_by) {
      map.set(row.record_id, row.changed_by);
    }
  }

  return map;
}

function mapDocumentRow(
  row: {
    id: string;
    doc_no: string;
    doc_date: string;
    doc_type: string;
    grand_total: number | null;
  },
  creatorUserId: string | null,
  profileMap: Map<string, { name: string | null; email: string | null }>,
): PendingApprovalItem {
  const profile = creatorUserId ? profileMap.get(creatorUserId) : undefined;
  return {
    id: row.id,
    target_type: "DOCUMENT",
    document_no: row.doc_no,
    doc_date: row.doc_date,
    doc_type: row.doc_type,
    grand_total: toMoney(row.grand_total),
    created_by_name: profile?.name ?? null,
    created_by_email: profile?.email ?? null,
    detail_href: resolveDocumentDetailHref(row.doc_no, row.doc_type),
  };
}

function mapExpenseRow(
  row: {
    id: string;
    document_no: string;
    expense_date: string;
    grand_total: number | null;
    recorded_by: string | null;
  },
  profileMap: Map<string, { name: string | null; email: string | null }>,
): PendingApprovalItem {
  const profile = row.recorded_by
    ? profileMap.get(row.recorded_by)
    : undefined;
  return {
    id: row.id,
    target_type: "EXPENSE",
    document_no: row.document_no,
    doc_date: row.expense_date,
    doc_type: "EXPENSE",
    grand_total: toMoney(row.grand_total),
    created_by_name: profile?.name ?? null,
    created_by_email: profile?.email ?? null,
    detail_href: `/expenses/${row.id}`,
  };
}

function revalidateApprovalCaches(paths: string[] = []) {
  revalidatePath(APPROVALS_PATH);
  revalidatePath(APPROVALS_PATH, "layout");
  for (const path of paths) {
    revalidatePath(path);
  }
}

/**
 * ดึงรายการ documents / expenses ที่รออนุมัติ (approval_status = PENDING)
 */
export async function getPendingApprovals(): Promise<GetPendingApprovalsResult> {
  try {
    const gate = await requireAdmin({
      forbiddenMessage:
        "Forbidden: เฉพาะ Admin เท่านั้นที่เข้าถึง Approval Center ได้",
    });
    if (!gate.ok) {
      return emptyResult(gate.error);
    }

    const supabaseAdmin = createClient();

    const [documentsResult, expensesResult] = await Promise.all([
      supabaseAdmin
        .from("documents")
        .select("id, doc_no, doc_date, doc_type, grand_total")
        .eq("approval_status", "PENDING")
        .order("doc_date", { ascending: false }),
      supabaseAdmin
        .from("expenses")
        .select("id, document_no, expense_date, grand_total, recorded_by")
        .eq("approval_status", "PENDING")
        .order("expense_date", { ascending: false }),
    ]);

    if (documentsResult.error) {
      return emptyResult(documentsResult.error.message);
    }
    if (expensesResult.error) {
      return emptyResult(expensesResult.error.message);
    }

    const documentRows = documentsResult.data ?? [];
    const expenseRows = expensesResult.data ?? [];

    const creatorByDocId = await resolveDocumentCreators(
      documentRows.map((row) => row.id),
    );

    const userIds = [
      ...new Set([
        ...expenseRows
          .map((row) => row.recorded_by)
          .filter((id): id is string => Boolean(id)),
        ...[...creatorByDocId.values()].filter((id): id is string =>
          Boolean(id),
        ),
      ]),
    ];

    const profileMap = await resolveUserDisplay(userIds);

    const documents = documentRows.map((row) =>
      mapDocumentRow(row, creatorByDocId.get(row.id) ?? null, profileMap),
    );
    const expenses = expenseRows.map((row) => mapExpenseRow(row, profileMap));

    return {
      success: true,
      data: { documents, expenses },
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ไม่สามารถดึงรายการรออนุมัติได้";
    return emptyResult(message);
  }
}

async function postInventoryAdjustmentLedger(
  documentId: string,
  docNo: string,
  docType: string,
  remark: string | null,
): Promise<{ error: string | null }> {
  const supabaseAdmin = createClient();
  const { data: items, error: itemsError } = await supabaseAdmin
    .from("document_items")
    .select("product_id, qty, unit_cost_price")
    .eq("document_id", documentId);

  if (itemsError) {
    return { error: itemsError.message };
  }

  const lines = (items ?? []).filter((row) => Boolean(row.product_id));
  if (lines.length === 0) {
    return { error: null };
  }

  const ledgerPayload = lines.map((line) => {
    const qty = Number(line.qty ?? 0);
    const absQty = Math.abs(Math.trunc(qty));
    const unitCost = Number(line.unit_cost_price ?? 0);
    const isOb = docType === "STK_OB";
    const transType = isOb || qty > 0 ? "IN" : "OUT";
    return {
      product_id: line.product_id as string,
      doc_header_id: null as string | null,
      trans_type: transType,
      qty: absQty,
      notes: isOb
        ? `${docType} ${docNo} | document_id=${documentId} | unit_cost=${unitCost.toFixed(4)}${remark ? ` | ${remark}` : ""}`
        : `${docType} ${docNo} | document_id=${documentId} | adj=${qty > 0 ? "+" : "-"}${absQty}${remark ? ` | ${remark}` : ""}`,
    };
  });

  const { error: ledgerError } = await supabaseAdmin
    .from("inventory_ledger")
    .insert(ledgerPayload);

  return { error: ledgerError?.message ?? null };
}

/**
 * อนุมัติหรือปฏิเสธรายการ — บันทึก approval_logs + audit_logs
 * APPROVED → approval_status APPROVED + status ISSUED/COMPLETED + Late Numbering
 * REJECTED → approval_status REJECTED (คง DRAFT)
 */
export async function processApproval(
  targetId: string,
  type: ApprovalTargetType,
  action: ApprovalDecision,
  comment?: string | null,
): Promise<ProcessApprovalResult> {
  try {
    const gate = await requireAdmin({
      forbiddenMessage: "Forbidden: เฉพาะ Admin เท่านั้นที่อนุมัติ/ปฏิเสธได้",
    });
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }

    const trimmedId = targetId.trim();
    if (!trimmedId) {
      return { success: false, error: "ไม่พบรหัสเอกสารเป้าหมาย" };
    }

    if (action !== "APPROVED" && action !== "REJECTED") {
      return { success: false, error: "การดำเนินการไม่ถูกต้อง" };
    }

    const trimmedComment = comment?.trim() ?? "";
    if (action === "REJECTED" && !trimmedComment) {
      return {
        success: false,
        error: "กรุณาระบุเหตุผลเมื่อปฏิเสธเอกสาร",
      };
    }

    const supabaseAdmin = createClient();
    const nowIso = new Date().toISOString();
    const newApprovalStatus: ApprovalStatus =
      action === "APPROVED" ? "APPROVED" : "REJECTED";
    const actorId = gate.admin.userId;
    if (!actorId) {
      return { success: false, error: "ไม่พบผู้ใช้งานที่กำลังอนุมัติ" };
    }

    let previousApproval: ApprovalStatus | null = null;
    let previousStatus: string | null = null;
    let documentNo = trimmedId;
    let revalidateExtra: string[] = [];

    if (type === "DOCUMENT") {
      const { data: existing, error: lookupError } = await supabaseAdmin
        .from("documents")
        .select(
          "id, doc_no, doc_type, doc_date, status, approval_status, notes, paid_amount, grand_total, payment_status",
        )
        .eq("id", trimmedId)
        .maybeSingle();

      if (lookupError) {
        return { success: false, error: lookupError.message };
      }
      if (!existing) {
        return { success: false, error: "ไม่พบเอกสารที่ระบุ" };
      }
      if (existing.approval_status !== "PENDING") {
        return {
          success: false,
          error: "เอกสารนี้ไม่อยู่ในสถานะรออนุมัติแล้ว",
        };
      }

      previousApproval = existing.approval_status;
      previousStatus = existing.status;
      documentNo = existing.doc_no;
      const docType = existing.doc_type as DocumentType;

      if (action === "APPROVED") {
        let officialDocNo = String(existing.doc_no ?? "");
        const issueDate = nowIso.slice(0, 10);
        const issuedStatus = resolveIssuedDocumentStatus(docType);

        if (isTemporaryDraftDocNo(officialDocNo)) {
          const numberResult = await generateDocumentNumber(
            docType,
            existing.doc_date ?? issueDate,
          );
          if (numberResult.error || !numberResult.data) {
            return {
              success: false,
              error:
                numberResult.error ??
                "สร้างเลขที่เอกสารทางการไม่สำเร็จ — ยังไม่อนุมัติ",
            };
          }
          officialDocNo = numberResult.data;
        }

        const updatePayload = {
          approval_status: "APPROVED" as const,
          approved_by: actorId,
          approved_at: nowIso,
          status: issuedStatus,
          updated_at: nowIso,
          doc_no: officialDocNo,
          ...(isTemporaryDraftDocNo(String(existing.doc_no ?? ""))
            ? { doc_date: existing.doc_date ?? issueDate }
            : {}),
        };

        const { error: updateError } = await supabaseAdmin
          .from("documents")
          .update(updatePayload)
          .eq("id", trimmedId)
          .eq("approval_status", "PENDING");

        if (updateError) {
          return { success: false, error: updateError.message };
        }

        documentNo = officialDocNo;

        if (
          (INVENTORY_DOC_TYPES as readonly string[]).includes(docType) &&
          String(existing.status) === "DRAFT"
        ) {
          const ledgerResult = await postInventoryAdjustmentLedger(
            trimmedId,
            officialDocNo,
            docType,
            existing.notes ?? null,
          );
          if (ledgerResult.error) {
            await supabaseAdmin
              .from("documents")
              .update({
                approval_status: "PENDING",
                approved_by: null,
                approved_at: null,
                status: "DRAFT",
                doc_no: existing.doc_no,
                updated_at: nowIso,
              })
              .eq("id", trimmedId);
            return {
              success: false,
              error: `ตัดสต็อกไม่สำเร็จ: ${ledgerResult.error}`,
            };
          }
          revalidateExtra.push("/inventory/adjustments", "/inventory/ledger");
        }

        revalidateExtra.push(
          resolveDocumentDetailHref(officialDocNo, docType),
        );
      } else {
        const { error: updateError } = await supabaseAdmin
          .from("documents")
          .update({
            approval_status: "REJECTED",
            approved_by: actorId,
            approved_at: nowIso,
            updated_at: nowIso,
          })
          .eq("id", trimmedId)
          .eq("approval_status", "PENDING");

        if (updateError) {
          return { success: false, error: updateError.message };
        }
      }
    } else if (type === "EXPENSE") {
      const { data: existing, error: lookupError } = await supabaseAdmin
        .from("expenses")
        .select(
          "id, document_no, expense_date, approval_status, status, grand_total",
        )
        .eq("id", trimmedId)
        .maybeSingle();

      if (lookupError) {
        return { success: false, error: lookupError.message };
      }
      if (!existing) {
        return { success: false, error: "ไม่พบรายการค่าใช้จ่ายที่ระบุ" };
      }
      if (existing.approval_status !== "PENDING") {
        return {
          success: false,
          error: "รายการค่าใช้จ่ายนี้ไม่อยู่ในสถานะรออนุมัติแล้ว",
        };
      }

      previousApproval = existing.approval_status;
      previousStatus = String(existing.status);
      documentNo = existing.document_no;

      if (action === "APPROVED") {
        let officialNo = String(existing.document_no ?? "");
        const expenseDate = String(existing.expense_date ?? "").slice(0, 10);

        if (isTemporaryDraftDocNo(officialNo)) {
          const { data: generated, error: rpcError } = await supabaseAdmin.rpc(
            "generate_expense_no",
            { p_expense_date: expenseDate },
          );
          if (rpcError) {
            return {
              success: false,
              error:
                rpcError.message ||
                "สร้างเลขที่เอกสาร EXP ไม่สำเร็จ — ตรวจว่า migration generate_expense_no รันแล้ว",
            };
          }
          if (!generated || typeof generated !== "string") {
            return {
              success: false,
              error: "RPC generate_expense_no ไม่คืนเลขที่เอกสาร",
            };
          }
          officialNo = generated;
        }

        const { error: updateError } = await supabaseAdmin
          .from("expenses")
          .update({
            document_no: officialNo,
            status: "ISSUED",
            approval_status: "APPROVED",
            approved_by: actorId,
            approved_at: nowIso,
            updated_at: nowIso,
          })
          .eq("id", trimmedId)
          .eq("approval_status", "PENDING");

        if (updateError) {
          return { success: false, error: updateError.message };
        }

        const settlement = await settleExpenseCashPurchase(
          supabaseAdmin,
          trimmedId,
        );
        if (!settlement.success) {
          return {
            success: false,
            error:
              settlement.error ??
              "อนุมัติแล้ว แต่บันทึกการจ่ายซื้อสดไม่สำเร็จ",
          };
        }

        documentNo = officialNo;
        revalidateExtra.push(`/expenses/${trimmedId}`, "/expenses");
        if (!settlement.skipped) {
          revalidateExtra.push("/finance", "/finance/ap-payment", "/purchases");
        }
      } else {
        const { error: updateError } = await supabaseAdmin
          .from("expenses")
          .update({
            approval_status: "REJECTED",
            approved_by: actorId,
            approved_at: nowIso,
            status: "DRAFT",
            updated_at: nowIso,
          })
          .eq("id", trimmedId)
          .eq("approval_status", "PENDING");

        if (updateError) {
          return { success: false, error: updateError.message };
        }
        revalidateExtra.push(`/expenses/${trimmedId}`, "/expenses");
      }
    } else {
      return { success: false, error: "ประเภทเป้าหมายไม่ถูกต้อง" };
    }

    const logInsert: ApprovalLogInsert = {
      document_id: type === "DOCUMENT" ? trimmedId : null,
      expense_id: type === "EXPENSE" ? trimmedId : null,
      action,
      actor_id: actorId,
      comments: trimmedComment || null,
    };

    const { error: logError } = await insertApprovalLog(logInsert);

    if (logError) {
      // Best-effort rollback of approval fields only (avoid typed status mismatch)
      if (type === "DOCUMENT") {
        await supabaseAdmin
          .from("documents")
          .update({
            approval_status: "PENDING",
            approved_by: null,
            approved_at: null,
          })
          .eq("id", trimmedId);
      } else {
        await supabaseAdmin
          .from("expenses")
          .update({
            approval_status: "PENDING",
            approved_by: null,
            approved_at: null,
          })
          .eq("id", trimmedId);
      }
      return {
        success: false,
        error: `บันทึกประวัติการอนุมัติไม่สำเร็จ: ${logError}`,
      };
    }

    const auditComment =
      trimmedComment ||
      (action === "APPROVED" ? "อนุมัติเอกสาร" : "ปฏิเสธเอกสาร");

    await insertAuditLog({
      tableName: type === "DOCUMENT" ? "documents" : "expenses",
      recordId: trimmedId,
      action: "UPDATE",
      oldData: {
        approval_status: previousApproval,
        status: previousStatus,
        document_no: documentNo,
      },
      newData: {
        approval_status: newApprovalStatus,
        status:
          action === "APPROVED"
            ? type === "EXPENSE"
              ? "ISSUED"
              : previousStatus === "DRAFT"
                ? "ISSUED"
                : previousStatus
            : type === "EXPENSE"
              ? "DRAFT"
              : previousStatus,
        approved_by: actorId,
        approved_at: nowIso,
        approval_decision: action,
        comment: auditComment,
        approval_comment: auditComment,
        document_no: documentNo,
      },
    });

    revalidateApprovalCaches(revalidateExtra);

    return { success: true };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ไม่สามารถดำเนินการอนุมัติได้";
    return { success: false, error: message };
  }
}
