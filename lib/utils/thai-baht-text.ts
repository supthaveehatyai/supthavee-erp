/**
 * Thai Baht Text — แปลงตัวเลขเป็นคำอ่านเงินบาทภาษาไทย
 * ตัวอย่าง: 45 → "สี่สิบห้าบาทถ้วน" | 1500.25 → "หนึ่งพันห้าร้อยบาทยี่สิบห้าสตางค์"
 */

const DIGITS = [
  "ศูนย์",
  "หนึ่ง",
  "สอง",
  "สาม",
  "สี่",
  "ห้า",
  "หก",
  "เจ็ด",
  "แปด",
  "เก้า",
] as const;

/** ตำแหน่งภายในกลุ่มล้าน (หลักหน่วย → แสน) */
const PLACES = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"] as const;

/**
 * อ่านจำนวนเต็ม 0–999,999 เป็นคำไทย
 */
function readUnderMillion(n: number): string {
  if (n <= 0) return "";
  if (n < 10) return DIGITS[n];

  const digits = String(n).split("").map(Number);
  const len = digits.length;
  let out = "";

  for (let i = 0; i < len; i++) {
    const d = digits[i]!;
    const place = len - i - 1; // 0=หน่วย … 5=แสน

    if (d === 0) continue;

    if (place === 1) {
      // หลักสิบ
      if (d === 1) out += "สิบ";
      else if (d === 2) out += "ยี่สิบ";
      else out += `${DIGITS[d]}สิบ`;
    } else if (place === 0) {
      // หลักหน่วย
      if (d === 1 && len > 1) out += "เอ็ด";
      else out += DIGITS[d];
    } else {
      out += `${DIGITS[d]}${PLACES[place]}`;
    }
  }

  return out;
}

/**
 * อ่านจำนวนเต็ม ≥ 0 (รองรับหลักล้าน / ล้านล้าน)
 */
function readInteger(n: number): string {
  if (n === 0) return "ศูนย์";

  const parts: string[] = [];
  let remaining = n;
  let millionLevel = 0;

  while (remaining > 0) {
    const chunk = remaining % 1_000_000;
    if (chunk > 0) {
      const chunkText = readUnderMillion(chunk);
      const millionSuffix = "ล้าน".repeat(millionLevel);
      parts.unshift(`${chunkText}${millionSuffix}`);
    }
    remaining = Math.floor(remaining / 1_000_000);
    millionLevel += 1;
  }

  return parts.join("");
}

/**
 * แปลงยอดเงินเป็นตัวอักษรภาษาไทย (บาท/สตางค์)
 * - เศษสตางค์ = 0 → ลงท้ายด้วย "ถ้วน"
 * - มีเศษสตางค์ → ต่อด้วย "...สตางค์"
 */
export function numberToThaiBaht(amount: number): string {
  if (!Number.isFinite(amount)) return "—";

  const absolute = Math.abs(amount);
  const rounded = Math.round((absolute + Number.EPSILON) * 100) / 100;
  const baht = Math.floor(rounded);
  const satang = Math.round((rounded - baht) * 100);

  let text = `${readInteger(baht)}บาท`;
  if (satang === 0) {
    text += "ถ้วน";
  } else {
    text += `${readInteger(satang)}สตางค์`;
  }

  if (amount < 0) {
    text = `ลบ${text}`;
  }

  return text;
}

/** @deprecated ใช้ numberToThaiBaht แทน */
export function toThaiBahtText(amount: number): string {
  return numberToThaiBaht(amount);
}
