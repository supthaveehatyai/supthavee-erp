import type { BundleKit, BundleSizeUpcharge } from "@/types/bundle-kit";
import type { SalesBundleComponentLine, SalesLineItem } from "@/types/document";
import type { ModelMatrixSkuRow } from "@/types/product-sale";

export type BundleSlotPick = {
  slot_name: string;
  model_price_delta: number;
  size_upcharge_rules: BundleSizeUpcharge[];
  sku: ModelMatrixSkuRow;
  qty: number;
};

function roundMoney(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

export function upchargeForSize(
  rules: BundleSizeUpcharge[],
  sizeCode: string,
  sizeLabel: string,
): number {
  const wanted = [sizeCode, sizeLabel]
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  for (const rule of rules) {
    const key = rule.size_code.trim().toUpperCase();
    if (!key) continue;
    if (wanted.includes(key)) return roundMoney(rule.amount);
  }
  return 0;
}

function expandSlot(picks: BundleSlotPick[]): Array<BundleSlotPick & { unitCost: number }> {
  const units: Array<BundleSlotPick & { unitCost: number }> = [];
  for (const pick of picks) {
    const qty = Math.round(Number(pick.qty));
    if (!(qty > 0)) continue;
    const surcharge = upchargeForSize(
      pick.size_upcharge_rules,
      pick.sku.size_code,
      pick.sku.size_label,
    );
    for (let index = 0; index < qty; index += 1) {
      units.push({ ...pick, unitCost: surcharge });
    }
  }
  return units;
}

/**
 * จับคู่ลำดับชิ้นในแต่ละช่อง แล้วรวมชุดที่ราคาต่อหน่วยเท่ากันเป็นแถวหัวชุด
 * แถวลูกเก็บ SKU จริงไว้ตัดสต็อก ราคาขายอยู่ที่แถวแม่เท่านั้น
 */
export function buildBundleBillLines(
  kit: BundleKit,
  slotPicks: BundleSlotPick[][],
): SalesLineItem[] {
  const expanded = slotPicks.map((picks) => expandSlot(picks));
  const kitQty = expanded[0]?.length ?? 0;
  if (kitQty <= 0) return [];
  if (expanded.some((units) => units.length !== kitQty)) return [];

  const groups = new Map<
    string,
    {
      unitPrice: number;
      pairs: Array<Array<BundleSlotPick & { unitCost: number }>>;
    }
  >();

  for (let index = 0; index < kitQty; index += 1) {
    const pair = expanded.map((units) => units[index]);
    const unitPrice = roundMoney(
      kit.base_price +
        pair.reduce(
          (sum, unit) => sum + unit.model_price_delta + unit.unitCost,
          0,
        ),
    );
    const key = unitPrice.toFixed(2);
    const group = groups.get(key) ?? { unitPrice, pairs: [] };
    group.pairs.push(pair);
    groups.set(key, group);
  }

  const label = kit.short_name.trim() || kit.kit_name.trim() || kit.kit_code;
  const lines: SalesLineItem[] = [];

  for (const group of groups.values()) {
    const componentQty = new Map<string, SalesBundleComponentLine>();
    let costTotal = 0;
    for (const pair of group.pairs) {
      for (const unit of pair) {
        costTotal += Number(unit.sku.cost_price ?? 0);
        const existing = componentQty.get(unit.sku.product_id);
        if (existing) {
          existing.qty += 1;
          continue;
        }
        const name = unit.sku.name?.trim() || unit.sku.sku;
        componentQty.set(unit.sku.product_id, {
          product_id: unit.sku.product_id,
          sku: unit.sku.sku,
          description: `↳ ${unit.slot_name} ${unit.sku.sku} ${name}`.trim(),
          qty: 1,
          unit_cost_price: roundMoney(Number(unit.sku.cost_price ?? 0)),
        });
      }
    }
    const qty = group.pairs.length;
    const unitCost = qty > 0 ? roundMoney(costTotal / qty) : 0;
    lines.push({
      key: `bundle-${kit.id}-${group.unitPrice.toFixed(2)}-${Math.random().toString(36).slice(2, 8)}`,
      product_id: null,
      sku: kit.kit_code,
      description: label,
      qty,
      uom_used: "ชุด",
      unit_price: group.unitPrice,
      cost_price: unitCost,
      discount_text: "",
      discount_amount: 0,
      line_total: roundMoney(qty * group.unitPrice),
      image_url: null,
      is_service_item: false,
      is_service: false,
      bundle_kit_id: kit.id,
      is_bundle_header: true,
      bundle_components: [...componentQty.values()],
    });
  }

  return lines;
}

export function salesBundleDraftFields(row: {
  product_id?: string | null;
  is_service_item?: boolean;
  is_bundle_header?: boolean;
  bundle_kit_id?: string | null;
  bundle_components?: SalesBundleComponentLine[];
}) {
  const bundle = row.is_bundle_header === true;
  return {
    product_id: row.product_id?.trim() ? row.product_id : null,
    is_service_item: bundle ? false : !row.product_id || row.is_service_item === true,
    bundle_kit_id: bundle ? row.bundle_kit_id ?? null : null,
    is_bundle_header: bundle,
    bundle_components: bundle ? row.bundle_components ?? [] : undefined,
  };
}
