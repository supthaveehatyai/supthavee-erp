import type { PaymentRegisterLine } from "@/types/payment-register";

function uniqueDocNos(docNos: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const docNo of docNos) {
    const value = docNo.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    unique.push(value);
  }
  unique.sort((left, right) => left.localeCompare(right, "en"));
  return unique;
}

function invoiceSpan(docNos: string[]): string {
  if (docNos.length === 0) return "—";
  if (docNos.length === 1) return docNos[0];
  const first = docNos[0];
  const last = docNos[docNos.length - 1];
  const firstCut = first.lastIndexOf("-");
  const lastCut = last.lastIndexOf("-");
  if (firstCut > 0 && lastCut > 0 && first.slice(0, firstCut) === last.slice(0, lastCut)) {
    return `${first}..${last.slice(lastCut + 1)}`;
  }
  return `${first}..${last}`;
}

function groupLabel(note: string, docNos: string[], compact: boolean): string {
  const bills = uniqueDocNos(docNos);
  if (bills.length === 0) return note || "—";
  if (!note) {
    if (!compact || bills.length <= 3) return bills.join(", ");
    return `${bills.length} บิล: ${invoiceSpan(bills)}`;
  }
  if (!compact || bills.length <= 3) return `${note} (${bills.join(", ")})`;
  return `${note} (${bills.length} บิล: ${invoiceSpan(bills)})`;
}

/** จัดกลุ่มใบวางบิลครั้งเดียว ตามด้วยบิลที่ตัดชำระ */
export function formatRegisterBillLabel(lines: PaymentRegisterLine[], compact: boolean): string {
  if (lines.length === 0) return "—";
  const groups = new Map<string, string[]>();
  const order: string[] = [];
  for (const line of lines) {
    const note = line.billingNoteNo?.trim() || "";
    const bill = line.invoiceDocNo?.trim() || "";
    if (!bill) continue;
    if (!groups.has(note)) {
      groups.set(note, []);
      order.push(note);
    }
    groups.get(note)?.push(bill);
  }
  if (order.length === 0) return "—";
  return order.map((note) => groupLabel(note, groups.get(note) ?? [], compact)).join(", ");
}

/** ยุบข้อความเดิมที่ขึ้นต้นเลขใบวางบิลซ้ำ เช่น `BR-1 (APT-1), BR-1 (APT-2)` */
export function compactRepeatedBillLabel(label: string): string {
  const parts = label
    .split(/,\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return "—";
  const groups = new Map<string, string[]>();
  const order: string[] = [];
  let grouped = false;
  for (const part of parts) {
    const match = part.match(/^([A-Z]{2,}-\d{4}-\d+)\s+\(([^)]+)\)$/i);
    if (!match) {
      if (!groups.has("")) {
        groups.set("", []);
        order.push("");
      }
      groups.get("")?.push(part);
      continue;
    }
    grouped = true;
    const note = match[1];
    if (!groups.has(note)) {
      groups.set(note, []);
      order.push(note);
    }
    groups.get(note)?.push(match[2]);
  }
  if (!grouped) return label;
  return order.map((note) => groupLabel(note, groups.get(note) ?? [], true)).join(", ");
}
