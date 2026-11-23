"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, ImageIcon, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { PosterColorwayCropperDialog } from "@/components/products/PosterColorwayCropperDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type {
  CatalogCategoryOption,
  ColorFamilyOption,
  ColorwayCatalogItem,
  ColorwayCatalogQuery,
} from "@/types/colorway-catalog";
import { cn } from "@/lib/utils";

type SalesCatalogWorkspaceProps = {
  filters: ColorwayCatalogQuery;
  items: ColorwayCatalogItem[];
  truncated: boolean;
  error: string | null;
  categories: CatalogCategoryOption[];
  families: ColorFamilyOption[];
};

type CropTarget = {
  modelId: string;
  modelCode: string;
  modelName: string;
};

const FAMILY_ORDER = [
  "ขาว/ครีม",
  "ดำ",
  "เทา/เงิน",
  "กรมท่า",
  "น้ำเงิน",
  "ฟ้า",
  "แดง/เลือดหมู",
  "ชมพู/บานเย็น",
  "ส้ม/อิฐ",
  "เหลือง/ทอง",
  "เขียว",
  "ม่วง",
  "น้ำตาล/กากี/เบจ",
  "หลากสี/อื่นๆ",
];

function formatBaht(value: number): string {
  const whole = Math.abs(value - Math.round(value)) < 0.001;
  return new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPriceSpan(min: number | null, max: number | null): string {
  if (min == null && max == null) return "—";
  const low = Math.min(min ?? max ?? 0, max ?? min ?? 0);
  const high = Math.max(min ?? max ?? 0, max ?? min ?? 0);
  if (Math.abs(low - high) < 0.005) return `฿${formatBaht(low)}`;
  return `฿${formatBaht(low)}–${formatBaht(high)}`;
}

function formatQty(value: number): string {
  if (Math.abs(value - Math.round(value)) < 0.001) return String(Math.round(value));
  return new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 }).format(value);
}

function customerText(item: ColorwayCatalogItem): string {
  const ready = item.sizes_breakdown.filter((size) => size.on_hand_qty > 0);
  const lines = [
    `${item.model_name} (${item.model_code})`,
    `สี ${item.color_name}`,
    `ราคาปลีก ${formatPriceSpan(item.min_retail_price, item.max_retail_price)}`,
    ready.length > 0
      ? `พร้อมส่ง ${ready.map((size) => `${size.size} ${formatQty(size.on_hand_qty)}`).join(", ")}`
      : "ยังไม่มีไซส์พร้อมส่ง",
  ];
  return lines.join("\n");
}

export function SalesCatalogWorkspace({
  filters,
  items,
  truncated,
  error,
  categories,
  families,
}: SalesCatalogWorkspaceProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [draftQ, setDraftQ] = useState(filters.q ?? "");
  const [cropTarget, setCropTarget] = useState<CropTarget | null>(null);
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(0);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const orderedFamilies = useMemo(() => {
    return [...families].sort((a, b) => {
      const ai = FAMILY_ORDER.indexOf(a.color_family_th);
      const bi = FAMILY_ORDER.indexOf(b.color_family_th);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.color_family_th.localeCompare(b.color_family_th, "th");
    });
  }, [families]);

  useEffect(() => {
    setDraftQ(filters.q ?? "");
  }, [filters.q]);

  function pushFilters(patch: Partial<ColorwayCatalogQuery>) {
    const current = filtersRef.current;
    const next: ColorwayCatalogQuery = {
      q: patch.q ?? current.q ?? "",
      family: patch.family ?? current.family ?? "",
      categoryId: patch.categoryId ?? current.categoryId ?? "",
      inStockOnly: patch.inStockOnly ?? current.inStockOnly ?? false,
    };
    const params = new URLSearchParams();
    const q = String(next.q ?? "").trim();
    if (q) params.set("q", q);
    if (next.family) params.set("family", next.family);
    if (next.categoryId) params.set("category", next.categoryId);
    if (next.inStockOnly) params.set("instock", "1");
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `/sales/catalog?${qs}` : "/sales/catalog", { scroll: false });
    });
  }

  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (draftQ.trim() === String(filters.q ?? "").trim()) return;
      pushFilters({ q: draftQ });
    }, 350);
    return () => window.clearTimeout(handle);
    // pushFilters closes over the latest filters; draftQ is the only trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftQ]);

  useEffect(() => {
    if (savedTick > 0) router.refresh();
  }, [savedTick, router]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-6 sm:px-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-slate-900">แคตตาล็อกรูป & สต็อก</h1>
        <p className="text-sm text-slate-500">
          ค้นด้วยชื่อทรงและสี เช่น คอกลมสั้น แดง, โปโล กรม หรือรหัสรุ่น HA003S
        </p>
      </header>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={draftQ}
              onChange={(event) => setDraftQ(event.target.value)}
              placeholder="ค้นหา คอกลมสั้น แดง, โปโล กรม, HA003S"
              className="pl-9"
              aria-label="ค้นหาแคตตาล็อก"
            />
          </div>
          <select
            value={filters.categoryId ?? ""}
            onChange={(event) => pushFilters({ categoryId: event.target.value })}
            className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800"
            aria-label="หมวดหมู่"
          >
            <option value="">ทุกหมวด</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.category_code} · {category.category_name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <Switch
              checked={filters.inStockOnly === true}
              onCheckedChange={(checked) => pushFilters({ inStockOnly: checked })}
              aria-label="เฉพาะพร้อมส่ง"
            />
            เฉพาะพร้อมส่ง (มีสต็อก &gt; 0)
          </label>
          {isPending ? <Loader2 className="size-4 animate-spin text-slate-400" /> : null}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => pushFilters({ family: "" })}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium",
              !filters.family
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
            )}
          >
            ทั้งหมด
          </button>
          {orderedFamilies.map((family) => {
            const active = filters.family === family.color_family;
            return (
              <button
                key={family.color_family}
                type="button"
                onClick={() =>
                  pushFilters({ family: active ? "" : family.color_family })
                }
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
                  active
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                )}
              >
                <span
                  className="size-2.5 rounded-full border border-black/10"
                  style={{ backgroundColor: family.hex_code || "#CBD5E1" }}
                />
                {family.color_family_th}
              </button>
            );
          })}
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {truncated ? (
        <p className="text-xs text-amber-700">
          แสดง {items.length} รายการแรก — แคบคำค้น ตระกูลสี หรือหมวด เพื่อดูรายการที่เหลือ
        </p>
      ) : (
        <p className="text-xs text-slate-500">{items.length} รุ่น-สี</p>
      )}

      {items.length === 0 && !error ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center text-sm text-slate-500">
          ไม่พบสินค้าที่ตรงกับตัวกรองนี้
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {items.map((item) => {
            const image = item.display_image_url || "";
            return (
              <article
                key={`${item.model_id}-${item.color_id}`}
                className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
              >
                <div className="relative flex h-56 items-center justify-center bg-slate-50">
                  {image ? (
                    <button
                      type="button"
                      className="h-full w-full cursor-zoom-in"
                      onClick={() => setZoomUrl(image)}
                      aria-label={`ขยายรูป ${item.model_name} สี ${item.color_name}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- public catalog image */}
                      <img
                        src={image}
                        alt={`${item.model_name} ${item.color_name}`}
                        className="h-full w-full object-contain p-2"
                      />
                    </button>
                  ) : (
                    <ImageIcon className="size-10 text-slate-300" />
                  )}
                  <Badge
                    className={cn(
                      "absolute left-2 top-2 border-0",
                      item.has_colorway_image
                        ? "bg-emerald-600 text-white"
                        : "bg-slate-700/80 text-white",
                    )}
                  >
                    {item.has_colorway_image ? "รูปเฉพาะสี" : "โปสเตอร์รวม"}
                  </Badge>
                </div>
                <div className="flex flex-1 flex-col gap-3 p-4">
                  <div>
                    <p className="font-mono text-xs font-semibold text-blue-700">
                      {item.model_code}
                    </p>
                    <h2 className="line-clamp-2 text-sm font-semibold text-slate-900">
                      {item.model_name}
                    </h2>
                    <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-slate-600">
                      <span
                        className="size-2.5 rounded-full border border-black/10"
                        style={{ backgroundColor: item.hex_code || "#CBD5E1" }}
                      />
                      {item.color_name}
                      <span className="font-mono text-slate-400">({item.color_code})</span>
                    </p>
                  </div>
                  <dl className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                      <dt className="text-slate-500">ราคาปลีก</dt>
                      <dd className="font-semibold text-slate-900">
                        {formatPriceSpan(item.min_retail_price, item.max_retail_price)}
                      </dd>
                    </div>
                    <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                      <dt className="text-slate-500">ราคาส่ง</dt>
                      <dd className="font-semibold text-slate-900">
                        {formatPriceSpan(item.min_wholesale_price, item.max_wholesale_price)}
                      </dd>
                    </div>
                  </dl>
                  <p className="text-sm font-medium text-slate-800">
                    พร้อมส่งรวม{" "}
                    <span className={item.total_on_hand_qty > 0 ? "text-emerald-700" : "text-slate-400"}>
                      {formatQty(item.total_on_hand_qty)}
                    </span>
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {item.sizes_breakdown.map((size) => (
                      <span
                        key={`${item.color_id}-${size.product_id}-${size.size}`}
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-medium",
                          size.on_hand_qty > 0
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-slate-100 text-slate-400",
                        )}
                      >
                        {size.size}: {formatQty(size.on_hand_qty)}
                      </span>
                    ))}
                  </div>
                  <div className="mt-auto flex flex-wrap gap-2 pt-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        void navigator.clipboard.writeText(customerText(item)).then(
                          () => toast.success("คัดลอกข้อความแจ้งลูกค้าแล้ว"),
                          () => toast.error("คัดลอกไม่สำเร็จ"),
                        );
                      }}
                    >
                      <Copy className="mr-1 size-3.5" />
                      คัดลอกข้อความแจ้งลูกค้า
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        setCropTarget({
                          modelId: item.model_id,
                          modelCode: item.model_code,
                          modelName: item.model_name,
                        })
                      }
                    >
                      ✂️ ตัดรูปแยกสี
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Dialog open={Boolean(zoomUrl)} onOpenChange={(open) => !open && setZoomUrl(null)}>
        <DialogContent className="max-w-[min(90vw,56rem)] border-0 bg-transparent p-0 shadow-none [&>button]:text-white">
          <DialogTitle className="sr-only">ขยายรูปสินค้า</DialogTitle>
          {zoomUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- lightbox
            <img src={zoomUrl} alt="" className="max-h-[80vh] w-full object-contain" />
          ) : null}
        </DialogContent>
      </Dialog>

      <PosterColorwayCropperDialog
        open={Boolean(cropTarget)}
        onOpenChange={(open) => {
          if (!open) setCropTarget(null);
        }}
        modelId={cropTarget?.modelId ?? ""}
        modelCode={cropTarget?.modelCode}
        modelName={cropTarget?.modelName}
        onSaved={() => setSavedTick((tick) => tick + 1)}
      />
    </div>
  );
}
