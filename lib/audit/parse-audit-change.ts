/**
 * Audit Trail JSONB change parser (shared, non-server-action).
 * Safe to import from Server Actions and (if needed) Client Components.
 */

import type { Json } from "@/src/types/supabase";

export type AuditActionLike = "INSERT" | "UPDATE" | "DELETE" | string;

/** Strongly-typed JSONB object payload from audit_logs.old_data / new_data */
export type AuditJsonRecord = Record<string, Json | undefined>;

/** Parsed plain object used for diff comparison (post-normalization) */
type AuditDiffRecord = Record<string, unknown>;

/** Friendly Thai names for audited tables */
export const AUDIT_TABLE_LABELS: Record<string, string> = {
  documents: "เอกสาร",
  document_items: "รายการเอกสาร",
  inventory_ledger: "สต็อกสินค้า",
  expenses: "ค่าใช้จ่าย",
  expense_items: "รายการค่าใช้จ่าย",
  fixed_assets: "สินทรัพย์ถาวร",
  production_jobs: "ใบสั่งผลิต",
  contacts: "ลูกค้า / คู่ค้า",
  contact_persons: "ผู้ติดต่อ",
  products: "สินค้า",
  product_models: "รุ่นสินค้า",
  payments: "การชำระเงิน",
  payment_allocations: "จัดสรรชำระเงิน",
  deposit_allocations: "จัดสรรเงินมัดจำ",
  billing_notes: "ใบวางบิล",
  billing_note_items: "รายการใบวางบิล",
  user_profiles: "โปรไฟล์ผู้ใช้งาน",
  audit_logs: "บันทึกตรวจสอบ",
  system_backup: "สำรองข้อมูลระบบ",
  system: "ระบบ (System)",
};

/** Critical fields shown first in UPDATE summaries */
const CRITICAL_FIELDS = [
  "status",
  "approval_status",
  "payment_status",
  "is_voided",
  "grand_total",
  "total_amount",
  "net_amount",
  "net_before_vat",
  "paid_amount",
  "wht_rate",
  "qty",
  "quantity",
  "signed_qty",
  "doc_no",
  "document_no",
  "job_no",
  "job_type",
  "due_date",
  "doc_type",
  "asset_code",
  "asset_name",
  "role_code",
  "data_access_scope",
  "approval_limit",
] as const;

const FIELD_LABELS: Record<string, string> = {
  status: "สถานะ",
  approval_status: "สถานะอนุมัติ",
  payment_status: "สถานะชำระเงิน",
  is_voided: "ยกเลิกเอกสาร",
  grand_total: "ยอดสุทธิ",
  total_amount: "ยอดรวม",
  net_amount: "ยอดก่อนภาษี",
  net_before_vat: "ยอดก่อน VAT",
  paid_amount: "ยอดชำระแล้ว",
  wht_rate: "อัตราภาษีหัก ณ ที่จ่าย",
  qty: "จำนวน",
  quantity: "จำนวน",
  signed_qty: "จำนวน (±)",
  doc_no: "เลขที่เอกสาร",
  document_no: "เลขที่เอกสาร",
  job_no: "เลขที่งานผลิต",
  job_type: "ประเภทงาน",
  due_date: "วันครบกำหนด",
  doc_type: "ประเภทเอกสาร",
  asset_code: "รหัสสินทรัพย์",
  asset_name: "ชื่อสินทรัพย์",
  role_code: "สิทธิ์ (Role)",
  data_access_scope: "Data Access Scope",
  approval_limit: "Approval Limit",
  details: "รายละเอียด",
  notes: "หมายเหตุ",
  company_name: "ชื่อบริษัท",
  sku: "SKU",
  name: "ชื่อ",
};

const SKIP_KEYS = new Set([
  "id",
  "created_at",
  "updated_at",
  "changed_at",
  "correlation_id",
  "audit_event",
  "pin_code",
]);

const EMPTY_STRING_TOKENS = new Set(["", "—", "-", "null", "undefined"]);

function formatAuditEventLabel(event: unknown): string | null {
  if (typeof event !== "string" || !event.trim()) return null;
  const token = event.trim().toUpperCase();
  const labels: Record<string, string> = {
    ISSUE: "ยืนยันเอกสาร (ISSUE)",
    VOID: "ยกเลิกเอกสาร (VOID)",
    UPDATE: "แก้ไขเอกสาร (UPDATE)",
    DELETE: "ลบเอกสาร (DELETE)",
    COMPLETE: "ปิดจบเอกสาร (COMPLETE)",
    CREATE: "สร้างเอกสาร (CREATE)",
    CONVERT: "แปลงเอกสาร (CONVERT)",
    DUPLICATE: "คัดลอกเอกสาร (DUPLICATE)",
    CLONE: "โคลนเป็นร่างใหม่ (CLONE)",
    DISPOSE: "จำหน่ายสินทรัพย์ (DISPOSE)",
  };
  return labels[token] ?? token;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toRecord(data: Json | null | undefined): AuditDiffRecord | null {
  if (data == null) return null;
  if (typeof data === "string") {
    try {
      const parsed: unknown = JSON.parse(data);
      return isPlainObject(parsed) ? (parsed as AuditDiffRecord) : null;
    } catch {
      return null;
    }
  }
  return isPlainObject(data) ? (data as AuditDiffRecord) : null;
}

function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "ใช่" : "ไม่ใช่";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return String(value);
    if (Math.abs(value) >= 100 || !Number.isInteger(value)) {
      return value.toLocaleString("th-TH", {
        maximumFractionDigits: 2,
      });
    }
    return String(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (EMPTY_STRING_TOKENS.has(trimmed.toLowerCase()) || trimmed === "") {
      return "—";
    }
    return trimmed.length > 48 ? `${trimmed.slice(0, 48)}…` : trimmed;
  }
  if (Array.isArray(value)) {
    return `[${value.length} รายการ]`;
  }
  if (isPlainObject(value)) {
    return "{…}";
  }
  return String(value);
}

function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key;
}

/**
 * Normalize values before diff comparison to suppress false positives
 * (e.g. null vs "", "-" vs "—", "100" vs 100).
 */
function normalizeForCompare(value: unknown): unknown {
  if (value === null || value === undefined) return null;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (
      trimmed === "" ||
      trimmed === "—" ||
      trimmed === "-" ||
      trimmed.toLowerCase() === "null" ||
      trimmed.toLowerCase() === "undefined"
    ) {
      return null;
    }
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      const num = Number(trimmed);
      if (Number.isFinite(num)) return num;
    }
    return trimmed;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : value;
  }

  if (typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    return value.map((item) => normalizeForCompare(item));
  }

  if (isPlainObject(value)) {
    const normalized: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      normalized[key] = normalizeForCompare(nested);
    }
    return normalized;
  }

  return value;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  const left = normalizeForCompare(a);
  const right = normalizeForCompare(b);

  if (Object.is(left, right)) return true;

  if (left === null && right === null) return true;

  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function formatChangePart(key: string, from: unknown, to: unknown): string {
  const label = fieldLabel(key);
  return `เปลี่ยน${label} จาก '${formatAuditValue(from)}' เป็น '${formatAuditValue(to)}'`;
}

function summarizeFixedAssetInsert(newRec: AuditDiffRecord): string | null {
  const assetCode = String(newRec.asset_code ?? "").trim();
  const assetName = String(newRec.asset_name ?? "").trim();
  if (!assetCode && !assetName) return null;

  const codePart = assetCode ? `[${assetCode}]` : "[—]";
  const namePart = assetName || "—";
  return `ขึ้นทะเบียนสินทรัพย์ใหม่: ${codePart} ${namePart}`;
}

export function getAuditTableLabel(tableName: string): string {
  const key = tableName.trim();
  return AUDIT_TABLE_LABELS[key] ?? key;
}

/**
 * Parse old_data / new_data JSONB into a concise human-readable summary.
 * Prefer critical fields (status, totals, qty) when the diff is large.
 */
export function parseAuditChangeSummary(
  action: AuditActionLike,
  oldData: Json | null,
  newData: Json | null,
  maxChanges = 4,
  tableName?: string,
): string {
  const oldRec = toRecord(oldData);
  const newRec = toRecord(newData);
  const normalized = String(action).toUpperCase();
  const table = String(tableName ?? "").trim();

  if (normalized === "INSERT") {
    if (!newRec) return "สร้างรายการใหม่";

    if (table === "fixed_assets") {
      const fixedAssetSummary = summarizeFixedAssetInsert(newRec);
      if (fixedAssetSummary) {
        const eventLabel = formatAuditEventLabel(newRec.audit_event);
        return eventLabel
          ? `${eventLabel} · ${fixedAssetSummary}`
          : fixedAssetSummary;
      }
    }

    // Phase 9 — Manual Backup audit payload
    if (
      newRec.action === "MANUAL_BACKUP_TRIGGERED" ||
      newRec.event === "MANUAL_BACKUP_TRIGGERED"
    ) {
      const status =
        typeof newRec.status === "string" ? newRec.status : "unknown";
      if (status === "failed" || status === "FAILED") {
        const errMsg =
          typeof newRec.error === "string"
            ? formatAuditValue(newRec.error)
            : "—";
        return `Manual Backup ล้มเหลว · ${errMsg}`;
      }
      return "Manual Backup สำเร็จ (Database + Storage)";
    }

    const eventLabel = formatAuditEventLabel(newRec.audit_event);
    const highlights: string[] = [];
    for (const key of CRITICAL_FIELDS) {
      if (newRec[key] === undefined || newRec[key] === null) continue;
      highlights.push(
        `${fieldLabel(key)} = '${formatAuditValue(newRec[key])}'`,
      );
      if (highlights.length >= 3) break;
    }
    const body =
      highlights.length > 0
        ? `สร้างรายการใหม่ · ${highlights.join(", ")}`
        : "สร้างรายการใหม่";
    return eventLabel ? `${eventLabel} · ${body}` : body;
  }

  if (normalized === "DELETE") {
    if (!oldRec) return "ลบรายการ";
    const highlights: string[] = [];
    for (const key of CRITICAL_FIELDS) {
      if (oldRec[key] === undefined || oldRec[key] === null) continue;
      highlights.push(
        `${fieldLabel(key)} = '${formatAuditValue(oldRec[key])}'`,
      );
      if (highlights.length >= 3) break;
    }
    return highlights.length > 0
      ? `ลบรายการ · ${highlights.join(", ")}`
      : "ลบรายการ";
  }

  // UPDATE
  if (!oldRec && !newRec) return "อัปเดตข้อมูล";
  if (!oldRec && newRec) {
    return parseAuditChangeSummary(
      "INSERT",
      null,
      newData,
      maxChanges,
      tableName,
    );
  }
  if (oldRec && !newRec) {
    return parseAuditChangeSummary(
      "DELETE",
      oldData,
      null,
      maxChanges,
      tableName,
    );
  }

  const left = oldRec ?? {};
  const right = newRec ?? {};
  const allKeys = new Set([...Object.keys(left), ...Object.keys(right)]);

  type Diff = { key: string; from: unknown; to: unknown; critical: boolean };
  const diffs: Diff[] = [];

  for (const key of allKeys) {
    if (SKIP_KEYS.has(key)) continue;
    const from = left[key];
    const to = right[key];
    if (valuesEqual(from, to)) continue;
    diffs.push({
      key,
      from,
      to,
      critical: (CRITICAL_FIELDS as readonly string[]).includes(key),
    });
  }

  if (diffs.length === 0) return "อัปเดตข้อมูล (ไม่พบฟิลด์ที่เปลี่ยน)";

  diffs.sort((a, b) => {
    if (a.critical !== b.critical) return a.critical ? -1 : 1;
    const ai = (CRITICAL_FIELDS as readonly string[]).indexOf(a.key);
    const bi = (CRITICAL_FIELDS as readonly string[]).indexOf(b.key);
    const aOrder = ai === -1 ? 999 : ai;
    const bOrder = bi === -1 ? 999 : bi;
    return aOrder - bOrder;
  });

  const shown = diffs.slice(0, maxChanges);
  const parts = shown.map((d) => formatChangePart(d.key, d.from, d.to));

  const remaining = diffs.length - shown.length;
  if (remaining > 0) {
    parts.push(`และแก้ไขข้อมูลอื่นๆ อีก ${remaining} รายการ`);
  }

  const eventLabel = formatAuditEventLabel(
    right.audit_event ?? left.audit_event,
  );
  const body = parts.join(" · ");
  return eventLabel ? `${eventLabel} · ${body}` : body;
}
