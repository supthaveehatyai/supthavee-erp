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
  BillMatchSuggestion,
  ConfirmBankMatchInput,
  ConfirmBankMatchResult,
  ImportKtbStatementResult,
  ListBankLinesResult,
  OpenSalesBill,
  SearchOpenBillsInput,
  SearchOpenBillsResult,
  SuggestBillMatchesResult,
} from "@/types/bank-reconcile";
import type { ParsedKtbLine } from "@/types/bank-reconcile";

const SALES_DOC_TYPES = ["INV_DO", "TAX_INV", "CS_TAX", "ABB", "DEP_IN"] as const;
const OPEN_DOC_STATUSES = ["ISSUED", "COMPLETED", "PAID"] as const;
const CASH_DOC_TYPES = new Set(["ABB", "CS_TAX"]);
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
    reconcile_status: String(row.reconcile_status ?? "UNMATCHED"),
    matched_amount: roundMoney(Number(row.matched_amount ?? 0)),
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
      file_name: file.name.slice(0, 180),
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

export async function listBankStatementLines(
  scope: "open" | "all" = "open",
): Promise<ListBankLinesResult> {
  try {
    const owner = await requireSessionUserId();
    if (!owner.ok) return { data: [], error: owner.error };
    const supabase = createSupabaseServerClient();
    let query = supabase
      .from("bank_statement_lines")
      .select(
        "id, tx_date, tx_time, tx_code, description, payer_hint, withdrawal_amount, deposit_amount, balance_amount, reconcile_status, matched_amount",
      )
      .order("tx_date", { ascending: false })
      .limit(200);
    if (scope === "open") {
      query = query
        .gt("deposit_amount", 0)
        .in("reconcile_status", ["UNMATCHED", "PARTIAL"]);
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
    return {
      data: (data ?? []).map((row) => mapLine(row as Record<string, unknown>)),
      error: null,
    };
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

function toOpenBill(row: RawBill, allocated: number, customer: string | null): OpenSalesBill {
  const grand = roundMoney(Number(row.grand_total ?? 0));
  const paid = roundMoney(Number(row.paid_amount ?? 0));
  const outstanding = roundMoney(Math.max(0, grand - paid));
  const unlinked = roundMoney(Math.max(0, grand - allocated));
  const linkable =
    CASH_DOC_TYPES.has(row.doc_type) || row.doc_type === "DEP_IN"
      ? roundMoney(Math.max(outstanding, unlinked))
      : roundMoney(Math.min(outstanding, unlinked));
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
    linkable_amount: linkable,
    payment_status: row.payment_status,
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
  };
}

const BILL_SELECT =
  "id, doc_no, doc_type, doc_date, sales_channel, contact_id, ecommerce_order_no, grand_total, paid_amount, payment_status, status";

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
    const { data, error } = await supabase
      .from("documents")
      .select(BILL_SELECT)
      .in("doc_type", [...SALES_DOC_TYPES])
      .in("status", [...OPEN_DOC_STATUSES])
      .gte("doc_date", from)
      .lte("doc_date", to)
      .order("doc_date", { ascending: false })
      .limit(400);
    if (error) return { data: [], error: error.message };

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

    const merged = new Map<string, RawBill>();
    for (const row of [...(data ?? []).map((item) => asRawBill(item as Record<string, unknown>)), ...extra]) {
      merged.set(row.id, row);
    }
    const bills = (await hydrateBills(supabase, [...merged.values()])).filter(
      (bill) => bill.linkable_amount > MONEY_EPSILON,
    );

    const suggestions: BillMatchSuggestion[] = [];
    for (const bill of bills) {
      const dated = withinDays(bill.doc_date, line.tx_date, 7);
      const docHit = line.description.includes(bill.doc_no);
      if (dated && sameMoney(bill.linkable_amount, remaining)) {
        suggestions.push({
          ...bill,
          reason: "ยอดตรงกับเงินฝาก",
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
    const keyword = input.keyword?.trim() ?? "";
    const channel = input.sales_channel?.trim() || "";
    let query = supabase
      .from("documents")
      .select(BILL_SELECT)
      .in("doc_type", [...SALES_DOC_TYPES])
      .in("status", [...OPEN_DOC_STATUSES])
      .order("doc_date", { ascending: false })
      .limit(80);
    if (channel) query = query.eq("sales_channel", channel);
    const txDate = input.tx_date?.slice(0, 10) ?? "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(txDate) && !keyword) {
      query = query.gte("doc_date", shiftIso(txDate, -31)).lte("doc_date", shiftIso(txDate, 31));
    }
    if (keyword) {
      const safe = keyword.replace(/[%_,]/g, " ").trim();
      query = query.or(`doc_no.ilike.%${safe}%,ecommerce_order_no.ilike.%${safe}%`);
    }
    const { data, error } = await query;
    if (error) return { data: [], error: error.message };

    let rows = (data ?? []).map((row) => asRawBill(row as Record<string, unknown>));
    if (keyword && /[ก-๙a-z]/i.test(keyword)) {
      const safe = keyword.replace(/[%_,()"\\]/g, " ").trim();
      const { data: contacts } = await supabase
        .from("contacts")
        .select("id")
        .or(`nickname.ilike.%${safe}%,company_name.ilike.%${safe}%`)
        .limit(12);
      const contactIds = (contacts ?? []).map((row) => String(row.id));
      if (contactIds.length > 0) {
        const { data: byContact } = await supabase
          .from("documents")
          .select(BILL_SELECT)
          .in("contact_id", contactIds)
          .in("doc_type", [...SALES_DOC_TYPES])
          .in("status", [...OPEN_DOC_STATUSES])
          .order("doc_date", { ascending: false })
          .limit(40);
        const known = new Set(rows.map((row) => row.id));
        for (const row of byContact ?? []) {
          const bill = asRawBill(row as Record<string, unknown>);
          if (!known.has(bill.id)) rows.push(bill);
        }
      }
    }

    const bills = (await hydrateBills(supabase, rows)).filter(
      (bill) => bill.linkable_amount > MONEY_EPSILON,
    );
    return { data: bills.slice(0, 40), error: null };
  } catch (error) {
    return {
      data: [],
      error: error instanceof Error ? error.message : "ค้นหาบิลขายไม่สำเร็จ",
    };
  }
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
      .select("id, doc_no, doc_type, status, grand_total, paid_amount, payment_status")
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
        nextStatus: nextPaid + MONEY_EPSILON >= open.grand_total ? "PAID" : "PARTIAL",
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
