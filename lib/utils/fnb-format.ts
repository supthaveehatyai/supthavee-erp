const DISCRETE_UNITS = new Set([
  "กระป๋อง",
  "ขวด",
  "กล่อง",
  "ถุง",
  "ชิ้น",
  "ใบ",
  "แท่ง",
  "เล่ม",
  "โคน",
  "ลูก",
  "แพ็ค",
  "ลัง",
  "ห่อ",
  "แถว",
  "ml",
]);

export function formatFnbQty(qty: number | string | null | undefined, uom?: string, allowDecimal?: boolean): string {
  const amount = Number(qty ?? 0);
  const safe = Number.isFinite(amount) ? amount : 0;
  const unit = (uom || "").trim();
  const discrete = DISCRETE_UNITS.has(unit) || allowDecimal === false || Number.isInteger(safe);
  const shown = discrete
    ? Math.round(safe).toLocaleString("en-US")
    : String(Number(safe.toFixed(2)));
  return unit ? `${shown} ${unit}` : shown;
}

export function produceProfile(item: {
  is_catch_weight_produce?: boolean | null;
  piece_uom_label?: string | null;
  avg_gross_grams_per_piece?: number | null;
  prep_yield_pct?: number | null;
} | null | undefined) {
  const label = (item?.piece_uom_label || "").trim() || "ลูก";
  const avg = Number(item?.avg_gross_grams_per_piece) > 0 ? Number(item?.avg_gross_grams_per_piece) : 110;
  const yieldPct = Number(item?.prep_yield_pct) > 0 ? Number(item?.prep_yield_pct) : 80;
  return {
    enabled: item?.is_catch_weight_produce === true,
    label,
    avg,
    yieldPct,
    usablePerPiece: Math.round((avg * yieldPct) / 100),
  };
}

export function formatPrepPortionPct(packsDeducted: number, brewPortionMode?: string): string {
  const mode = (brewPortionMode || "").trim().toUpperCase();
  if (mode === "PCT_25") return "25%";
  if (mode === "PCT_50") return "50%";
  if (mode === "PCT_75") return "75%";
  const packs = Number(packsDeducted);
  if (Number.isFinite(packs) && packs > 0 && packs < 1) return `${Math.round(packs * 100)}%`;
  if (mode === "FULL_RECIPE" || mode === "1" || packs === 1) return "100%";
  if (Number.isFinite(packs) && packs > 1 && packs <= 100 && Number.isInteger(packs)) return `${Math.round(packs)}%`;
  if (Number.isFinite(packs) && packs > 0) return `${Math.round(packs * 100)}%`;
  return "100%";
}
