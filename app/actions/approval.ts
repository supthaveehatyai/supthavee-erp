"use server";

/**
 * Phase 14 — Maker-Checker Approval Server Actions.
 * Zero Client-Side Fetching: Service Role (`supabaseAdmin`) only.
 * Types live in `@/types/approval`.
 */

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { logAuditTrail } from "@/lib/supabase/auditService";
import { createClient } from "@/lib/supabase/server-admin";
import type { Database } from "@/src/types/supabase";
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
  target_type: ApprovalTargetType;
  target_id: string;
  decision: ApprovalDecision;
  comment: string | null;
  previous_status: ApprovalStatus | null;
  new_status: ApprovalStatus;
  acted_by: string | null;
  acted_at: string;
};

async function insertApprovalLog(
  payload: ApprovalLogInsert,
): Promise<{ error: string | null }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return { error: "Missing Supabase service role configuration" };
  }

  const { createClient: createUntypedClient } = await import(
    "@supabase/supabase-js"
  );
  const client = createUntypedClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { error } = await client.from("approval_logs").insert(payload);
  return { error: error?.message ?? null };
}

function emptyResult(error: string): GetPendingApprovalsResult {
  return { success: false, data: EMPTY_PAYLOAD, error };
}

function toMoney(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
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
  };
}

function revalidateApprovalCaches() {
  revalidatePath(APPROVALS_PATH);
  revalidatePath(APPROVALS_PATH, "layout");
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
    const expenses = expenseRows.map((row) =>
      mapExpenseRow(row, profileMap),
    );

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

/**
 * อนุมัติหรือปฏิเสธรายการ — บันทึก approval_logs
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
    const newStatus: ApprovalStatus =
      action === "APPROVED" ? "APPROVED" : "REJECTED";
    const actorId = gate.admin.userId;

    let previousStatus: ApprovalStatus | null = null;
    let documentNo = trimmedId;

    if (type === "DOCUMENT") {
      const { data: existing, error: lookupError } = await supabaseAdmin
        .from("documents")
        .select("id, doc_no, approval_status")
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

      previousStatus = existing.approval_status;
      documentNo = existing.doc_no;

      const { error: updateError } = await supabaseAdmin
        .from("documents")
        .update({
          approval_status: newStatus,
          approved_by: actorId,
          approved_at: nowIso,
        })
        .eq("id", trimmedId);

      if (updateError) {
        return { success: false, error: updateError.message };
      }
    } else if (type === "EXPENSE") {
      const { data: existing, error: lookupError } = await supabaseAdmin
        .from("expenses")
        .select("id, document_no, approval_status")
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

      previousStatus = existing.approval_status;
      documentNo = existing.document_no;

      const { error: updateError } = await supabaseAdmin
        .from("expenses")
        .update({
          approval_status: newStatus,
          approved_by: actorId,
          approved_at: nowIso,
        })
        .eq("id", trimmedId);

      if (updateError) {
        return { success: false, error: updateError.message };
      }
    } else {
      return { success: false, error: "ประเภทเป้าหมายไม่ถูกต้อง" };
    }

    const logInsert = {
      target_type: type,
      target_id: trimmedId,
      decision: action,
      comment: trimmedComment || null,
      previous_status: previousStatus,
      new_status: newStatus,
      acted_by: actorId,
      acted_at: nowIso,
    };

    const { error: logError } = await insertApprovalLog(logInsert);

    if (logError) {
      const rollbackPayload = {
        approval_status: "PENDING" as ApprovalStatus,
        approved_by: null,
        approved_at: null,
      };
      if (type === "DOCUMENT") {
        await supabaseAdmin
          .from("documents")
          .update(rollbackPayload)
          .eq("id", trimmedId);
      } else {
        await supabaseAdmin
          .from("expenses")
          .update(rollbackPayload)
          .eq("id", trimmedId);
      }
      return {
        success: false,
        error: `บันทึกประวัติการอนุมัติไม่สำเร็จ: ${logError}`,
      };
    }

    await logAuditTrail(
      type === "DOCUMENT" ? "documents" : "expenses",
      trimmedId,
      "UPDATE",
      { approval_status: previousStatus },
      {
        approval_status: newStatus,
        approved_by: actorId,
        approved_at: nowIso,
        approval_decision: action,
        approval_comment: trimmedComment || null,
      },
    );

    revalidateApprovalCaches();

    return { success: true };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ไม่สามารถดำเนินการอนุมัติได้";
    return { success: false, error: message };
  }
}
