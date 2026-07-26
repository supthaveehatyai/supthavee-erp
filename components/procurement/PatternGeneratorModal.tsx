"use client";

/**
 * Smart Pattern Autofill — generates vendor_sku drafts for every SKU inside
 * a single product_model from a base pattern + per-color mapping.
 *
 * Pure client-side derivation over data already loaded by the parent
 * (Server Action) — never fetches anything itself. Zero Client-Side Fetching
 * is preserved: this only *transforms* props already in memory and hands
 * the result back to the parent via `onApply`.
 */

import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import type { MappedProductSku } from "@/lib/actions/mapping";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type ColorMap = Record<string, string>;

type PatternGeneratorModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modelCode: string;
  modelName: string;
  products: MappedProductSku[];
  /** Current draft values (vendor_sku) for this model's products only. */
  draftByProductId: Record<string, string>;
  /** Apply computed values back into the parent's draftByProductId state. */
  onApply: (values: Record<string, string>) => void;
};

/**
 * Formula: `{BasePattern}-{MappedColor}-{Size}` — missing segments (no
 * color / no size / no mapping override) are safely dropped instead of
 * leaving literal "undefined"/"null" fragments in the generated code.
 */
function buildVendorSku(
  basePattern: string,
  colorMap: ColorMap,
  product: MappedProductSku,
): string {
  const segments: string[] = [];

  const base = basePattern.trim();
  if (base) segments.push(base);

  if (product.color) {
    const mapped = (colorMap[product.color] ?? "").trim();
    segments.push(mapped || product.color.trim());
  }

  if (product.size?.trim()) segments.push(product.size.trim());

  return segments.join("-");
}

export default function PatternGeneratorModal({
  open,
  onOpenChange,
  modelCode,
  modelName,
  products,
  draftByProductId,
  onApply,
}: PatternGeneratorModalProps) {
  const [basePattern, setBasePattern] = useState("");
  const [colorMap, setColorMap] = useState<ColorMap>({});
  const [skipFilled, setSkipFilled] = useState(false);

  // Unique internal colors for this model, in first-seen order.
  const uniqueColors = useMemo(() => {
    const seen = new Set<string>();
    const colors: string[] = [];
    for (const product of products) {
      const color = product.color?.trim();
      if (color && !seen.has(color)) {
        seen.add(color);
        colors.push(color);
      }
    }
    return colors;
  }, [products]);

  const preview = useMemo(
    () =>
      products.map((product) => ({
        product,
        generated: buildVendorSku(basePattern, colorMap, product),
      })),
    [products, basePattern, colorMap],
  );

  const willFillCount = useMemo(
    () =>
      preview.filter(({ product, generated }) => {
        if (!generated) return false;
        if (skipFilled && (draftByProductId[product.id] ?? "").trim()) {
          return false;
        }
        return true;
      }).length,
    [preview, skipFilled, draftByProductId],
  );

  function resetState() {
    setBasePattern("");
    setColorMap({});
    setSkipFilled(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetState();
    onOpenChange(next);
  }

  function handleApply() {
    const values: Record<string, string> = {};

    for (const { product, generated } of preview) {
      if (!generated) continue;
      if (skipFilled && (draftByProductId[product.id] ?? "").trim()) continue;
      values[product.id] = generated;
    }

    onApply(values);
    handleOpenChange(false);
  }

  const canApply = basePattern.trim().length > 0 && willFillCount > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-blue-600" />
            Smart Pattern Autofill
          </DialogTitle>
          <DialogDescription>
            สร้างรหัส Vendor SKU อัตโนมัติให้ทั้งโมเดล{" "}
            <span className="font-mono text-blue-600">{modelCode}</span>{" "}
            <span className="text-slate-400">· {modelName}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Base pattern */}
          <div>
            <Label htmlFor="base-pattern">Base Pattern</Label>
            <Input
              id="base-pattern"
              value={basePattern}
              onChange={(event) => setBasePattern(event.target.value)}
              placeholder="เช่น [PL002]"
              className="font-mono"
              autoFocus
            />
            <p className="mt-1 text-xs text-slate-400">
              รูปแบบผลลัพธ์:{" "}
              <span className="font-mono text-slate-500">
                {"{BasePattern}-{MappedColor}-{Size}"}
              </span>
            </p>
          </div>

          {/* Color mapping */}
          <div>
            <Label>Color Mapping (ภายใน → รหัสของ Vendor)</Label>
            {uniqueColors.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-400">
                โมเดลนี้ไม่มีข้อมูลสี — ระบบจะข้ามส่วนสีในรหัสที่สร้าง
              </p>
            ) : (
              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                {uniqueColors.map((color) => (
                  <div key={color} className="flex items-center gap-2">
                    <span className="w-24 shrink-0 truncate rounded-md bg-slate-100 px-2 py-1.5 text-center font-mono text-xs font-medium text-slate-600">
                      {color}
                    </span>
                    <span className="text-slate-300">→</span>
                    <Input
                      value={colorMap[color] ?? ""}
                      onChange={(event) =>
                        setColorMap((current) => ({
                          ...current,
                          [color]: event.target.value,
                        }))
                      }
                      placeholder={`รหัสสีของ Vendor (ค่าเริ่มต้น: ${color})`}
                      className="h-9 font-mono text-xs"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Skip already-filled toggle */}
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={skipFilled}
              onChange={(event) => setSkipFilled(event.target.checked)}
              className="size-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-400"
            />
            ข้ามรายการที่กรอกรหัสไว้แล้ว (ไม่เขียนทับ)
          </label>

          {/* Live preview */}
          <div>
            <Label>ตัวอย่างผลลัพธ์ ({products.length} SKU)</Label>
            <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">
                      Internal SKU
                    </th>
                    <th className="px-3 py-2 text-left font-medium">
                      Vendor SKU (ใหม่)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {preview.map(({ product, generated }) => {
                    const wouldSkip =
                      skipFilled &&
                      Boolean((draftByProductId[product.id] ?? "").trim());
                    return (
                      <tr key={product.id}>
                        <td className="px-3 py-1.5 font-mono text-slate-600">
                          {product.sku}
                        </td>
                        <td className="px-3 py-1.5">
                          {!generated ? (
                            <span className="text-slate-300">—</span>
                          ) : wouldSkip ? (
                            <span className="font-mono text-slate-400 line-through">
                              {generated}
                            </span>
                          ) : (
                            <span className="font-mono font-medium text-emerald-700">
                              {generated}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <DialogFooter>
          <p className="mr-auto text-xs text-slate-500">
            {canApply
              ? `จะกรอกให้ ${willFillCount} SKU`
              : "กรอก Base Pattern เพื่อดูตัวอย่าง"}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
          >
            ยกเลิก
          </Button>
          <Button type="button" onClick={handleApply} disabled={!canApply}>
            <Sparkles className="mr-1.5 size-4" />
            Apply Pattern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
