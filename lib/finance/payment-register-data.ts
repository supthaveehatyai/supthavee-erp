import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPages } from "@/lib/supabase/fetch-all-pages";
import { addIsoDays } from "@/lib/utils/billing-period";
import { formatRegisterBillLabel } from "@/lib/finance/payment-register-label";
import type {
  PaymentRegisterBank,
  PaymentRegisterChannelTotal,
  PaymentRegisterData,
  PaymentRegisterEntry,
  PaymentRegisterLine,
  PaymentRegisterQuery,
} from "@/types/payment-register";

type Admin = SupabaseClient;

type TxRow = {
  id: string;
  amount: number | string | null;
  payment_date: string | null;
  payment_method: string | null;
  bank_account_id: string | null;
  reference_no: string | null;
  attachment_url: string | null;
  document_id: string;
  is_voided: boolean | null;
};

type DocRow = {
  id: string;
  doc_no: string | null;
  doc_type: string | null;
  contact_id: string | null;
  notes: string | null;
  reference_no: string | null;
};

function money(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 100) / 100 : 0;
}

function chunk<T>(rows: T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    pages.push(rows.slice(index, index + size));
  }
  return pages;
}

function billLabel(lines: PaymentRegisterLine[]): string {
  return formatRegisterBillLabel(lines, false);
}

function mapRegisterLine(raw: unknown): PaymentRegisterLine {
  const row = (raw ?? {}) as Record<string, unknown>;
  const reference = row.referenceNo ?? row.reference_no;
  const note = row.billingNoteNo ?? row.billing_note_no;
  return {
    invoiceDocNo: String(row.invoiceDocNo ?? row.invoice_doc_no ?? "").trim(),
    referenceNo: reference ? String(reference) : null,
    billingNoteNo: note ? String(note) : null,
    billAmount: money((row.billAmount ?? row.bill_amount) as number | string | null),
    whtAmount: money((row.whtAmount ?? row.wht_amount) as number | string | null),
    netAmount: money((row.netAmount ?? row.net_amount) as number | string | null),
  };
}

function isMissingRegisterRpc(message: string): boolean {
  return /get_accounting_payment_receipt_register|PGRST202|schema cache|does not exist|could not find the function/i.test(
    message,
  );
}

async function loadBanks(supabase: Admin): Promise<PaymentRegisterBank[]> {
  const { data, error } = await supabase
    .from("mst_bank_accounts")
    .select("id, bank_name, account_no, is_active")
    .order("bank_name", { ascending: true });
  if (error || !data) return [];
  return data
    .filter((row) => row.is_active !== false)
    .map((row) => ({
      id: String(row.id),
      bankName: String(row.bank_name ?? "").trim() || "ธนาคาร",
      accountNo: String(row.account_no ?? "").trim(),
    }));
}

function summarize(rows: PaymentRegisterEntry[]): PaymentRegisterChannelTotal[] {
  const map = new Map<string, PaymentRegisterChannelTotal>();
  for (const row of rows) {
    const key = row.accountNo ? `${row.channelLabel}` : "เงินสด (Cash)";
    const current = map.get(key) ?? {
      key,
      label: row.channelLabel,
      accountNo: row.accountNo,
      inbound: 0,
      outbound: 0,
    };
    if (row.direction === "AR") current.inbound = money(current.inbound + row.amount);
    else current.outbound = money(current.outbound + row.amount);
    map.set(key, current);
  }
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, "th"));
}

async function loadRegisterFallback(
  supabase: Admin,
  input: PaymentRegisterQuery,
): Promise<PaymentRegisterEntry[]> {
  const fromIso = `${input.fromDate}T00:00:00+07:00`;
  const toExclusive = `${addIsoDays(input.toDate, 1)}T00:00:00+07:00`;
  const page = await fetchAllPages<TxRow>((from, to) =>
    supabase
      .from("payment_transactions")
      .select(
        "id, amount, payment_date, payment_method, bank_account_id, reference_no, attachment_url, document_id, is_voided",
      )
      .gte("payment_date", fromIso)
      .lt("payment_date", toExclusive)
      .order("payment_date", { ascending: true })
      .range(from, to),
  );
  if (page.error) throw new Error(page.error.message);
  const transactions = page.data.filter((row) => row.is_voided !== true && row.payment_date);
  if (transactions.length === 0) return [];

  const docIds = Array.from(new Set(transactions.map((row) => row.document_id).filter(Boolean)));
  const documents: DocRow[] = [];
  for (const ids of chunk(docIds, 200)) {
    const { data, error } = await supabase
      .from("documents")
      .select("id, doc_no, doc_type, contact_id, notes, reference_no")
      .in("id", ids);
    if (error) throw new Error(error.message);
    documents.push(...((data ?? []) as DocRow[]));
  }
  const docById = new Map(documents.map((row) => [row.id, row]));

  const contactIds = Array.from(
    new Set(documents.map((row) => row.contact_id).filter((id): id is string => Boolean(id))),
  );
  const contactById = new Map<string, { name: string; taxId: string | null }>();
  for (const ids of chunk(contactIds, 200)) {
    const { data, error } = await supabase
      .from("contacts")
      .select("id, company_name, tax_id")
      .in("id", ids);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      contactById.set(String(row.id), {
        name: String(row.company_name ?? "").trim() || "ไม่ระบุชื่อ",
        taxId: row.tax_id?.trim() || null,
      });
    }
  }

  const bankIds = Array.from(
    new Set(transactions.map((row) => row.bank_account_id).filter((id): id is string => Boolean(id))),
  );
  const bankById = new Map<string, { bankName: string; accountNo: string }>();
  for (const ids of chunk(bankIds, 200)) {
    const { data, error } = await supabase
      .from("mst_bank_accounts")
      .select("id, bank_name, account_no")
      .in("id", ids);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      bankById.set(String(row.id), {
        bankName: String(row.bank_name ?? "").trim(),
        accountNo: String(row.account_no ?? "").trim(),
      });
    }
  }

  const receiptIds = documents
    .filter((row) => row.doc_type === "PAY" || row.doc_type === "REC")
    .map((row) => row.id);
  type Alloc = {
    receipt_doc_id: string;
    invoice_doc_id: string;
    allocated_amount: number | string | null;
    wht_amount: number | string | null;
  };
  const allocations: Alloc[] = [];
  for (const ids of chunk(receiptIds, 200)) {
    const { data, error } = await supabase
      .from("document_allocations")
      .select("receipt_doc_id, invoice_doc_id, allocated_amount, wht_amount")
      .in("receipt_doc_id", ids);
    if (error) throw new Error(error.message);
    allocations.push(...((data ?? []) as Alloc[]));
  }

  const invoiceIds = Array.from(new Set(allocations.map((row) => row.invoice_doc_id)));
  const invoiceById = new Map<string, { docNo: string; referenceNo: string | null }>();
  for (const ids of chunk(invoiceIds, 200)) {
    const { data, error } = await supabase
      .from("documents")
      .select("id, doc_no, reference_no")
      .in("id", ids);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      invoiceById.set(String(row.id), {
        docNo: String(row.doc_no ?? "").trim(),
        referenceNo: row.reference_no?.trim() || null,
      });
    }
  }

  const invoiceDocNos = Array.from(
    new Set(Array.from(invoiceById.values()).map((row) => row.docNo).filter(Boolean)),
  );
  const headerIdByDocNo = new Map<string, string>();
  for (const docNos of chunk(invoiceDocNos, 200)) {
    const { data, error } = await supabase
      .from("doc_headers")
      .select("id, doc_no")
      .in("doc_no", docNos);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const docNo = String(row.doc_no ?? "").trim();
      if (docNo) headerIdByDocNo.set(docNo, String(row.id));
    }
  }

  const noteKeys = Array.from(
    new Set([
      ...invoiceIds,
      ...Array.from(headerIdByDocNo.values()),
    ]),
  );
  const noteIdByInvoiceKey = new Map<string, string[]>();
  for (const ids of chunk(noteKeys, 200)) {
    const { data, error } = await supabase
      .from("billing_note_items")
      .select("billing_note_id, invoice_id")
      .in("invoice_id", ids);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const key = String(row.invoice_id);
      const list = noteIdByInvoiceKey.get(key) ?? [];
      list.push(String(row.billing_note_id));
      noteIdByInvoiceKey.set(key, list);
    }
  }
  const noteIds = Array.from(new Set(Array.from(noteIdByInvoiceKey.values()).flat()));
  const noteNoById = new Map<string, { docNo: string; docType: string }>();
  for (const ids of chunk(noteIds, 200)) {
    const { data, error } = await supabase
      .from("doc_headers")
      .select("id, doc_no, doc_type")
      .in("id", ids);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const docType = String(row.doc_type ?? "");
      if (docType !== "BN" && docType !== "BR") continue;
      noteNoById.set(String(row.id), {
        docNo: String(row.doc_no ?? "").trim(),
        docType,
      });
    }
  }

  function noteForInvoice(invoiceId: string, invoiceDocNo: string, direction: "AP" | "AR"): string | null {
    const headerId = headerIdByDocNo.get(invoiceDocNo);
    const candidates = [
      ...(noteIdByInvoiceKey.get(invoiceId) ?? []),
      ...(headerId ? noteIdByInvoiceKey.get(headerId) ?? [] : []),
    ];
    const notes = candidates
      .map((id) => noteNoById.get(id))
      .filter((row): row is { docNo: string; docType: string } => Boolean(row?.docNo));
    const preferred = direction === "AP" ? "BR" : "BN";
    return notes.find((row) => row.docType === preferred)?.docNo ?? notes[0]?.docNo ?? null;
  }

  const linesByReceipt = new Map<string, PaymentRegisterLine[]>();
  for (const allocation of allocations) {
    const invoice = invoiceById.get(allocation.invoice_doc_id);
    const doc = docById.get(allocation.receipt_doc_id);
    const direction = doc?.doc_type === "REC" ? "AR" : "AP";
    const allocated = money(allocation.allocated_amount);
    const wht = money(allocation.wht_amount);
    const line: PaymentRegisterLine = {
      invoiceDocNo: invoice?.docNo || "—",
      referenceNo: invoice?.referenceNo ?? null,
      billingNoteNo: invoice
        ? noteForInvoice(allocation.invoice_doc_id, invoice.docNo, direction)
        : null,
      billAmount: allocated,
      whtAmount: wht,
      netAmount: money(allocated - wht),
    };
    const list = linesByReceipt.get(allocation.receipt_doc_id) ?? [];
    list.push(line);
    linesByReceipt.set(allocation.receipt_doc_id, list);
  }

  const rows: PaymentRegisterEntry[] = [];
  for (const tx of transactions) {
    const doc = docById.get(tx.document_id);
    if (!doc || (doc.doc_type !== "PAY" && doc.doc_type !== "REC")) continue;
    const direction = doc.doc_type === "REC" ? "AR" : "AP";
    if (input.direction === "AP" && direction !== "AP") continue;
    if (input.direction === "AR" && direction !== "AR") continue;
    const method = String(tx.payment_method ?? "").toUpperCase();
    const isCash = method === "CASH" || !tx.bank_account_id;
    if (input.channelId === "CASH" && !isCash) continue;
    if (input.channelId && input.channelId !== "CASH" && tx.bank_account_id !== input.channelId) {
      continue;
    }
    const bank = tx.bank_account_id ? bankById.get(tx.bank_account_id) : null;
    const contact = doc.contact_id ? contactById.get(doc.contact_id) : null;
    const lines = linesByReceipt.get(doc.id) ?? [];
    rows.push({
      id: tx.id,
      direction,
      paidAt: String(tx.payment_date),
      docNo: String(doc.doc_no ?? "").trim() || "—",
      contactName: contact?.name ?? "ไม่ระบุชื่อ",
      taxId: contact?.taxId ?? null,
      channelLabel: bank
        ? `${bank.bankName} • ${bank.accountNo}`
        : "เงินสด (Cash)",
      accountNo: bank?.accountNo ?? null,
      referenceNo: tx.reference_no?.trim() || null,
      slipUrl: tx.attachment_url?.trim() || null,
      notes: doc.notes?.trim() || null,
      amount: money(tx.amount),
      lines,
      billLabel: billLabel(lines),
    });
  }
  return rows;
}

function mapRpcRows(data: unknown): PaymentRegisterEntry[] | null {
  const list = Array.isArray(data) ? data : null;
  if (!list) return null;
  if (list.length === 0) return [];
  const first = list[0] as Record<string, unknown>;
  if (!first || typeof first !== "object" || !("docNo" in first || "doc_no" in first)) return null;
  return list.map((item) => {
    const row = item as Record<string, unknown>;
    const direction = String(row.direction ?? "") === "AR" ? "AR" : "AP";
    const lines = Array.isArray(row.lines) ? row.lines.map(mapRegisterLine) : [];
    return {
      id: String(row.id ?? ""),
      direction,
      paidAt: String(row.paidAt ?? row.paid_at ?? ""),
      docNo: String(row.docNo ?? row.doc_no ?? "—"),
      contactName: String(row.contactName ?? row.contact_name ?? "ไม่ระบุชื่อ"),
      taxId: row.taxId ? String(row.taxId) : row.tax_id ? String(row.tax_id) : null,
      channelLabel: String(row.channelLabel ?? row.channel_label ?? "เงินสด (Cash)"),
      accountNo: row.accountNo ? String(row.accountNo) : row.account_no ? String(row.account_no) : null,
      referenceNo: row.referenceNo ? String(row.referenceNo) : row.reference_no ? String(row.reference_no) : null,
      slipUrl: row.slipUrl ? String(row.slipUrl) : row.slip_url ? String(row.slip_url) : null,
      notes: row.notes ? String(row.notes) : null,
      amount: money(row.amount as number | string | null),
      lines,
      billLabel: String(row.billLabel ?? row.bill_label ?? billLabel(lines)),
    };
  });
}

export async function queryPaymentReceiptRegister(
  supabase: Admin,
  input: PaymentRegisterQuery,
): Promise<PaymentRegisterData> {
  const banks = await loadBanks(supabase);
  const rpc = supabase as unknown as {
    rpc: (
      fn: string,
      args: {
        p_direction: string;
        p_from_date: string;
        p_to_date: string;
        p_bank_account_id: string | null;
        p_payment_method: string | null;
      },
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
  const channelId =
    input.channelId && input.channelId !== "CASH" ? input.channelId : null;
  const { data, error } = await rpc.rpc("get_accounting_payment_receipt_register", {
    p_direction: input.direction,
    p_from_date: input.fromDate,
    p_to_date: input.toDate,
    p_bank_account_id: channelId,
    p_payment_method: input.channelId === "CASH" ? "CASH" : null,
  });
  let rows: PaymentRegisterEntry[];
  if (!error) {
    const mapped = mapRpcRows(data);
    rows = mapped ?? (await loadRegisterFallback(supabase, input));
  } else if (isMissingRegisterRpc(error.message)) {
    rows = await loadRegisterFallback(supabase, input);
  } else {
    return { rows: [], banks, channels: [], error: error.message };
  }
  return { rows, banks, channels: summarize(rows), error: null };
}
