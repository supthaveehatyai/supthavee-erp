"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import type { ProductModelGroup } from "./types";

type ModelTreePanelProps = {
  models: ProductModelGroup[];
  selectedModelId: string;
  onSelectModel: (model: ProductModelGroup) => void;
  isLoading?: boolean;
  disabled?: boolean;
};

export function ModelTreePanel({
  models,
  selectedModelId,
  onSelectModel,
  isLoading = false,
  disabled = false,
}: ModelTreePanelProps) {
  if (isLoading) {
    return (
      <p className="px-1 py-10 text-center text-sm text-slate-400">
        กำลังโหลดรุ่นสินค้า...
      </p>
    );
  }

  if (models.length === 0) {
    return (
      <p className="px-1 py-10 text-center text-sm text-slate-400">
        ไม่พบ product_models ของ Vendor นี้
      </p>
    );
  }

  return (
    <Accordion type="multiple" defaultValue={[]} className="px-1">
      {models.map((model) => {
        const isSelected = model.id === selectedModelId;
        const skuCount = model.products.length;

        return (
          <AccordionItem key={model.id} value={model.id}>
            <div
              className={cn(
                "rounded-xl px-2 transition",
                isSelected && "bg-blue-50 ring-1 ring-blue-200",
              )}
            >
              <AccordionTrigger
                disabled={disabled}
                className="py-2.5"
                onClick={() => {
                  if (!disabled) onSelectModel(model);
                }}
              >
                <span className="block min-w-0">
                  <span className="block truncate font-mono text-[11px] font-bold text-blue-700">
                    {model.model_code}
                  </span>
                  <span className="mt-0.5 block truncate text-sm font-semibold text-slate-800">
                    {model.name}
                  </span>
                  <span className="mt-0.5 block text-[11px] font-normal text-slate-400">
                    {skuCount.toLocaleString("th-TH")} SKU
                    {model.status ? ` · ${model.status}` : ""}
                  </span>
                </span>
              </AccordionTrigger>

              <AccordionContent className="pb-2 pl-1">
                {skuCount === 0 ? (
                  <p className="px-2 py-2 text-xs text-slate-400">
                    ยังไม่มี SKU ในรุ่นนี้
                  </p>
                ) : (
                  <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-slate-100 bg-white p-2">
                    {model.products.map((product) => (
                      <li
                        key={product.id}
                        className="rounded-md px-2 py-1.5 hover:bg-slate-50"
                      >
                        <p className="font-mono text-[11px] font-semibold text-slate-700">
                          {product.sku}
                        </p>
                        <p className="text-[10px] text-slate-400">
                          {[product.color, product.size]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </AccordionContent>
            </div>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}
