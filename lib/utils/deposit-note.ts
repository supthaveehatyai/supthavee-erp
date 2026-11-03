const DEPOSIT_META =
  /^(amount|vat|vat_amt|net|grand|ref)=/i;

/** ตัด metadata หลังบ้านออกจากหมายเหตุใบมัดจำ เหลือข้อความที่แสดงต่อลูกค้า */
export function stripDepositNoteMetadata(
  value: string | null | undefined,
): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const pieces = raw
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
  const kept: string[] = [];
  let remark = "";

  for (const part of pieces) {
    const remarkMatch = /^remark=(.*)$/i.exec(part);
    if (remarkMatch) {
      remark = remarkMatch[1].trim();
      continue;
    }
    if (DEPOSIT_META.test(part)) continue;
    kept.push(part);
  }

  let text = kept.join(" ").replace(/\s+/g, " ").trim();
  const titled = text.match(
    /^(รับเงินมัดจำลูกค้า|จ่ายเงินมัดจำซัพพลายเออร์)\s+อ้างอิง\s+(\S+)$/,
  );
  if (titled) {
    text = `${titled[1]} (อ้างอิง ${titled[2]})`;
  }
  if (remark && !text.includes(remark)) {
    text = text ? `${text} ${remark}` : remark;
  }
  return text;
}

export function formatBuddhistSlash(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  return `${match[3]}/${match[2]}/${Number(match[1]) + 543}`;
}
