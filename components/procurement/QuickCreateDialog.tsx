"use client";

/**
 * "Quick Create SKU" dialog — adds a single new color/size variant onto an
 * EXISTING product model, for the On-the-fly mapping flow in Smart Goods
 * Receipt (`GoodsReceiptUI`).
 *
 * Zero Client-Side Fetching: every read (`getModelsByVendorForQuickCreate`,
 * `getSizesByBrand`) and write (`quickCreateSKU`) goes through Server
 * Actions in `lib/actions/product.ts` — this component only holds form
 * state, it never talks to Supabase directly.
 */

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { Loader2, PackagePlus } from "lucide-react";
import { toast } from "sonner";
import {
  getModelsByVendorForQuickCreate,
  getSizesByBrand,
  quickCreateSKU,
  type SizeOption,
  type VendorModelOption,
} from "@/lib/actions/product";
import type { ReceiptProductSummary } from "@/lib/actions/receipt";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const selectClassName =
  "flex h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 shadow-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400";

export type QuickCreateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendorId: string;
  /** Optional context label — the OCR raw vendor SKU this creation was triggered from. */
  vendorSkuHint?: string;
  onCreated: (product: ReceiptProductSummary) => void;
};

export default function QuickCreateDialog({
  open,
  onOpenChange,
  vendorId,
  vendorSkuHint,
  onCreated,
}: QuickCreateDialogProps) {
  const [models, setModels] = useState<VendorModelOption[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelId, setModelId] = useState("");

  const [sizes, setSizes] = useState<SizeOption[]>([]);
  const [isLoadingSizes, setIsLoadingSizes] = useState(false);
  const [sizeId, setSizeId] = useState("");

  const [colorCode, setColorCode] = useState("");
  const [unitCostPrice, setUnitCostPrice] = useState("");

  const [isPending, startTransition] = useTransition();

  const selectedModel = models.find((model) => model.id === modelId) ?? null;
  const selectedBrandId = selectedModel?.brand_id ?? null;

  // Reset form state on open/close and whenever the selected model changes —
  // "adjusting state during render" (React-sanctioned pattern) rather than an
  // effect, so no setState call ever runs synchronously inside an effect body.
  const [wasOpen, setWasOpen] = useState(open);
  const [lastModelId, setLastModelId] = useState(modelId);

  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setModelId("");
      setLastModelId("");
      setSizes([]);
      setSizeId("");
      setColorCode("");
      setUnitCostPrice("");
      if (!vendorId) setModels([]);
    }
  } else if (lastModelId !== modelId) {
    setLastModelId(modelId);
    setSizeId("");
    setSizes([]);
  }

  // Load models whenever the dialog opens for a (possibly new) vendor.
  useEffect(() => {
    if (!open || !vendorId) return;

    let active = true;
    void (async () => {
      setIsLoadingModels(true);
      const result = await getModelsByVendorForQuickCreate(vendorId);
      if (!active) return;
      setIsLoadingModels(false);
      if (result.error) {
        toast.error(result.error);
        setModels([]);
        return;
      }
      setModels(result.data);
    })();

    return () => {
      active = false;
    };
  }, [open, vendorId]);

  // Load the brand-scoped size run whenever the selected model changes.
  useEffect(() => {
    if (!selectedBrandId) return;

    let active = true;
    void (async () => {
      setIsLoadingSizes(true);
      const result = await getSizesByBrand(selectedBrandId);
      if (!active) return;
      setIsLoadingSizes(false);
      if (result.error) {
        toast.error(result.error);
        setSizes([]);
        return;
      }
      setSizes(result.data);
    })();

    return () => {
      active = false;
    };
  }, [selectedBrandId]);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isPending) return;

    if (!vendorId) {
      toast.error("กรุณาเลือกผู้จำหน่ายก่อน");
      return;
    }
    if (!modelId) {
      toast.error("กรุณาเลือกรุ่นสินค้า (Model)");
      return;
    }
    if (!sizeId) {
      toast.error("กรุณาเลือกไซส์");
      return;
    }
    if (!/^[A-Z]{3}$/.test(colorCode.trim().toUpperCase())) {
      toast.error("รหัสสีต้องเป็นตัวอักษรภาษาอังกฤษ 3 ตัวเท่านั้น (เช่น BLK, RED)");
      return;
    }
    const price = Number(unitCostPrice);
    if (!Number.isFinite(price) || price < 0) {
      toast.error("กรุณาระบุราคาทุน (Unit Cost Price) ให้ถูกต้อง");
      return;
    }

    startTransition(async () => {
      const result = await quickCreateSKU({
        model_id: modelId,
        color_code: colorCode.trim().toUpperCase(),
        size_id: sizeId,
        unit_price: price,
        vendor_id: vendorId,
      });

      if (result.error || !result.product) {
        toast.error(result.error ?? "สร้างสินค้าใหม่ไม่สำเร็จ");
        return;
      }

      toast.success(`สร้าง SKU ใหม่แล้ว: ${result.product.sku}`);
      onCreated(result.product);
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !isPending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>⚡ เพิ่มสี/ไซส์ จากรุ่นเดิม (Quick Create)</DialogTitle>
          <DialogDescription>
            {vendorSkuHint ? (
              <>
                สำหรับรหัสโรงงาน{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 text-xs font-semibold text-slate-700">
                  {vendorSkuHint}
                </code>{" "}
                — เลือกรุ่นสินค้าที่มีอยู่แล้ว แล้วเพิ่มสี/ไซส์ใหม่เข้าไป
              </>
            ) : (
              "เลือกรุ่นสินค้าที่มีอยู่แล้ว แล้วเพิ่มสี/ไซส์ใหม่เข้าไป"
            )}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label htmlFor="quick-sku-model">
              รุ่นสินค้า (Model) <span className="text-red-500">*</span>
            </Label>
            <select
              id="quick-sku-model"
              className={selectClassName}
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              disabled={isLoadingModels || isPending}
              required
            >
              <option value="">
                {isLoadingModels
                  ? "กำลังโหลดรุ่นสินค้า..."
                  : models.length === 0
                    ? "ไม่พบรุ่นสินค้าของผู้จำหน่ายนี้"
                    : "เลือกรุ่นสินค้า..."}
              </option>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.model_code} — {model.name}
                </option>
              ))}
            </select>
          </div>

          {selectedModel && (
            <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-100 bg-slate-50/70 p-3">
              <Badge variant="blue">🏷️ {selectedModel.brand_name ?? "ไม่มีแบรนด์"}</Badge>
              <Badge variant="emerald">📂 {selectedModel.category_name ?? "ไม่มีหมวดหมู่"}</Badge>
              <Badge variant="slate">รหัสรุ่น: {selectedModel.model_code}</Badge>
              {selectedModel.gender && (
                <Badge variant="amber">เพศ: {selectedModel.gender}</Badge>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="quick-sku-color">
                รหัสสี (3 ตัวอักษร) <span className="text-red-500">*</span>
              </Label>
              <Input
                id="quick-sku-color"
                value={colorCode}
                onChange={(e) => setColorCode(e.target.value.toUpperCase().slice(0, 3))}
                placeholder="เช่น BLK"
                maxLength={3}
                disabled={isPending}
                className="uppercase"
                required
              />
            </div>
            <div>
              <Label htmlFor="quick-sku-size">
                ไซส์ <span className="text-red-500">*</span>
              </Label>
              <select
                id="quick-sku-size"
                className={selectClassName}
                value={sizeId}
                onChange={(e) => setSizeId(e.target.value)}
                disabled={!selectedModel || isLoadingSizes || isPending}
                required
              >
                <option value="">
                  {!selectedModel
                    ? "เลือกรุ่นสินค้าก่อน"
                    : isLoadingSizes
                      ? "กำลังโหลดไซส์..."
                      : sizes.length === 0
                        ? "ไม่พบไซส์ของแบรนด์นี้"
                        : "เลือกไซส์..."}
                </option>
                {sizes.map((size) => (
                  <option key={size.id} value={size.id}>
                    {size.size_label} ({size.size_code})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <Label htmlFor="quick-sku-cost">
              ราคาทุน (Unit Cost Price) <span className="text-red-500">*</span>
            </Label>
            <Input
              id="quick-sku-cost"
              type="number"
              min={0}
              step="0.01"
              value={unitCostPrice}
              onChange={(e) => setUnitCostPrice(e.target.value)}
              placeholder="0.00"
              disabled={isPending}
              required
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => onOpenChange(false)}
            >
              ยกเลิก
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <PackagePlus className="size-4" aria-hidden />
              )}
              {isPending ? "กำลังสร้าง..." : "สร้าง SKU"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
