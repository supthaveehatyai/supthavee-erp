"use client";

/**
 * Slide-over form — register / edit fixed asset.
 * Mutations via Server Actions only (Zero Client-Side Fetching).
 */

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  createFixedAsset,
  updateFixedAsset,
} from "@/app/actions/fixed-assets";
import type {
  AssetCategory,
  FixedAssetListItem,
  FixedAssetStatus,
} from "@/types/fixed-asset";
import {
  FIXED_ASSET_STATUS_LABELS,
  FIXED_ASSET_STATUSES,
} from "@/types/fixed-asset";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export type FixedAssetFormSheetProps = {
  open: boolean;
  mode: "create" | "edit";
  categories: AssetCategory[];
  initialAsset: FixedAssetListItem | null;
};

type FormState = {
  asset_code: string;
  asset_name: string;
  category_id: string;
  location: string;
  purchase_date: string;
  acquisition_cost: string;
  salvage_value: string;
  useful_life_years: string;
  remark: string;
  status: FixedAssetStatus;
};

function emptyForm(categories: AssetCategory[]): FormState {
  return {
    asset_code: "",
    asset_name: "",
    category_id: categories[0]?.id ?? "",
    location: "",
    purchase_date: new Date().toISOString().slice(0, 10),
    acquisition_cost: "",
    salvage_value: "0",
    useful_life_years: categories[0]
      ? String(categories[0].useful_life_years)
      : "",
    remark: "",
    status: "ACTIVE",
  };
}

function fromAsset(
  asset: FixedAssetListItem,
  categories: AssetCategory[],
): FormState {
  return {
    asset_code: asset.asset_code,
    asset_name: asset.asset_name,
    category_id: asset.category_id || categories[0]?.id || "",
    location: asset.location ?? "",
    purchase_date: asset.purchase_date,
    acquisition_cost: String(asset.acquisition_cost),
    salvage_value: String(asset.salvage_value ?? 0),
    useful_life_years:
      asset.useful_life_years == null ? "" : String(asset.useful_life_years),
    remark: asset.remark ?? "",
    status: asset.status,
  };
}

function closeSheetUrl(
  pathname: string,
  searchParams: URLSearchParams,
): string {
  const params = new URLSearchParams(searchParams.toString());
  params.delete("create");
  params.delete("edit_id");
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export function FixedAssetFormSheet({
  open,
  mode,
  categories,
  initialAsset,
}: FixedAssetFormSheetProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isSubmitting, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(() => emptyForm(categories));

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && initialAsset) {
      setForm(fromAsset(initialAsset, categories));
      return;
    }
    setForm(emptyForm(categories));
  }, [open, mode, initialAsset, categories]);

  function closeSheet() {
    if (isSubmitting) return;
    router.replace(closeSheetUrl(pathname, searchParams));
  }

  function handleCategoryChange(categoryId: string) {
    const category = categories.find((row) => row.id === categoryId);
    setForm((prev) => ({
      ...prev,
      category_id: categoryId,
      useful_life_years:
        mode === "create" && category
          ? String(category.useful_life_years)
          : prev.useful_life_years,
    }));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const acquisition_cost = Number(form.acquisition_cost);
    const salvage_value = Number(form.salvage_value || 0);
    const useful_life_years =
      form.useful_life_years.trim() === ""
        ? null
        : Number(form.useful_life_years);

    startTransition(async () => {
      if (mode === "edit" && initialAsset) {
        const result = await updateFixedAsset({
          id: initialAsset.id,
          asset_code: form.asset_code,
          asset_name: form.asset_name,
          category_id: form.category_id,
          location: form.location,
          purchase_date: form.purchase_date,
          acquisition_cost,
          salvage_value,
          useful_life_years,
          remark: form.remark,
          status: form.status,
        });
        if (!result.success) {
          toast.error(result.error ?? "ไม่สามารถแก้ไขสินทรัพย์ได้");
          return;
        }
        toast.success("บันทึกการแก้ไขสินทรัพย์แล้ว");
        router.replace(closeSheetUrl(pathname, searchParams));
        router.refresh();
        return;
      }

      const result = await createFixedAsset({
        asset_code: form.asset_code,
        asset_name: form.asset_name,
        category_id: form.category_id,
        location: form.location,
        purchase_date: form.purchase_date,
        acquisition_cost,
        salvage_value,
        useful_life_years,
        remark: form.remark,
      });
      if (!result.success) {
        toast.error(result.error ?? "ไม่สามารถลงทะเบียนสินทรัพย์ได้");
        return;
      }
      toast.success("ลงทะเบียนสินทรัพย์ถาวรแล้ว");
      router.replace(closeSheetUrl(pathname, searchParams));
      router.refresh();
    });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) closeSheet();
      }}
    >
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>
            {mode === "edit" ? "แก้ไขสินทรัพย์ถาวร" : "ลงทะเบียนสินทรัพย์ใหม่"}
          </SheetTitle>
          <SheetDescription>
            บันทึกผ่าน Server Action เท่านั้น — ราคาทุนใช้เป็นฐานคิดค่าเสื่อม (Straight-line)
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4 px-6 pb-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="asset_name">
                ชื่อทรัพย์สิน <span className="text-red-500">*</span>
              </Label>
              <Input
                id="asset_name"
                value={form.asset_name}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    asset_name: event.target.value,
                  }))
                }
                placeholder="เช่น คอมพิวเตอร์สำนักงาน"
                required
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="asset_code">
                รหัส <span className="text-red-500">*</span>
              </Label>
              <Input
                id="asset_code"
                value={form.asset_code}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    asset_code: event.target.value.toUpperCase(),
                  }))
                }
                placeholder="เช่น FA-COMP-001"
                required
                disabled={isSubmitting}
                className="font-mono"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="category_id">
                หมวดหมู่ <span className="text-red-500">*</span>
              </Label>
              <Select
                id="category_id"
                value={form.category_id}
                onChange={(event) => handleCategoryChange(event.target.value)}
                required
                disabled={isSubmitting || categories.length === 0}
              >
                <option value="" disabled>
                  เลือกหมวดหมู่
                </option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.category_code} — {category.category_name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="location">สถานที่ตั้ง</Label>
              <Input
                id="location"
                value={form.location}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    location: event.target.value,
                  }))
                }
                placeholder="เช่น สำนักงานหาดใหญ่ / โรงงานผลิต"
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="purchase_date">
                วันที่ซื้อ <span className="text-red-500">*</span>
              </Label>
              <Input
                id="purchase_date"
                type="date"
                value={form.purchase_date}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    purchase_date: event.target.value,
                  }))
                }
                required
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="acquisition_cost">
                ราคาทุน (Acquisition Cost) <span className="text-red-500">*</span>
              </Label>
              <Input
                id="acquisition_cost"
                type="number"
                min={0}
                step="0.01"
                value={form.acquisition_cost}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    acquisition_cost: event.target.value,
                  }))
                }
                placeholder="0.00"
                required
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="salvage_value">มูลค่าซาก (Salvage)</Label>
              <Input
                id="salvage_value"
                type="number"
                min={0}
                step="0.01"
                value={form.salvage_value}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    salvage_value: event.target.value,
                  }))
                }
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="useful_life_years">อายุการใช้งาน (ปี)</Label>
              <Input
                id="useful_life_years"
                type="number"
                min={1}
                max={100}
                step={1}
                value={form.useful_life_years}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    useful_life_years: event.target.value,
                  }))
                }
                disabled={isSubmitting}
              />
            </div>

            {mode === "edit" ? (
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="status">สถานะ</Label>
                <Select
                  id="status"
                  value={form.status}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      status: event.target.value as FixedAssetStatus,
                    }))
                  }
                  disabled={isSubmitting}
                >
                  {FIXED_ASSET_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {FIXED_ASSET_STATUS_LABELS[value]}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="remark">หมายเหตุ</Label>
              <Input
                id="remark"
                value={form.remark}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    remark: event.target.value,
                  }))
                }
                disabled={isSubmitting}
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={closeSheet}
              disabled={isSubmitting}
            >
              ยกเลิก
            </Button>
            <Button type="submit" disabled={isSubmitting || categories.length === 0}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  กำลังบันทึก...
                </>
              ) : mode === "edit" ? (
                "บันทึกการแก้ไข"
              ) : (
                "ลงทะเบียนสินทรัพย์"
              )}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
