import Link from "next/link";
import { History, Layers, Tag } from "lucide-react";
import type { InventoryOverviewPayload } from "@/lib/actions/inventory";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

function formatQty(value: number): string {
  return value.toLocaleString("th-TH");
}

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function buildLedgerHref(args: {
  q?: string;
  productId: string;
  startDate?: string;
  endDate?: string;
}): string {
  const params = new URLSearchParams();
  if (args.q?.trim()) params.set("q", args.q.trim());
  params.set("productId", args.productId);
  if (args.startDate?.trim()) params.set("startDate", args.startDate.trim());
  if (args.endDate?.trim()) params.set("endDate", args.endDate.trim());
  return `/inventory/ledger?${params.toString()}`;
}

export type StockCardMatrixProps = {
  brands: InventoryOverviewPayload[];
  selectedProductId?: string;
  q?: string;
  startDate?: string;
  endDate?: string;
};

function findSelection(brands: InventoryOverviewPayload[], productId: string) {
  for (const brand of brands) {
    for (const model of brand.models) {
      for (const color of model.colors) {
        if (color.sizes.some((s) => s.product_id === productId)) {
          return {
            brandId: brand.brand_id,
            modelId: model.model_id,
            colorKey: `${model.model_id}::${color.color_code}`,
          };
        }
      }
    }
  }
  return null;
}

/**
 * Multi-brand Inventory Overview:
 * Brand card → Model Accordion → Color Accordion → Size table (sort_order)
 */
export function StockCardMatrix({
  brands,
  selectedProductId = "",
  q = "",
  startDate = "",
  endDate = "",
}: StockCardMatrixProps) {
  const selection = selectedProductId
    ? findSelection(brands, selectedProductId)
    : null;

  if (brands.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center text-sm text-slate-500">
        ไม่พบรุ่นสินค้าตามเงื่อนไขค้นหา
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {brands.map((brand) => {
        const defaultModels =
          selection?.brandId === brand.brand_id && selection.modelId
            ? [selection.modelId]
            : brand.models[0]
              ? [brand.models[0].model_id]
              : [];

        return (
          <section
            key={brand.brand_id}
            className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
          >
            {/* Level 1 — Brand */}
            <header className="flex items-start gap-3 border-b border-slate-100 bg-slate-50/80 px-5 py-3.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <Tag className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white">
                    BRAND
                  </span>
                  <h2 className="truncate text-sm font-semibold text-slate-800">
                    {brand.brand_name}
                  </h2>
                </div>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {brand.models.length.toLocaleString("th-TH")} รุ่น · ไซส์เรียงตาม
                  mst_sizes.sort_order
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                  Qty ทั้งแบรนด์
                </p>
                <p className="text-lg font-bold tabular-nums text-slate-900">
                  {formatQty(brand.total_brand_qty)}
                </p>
              </div>
            </header>

            {brand.models.length === 0 ? (
              <div className="px-5 py-8 text-center text-xs text-slate-400">
                ยังไม่มีรุ่นภายใต้แบรนด์นี้
              </div>
            ) : (
              <Accordion type="multiple" defaultValue={defaultModels}>
                {brand.models.map((model) => {
                  const defaultColors =
                    selection?.modelId === model.model_id && selection.colorKey
                      ? [selection.colorKey]
                      : model.colors[0]
                        ? [`${model.model_id}::${model.colors[0].color_code}`]
                        : [];

                  return (
                    <AccordionItem
                      key={model.model_id}
                      value={model.model_id}
                      className="border-b border-slate-100 px-5 last:border-b-0"
                    >
                      {/* Level 2 — Model */}
                      <AccordionTrigger className="py-3 hover:no-underline">
                        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2 pr-2">
                          <Layers className="h-3.5 w-3.5 text-slate-400" />
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-slate-600">
                            MODEL
                          </span>
                          <span className="font-mono text-xs font-bold text-slate-900">
                            {model.model_code}
                          </span>
                          <span className="text-sm font-semibold text-slate-800">
                            {model.model_name}
                          </span>
                          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium tabular-nums text-slate-600">
                            {formatQty(model.total_model_qty)} ชิ้น
                          </span>
                          <span className="text-[11px] text-slate-400">
                            {model.colors.length} สี
                          </span>
                        </span>
                      </AccordionTrigger>

                      <AccordionContent className="pb-3">
                        {model.colors.length === 0 ? (
                          <p className="py-4 text-center text-xs text-slate-400">
                            ยังไม่มี SKU ในรุ่นนี้
                          </p>
                        ) : (
                          <Accordion
                            type="multiple"
                            defaultValue={defaultColors}
                            className="rounded-xl border border-slate-200 bg-slate-50/40"
                          >
                            {model.colors.map((color) => {
                              const colorKey = `${model.model_id}::${color.color_code}`;
                              return (
                                <AccordionItem
                                  key={colorKey}
                                  value={colorKey}
                                  className="border-b border-slate-100 px-3 last:border-b-0"
                                >
                                  {/* Level 3 — Color */}
                                  <AccordionTrigger className="py-2.5 hover:no-underline">
                                    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2 pr-2">
                                      <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-slate-500 ring-1 ring-slate-200">
                                        COLOR
                                      </span>
                                      <span className="font-mono text-xs font-bold tracking-wide text-slate-900">
                                        {color.color_code}
                                      </span>
                                      <span className="text-sm font-medium text-slate-800">
                                        {color.color_name}
                                      </span>
                                      <span className="rounded-md bg-white px-2 py-0.5 text-[11px] font-medium tabular-nums text-slate-600 ring-1 ring-slate-200">
                                        {formatQty(color.total_color_qty)} ชิ้น
                                      </span>
                                    </span>
                                  </AccordionTrigger>

                                  {/* Level 4 — Size table (backend sort_order) */}
                                  <AccordionContent className="pb-3">
                                    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                                      <Table>
                                        <TableHeader>
                                          <TableRow className="bg-slate-50/90 hover:bg-slate-50/90">
                                            <TableHead className="h-9 px-3 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                              ไซส์ / SKU
                                            </TableHead>
                                            <TableHead className="h-9 w-[6rem] px-3 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                              คงเหลือ
                                            </TableHead>
                                            <TableHead className="h-9 w-[7.5rem] px-3 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                              Unit Cost
                                            </TableHead>
                                            <TableHead className="h-9 w-[7.5rem] px-3 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                              Value
                                            </TableHead>
                                            <TableHead className="h-9 w-[10rem] px-3 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                              การทำงาน
                                            </TableHead>
                                          </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                          {color.sizes.map((size) => {
                                            const selected =
                                              size.product_id ===
                                              selectedProductId;
                                            const totalValue =
                                              size.current_balance *
                                              size.unit_cost_price;
                                            return (
                                              <TableRow
                                                key={size.product_id}
                                                className={cn(
                                                  "text-xs",
                                                  selected
                                                    ? "bg-blue-50/70 hover:bg-blue-50/70"
                                                    : "hover:bg-slate-50/80",
                                                )}
                                              >
                                                <TableCell className="px-3 py-2.5">
                                                  <p className="text-xs font-medium text-slate-700">
                                                    ไซส์ {size.size_name}
                                                  </p>
                                                  <p className="mt-0.5 font-mono text-[11px] font-semibold text-blue-700">
                                                    {size.sku}
                                                  </p>
                                                </TableCell>
                                                <TableCell
                                                  className={cn(
                                                    "px-3 py-2.5 text-right font-semibold tabular-nums",
                                                    size.current_balance < 0
                                                      ? "text-red-600"
                                                      : size.current_balance ===
                                                          0
                                                        ? "text-slate-400"
                                                        : "text-slate-900",
                                                  )}
                                                >
                                                  {formatQty(
                                                    size.current_balance,
                                                  )}
                                                </TableCell>
                                                <TableCell className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                                                  ฿
                                                  {formatMoney(
                                                    size.unit_cost_price,
                                                  )}
                                                </TableCell>
                                                <TableCell className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900">
                                                  ฿{formatMoney(totalValue)}
                                                </TableCell>
                                                <TableCell className="px-3 py-2.5 text-right">
                                                  <Link
                                                    href={buildLedgerHref({
                                                      q,
                                                      productId:
                                                        size.product_id,
                                                      startDate,
                                                      endDate,
                                                    })}
                                                    scroll={false}
                                                    className={cn(
                                                      "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-semibold transition",
                                                      selected
                                                        ? "border-blue-500 bg-blue-600 text-white hover:bg-blue-700"
                                                        : "border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700",
                                                    )}
                                                  >
                                                    <History className="h-3.5 w-3.5" />
                                                    ดูความเคลื่อนไหว
                                                  </Link>
                                                </TableCell>
                                              </TableRow>
                                            );
                                          })}
                                        </TableBody>
                                      </Table>
                                    </div>
                                  </AccordionContent>
                                </AccordionItem>
                              );
                            })}
                          </Accordion>
                        )}
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            )}
          </section>
        );
      })}
    </div>
  );
}
