export function normalizeContactTaxId(raw: string): {
  value: string;
  warning: string | null;
} {
  const digits = raw.replace(/\D/g, "");
  if (digits.length > 13) {
    return {
      value: digits.slice(0, 13),
      warning: "เลขประจำตัวผู้เสียภาษีต้องไม่เกิน 13 หลัก",
    };
  }
  if (digits.length > 0 && digits.length < 13) {
    return {
      value: digits,
      warning: "เลขประจำตัวผู้เสียภาษีต้องครบ 13 หลัก",
    };
  }
  return { value: digits, warning: null };
}
