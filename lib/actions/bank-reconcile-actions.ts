"use server";

import { revalidatePath } from "next/cache";
import {
  cleanGeminiModelId,
  generateGeminiContent,
  GeminiQuotaExhaustedError,
  resolveGeminiApiKey,
} from "@/lib/ai/gemini-client";
import {
  modelsAtQuota,
  parseModelCascadeOrder,
  recordOcrQuota,
} from "@/lib/ai/ocr-quota";
import { requireSessionUserId } from "@/lib/auth/current-user";
import {
  ktbStatementOcrPrompt,
  linesFromOcrJson,
  parseKtbSpreadsheet,
} from "@/lib/sales/ktb-statement-parse";
import { parseJsonObject } from "@/lib/sales/sales-ocr-parse";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import type {
  BankMatchAllocationInput,
  BankStatementLineView,
  MatchedStatementDocument,
  BillMatchSuggestion,
  ConfirmBankMatchInput,
  ConfirmBankMatchResult,
  ConfirmWithdrawalInput,
  ImportKtbStatementResult,
  ListBankLinesResult,
  AutoMatchUniqueResult,
  OpenSalesBill,
  ReclassifyPaymentChannelInput,
  SearchOpenBillsInput,
  SearchOpenBillsResult,
  SuggestBillMatchesResult,
} from "@/types/bank-reconcile";
import type { ParsedKtbLine } from "@/types/bank-reconcile";

const SALES_DOC_TYPES = [
  "DEP_IN",
  "ABB",
  "CS_TAX",
  "INV_DO",
  "TAX_INV",
  "SO",
  "REC",
] as const;
const OPEN_DOC_STATUSES = ["ISSUED", "COMPLETED", "PAID"] as const;
const MAX_BYTES = 4_500_000;
const MONEY_EPSILON = 0.05;

type Db = ReturnType<typeof createSupabaseServerClient>;

function roundMoney(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function sameMoney(left: number, right: number): boolean {
  return Math.abs(left - right) <= MONEY_EPSILON;
}

function shiftIso(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, (month || 1) - 1, (day || 1) + days));
  return date.toISOString().slice(0, 10);
}

function withinDays(left: string, right: string, days: number): boolean {
  const a = Date.parse(`${left.slice(0, 10)}T12:00:00Z`);
  const b = Date.parse(`${right.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= days * 86_400_000;
}

function isMissingColumn(message: string): string | null {
  return /Could not find the '([^']+)' column/i.exec(message)?.[1] ?? null;
}

function isSchemaMiss(message: string): boolean {
  return /Could not find the table|PGRST205|schema cache|does not exist/i.test(message);
}

function isMissingFunction(message: string): boolean {
  return /Could not find the function|PGRST202/i.test(message);
}

function parseMatchedDocuments(value: unknown): MatchedStatementDocument[] {
  let raw: unknown = value;
  if (typeof value === "string") {
    try {
      raw = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const row = (item ?? {}) as Record<string, unknown>;
      const parent = String(row.parent_doc_no ?? "").trim();
      return {
        document_id: String(row.document_id ?? row.id ?? ""),
        doc_no: String(row.doc_no ?? ""),
        doc_type: String(row.doc_type ?? ""),
        doc_date: String(row.doc_date ?? "").slice(0, 10),
        customer_name: String(row.customer_name ?? row.customer_label ?? "").trim(),
        handwritten_doc_ref: String(row.handwritten_doc_ref ?? "").trim(),
        reference_no: String(row.reference_no ?? "").trim(),
        grand_total: roundMoney(Number(row.grand_total ?? 0)),
        deposit_deducted: roundMoney(Number(row.deposit_deducted ?? 0)),
        wht_amount: roundMoney(Number(row.wht_amount ?? 0)),
        allocated_amount: roundMoney(Number(row.allocated_amount ?? 0)),
        parent_doc_no: parent || null,
      };
    })
    .filter((doc) => doc.document_id || doc.doc_no);
}

function matchedDocNos(value: unknown, documents: MatchedStatementDocument[]): string {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter(Boolean).join(", ");
  }
  const text = String(value ?? "").trim();
  if (text && text !== "null") return text;
  return documents
    .map((doc) => doc.doc_no)
    .filter(Boolean)
    .join(", ");
}

async function readGeminiText(
  prompt: string,
  file: File,
  mimeType: string,
): Promise<{ text: string } | { error: string }> {
  const apiKey = resolveGeminiApiKey();
  if (!apiKey) return { error: "ไม่พบ GEMINI_API_KEY บนเซิร์ฟเวอร์" };
  const supabase = createSupabaseServerClient();
  const { data: paramRow } = await supabase
    .from("system_parameters")
    .select("param_value")
    .eq("param_key", "GEMINI_MODEL_VERSION")
    .maybeSingle();
  const { data: cascadeRow } = await supabase
    .from("system_parameters")
    .select("param_value")
    .eq("param_key", "model_cascade_order")
    .maybeSingle();
  const quotaClient = supabase as unknown as Parameters<typeof recordOcrQuota>[0];
  const quotaSnapshot = await recordOcrQuota(quotaClient, null, false);
  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  try {
    const generated = await generateGeminiContent({
      apiKey,
      preferredModel: cleanGeminiModelId(paramRow?.param_value) || "gemini-3.7-flash",
      modelCascade: parseModelCascadeOrder(cascadeRow?.param_value),
      skipModels: modelsAtQuota(quotaSnapshot),
      parts: [
        { text: prompt },
        { inlineData: { mimeType, data: base64 } },
      ],
      onModelOutcome: async ({ model, exhausted }) => {
        await recordOcrQuota(quotaClient, model, exhausted);
      },
    });
    return { text: generated.text };
  } catch (error) {
    if (error instanceof GeminiQuotaExhaustedError) return { error: error.message };
    return { error: error instanceof Error ? error.message : "เรียก Gemini ไม่สำเร็จ" };
  }
}

async function insertFlexible(
  supabase: Db,
  table: string,
  payload: Record<string, unknown>,
): Promise<{ id: string | null; error: string | null }> {
  let current = { ...payload };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { data, error } = await supabase
      .from(table)
      .insert(current)
      .select("id")
      .maybeSingle();
    if (!error) return { id: data?.id ? String(data.id) : null, error: null };
    const missing = isMissingColumn(error.message);
    if (missing && missing in current) {
      delete current[missing];
      current = { ...current };
      continue;
    }
    return { id: null, error: error.message };
  }
  return { id: null, error: "บันทึกไม่สำเร็จ" };
}

async function upsertLines(
  supabase: Db,
  importId: string | null,
  lines: ParsedKtbLine[],
): Promise<{ inserted: number; skipped: number; error: string | null }> {
  let inserted = 0;
  let skipped = 0;
  const baseRows = lines.map((line) => ({
    import_id: importId,
    tx_date: line.tx_date,
    tx_time: line.tx_time,
    tx_code: line.tx_code || null,
    description: line.description || null,
    payer_hint: line.payer_hint || null,
    withdrawal_amount: line.withdrawal_amount,
    deposit_amount: line.deposit_amount,
    tx_direction: line.tx_direction,
    balance_amount: line.balance_amount,
    row_hash: line.row_hash,
    reconcile_status: "UNMATCHED",
    matched_amount: 0,
  }));

  for (let index = 0; index < baseRows.length; index += 80) {
    let chunk = baseRows.slice(index, index + 80).map((row) => ({ ...row }));
    let saved = false;
    for (let attempt = 0; attempt < 8 && !saved; attempt += 1) {
      const { data, error } = await supabase
        .from("bank_statement_lines")
        .upsert(chunk, { onConflict: "row_hash", ignoreDuplicates: true })
        .select("id");
      if (!error) {
        const wrote = data?.length ?? 0;
        inserted += wrote;
        skipped += chunk.length - wrote;
        saved = true;
        break;
      }
      if (/no unique|exclusion constraint|ON CONFLICT/i.test(error.message)) {
        return {
          inserted,
          skipped,
          error: "ตาราง bank_statement_lines ต้องมี unique ที่คอลัมน์ row_hash",
        };
      }
      const missing = isMissingColumn(error.message);
      if (missing) {
        chunk = chunk.map((row) => {
          const next = { ...row };
          delete next[missing as keyof typeof next];
          return next;
        });
        continue;
      }
      return { inserted, skipped, error: error.message };
    }
    if (!saved) return { inserted, skipped, error: "บันทึกรายการเดินบัญชีไม่สำเร็จ" };
  }
  return { inserted, skipped, error: null };
}

function mapLine(row: Record<string, unknown>): BankStatementLineView {
  const balance = row.balance_amount;
  const matchedDocuments = parseMatchedDocuments(row.matched_documents);
  return {
    id: String(row.id ?? ""),
    tx_date: String(row.tx_date ?? "").slice(0, 10),
    tx_time: String(row.tx_time ?? ""),
    tx_code: String(row.tx_code ?? ""),
    description: String(row.description ?? ""),
    payer_hint: String(row.payer_hint ?? ""),
    withdrawal_amount: roundMoney(Number(row.withdrawal_amount ?? 0)),
    deposit_amount: roundMoney(Number(row.deposit_amount ?? 0)),
    balance_amount:
      balance == null || balance === "" ? null : roundMoney(Number(balance)),
    tx_direction:
      String(row.tx_direction ?? "") === "OUT" ||
      Number(row.withdrawal_amount ?? 0) > 0
        ? "OUT"
        : "IN",
    expense_memo: String(row.expense_memo ?? ""),
    reconcile_status: String(row.match_status ?? row.reconcile_status ?? "UNMATCHED"),
    matched_amount: roundMoney(Number(row.matched_amount ?? 0)),
    allocated_amount: roundMoney(Number(row.allocated_amount ?? 0)),
    allocated_total: roundMoney(Number(row.allocated_total ?? row.matched_amount ?? 0)),
    matched_documents: matchedDocuments,
    matched_doc_nos: matchedDocNos(row.matched_doc_nos, matchedDocuments),
  };
}

export async function importKtbStatement(
  formData: FormData,
): Promise<ImportKtbStatementResult> {
  try {
    const owner = await requireSessionUserId();
    if (!owner.ok) return { data: null, error: owner.error };
    const file = formData.get("file");
    if (!(file instanceof File) || file.size <= 0) {
      return { data: null, error: "ไม่พบไฟล์ Statement" };
    }
    if (file.size > MAX_BYTES) {
      return { data: null, error: "ไฟล์ใหญ่เกิน 4.5 MB" };
    }

    const lower = file.name.toLocaleLowerCase("en");
    const isSheet = /\.(xlsx|xls|csv)$/i.test(lower);
    const mime =
      file.type ||
      (lower.endsWith(".pdf")
        ? "application/pdf"
        : lower.endsWith(".png")
          ? "image/png"
          : lower.endsWith(".webp")
            ? "image/webp"
            : "image/jpeg");
    const isImage =
      /^(image\/jpeg|image\/jpg|image\/png|image\/webp|application\/pdf)$/.test(mime) ||
      /\.(pdf|jpg|jpeg|png|webp)$/i.test(lower);

    let parsed: { account_no: string | null; lines: ParsedKtbLine[] };
    if (isSheet) {
      parsed = parseKtbSpreadsheet(Buffer.from(await file.arrayBuffer()));
    } else if (isImage) {
      const gemini = await readGeminiText(ktbStatementOcrPrompt(), file, mime);
      if ("error" in gemini) return { data: null, error: gemini.error };
      parsed = linesFromOcrJson(parseJsonObject(gemini.text));
      if (parsed.lines.length === 0) {
        return { data: null, error: "ไม่พบรายการเดินบัญชีในไฟล์" };
      }
    } else {
      return { data: null, error: "รองรับ Excel, CSV, PDF, JPG, PNG และ WEBP" };
    }

    const supabase = createSupabaseServerClient();
    const sourceKind = lower.endsWith(".csv")
      ? "CSV"
      : lower.endsWith(".xls")
        ? "XLS"
        : lower.endsWith(".xlsx")
          ? "XLSX"
          : lower.endsWith(".pdf")
            ? "PDF"
            : "IMAGE";
    const imported = await insertFlexible(supabase, "bank_statement_imports", {
      bank_code: "KTB",
      account_no: parsed.account_no,
      file_name: file.name,
      source_filename: file.name,
      source_kind: sourceKind,
      row_count: parsed.lines.length,
      created_by: owner.userId,
    });
    if (imported.error && isSchemaMiss(imported.error)) {
      return { data: null, error: "ยังไม่พบตาราง bank_statement_imports บนฐานข้อมูลที่แอปเชื่อมอยู่" };
    }
    if (imported.error) return { data: null, error: imported.error };

    const saved = await upsertLines(supabase, imported.id, parsed.lines);
    if (saved.error) return { data: null, error: saved.error };
    revalidatePath("/sales/reconcile");
    return {
      data: {
        inserted: saved.inserted,
        skipped: saved.skipped,
        account_no: parsed.account_no,
      },
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "นำเข้า Statement ไม่สำเร็จ",
    };
  }
}

function filterStatementLines(
  lines: BankStatementLineView[],
  scope: "deposits" | "withdrawals" | "all" | "matched",
): BankStatementLineView[] {
  const sorted = [...lines].sort((left, right) => right.tx_date.localeCompare(left.tx_date));
  if (scope === "withdrawals") {
    return sorted.filter((line) => line.withdrawal_amount > 0).slice(0, 200);
  }
  if (scope === "deposits") {
    return sorted.filter((line) => line.deposit_amount > 0).slice(0, 400);
  }
  return sorted.slice(0, 400);
}

async function attachMatchedDocuments(
  supabase: Db,
  lines: BankStatementLineView[],
): Promise<BankStatementLineView[]> {
  if (lines.length === 0) return lines;
  const allocations: {
    statement_line_id: string;
    document_id: string;
    allocated_amount: number;
  }[] = [];
  const lineIds = lines.map((line) => line.id);
  for (let index = 0; index < lineIds.length; index += 80) {
    const slice = lineIds.slice(index, index + 80);
    const { data, error } = await supabase
      .from("bank_reconciliation_allocations")
      .select("statement_line_id, document_id, allocated_amount")
      .in("statement_line_id", slice)
      .limit(1000);
    if (error) {
      if (isSchemaMiss(error.message)) return lines;
      throw new Error(error.message);
    }
    for (const row of data ?? []) {
      allocations.push({
        statement_line_id: String(row.statement_line_id ?? ""),
        document_id: String(row.document_id ?? ""),
        allocated_amount: roundMoney(Number(row.allocated_amount ?? 0)),
      });
    }
  }
  const documentIds = [...new Set(allocations.map((row) => row.document_id).filter(Boolean))];
  const documents = new Map<string, Record<string, unknown>>();
  const reader = supabase as unknown as {
    from: (table: string) => {
      select: (columns: string) => {
        in: (
          column: string,
          values: string[],
        ) => Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>;
      };
    };
  };
  let columns =
    "id, doc_no, doc_type, doc_date, contact_id, reference_no, handwritten_doc_ref, grand_total, deposit_deducted, wht_amount, ref_document_id";
  for (let index = 0; index < documentIds.length; index += 80) {
    const slice = documentIds.slice(index, index + 80);
    let pending = slice;
    for (let attempt = 0; attempt < 6 && pending.length > 0; attempt += 1) {
      const loaded = await reader.from("documents").select(columns).in("id", pending);
      if (!loaded.error) {
        for (const row of loaded.data ?? []) documents.set(String(row.id ?? ""), row);
        pending = [];
        break;
      }
      const missing = isMissingColumn(loaded.error.message);
      if (missing && columns.includes(missing)) {
        columns = columns
          .split(",")
          .map((part) => part.trim())
          .filter((part) => part !== missing)
          .join(", ");
        continue;
      }
      if (isSchemaMiss(loaded.error.message)) return lines;
      throw new Error(loaded.error.message);
    }
  }
  const contactIds = [
    ...new Set(
      [...documents.values()].map((row) => String(row.contact_id ?? "")).filter(Boolean),
    ),
  ];
  const customers = new Map<string, string>();
  for (let index = 0; index < contactIds.length; index += 80) {
    const slice = contactIds.slice(index, index + 80);
    const { data } = await supabase
      .from("contacts")
      .select("id, company_name, nickname")
      .in("id", slice);
    for (const row of data ?? []) {
      const company = String(row.company_name ?? "").trim();
      const nickname = String(row.nickname ?? "").trim();
      customers.set(String(row.id), company || nickname);
    }
  }
  const parentIds = [
    ...new Set(
      [...documents.values()].map((row) => String(row.ref_document_id ?? "")).filter(Boolean),
    ),
  ];
  const parents = new Map<string, string>();
  for (let index = 0; index < parentIds.length; index += 80) {
    const slice = parentIds.slice(index, index + 80);
    const { data } = await supabase.from("documents").select("id, doc_no").in("id", slice);
    for (const row of data ?? []) parents.set(String(row.id), String(row.doc_no ?? ""));
  }
  const byLine = new Map<string, MatchedStatementDocument[]>();
  for (const allocation of allocations) {
    const doc = documents.get(allocation.document_id);
    if (!doc) continue;
    const parentId = String(doc.ref_document_id ?? "");
    const parentNo = parentId ? parents.get(parentId) ?? "" : "";
    const matched: MatchedStatementDocument = {
      document_id: allocation.document_id,
      doc_no: String(doc.doc_no ?? ""),
      doc_type: String(doc.doc_type ?? ""),
      doc_date: String(doc.doc_date ?? "").slice(0, 10),
      customer_name: customers.get(String(doc.contact_id ?? "")) ?? "",
      handwritten_doc_ref: String(doc.handwritten_doc_ref ?? "").trim(),
      reference_no: String(doc.reference_no ?? "").trim(),
      grand_total: roundMoney(Number(doc.grand_total ?? 0)),
      deposit_deducted: roundMoney(Number(doc.deposit_deducted ?? 0)),
      wht_amount: roundMoney(Number(doc.wht_amount ?? 0)),
      allocated_amount: allocation.allocated_amount,
      parent_doc_no: parentNo || null,
    };
    const bucket = byLine.get(allocation.statement_line_id) ?? [];
    bucket.push(matched);
    byLine.set(allocation.statement_line_id, bucket);
  }
  return lines.map((line) => {
    const matchedDocuments = byLine.get(line.id) ?? [];
    return {
      ...line,
      matched_documents: matchedDocuments,
      matched_doc_nos: matchedDocuments.map((doc) => doc.doc_no).filter(Boolean).join(", "),
    };
  });
}

export async function listBankStatementLines(
  scope: "deposits" | "withdrawals" | "all" | "matched" = "deposits",
): Promise<ListBankLinesResult> {
  try {
    const owner = await requireSessionUserId();
    if (!owner.ok) return { data: [], error: owner.error };
    const supabase = createSupabaseServerClient();
    const rpcClient = supabase as unknown as {
      rpc: (
        fn: "get_statement_lines_with_matches",
        args: { p_import_id: string | null },
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
    };
    const rpc = await rpcClient.rpc("get_statement_lines_with_matches", { p_import_id: null });
    if (!rpc.error) {
      const rows = (Array.isArray(rpc.data) ? rpc.data : []) as Record<string, unknown>[];
      const mapped = rows.map((row) => mapLine(row));
      const hasMatchPayload = rows.some(
        (row) => "matched_documents" in row || "matched_doc_nos" in row,
      );
      const withMatches = hasMatchPayload ? mapped : await attachMatchedDocuments(supabase, mapped);
      return { data: filterStatementLines(withMatches, scope), error: null };
    }
    if (!isMissingFunction(rpc.error.message) && !isSchemaMiss(rpc.error.message)) {
      return { data: [], error: rpc.error.message };
    }

    let query = supabase
      .from("bank_statement_lines")
      .select(
        "id, tx_date, tx_time, tx_code, description, payer_hint, withdrawal_amount, deposit_amount, balance_amount, tx_direction, expense_memo, reconcile_status, matched_amount",
      )
      .order("tx_date", { ascending: false })
      .limit(scope === "withdrawals" ? 200 : 400);
    if (scope === "deposits") {
      query = query.gt("deposit_amount", 0);
    } else if (scope === "withdrawals") {
      query = query.gt("withdrawal_amount", 0);
    }
    const { data, error } = await query;
    if (error) {
      return {
        data: [],
        error: isSchemaMiss(error.message)
          ? "ยังไม่พบตาราง bank_statement_lines บนฐานข้อมูลที่แอปเชื่อมอยู่"
          : error.message,
      };
    }
    const mapped = (data ?? []).map((row) => mapLine(row as Record<string, unknown>));
    return { data: await attachMatchedDocuments(supabase, mapped), error: null };
  } catch (error) {
    return {
      data: [],
      error: error instanceof Error ? error.message : "โหลดรายการเดินบัญชีไม่สำเร็จ",
    };
  }
}

type RawBill = {
  id: string;
  doc_no: string;
  doc_type: string;
  doc_date: string;
  sales_channel: string | null;
  contact_id: string | null;
  ecommerce_order_no: string | null;
  grand_total: number;
  paid_amount: number;
  payment_status: string;
  status: string;
  payment_channel: string | null;
  is_swept_to_company: boolean | null;
  deposit_deducted: number;
  wht_amount: number;
  created_at: string;
  reference_no: string;
};

async function loadAllocatedSums(
  supabase: Db,
  documentIds: string[],
): Promise<Map<string, number>> {
  const sums = new Map<string, number>();
  for (let index = 0; index < documentIds.length; index += 80) {
    const slice = documentIds.slice(index, index + 80);
    const { data, error } = await supabase
      .from("bank_reconciliation_allocations")
      .select("document_id, allocated_amount")
      .in("document_id", slice)
      .limit(1000);
    if (error) {
      if (isSchemaMiss(error.message)) return sums;
      throw new Error(error.message);
    }
    for (const row of data ?? []) {
      const id = String(row.document_id ?? "");
      sums.set(id, roundMoney((sums.get(id) ?? 0) + Number(row.allocated_amount ?? 0)));
    }
  }
  return sums;
}

async function loadCustomerLabels(
  supabase: Db,
  contactIds: string[],
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  const unique = [...new Set(contactIds.filter(Boolean))];
  for (let index = 0; index < unique.length; index += 80) {
    const slice = unique.slice(index, index + 80);
    const { data } = await supabase
      .from("contacts")
      .select("id, company_name, nickname")
      .in("id", slice);
    for (const row of data ?? []) {
      const nickname = String(row.nickname ?? "").trim();
      const company = String(row.company_name ?? "").trim();
      labels.set(String(row.id), nickname ? `${nickname} — ${company}` : company);
    }
  }
  return labels;
}

/** บิลเหล่านี้เก็บ grand_total หลังหักมัดจำแล้ว — ห้ามลบ deposit_deducted ซ้ำ */
function depositAlreadyNetted(docType: string): boolean {
  return (
    docType === "ABB" ||
    docType === "CS_TAX" ||
    docType === "TAX_INV" ||
    docType === "INV_DO" ||
    docType === "DEP_IN"
  );
}

function reconcilableAmount(row: RawBill, allocated: number): number {
  const grand = roundMoney(Number(row.grand_total ?? 0));
  const paid = roundMoney(Number(row.paid_amount ?? 0));
  const depositDeducted = roundMoney(Number(row.deposit_deducted ?? 0));
  const wht = roundMoney(Number(row.wht_amount ?? 0));
  const used = roundMoney(allocated);
  if (row.doc_type === "SO" || row.doc_type === "QT") {
    return roundMoney(Math.max(0, grand - depositDeducted - wht - used));
  }
  if (depositAlreadyNetted(row.doc_type)) {
    return roundMoney(Math.max(0, grand - wht - used));
  }
  if (row.doc_type === "REC") {
    return roundMoney(Math.max(0, grand - depositDeducted - wht - used));
  }
  return roundMoney(Math.max(0, grand - paid - used));
}

function paymentCoversBill(
  paid: number,
  deposit: number,
  grand: number,
  docType: string,
): boolean {
  const settled = depositAlreadyNetted(docType) ? paid : paid + deposit;
  return settled + MONEY_EPSILON >= grand;
}

function toOpenBill(row: RawBill, allocated: number, customer: string | null): OpenSalesBill {
  const grand = roundMoney(Number(row.grand_total ?? 0));
  const paid = roundMoney(Number(row.paid_amount ?? 0));
  const depositDeducted = roundMoney(Number(row.deposit_deducted ?? 0));
  const outstanding = depositAlreadyNetted(row.doc_type)
    ? roundMoney(Math.max(0, grand - paid))
    : roundMoney(Math.max(0, grand - depositDeducted - paid));
  return {
    id: row.id,
    doc_no: row.doc_no,
    doc_type: row.doc_type,
    doc_date: String(row.doc_date ?? "").slice(0, 10),
    sales_channel: row.sales_channel,
    customer_label: customer,
    grand_total: grand,
    paid_amount: paid,
    outstanding,
    deposit_deducted: depositDeducted,
    wht_amount: roundMoney(Number(row.wht_amount ?? 0)),
    linkable_amount: reconcilableAmount(row, allocated),
    payment_status: row.payment_status,
    created_at: row.created_at,
    reference_no: row.reference_no,
    same_amount_count: 1,
  };
}

async function hydrateBills(supabase: Db, rows: RawBill[]): Promise<OpenSalesBill[]> {
  const allocated = await loadAllocatedSums(
    supabase,
    rows.map((row) => row.id),
  );
  const labels = await loadCustomerLabels(
    supabase,
    rows.map((row) => row.contact_id ?? ""),
  );
  return rows.map((row) =>
    toOpenBill(row, allocated.get(row.id) ?? 0, labels.get(row.contact_id ?? "") ?? null),
  );
}

function asRawBill(row: Record<string, unknown>): RawBill {
  return {
    id: String(row.id ?? ""),
    doc_no: String(row.doc_no ?? ""),
    doc_type: String(row.doc_type ?? ""),
    doc_date: String(row.doc_date ?? ""),
    sales_channel: row.sales_channel ? String(row.sales_channel) : null,
    contact_id: row.contact_id ? String(row.contact_id) : null,
    ecommerce_order_no: row.ecommerce_order_no ? String(row.ecommerce_order_no) : null,
    grand_total: Number(row.grand_total ?? 0),
    paid_amount: Number(row.paid_amount ?? 0),
    payment_status: String(row.payment_status ?? ""),
    status: String(row.status ?? ""),
    payment_channel: row.payment_channel ? String(row.payment_channel) : null,
    is_swept_to_company:
      row.is_swept_to_company == null ? null : Boolean(row.is_swept_to_company),
    deposit_deducted: Number(row.deposit_deducted ?? 0),
    wht_amount: Number(row.wht_amount ?? 0),
    created_at: String(row.created_at ?? ""),
    reference_no: String(row.reference_no ?? "").trim(),
  };
}

function stampDuplicateCounts(bills: OpenSalesBill[]): OpenSalesBill[] {
  const counts = new Map<string, number>();
  for (const bill of bills) {
    const key = `${bill.doc_date}|${bill.linkable_amount.toFixed(2)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return bills.map((bill) => ({
    ...bill,
    same_amount_count:
      counts.get(`${bill.doc_date}|${bill.linkable_amount.toFixed(2)}`) ?? 1,
  }));
}

function orderCandidateBills(bills: OpenSalesBill[], description: string): OpenSalesBill[] {
  const text = description.toLowerCase();
  return [...bills].sort((left, right) => {
    const leftSlip =
      left.reference_no && text.includes(left.reference_no.toLowerCase()) ? 0 : 1;
    const rightSlip =
      right.reference_no && text.includes(right.reference_no.toLowerCase()) ? 0 : 1;
    if (leftSlip !== rightSlip) return leftSlip - rightSlip;
    return left.created_at.localeCompare(right.created_at);
  });
}

async function hideConvertedSalesOrders(
  supabase: Db,
  bills: OpenSalesBill[],
): Promise<OpenSalesBill[]> {
  const soIds = bills.filter((bill) => bill.doc_type === "SO").map((bill) => bill.id);
  if (soIds.length === 0) return bills;
  const hidden = new Set<string>();
  for (let index = 0; index < soIds.length; index += 80) {
    const slice = soIds.slice(index, index + 80);
    const { data, error } = await supabase
      .from("documents")
      .select("ref_document_id")
      .in("ref_document_id", slice)
      .in("doc_type", [...CONVERTED_CHILD_DOC_TYPES])
      .in("status", ["ISSUED", "COMPLETED", "PAID"]);
    if (error) {
      if (isSchemaMiss(error.message)) return bills;
      throw new Error(error.message);
    }
    for (const row of data ?? []) hidden.add(String(row.ref_document_id ?? ""));
  }
  return bills.filter((bill) => !(bill.doc_type === "SO" && hidden.has(bill.id)));
}

async function loadReconcileCandidates(
  supabase: Db,
): Promise<{ bills: OpenSalesBill[]; error: string | null }> {
  const rpcClient = supabase as unknown as {
    rpc: (
      fn: "get_reconcile_candidate_documents",
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
  const rpc = await rpcClient.rpc("get_reconcile_candidate_documents");
  if (!rpc.error) {
    const rows = (Array.isArray(rpc.data) ? rpc.data : []) as Record<string, unknown>[];
    const kept = rows.filter((row) => {
      const channel = row.payment_channel ? String(row.payment_channel) : "";
      if (!channel) return true;
      return channel === "COMPANY_BANK" || row.is_swept_to_company === true;
    });
    const rpcAmounts = new Map<string, number>();
    for (const row of kept) {
      if (row.reconcilable_amount == null || row.reconcilable_amount === "") continue;
      const amount = Number(row.reconcilable_amount);
      if (!Number.isFinite(amount)) continue;
      rpcAmounts.set(String(row.id ?? ""), roundMoney(amount));
    }
    const hydrated = await hydrateBills(
      supabase,
      kept.map((row) => asRawBill(row)),
    );
    for (const bill of hydrated) {
      const rpcAmount = rpcAmounts.get(bill.id);
      if (rpcAmount != null) bill.linkable_amount = rpcAmount;
    }
    const bills = await hideConvertedSalesOrders(supabase, hydrated);
    return {
      bills: bills.filter((bill) => bill.linkable_amount > MONEY_EPSILON),
      error: null,
    };
  }
  if (!isSchemaMiss(rpc.error.message) && !/Could not find the function/i.test(rpc.error.message)) {
    return { bills: [], error: rpc.error.message };
  }

  const { data, error } = await supabase
    .from("documents")
    .select(BILL_SELECT)
    .in("doc_type", [...SALES_DOC_TYPES])
    .in("status", [...OPEN_DOC_STATUSES])
    .or("payment_channel.eq.COMPANY_BANK,is_swept_to_company.eq.true")
    .order("created_at", { ascending: true })
    .limit(800);
  if (error) return { bills: [], error: error.message };
  const bills = await hideConvertedSalesOrders(
    supabase,
    await hydrateBills(
      supabase,
      (data ?? []).map((row) => asRawBill(row as Record<string, unknown>)),
    ),
  );
  return {
    bills: bills.filter((bill) => bill.linkable_amount > MONEY_EPSILON),
    error: null,
  };
}

function isCompanyBankReceipt(row: RawBill): boolean {
  return row.payment_channel === "COMPANY_BANK" || row.is_swept_to_company === true;
}

const BILL_SELECT =
  "id, doc_no, doc_type, doc_date, created_at, reference_no, sales_channel, contact_id, ecommerce_order_no, grand_total, paid_amount, deposit_deducted, wht_amount, payment_status, status, payment_channel, is_swept_to_company";
const CONVERTED_CHILD_DOC_TYPES = ["CS_TAX", "TAX_INV", "INV_DO", "ABB"] as const;
const PURCHASE_DOC_TYPES = ["PO", "AP_TAX", "AP_INV", "AP_CASH", "DEP_OUT", "PAY"] as const;

export async function suggestBillMatches(
  statementLineId: string,
): Promise<SuggestBillMatchesResult> {
  try {
    const owner = await requireSessionUserId();
    if (!owner.ok) return { data: [], error: owner.error };
    const supabase = createSupabaseServerClient();
    const { data: lineRow, error: lineError } = await supabase
      .from("bank_statement_lines")
      .select(
        "id, tx_date, description, payer_hint, deposit_amount, matched_amount, reconcile_status",
      )
      .eq("id", statementLineId)
      .maybeSingle();
    if (lineError || !lineRow) {
      return { data: [], error: lineError?.message ?? "ไม่พบรายการเดินบัญชี" };
    }
    const line = mapLine(lineRow as Record<string, unknown>);
    const remaining = roundMoney(line.deposit_amount - line.matched_amount);
    if (remaining <= MONEY_EPSILON) return { data: [], error: null };

    const from = shiftIso(line.tx_date, -7);
    const to = shiftIso(line.tx_date, 7);
    const loaded = await loadReconcileCandidates(supabase);
    if (loaded.error) return { data: [], error: loaded.error };
    const data = loaded.bills.filter(
      (bill) => bill.doc_date >= from && bill.doc_date <= to,
    );

    const refs = [
      ...(line.description.match(/[A-Z]{2,6}-\d{4}-\d{3,5}/g) ?? []),
      ...(line.description.match(/(?:SP|LZ)\d{2}\/\d{2,4}/gi) ?? []),
    ];
    let extra: RawBill[] = [];
    if (refs.length > 0) {
      const { data: named } = await supabase
        .from("documents")
        .select(BILL_SELECT)
        .in("doc_no", refs.slice(0, 20))
        .in("doc_type", [...SALES_DOC_TYPES])
        .limit(20);
      extra = (named ?? []).map((row) => asRawBill(row as Record<string, unknown>));
    }

    const extraBills = (
      await hydrateBills(
        supabase,
        extra.filter(isCompanyBankReceipt),
      )
    ).filter((bill) => bill.linkable_amount > MONEY_EPSILON);
    const merged = new Map<string, OpenSalesBill>();
    for (const bill of [...data, ...extraBills]) merged.set(bill.id, bill);
    const bills = stampDuplicateCounts(
      orderCandidateBills([...merged.values()], line.description),
    );

    const suggestions: BillMatchSuggestion[] = [];
    for (const bill of bills) {
      const dated = withinDays(bill.doc_date, line.tx_date, 7);
      const docHit = line.description.includes(bill.doc_no);
      if (dated && sameMoney(bill.linkable_amount, remaining)) {
        suggestions.push({
          ...bill,
          reason:
            bill.same_amount_count > 1
              ? `ยอด ${bill.linkable_amount.toFixed(2)} ซ้ำ ${bill.same_amount_count} บิลในวันนี้ — ยืนยันเอง`
              : "ยอดตรงกับเงินฝาก",
          suggested_amount: bill.linkable_amount,
          suggested_fee: 0,
        });
        continue;
      }
      const net1 = roundMoney(bill.linkable_amount * 0.99);
      const net3 = roundMoney(bill.linkable_amount * 0.97);
      if (dated && sameMoney(net1, remaining)) {
        suggestions.push({
          ...bill,
          reason: "ตรงหลังหัก ณ ที่จ่าย 1%",
          suggested_amount: bill.linkable_amount,
          suggested_fee: roundMoney(bill.linkable_amount - remaining),
        });
        continue;
      }
      if (dated && sameMoney(net3, remaining)) {
        suggestions.push({
          ...bill,
          reason: "ตรงหลังหัก ณ ที่จ่าย 3%",
          suggested_amount: bill.linkable_amount,
          suggested_fee: roundMoney(bill.linkable_amount - remaining),
        });
        continue;
      }
      if (docHit) {
        suggestions.push({
          ...bill,
          reason: "เลขที่เอกสารอยู่ในรายการเดินบัญชี",
          suggested_amount: Math.min(bill.linkable_amount, remaining),
          suggested_fee: 0,
        });
      }
    }

    suggestions.sort((left, right) => {
      const rank = (reason: string) => (reason.startsWith("ยอดตรง") ? 0 : reason.includes("หัก") ? 1 : 2);
      return rank(left.reason) - rank(right.reason);
    });
    return { data: suggestions.slice(0, 8), error: null };
  } catch (error) {
    return {
      data: [],
      error: error instanceof Error ? error.message : "ค้นหาบิลที่ตรงกันไม่สำเร็จ",
    };
  }
}

export async function searchOpenSalesBills(
  input: SearchOpenBillsInput,
): Promise<SearchOpenBillsResult> {
  try {
    const owner = await requireSessionUserId();
    if (!owner.ok) return { data: [], error: owner.error };
    const supabase = createSupabaseServerClient();
    const keyword = input.keyword?.trim().toLowerCase() ?? "";
    const channel = input.sales_channel?.trim() || "";
    const loaded = await loadReconcileCandidates(supabase);
    if (loaded.error) return { data: [], error: loaded.error };
    const txDate = input.tx_date?.slice(0, 10) ?? "";
    const from = /^\d{4}-\d{2}-\d{2}$/.test(txDate) ? shiftIso(txDate, -31) : "";
    const to = /^\d{4}-\d{2}-\d{2}$/.test(txDate) ? shiftIso(txDate, 31) : "";
    const bills = loaded.bills.filter((bill) => {
      if (channel === "STORE") {
        if (!["STORE", "DIRECT", "RETAIL", "WHOLESALE"].includes(bill.sales_channel ?? "")) {
          return false;
        }
      } else if (channel && bill.sales_channel !== channel) {
        return false;
      }
      if (!keyword && from && (bill.doc_date < from || bill.doc_date > to)) return false;
      if (!keyword) return true;
      const haystack = `${bill.doc_no} ${bill.reference_no} ${bill.customer_label ?? ""} ${bill.doc_type}`.toLowerCase();
      return haystack.includes(keyword);
    });
    return {
      data: stampDuplicateCounts(
        orderCandidateBills(bills, input.description ?? ""),
      ).slice(0, 40),
      error: null,
    };
  } catch (error) {
    return {
      data: [],
      error: error instanceof Error ? error.message : "ค้นหาบิลขายไม่สำเร็จ",
    };
  }
}

export async function autoMatchUniqueDeposits(): Promise<AutoMatchUniqueResult> {
  try {
    const owner = await requireSessionUserId();
    if (!owner.ok) return { data: null, error: owner.error };
    const supabase = createSupabaseServerClient();
    const loaded = await loadReconcileCandidates(supabase);
    if (loaded.error) return { data: null, error: loaded.error };
    const { data: lineRows, error: lineError } = await supabase
      .from("bank_statement_lines")
      .select("id, tx_date, deposit_amount, matched_amount, reconcile_status")
      .gt("deposit_amount", 0)
      .in("reconcile_status", ["UNMATCHED", "PARTIAL"])
      .order("tx_date", { ascending: true })
      .limit(400);
    if (lineError) return { data: null, error: lineError.message };

    const openLines = (lineRows ?? [])
      .map((row) => ({
        id: String(row.id ?? ""),
        tx_date: String(row.tx_date ?? "").slice(0, 10),
        remaining: roundMoney(
          Number(row.deposit_amount ?? 0) - Number(row.matched_amount ?? 0),
        ),
      }))
      .filter((line) => line.remaining > MONEY_EPSILON);
    const lineCounts = new Map<string, number>();
    for (const line of openLines) {
      const key = `${line.tx_date}|${line.remaining.toFixed(2)}`;
      lineCounts.set(key, (lineCounts.get(key) ?? 0) + 1);
    }

    const usedBills = new Set<string>();
    let matched = 0;
    let skipped = 0;
    const errors: string[] = [];
    for (const line of openLines) {
      const key = `${line.tx_date}|${line.remaining.toFixed(2)}`;
      const candidates = loaded.bills.filter(
        (bill) =>
          !usedBills.has(bill.id) &&
          bill.doc_date === line.tx_date &&
          bill.linkable_amount.toFixed(2) === line.remaining.toFixed(2),
      );
      if ((lineCounts.get(key) ?? 0) !== 1 || candidates.length !== 1) {
        skipped += 1;
        continue;
      }
      const bill = candidates[0];
      const result = await confirmBankMatch({
        statement_line_id: line.id,
        allocations: [{ document_id: bill.id, allocated_amount: bill.linkable_amount }],
        platform_fee_diff: 0,
      });
      if (result.error || !result.data) {
        errors.push(`${bill.doc_no}: ${result.error ?? "ชนยอดไม่สำเร็จ"}`);
        skipped += 1;
        continue;
      }
      usedBills.add(bill.id);
      matched += 1;
    }
    return { data: { matched, skipped, errors }, error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "ชนยอดอัตโนมัติไม่สำเร็จ",
    };
  }
}

export async function reclassifyDocumentPaymentChannel(
  input: ReclassifyPaymentChannelInput,
): Promise<{ data: { document_id: string } | null; error: string | null }> {
  try {
    const owner = await requireSessionUserId();
    if (!owner.ok) return { data: null, error: owner.error };
    const documentId = input.document_id?.trim() ?? "";
    if (!documentId) return { data: null, error: "ไม่พบเอกสาร" };
    if (input.payment_channel !== "CASH" && input.payment_channel !== "OTHER_BANK") {
      return { data: null, error: "ช่องทางที่เลือกไม่รองรับ" };
    }
    const supabase = createSupabaseServerClient();
    const rpcClient = supabase as unknown as {
      rpc: (
        fn: "reclassify_document_payment_channel",
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
    };
    const saved = await rpcClient.rpc("reclassify_document_payment_channel", {
      p_document_id: documentId,
      p_new_channel: input.payment_channel,
      p_bank_account_id: input.bank_account_id?.trim() || null,
    });
    if (saved.error) return { data: null, error: saved.error.message };
    revalidatePath("/sales");
    revalidatePath("/sales/reconcile");
    revalidatePath("/finance/deposits");
    return { data: { document_id: documentId }, error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "ย้ายช่องทางรับเงินไม่สำเร็จ",
    };
  }
}

export async function unmatchBankStatementLine(
  statementLineId: string,
): Promise<ConfirmBankMatchResult> {
  try {
    const owner = await requireSessionUserId();
    if (!owner.ok) return { data: null, error: owner.error };
    const lineId = statementLineId?.trim() ?? "";
    if (!lineId) return { data: null, error: "ไม่พบรายการเดินบัญชี" };
    const supabase = createSupabaseServerClient();
    const released = await callUnmatchAllocationRpc(supabase, lineId, null);
    if (released.handled) return released.result;
    const { data: allocations, error: allocationError } = await supabase
      .from("bank_reconciliation_allocations")
      .select("id, document_id, allocated_amount")
      .eq("statement_line_id", lineId);
    if (allocationError && !isSchemaMiss(allocationError.message)) {
      return { data: null, error: allocationError.message };
    }

    const creditTypes = new Set(["SO", "INV_DO", "TAX_INV"]);
    const snapshots: { id: string; docNo: string; paid: number; status: string }[] = [];
    for (const row of allocations ?? []) {
      const documentId = String(row.document_id ?? "");
      const amount = roundMoney(Number(row.allocated_amount ?? 0));
      if (!documentId || amount <= 0) continue;
      const { data: doc, error } = await supabase
        .from("documents")
        .select("id, doc_no, doc_type, grand_total, paid_amount, deposit_deducted, payment_status")
        .eq("id", documentId)
        .maybeSingle();
      if (error || !doc) continue;
      if (!creditTypes.has(String(doc.doc_type ?? ""))) continue;
      const paid = roundMoney(Number(doc.paid_amount ?? 0));
      const nextPaid = roundMoney(Math.max(0, paid - amount));
      const grand = roundMoney(Number(doc.grand_total ?? 0));
      const deposit = roundMoney(Number(doc.deposit_deducted ?? 0));
      const nextStatus = paymentCoversBill(nextPaid, deposit, grand, String(doc.doc_type ?? ""))
        ? "PAID"
        : nextPaid > MONEY_EPSILON
          ? "PARTIAL"
          : "UNPAID";
      snapshots.push({
        id: documentId,
        docNo: String(doc.doc_no ?? ""),
        paid,
        status: String(doc.payment_status ?? ""),
      });
      const { error: updateError } = await supabase
        .from("documents")
        .update({
          paid_amount: nextPaid,
          payment_status: nextStatus,
          updated_at: new Date().toISOString(),
        })
        .eq("id", documentId);
      if (updateError) {
        await restorePayments(supabase, snapshots.slice(0, -1));
        return { data: null, error: updateError.message };
      }
      await syncPaymentToDocHeader(supabase, {
        documentId,
        docNo: String(doc.doc_no ?? ""),
        paidAmount: nextPaid,
        paymentStatus: nextStatus,
      });
    }

    if ((allocations ?? []).length > 0) {
      const { error: deleteError } = await supabase
        .from("bank_reconciliation_allocations")
        .delete()
        .eq("statement_line_id", lineId);
      if (deleteError) {
        await restorePayments(supabase, snapshots);
        return { data: null, error: deleteError.message };
      }
    }

    const { error: lineError } = await supabase
      .from("bank_statement_lines")
      .update({
        matched_amount: 0,
        reconcile_status: "UNMATCHED",
        expense_memo: null,
      })
      .eq("id", lineId);
    if (lineError) return { data: null, error: lineError.message };

    revalidatePath("/sales");
    revalidatePath("/sales/reconcile");
    return {
      data: { reconcile_status: "UNMATCHED", matched_amount: 0, warnings: [] },
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "ยกเลิกการชนยอดไม่สำเร็จ",
    };
  }
}

export async function unmatchStatementLineAllocation(
  statementLineId: string,
  documentId?: string | null,
): Promise<ConfirmBankMatchResult> {
  try {
    const owner = await requireSessionUserId();
    if (!owner.ok) return { data: null, error: owner.error };
    const lineId = statementLineId?.trim() ?? "";
    const docId = documentId?.trim() ?? "";
    if (!lineId) return { data: null, error: "ไม่พบรายการเดินบัญชี" };
    if (!docId) return unmatchBankStatementLine(lineId);
    const supabase = createSupabaseServerClient();
    const released = await callUnmatchAllocationRpc(supabase, lineId, docId);
    if (released.handled) return released.result;
    return unmatchOneAllocationLocal(supabase, lineId, docId);
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "ยกเลิกการชนยอดไม่สำเร็จ",
    };
  }
}

async function callUnmatchAllocationRpc(
  supabase: Db,
  lineId: string,
  documentId: string | null,
): Promise<{ handled: boolean; result: ConfirmBankMatchResult }> {
  const rpcClient = supabase as unknown as {
    rpc: (
      fn: "unmatch_statement_line_allocation",
      args: { p_statement_line_id: string; p_document_id: string | null },
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
  const saved = await rpcClient.rpc("unmatch_statement_line_allocation", {
    p_statement_line_id: lineId,
    p_document_id: documentId,
  });
  if (!saved.error) {
    revalidatePath("/sales");
    revalidatePath("/sales/reconcile");
    const payload = (saved.data ?? {}) as Record<string, unknown>;
    return {
      handled: true,
      result: {
        data: {
          reconcile_status: String(payload.reconcile_status ?? "UNMATCHED"),
          matched_amount: roundMoney(Number(payload.matched_amount ?? 0)),
          warnings: [],
        },
        error: null,
      },
    };
  }
  if (isMissingFunction(saved.error.message)) {
    return { handled: false, result: { data: null, error: saved.error.message } };
  }
  return { handled: true, result: { data: null, error: saved.error.message } };
}

async function unmatchOneAllocationLocal(
  supabase: Db,
  lineId: string,
  documentId: string,
): Promise<ConfirmBankMatchResult> {
  const { data: allocation, error: allocationError } = await supabase
    .from("bank_reconciliation_allocations")
    .select("id, document_id, allocated_amount")
    .eq("statement_line_id", lineId)
    .eq("document_id", documentId)
    .maybeSingle();
  if (allocationError) return { data: null, error: allocationError.message };
  if (!allocation) return { data: null, error: "ไม่พบคู่ชนยอดของบิลนี้" };

  const amount = roundMoney(Number(allocation.allocated_amount ?? 0));
  const creditTypes = new Set(["SO", "INV_DO", "TAX_INV"]);
  const snapshots: { id: string; docNo: string; paid: number; status: string }[] = [];
  const { data: doc } = await supabase
    .from("documents")
    .select("id, doc_no, doc_type, grand_total, paid_amount, deposit_deducted, payment_status")
    .eq("id", documentId)
    .maybeSingle();
  if (doc && creditTypes.has(String(doc.doc_type ?? "")) && amount > 0) {
    const paid = roundMoney(Number(doc.paid_amount ?? 0));
    const nextPaid = roundMoney(Math.max(0, paid - amount));
    const grand = roundMoney(Number(doc.grand_total ?? 0));
    const deposit = roundMoney(Number(doc.deposit_deducted ?? 0));
    const nextStatus = paymentCoversBill(nextPaid, deposit, grand, String(doc.doc_type ?? ""))
      ? "PAID"
      : nextPaid > MONEY_EPSILON
        ? "PARTIAL"
        : "UNPAID";
    snapshots.push({
      id: documentId,
      docNo: String(doc.doc_no ?? ""),
      paid,
      status: String(doc.payment_status ?? ""),
    });
    const { error: updateError } = await supabase
      .from("documents")
      .update({
        paid_amount: nextPaid,
        payment_status: nextStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId);
    if (updateError) return { data: null, error: updateError.message };
    await syncPaymentToDocHeader(supabase, {
      documentId,
      docNo: String(doc.doc_no ?? ""),
      paidAmount: nextPaid,
      paymentStatus: nextStatus,
    });
  }

  const { error: deleteError } = await supabase
    .from("bank_reconciliation_allocations")
    .delete()
    .eq("id", allocation.id);
  if (deleteError) {
    await restorePayments(supabase, snapshots);
    return { data: null, error: deleteError.message };
  }

  const { data: remaining, error: remainingError } = await supabase
    .from("bank_reconciliation_allocations")
    .select("allocated_amount")
    .eq("statement_line_id", lineId);
  if (remainingError) return { data: null, error: remainingError.message };
  const matched = roundMoney(
    (remaining ?? []).reduce((sum, row) => sum + Number(row.allocated_amount ?? 0), 0),
  );
  const { data: lineRow } = await supabase
    .from("bank_statement_lines")
    .select("deposit_amount, withdrawal_amount")
    .eq("id", lineId)
    .maybeSingle();
  const deposit = roundMoney(Number(lineRow?.deposit_amount ?? 0));
  const withdrawal = roundMoney(Number(lineRow?.withdrawal_amount ?? 0));
  const movement = deposit > 0 ? deposit : withdrawal;
  const status =
    matched <= MONEY_EPSILON
      ? "UNMATCHED"
      : matched + MONEY_EPSILON >= movement && movement > 0
        ? "MATCHED"
        : "PARTIAL";
  const { error: lineError } = await supabase
    .from("bank_statement_lines")
    .update({
      matched_amount: matched,
      reconcile_status: status,
      ...(status === "UNMATCHED" ? { expense_memo: null } : {}),
    })
    .eq("id", lineId);
  if (lineError) return { data: null, error: lineError.message };
  revalidatePath("/sales");
  revalidatePath("/sales/reconcile");
  return { data: { reconcile_status: status, matched_amount: matched, warnings: [] }, error: null };
}

async function syncPaymentToDocHeader(
  supabase: Db,
  input: { documentId: string; docNo: string; paidAmount: number; paymentStatus: string },
): Promise<string | null> {
  let patch: Record<string, unknown> = {
    paid_amount: input.paidAmount,
    payment_status: input.paymentStatus,
  };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const byId = await supabase
      .from("doc_headers")
      .update(patch)
      .eq("id", input.documentId)
      .select("id");
    if (!byId.error && (byId.data ?? []).length > 0) return null;
    if (!byId.error) {
      const byNo = await supabase
        .from("doc_headers")
        .update(patch)
        .eq("doc_no", input.docNo)
        .select("id");
      if (!byNo.error) return null;
      const missingNo = isMissingColumn(byNo.error.message);
      if (missingNo && missingNo in patch) {
        delete patch[missingNo];
        patch = { ...patch };
        continue;
      }
      if (isSchemaMiss(byNo.error.message)) return null;
      return byNo.error.message;
    }
    const missing = isMissingColumn(byId.error.message);
    if (missing && missing in patch) {
      delete patch[missing];
      patch = { ...patch };
      continue;
    }
    if (isSchemaMiss(byId.error.message)) return null;
    return byId.error.message;
  }
  return null;
}

export async function confirmBankMatch(
  input: ConfirmBankMatchInput,
): Promise<ConfirmBankMatchResult> {
  try {
    const owner = await requireSessionUserId();
    if (!owner.ok) return { data: null, error: owner.error };
    const lineId = input.statement_line_id?.trim() ?? "";
    const allocations = Array.isArray(input.allocations) ? input.allocations : [];
    const fee = roundMoney(Number(input.platform_fee_diff ?? 0));
    if (!lineId) return { data: null, error: "ไม่พบรายการเดินบัญชี" };
    if (allocations.length === 0) return { data: null, error: "เลือกบิลอย่างน้อย 1 ใบ" };
    if (fee < 0) return { data: null, error: "ส่วนต่างค่าธรรมเนียมติดลบไม่ได้" };

    const seen = new Set<string>();
    for (const row of allocations) {
      if (!row.document_id || seen.has(row.document_id)) {
        return { data: null, error: "มีบิลซ้ำในรายการที่เลือก" };
      }
      seen.add(row.document_id);
      if (!Number.isFinite(row.allocated_amount) || row.allocated_amount <= 0) {
        return { data: null, error: "ยอดที่ตัดต้องมากกว่า 0" };
      }
    }

    const supabase = createSupabaseServerClient();
    const { data: lineRow, error: lineError } = await supabase
      .from("bank_statement_lines")
      .select("id, deposit_amount, matched_amount, reconcile_status")
      .eq("id", lineId)
      .maybeSingle();
    if (lineError || !lineRow) {
      return { data: null, error: lineError?.message ?? "ไม่พบรายการเดินบัญชี" };
    }
    const deposit = roundMoney(Number(lineRow.deposit_amount ?? 0));
    const matched = roundMoney(Number(lineRow.matched_amount ?? 0));
    const status = String(lineRow.reconcile_status ?? "UNMATCHED");
    if (deposit <= 0) return { data: null, error: "รายการนี้ไม่ใช่เงินฝาก" };
    if (status === "MATCHED" || deposit - matched <= MONEY_EPSILON) {
      return { data: null, error: "รายการนี้ชนยอดครบแล้ว" };
    }

    const { data: docs, error: docsError } = await supabase
      .from("documents")
      .select("id, doc_no, doc_type, status, grand_total, paid_amount, deposit_deducted, payment_status")
      .in(
        "id",
        allocations.map((row) => row.document_id),
      );
    if (docsError) return { data: null, error: docsError.message };
    const byId = new Map(
      (docs ?? []).map((row) => [String(row.id), asRawBill(row as Record<string, unknown>)]),
    );
    const allocatedSums = await loadAllocatedSums(
      supabase,
      allocations.map((row) => row.document_id),
    );

    let gross = 0;
    const prepared: {
      allocation: BankMatchAllocationInput;
      bill: RawBill;
      paymentDelta: number;
      nextPaid: number;
      nextStatus: "PAID" | "PARTIAL";
    }[] = [];
    for (const allocation of allocations) {
      const bill = byId.get(allocation.document_id);
      if (!bill || !(SALES_DOC_TYPES as readonly string[]).includes(bill.doc_type)) {
        return { data: null, error: "พบบิลที่ไม่ใช่บิลขายที่ชนยอดได้" };
      }
      if (["DRAFT", "VOID", "CANCELLED"].includes(bill.status)) {
        return { data: null, error: `เอกสารถูกยกเลิกหรือยังเป็นร่าง: ${bill.doc_no}` };
      }
      const open = toOpenBill(bill, allocatedSums.get(bill.id) ?? 0, null);
      const amount = roundMoney(allocation.allocated_amount);
      if (amount - open.linkable_amount > MONEY_EPSILON) {
        return {
          data: null,
          error: `${bill.doc_no} ตัดได้ไม่เกิน ${open.linkable_amount.toFixed(2)} บาท`,
        };
      }
      gross = roundMoney(gross + amount);
      const delta = roundMoney(Math.min(amount, open.outstanding));
      const nextPaid = roundMoney(open.paid_amount + delta);
      prepared.push({
        allocation: { document_id: bill.id, allocated_amount: amount },
        bill,
        paymentDelta: delta,
        nextPaid,
        nextStatus: paymentCoversBill(
          nextPaid,
          open.deposit_deducted,
          open.grand_total,
          open.doc_type,
        )
          ? "PAID"
          : "PARTIAL",
      });
    }

    const cash = roundMoney(gross - fee);
    const room = roundMoney(deposit - matched);
    if (cash <= 0) {
      return { data: null, error: "ยอดบิลหลังหักส่วนต่างต้องมากกว่า 0" };
    }
    if (cash - room > MONEY_EPSILON) {
      return {
        data: null,
        error: `ยอดที่ตัด ${cash.toFixed(2)} เกินเงินฝากคงเหลือ ${room.toFixed(2)} — ใส่ส่วนต่างค่าธรรมเนียมให้ครบ`,
      };
    }

    const snapshots: { id: string; docNo: string; paid: number; status: string }[] = [];
    for (const row of prepared) {
      if (row.paymentDelta <= 0) continue;
      snapshots.push({
        id: row.bill.id,
        docNo: row.bill.doc_no,
        paid: roundMoney(Number(row.bill.paid_amount ?? 0)),
        status: row.bill.payment_status,
      });
      const { error } = await supabase
        .from("documents")
        .update({
          paid_amount: row.nextPaid,
          payment_status: row.nextStatus,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.bill.id);
      if (error) {
        await restorePayments(supabase, snapshots.slice(0, -1));
        return { data: null, error: error.message };
      }
    }

    const allocationRows = prepared.map((row, index) => ({
      statement_line_id: lineId,
      document_id: row.bill.id,
      allocated_amount: row.allocation.allocated_amount,
      platform_fee_diff: index === 0 ? fee : 0,
      created_by: owner.userId,
    }));
    const insertedIds: string[] = [];
    for (const row of allocationRows) {
      const inserted = await insertFlexible(supabase, "bank_reconciliation_allocations", row);
      if (inserted.error || !inserted.id) {
        await supabase.from("bank_reconciliation_allocations").delete().in("id", insertedIds);
        await restorePayments(supabase, snapshots);
        return { data: null, error: inserted.error ?? "บันทึกการชนยอดไม่สำเร็จ" };
      }
      insertedIds.push(inserted.id);
    }

    const nextMatched = cash + MONEY_EPSILON >= room ? deposit : roundMoney(matched + cash);
    const nextReconcile = nextMatched + MONEY_EPSILON >= deposit ? "MATCHED" : "PARTIAL";
    const { error: lineUpdateError } = await supabase
      .from("bank_statement_lines")
      .update({
        matched_amount: nextMatched,
        reconcile_status: nextReconcile,
      })
      .eq("id", lineId);
    if (lineUpdateError) {
      await supabase.from("bank_reconciliation_allocations").delete().in("id", insertedIds);
      await restorePayments(supabase, snapshots);
      return { data: null, error: lineUpdateError.message };
    }

    const warnings: string[] = [];
    for (const row of prepared) {
      if (row.paymentDelta <= 0) continue;
      const headerError = await syncPaymentToDocHeader(supabase, {
        documentId: row.bill.id,
        docNo: row.bill.doc_no,
        paidAmount: row.nextPaid,
        paymentStatus: row.nextStatus,
      });
      if (headerError) warnings.push(`${row.bill.doc_no}: ${headerError}`);
    }

    revalidatePath("/sales");
    revalidatePath("/sales/reconcile");
    return {
      data: {
        reconcile_status: nextReconcile,
        matched_amount: nextMatched,
        warnings,
      },
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "ยืนยันการชนยอดไม่สำเร็จ",
    };
  }
}

export async function searchOpenPurchaseBills(input: {
  keyword?: string;
  tx_date?: string;
}): Promise<SearchOpenBillsResult> {
  try {
    const owner = await requireSessionUserId();
    if (!owner.ok) return { data: [], error: owner.error };
    const supabase = createSupabaseServerClient();
    let query = supabase
      .from("documents")
      .select(BILL_SELECT)
      .in("doc_type", [...PURCHASE_DOC_TYPES])
      .not("status", "in", "(VOID,CANCELLED)")
      .order("doc_date", { ascending: false })
      .limit(80);
    const txDate = input.tx_date?.slice(0, 10) ?? "";
    const keyword = input.keyword?.trim().toLowerCase() ?? "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(txDate)) {
      query = query.gte("doc_date", shiftIso(txDate, -60)).lte("doc_date", shiftIso(txDate, 14));
    }
    const { data, error } = await query;
    if (error) return { data: [], error: error.message };
    const bills = (await hydrateBills(
      supabase,
      (data ?? []).map((row) => asRawBill(row as Record<string, unknown>)),
    ))
      .filter((bill) => bill.linkable_amount > MONEY_EPSILON)
      .filter((bill) => {
        if (!keyword) return true;
        const haystack = `${bill.doc_no} ${bill.customer_label ?? ""} ${bill.doc_type}`.toLowerCase();
        return haystack.includes(keyword);
      });
    return { data: bills.slice(0, 40), error: null };
  } catch (error) {
    return {
      data: [],
      error: error instanceof Error ? error.message : "ค้นหาเอกสารจ่ายไม่สำเร็จ",
    };
  }
}

export async function confirmWithdrawalRecord(
  input: ConfirmWithdrawalInput,
): Promise<ConfirmBankMatchResult> {
  try {
    const owner = await requireSessionUserId();
    if (!owner.ok) return { data: null, error: owner.error };
    const lineId = input.statement_line_id?.trim() ?? "";
    const memo = String(input.expense_memo ?? "").trim();
    const allocations = (input.allocations ?? []).filter(
      (row) => row.document_id && row.allocated_amount > 0,
    );
    if (!lineId) return { data: null, error: "ไม่พบรายการเดินบัญชี" };
    if (allocations.length === 0 && !memo) {
      return { data: null, error: "เลือกเอกสารจ่าย หรือกรอกบันทึกช่วยจำรายจ่าย" };
    }

    const supabase = createSupabaseServerClient();
    const { data: lineRow, error: lineError } = await supabase
      .from("bank_statement_lines")
      .select("id, withdrawal_amount, matched_amount, reconcile_status")
      .eq("id", lineId)
      .maybeSingle();
    if (lineError || !lineRow) {
      return { data: null, error: lineError?.message ?? "ไม่พบรายการเดินบัญชี" };
    }
    const withdrawal = roundMoney(Number(lineRow.withdrawal_amount ?? 0));
    const matched = roundMoney(Number(lineRow.matched_amount ?? 0));
    if (withdrawal <= 0) return { data: null, error: "รายการนี้ไม่ใช่ยอดจ่าย" };
    if (String(lineRow.reconcile_status ?? "") === "MATCHED") {
      return { data: null, error: "รายการนี้บันทึกยอดจ่ายแล้ว" };
    }

    const gross = roundMoney(
      allocations.reduce((sum, row) => sum + Number(row.allocated_amount ?? 0), 0),
    );
    if (gross - (withdrawal - matched) > MONEY_EPSILON) {
      return { data: null, error: "ยอดเอกสารจ่ายเกินยอดถอนคงเหลือ" };
    }

    for (const row of allocations) {
      const inserted = await insertFlexible(supabase, "bank_reconciliation_allocations", {
        statement_line_id: lineId,
        document_id: row.document_id,
        allocated_amount: roundMoney(row.allocated_amount),
        platform_fee_diff: 0,
        created_by: owner.userId,
      });
      if (inserted.error) return { data: null, error: inserted.error };
    }

    const covered =
      memo.length > 0 ||
      allocations.length === 0 ||
      gross + MONEY_EPSILON >= withdrawal - matched;
    const nextMatched = covered ? withdrawal : roundMoney(matched + gross);
    const { error: updateError } = await supabase
      .from("bank_statement_lines")
      .update({
        expense_memo: memo || null,
        tx_direction: "OUT",
        matched_amount: nextMatched,
        reconcile_status: covered ? "MATCHED" : "PARTIAL",
      })
      .eq("id", lineId);
    if (updateError) return { data: null, error: updateError.message };

    revalidatePath("/sales/reconcile");
    return {
      data: {
        reconcile_status: covered ? "MATCHED" : "PARTIAL",
        matched_amount: nextMatched,
        warnings: [],
      },
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "บันทึกยอดจ่ายไม่สำเร็จ",
    };
  }
}

async function restorePayments(
  supabase: Db,
  snapshots: { id: string; docNo: string; paid: number; status: string }[],
): Promise<void> {
  for (const row of snapshots) {
    await supabase
      .from("documents")
      .update({ paid_amount: row.paid, payment_status: row.status })
      .eq("id", row.id);
    await syncPaymentToDocHeader(supabase, {
      documentId: row.id,
      docNo: row.docNo,
      paidAmount: row.paid,
      paymentStatus: row.status,
    });
  }
}
