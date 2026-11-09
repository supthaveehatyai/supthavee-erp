"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { getModelMatrixForSale } from "@/lib/actions/product.actions";
import { getBundleKitById } from "@/lib/actions/product-actions";
import { buildBundleBillLines, type BundleSlotPick } from "@/lib/sales/bundle-lines";
import type { BundleKit } from "@/types/bundle-kit";
import type { SalesLineItem } from "@/types/document";
import type { ModelMatrixForSale, ModelMatrixSkuRow } from "@/types/product-sale";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type BundlePickerDialogProps = {
  kitId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (lines: SalesLineItem[]) => void;
};

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function groupByColor(skus: ModelMatrixSkuRow[]) {
  const groups = new Map<string, ModelMatrixSkuRow[]>();
  for (const sku of skus) {
    const key = sku.color_name?.trim() || sku.color_code?.trim() || "ไม่ระบุสี";
    const list = groups.get(key) ?? [];
    list.push(sku);
    groups.set(key, list);
  }
  return [...groups.entries()];
}

export function BundlePickerDialog({
  kitId,
  open,
  onOpenChange,
  onConfirm,
}: BundlePickerDialogProps) {
  const [kit, setKit] = useState<BundleKit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [matrices, setMatrices] = useState<Record<string, ModelMatrixForSale>>({});
  const [activeModelId, setActiveModelId] = useState<Record<string, string>>({});
  const [qtyByProductId, setQtyByProductId] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open || !kitId) return;
    setKit(null);
    setError(null);
    setMatrices({});
    setQtyByProductId({});
    startTransition(async () => {
      const loaded = await getBundleKitById(kitId);
      if (loaded.error || !loaded.data) {
        setError(loaded.error ?? "ไม่พบชุดเซ็ต");
        return;
      }
      setKit(loaded.data);
      const initialModel: Record<string, string> = {};
      for (const slot of loaded.data.slots) {
        initialModel[slot.id] = slot.models[0]?.model_id ?? "";
      }
      setActiveModelId(initialModel);
      const modelIds = [
        ...new Set(loaded.data.slots.flatMap((slot) => slot.models.map((model) => model.model_id))),
      ];
      const nextMatrices: Record<string, ModelMatrixForSale> = {};
      await Promise.all(
        modelIds.map(async (modelId) => {
          const matrix = await getModelMatrixForSale(modelId);
          if (matrix.success && matrix.data) nextMatrices[modelId] = matrix.data;
        }),
      );
      setMatrices(nextMatrices);
    });
  }, [open, kitId]);

  const slotTotals = useMemo(() => {
    if (!kit) return [] as number[];
    return kit.slots.map((slot) =>
      slot.models.reduce((sum, model) => {
        const matrix = matrices[model.model_id];
        if (!matrix) return sum;
        return (
          sum +
          matrix.skus.reduce((skuSum, sku) => {
            const qty = Number(qtyByProductId[sku.product_id] ?? 0);
            return skuSum + (Number.isFinite(qty) && qty > 0 ? qty : 0);
          }, 0)
        );
      }, 0),
    );
  }, [kit, matrices, qtyByProductId]);

  const balanced =
    slotTotals.length >= 2 &&
    slotTotals.every((qty) => qty > 0 && qty === slotTotals[0]);

  function confirm() {
    if (!kit || !balanced) return;
    const picks: BundleSlotPick[][] = kit.slots.map((slot) => {
      const rows: BundleSlotPick[] = [];
      for (const model of slot.models) {
        const matrix = matrices[model.model_id];
        if (!matrix) continue;
        for (const sku of matrix.skus) {
          const qty = Number(qtyByProductId[sku.product_id] ?? 0);
          if (!(qty > 0)) continue;
          rows.push({
            slot_name: slot.slot_name,
            model_price_delta: model.model_price_delta,
            size_upcharge_rules: slot.size_upcharge_rules,
            sku,
            qty,
          });
        }
      }
      return rows;
    });
    const lines = buildBundleBillLines(kit, picks);
    if (lines.length === 0) {
      setError("จำนวนในแต่ละช่องยังจับคู่เป็นชุดไม่ได้");
      return;
    }
    onConfirm(lines);
    onOpenChange(false);
  }

  const kitQty = balanced ? slotTotals[0] : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[min(1100px,calc(100vw-1.5rem))] max-w-none flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-slate-100 px-6 py-4">
          <DialogTitle>
            จับคู่ชุดเซ็ต: {kit ? `${kit.kit_code} (${kit.kit_name})` : "กำลังโหลดชุดเซ็ต"}
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}
          {pending && !kit ? (
            <p className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="size-4 animate-spin" />
              กำลังโหลดช่องเสื้อและกางเกง...
            </p>
          ) : null}
          {kit ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {kit.slots.map((slot) => {
                const modelId = activeModelId[slot.id] ?? slot.models[0]?.model_id ?? "";
                const matrix = matrices[modelId];
                return (
                  <section key={slot.id} className="rounded-xl border border-slate-200 p-3">
                    <h3 className="text-sm font-semibold text-slate-900">{slot.slot_name}</h3>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {slot.models.map((model) => (
                        <button
                          key={model.model_id}
                          type="button"
                          onClick={() =>
                            setActiveModelId((current) => ({
                              ...current,
                              [slot.id]: model.model_id,
                            }))
                          }
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${
                            model.model_id === modelId
                              ? "bg-blue-700 text-white"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {model.model_code || model.model_name}
                          {model.model_price_delta
                            ? ` +${formatMoney(model.model_price_delta)}`
                            : ""}
                        </button>
                      ))}
                    </div>
                    {slot.size_upcharge_rules.length > 0 ? (
                      <p className="mt-2 text-[11px] text-amber-800">
                        ไซส์ใหญ่บวกเพิ่ม:{" "}
                        {slot.size_upcharge_rules
                          .map((rule) => `${rule.size_code} +${formatMoney(rule.amount)}`)
                          .join(", ")}
                      </p>
                    ) : null}
                    {!matrix ? (
                      <p className="mt-3 text-xs text-slate-400">กำลังโหลดสีและไซส์...</p>
                    ) : (
                      <div className="mt-3 space-y-3">
                        {groupByColor(matrix.skus).map(([color, skus]) => (
                          <div key={color}>
                            <p className="text-xs font-semibold text-slate-600">{color}</p>
                            <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
                              {skus.map((sku) => (
                                <label key={sku.product_id} className="text-[11px] text-slate-500">
                                  <span className="mb-1 block">{sku.size_label || sku.size_code}</span>
                                  <Input
                                    type="number"
                                    min={0}
                                    step={1}
                                    value={qtyByProductId[sku.product_id] ?? ""}
                                    onChange={(event) =>
                                      setQtyByProductId((current) => ({
                                        ...current,
                                        [sku.product_id]: event.target.value,
                                      }))
                                    }
                                    className="h-8"
                                    aria-label={`${slot.slot_name} ${color} ${sku.size_label}`}
                                  />
                                </label>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          ) : null}
        </div>
        <DialogFooter className="shrink-0 flex-col items-stretch gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4 sm:flex-col">
          <p className="text-sm font-medium text-slate-800">
            {(kit?.slots ?? []).map((slot, index) => (
              <span key={slot.id}>
                {index > 0 ? " | " : ""}
                {slot.slot_name}รวม: {slotTotals[index] ?? 0} ตัว
              </span>
            ))}
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              ยกเลิก
            </Button>
            <Button type="button" disabled={!balanced || pending} onClick={confirm}>
              + เพิ่มชุดกีฬาลงบิล ({kitQty} ชุด)
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
