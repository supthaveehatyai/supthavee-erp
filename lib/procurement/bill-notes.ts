import type {
  ProcurementBillAttachment,
  ProcurementBillSet,
} from "@/types/procurement-bills";

const BILL_LINE = /(?:^|\n)\[#BILLS\](\{.*\})\s*$/;

export function sanitizeVendorRef(value: string | null | undefined): string {
  const cleaned = String(value ?? "")
    .trim()
    .replace(/[^\w.\-ก-๙]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return cleaned || "bill";
}

export function splitBillNotes(notes: string | null | undefined): {
  notes: string;
  bills: ProcurementBillSet;
} {
  const raw = String(notes ?? "");
  const match = raw.match(BILL_LINE);
  if (!match?.[1]) {
    return { notes: raw.trim(), bills: { attachment_urls: [], attachments: [] } };
  }
  const visible = raw.replace(BILL_LINE, "").trim();
  try {
    const parsed = JSON.parse(match[1]) as Partial<ProcurementBillSet>;
    const attachments = Array.isArray(parsed.attachments)
      ? parsed.attachments.filter(isAttachment)
      : [];
    const attachment_urls = Array.isArray(parsed.attachment_urls)
      ? parsed.attachment_urls.filter((url): url is string => typeof url === "string" && url.trim().length > 0)
      : attachments.map((item) => item.url);
    return {
      notes: visible,
      bills: {
        attachment_urls,
        attachments,
      },
    };
  } catch {
    return { notes: visible, bills: { attachment_urls: [], attachments: [] } };
  }
}

export function mergeBillNotes(
  notes: string | null | undefined,
  incoming: ProcurementBillSet,
): string {
  const current = splitBillNotes(notes);
  const seen = new Set(current.bills.attachments.map((item) => item.path));
  const attachments = [...current.bills.attachments];
  for (const item of incoming.attachments) {
    if (!item.path || seen.has(item.path)) continue;
    seen.add(item.path);
    attachments.push(item);
  }
  const attachment_urls = attachments.map((item) => item.url).filter(Boolean);
  const visible = current.notes;
  if (attachments.length === 0) return visible;
  const marker = `[#BILLS]${JSON.stringify({ attachment_urls, attachments })}`;
  return visible ? `${visible}\n${marker}` : marker;
}

export function billUrlsFromNotes(
  notes: string | null | undefined,
  fallbackUrl?: string | null,
): string[] {
  const parsed = splitBillNotes(notes).bills.attachment_urls;
  if (parsed.length > 0) return parsed;
  const fallback = fallbackUrl?.trim();
  return fallback ? [fallback] : [];
}

function isAttachment(value: unknown): value is ProcurementBillAttachment {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<ProcurementBillAttachment>;
  return typeof row.url === "string" && typeof row.path === "string";
}
