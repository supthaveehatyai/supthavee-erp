"use client";

/**
 * Phase 11 — Thumbnail Preview Slide-over สำหรับหน้าสินค้าและราคา
 * URL-driven: `?preview_model_id=<uuid>`
 */

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ImageIcon, Loader2, Package } from "lucide-react";
import { getProductModelPreview } from "@/app/products/actions/product-matrix";
import type { ProductModelPreview } from "@/types/product-preview";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const PREVIEW_PARAM = "preview_model_id";

function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  const display = value?.trim() || "—";
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2 border-b border-slate-100 py-2.5 last:border-b-0">
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd
        className={
          mono
            ? "font-mono text-sm font-semibold text-slate-900"
            : "text-sm text-slate-800"
        }
      >
        {display}
      </dd>
    </div>
  );
}

export function ProductModelPreviewSheet() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const modelId = searchParams.get(PREVIEW_PARAM)?.trim() || "";
  const open = Boolean(modelId);

  const [preview, setPreview] = useState<ProductModelPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!modelId) {
      setPreview(null);
      setError(null);
      return;
    }

    let active = true;
    startTransition(async () => {
      const result = await getProductModelPreview(modelId);
      if (!active) return;
      if (result.error || !result.data) {
        setPreview(null);
        setError(result.error ?? "ไม่พบรุ่นสินค้า");
        return;
      }
      setError(null);
      setPreview(result.data);
    });

    return () => {
      active = false;
    };
  }, [modelId]);

  function closeSheet() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete(PREVIEW_PARAM);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function handleOpenChange(next: boolean) {
    if (!next) closeSheet();
  }

  const imageSrc = (preview?.image_url ?? "").trim().split("?")[0];

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto p-0 sm:max-w-md"
      >
        <div className="flex h-full flex-col">
          <SheetHeader className="text-left">
            <SheetTitle>ตัวอย่างรูปสินค้า</SheetTitle>
            <SheetDescription>
              Visual Verification — รายละเอียดรุ่นจาก Master Data
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-1 flex-col gap-4 px-6 py-5">
            {isPending && !preview && !error ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-slate-400">
                <Loader2 className="size-6 animate-spin" />
                <p className="text-xs">กำลังโหลด...</p>
              </div>
            ) : null}

            {error && !preview ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
                <Package className="size-10 text-slate-300" />
                <p className="text-sm font-medium text-red-600">{error}</p>
                <Button type="button" variant="outline" onClick={closeSheet}>
                  ปิด
                </Button>
              </div>
            ) : null}

            {preview ? (
              <>
                <div className="flex h-64 w-full items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                  {imageSrc ? (
                    <Dialog>
                      <DialogTrigger asChild>
                        <button
                          type="button"
                          className="group relative h-full w-full cursor-zoom-in overflow-hidden rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                          aria-label="ขยายดูรูปสินค้า"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element -- Storage public URL */}
                          <img
                            src={imageSrc}
                            alt={preview.name || preview.model_code}
                            className="h-64 w-full object-contain p-2 transition-opacity group-hover:opacity-80"
                          />
                        </button>
                      </DialogTrigger>
                      <DialogContent
                        aria-describedby={undefined}
                        className="max-w-[min(90vw,56rem)] border-0 bg-transparent p-0 shadow-none [&>button]:hidden"
                      >
                        <DialogTitle className="sr-only">
                          ขยายรูปสินค้า {preview.name || preview.model_code}
                        </DialogTitle>
                        {/* eslint-disable-next-line @next/next/no-img-element -- Storage public URL */}
                        <img
                          src={imageSrc}
                          alt={preview.name || preview.model_code}
                          className="h-auto max-h-[80vh] w-full object-contain"
                        />
                      </DialogContent>
                    </Dialog>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-slate-300">
                      <ImageIcon className="size-12" />
                      <p className="text-xs text-slate-400">ยังไม่มีรูปภาพ</p>
                    </div>
                  )}
                </div>

                <dl className="rounded-xl border border-slate-200 bg-white px-4">
                  <DetailRow
                    label="รหัสรุ่น"
                    value={preview.model_code}
                    mono
                  />
                  <DetailRow label="ชื่อรุ่น" value={preview.name} />
                  <DetailRow
                    label="ชื่อสั้น"
                    value={preview.short_name}
                  />
                  <DetailRow
                    label="หมวดหมู่"
                    value={
                      preview.category_name
                        ? preview.category_code
                          ? `${preview.category_name} (${preview.category_code})`
                          : preview.category_name
                        : preview.category_code
                    }
                  />
                  <DetailRow
                    label="แบรนด์"
                    value={
                      preview.brand_name
                        ? preview.brand_code
                          ? `${preview.brand_name} (${preview.brand_code})`
                          : preview.brand_name
                        : preview.brand_code
                    }
                  />
                  <DetailRow label="เพศ" value={preview.gender} />
                </dl>
              </>
            ) : null}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Helper — อัปเดต URL search param `preview_model_id` (คง query อื่นไว้) */
export function buildPreviewModelHref(
  pathname: string,
  currentParams: { toString(): string },
  modelId: string | null,
): string {
  const params = new URLSearchParams(currentParams.toString());
  if (modelId) params.set(PREVIEW_PARAM, modelId);
  else params.delete(PREVIEW_PARAM);
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export { PREVIEW_PARAM };
