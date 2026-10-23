/**
 * OCR vendor-SKU matching.
 * Spacing, case, and a few apparel synonyms must not turn a known mapping
 * into Unmatched. Size and color still have to agree before a fuzzy hit.
 */

const COLOR_WORDS = [
  "เลือดหมู",
  "เหลือง",
  "น้ำเงิน",
  "น้ำตาล",
  "ชมพู",
  "เขียว",
  "ครีม",
  "ขาว",
  "เทา",
  "ดำ",
  "กรม",
  "แดง",
  "ม่วง",
  "ส้ม",
  "ฟ้า",
] as const;

const MULTI_SIZE_TOKENS = ["5xl", "4xl", "3xl", "2xl", "xl"] as const;

export type ApparelAttributes = {
  /** Canonical size such as S, M, L, XL, 2XL. Several sizes join with "+". */
  sizeToken: string | null;
  /** Canonical color words. Several colors join with "+". */
  colorToken: string | null;
};

export type VendorSkuCandidate = {
  id: string;
  vendorSku: string;
  normalizedKey?: string | null;
};

function prepareOcrSkuText(text: string): string {
  return (text ?? "")
    .toLowerCase()
    .replace(/\u0E4D\u0E32/g, "\u0E33")
    .replace(/xxxxl/g, "4xl")
    .replace(/xxxl/g, "3xl")
    .replace(/xxl/g, "2xl")
    .replace(/size/g, "ไซส์")
    .replace(/ไซด์/g, "ไซส์")
    .replace(/ไชส์/g, "ไซส์");
}

/** Lowercase, apparel synonyms, then one glued token of Thai / a-z / 0-9. */
export function normalizeOcrSkuText(text: string): string {
  return prepareOcrSkuText(text)
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, "")
    .replace(/[^ก-๙a-z0-9]/g, "");
}

export function extractApparelAttributes(text: string): ApparelAttributes {
  const prepared = prepareOcrSkuText(text);
  const sizes = new Set<string>();
  let withoutMultiSizes = prepared;
  for (const token of MULTI_SIZE_TOKENS) {
    if (!withoutMultiSizes.includes(token)) continue;
    sizes.add(token.toUpperCase());
    withoutMultiSizes = withoutMultiSizes.split(token).join(" ");
  }

  const singleSize = /(?:^|[^a-z0-9])([smlf])(?![a-z0-9])/g;
  for (const match of withoutMultiSizes.matchAll(singleSize)) {
    sizes.add(match[1].toUpperCase());
  }

  const normalized = normalizeOcrSkuText(text);
  const colors = COLOR_WORDS.filter((word) => normalized.includes(word));

  return {
    sizeToken: sizes.size > 0 ? [...sizes].sort().join("+") : null,
    colorToken: colors.length > 0 ? [...colors].sort().join("+") : null,
  };
}

export function apparelAttributesMatch(
  left: ApparelAttributes,
  right: ApparelAttributes,
): boolean {
  return left.sizeToken === right.sizeToken && left.colorToken === right.colorToken;
}

/** Sørensen–Dice on character bigrams. Identical strings score 1. */
export function diceCoefficient(left: string, right: string): number {
  if (left === right) return 1;
  if (left.length < 2 || right.length < 2) return 0;

  const counts = new Map<string, number>();
  for (let index = 0; index < left.length - 1; index += 1) {
    const gram = left.slice(index, index + 2);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }

  let overlap = 0;
  for (let index = 0; index < right.length - 1; index += 1) {
    const gram = right.slice(index, index + 2);
    const available = counts.get(gram) ?? 0;
    if (available <= 0) continue;
    counts.set(gram, available - 1);
    overlap += 1;
  }

  return (2 * overlap) / (left.length + right.length - 2);
}

function candidateKey(candidate: VendorSkuCandidate): string {
  const stored = candidate.normalizedKey?.trim() ?? "";
  return stored || normalizeOcrSkuText(candidate.vendorSku);
}

export type VendorSkuMatchTier = "EXACT" | "NORMALIZED" | "FUZZY";

export type VendorSkuMatch<T extends VendorSkuCandidate> = {
  candidate: T;
  matchTier: VendorSkuMatchTier;
  similarityScore: number;
};

/**
 * 1. Exact trimmed text.
 * 2. Canonical normalized text, including a stored `normalized_key`.
 * 3. Dice >= 0.88 only when size and color tokens are identical.
 * A tied fuzzy score is left unmatched.
 */
export function matchVendorSkuWithConfidence<T extends VendorSkuCandidate>(
  ocrRawText: string,
  candidates: T[],
): VendorSkuMatch<T> | null {
  const raw = (ocrRawText ?? "").trim();
  const exact = candidates.find((candidate) => candidate.vendorSku.trim() === raw);
  if (exact) {
    return { candidate: exact, matchTier: "EXACT", similarityScore: 1 };
  }

  const normalized = normalizeOcrSkuText(ocrRawText);
  if (normalized) {
    const canonical = candidates.find(
      (candidate) => candidateKey(candidate) === normalized,
    );
    if (canonical) {
      return { candidate: canonical, matchTier: "NORMALIZED", similarityScore: 1 };
    }
  }

  if (normalized.length < 2) return null;

  const ocrAttributes = extractApparelAttributes(ocrRawText);
  let best: { candidate: T; score: number } | null = null;
  let runnerUp = 0;

  for (const candidate of candidates) {
    const key = candidateKey(candidate);
    if (key.length < 2) continue;
    if (!apparelAttributesMatch(ocrAttributes, extractApparelAttributes(candidate.vendorSku))) {
      continue;
    }
    const score = diceCoefficient(normalized, key);
    if (score < 0.88) continue;
    if (!best || score > best.score) {
      runnerUp = best?.score ?? 0;
      best = { candidate, score };
    } else if (score > runnerUp) {
      runnerUp = score;
    }
  }

  if (!best || best.score <= runnerUp) return null;
  return {
    candidate: best.candidate,
    matchTier: "FUZZY",
    similarityScore: best.score,
  };
}

export function matchVendorSkuCandidate<T extends VendorSkuCandidate>(
  ocrRawText: string,
  candidates: T[],
): T | null {
  return matchVendorSkuWithConfidence(ocrRawText, candidates)?.candidate ?? null;
}
