"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { bulkInsertVendorMappings } from "../api";
import type { BulkMappingInsertRow, ProductModelGroup } from "../types";
import {
  applyVendorSkuPattern,
  buildInitialVendorColorMap,
  collectUniqueColorCodes,
  colorCodeLabel,
  DEFAULT_VENDOR_SKU_PATTERN,
  type VendorColorMap,
} from "../lib/bulk-mapping";

export type BulkMappingFormProps = {
  selectedModel: ProductModelGroup | null;
  selectedVendorId: string;
  /** Called after a successful bulk insert (refresh mapping list, etc.) */
  onSuccess?: () => void;
};

/**
 * Smart Bulk Mapping Form
 * Maps internal color_code → vendor_color_code, expands Vendor SKU Pattern
 * across all SKUs of the selected model, then inserts vendor_product_mapping.
 */
export default function BulkMappingForm({
  selectedModel,
  selectedVendorId,
  onSuccess,
}: BulkMappingFormProps) {
  const [vendorSkuPattern, setVendorSkuPattern] = useState(
    DEFAULT_VENDOR_SKU_PATTERN,
  );
  const [vendorColorMap, setVendorColorMap] = useState<VendorColorMap>({});
  const [isSaving, setIsSaving] = useState(false);

  const colorCodes = useMemo(
    () =>
      selectedModel ? collectUniqueColorCodes(selectedModel.products) : [],
    [selectedModel],
  );

  useEffect(() => {
    if (!selectedModel) {
      setVendorSkuPattern(DEFAULT_VENDOR_SKU_PATTERN);
      setVendorColorMap({});
      return;
    }
    setVendorSkuPattern(DEFAULT_VENDOR_SKU_PATTERN);
    setVendorColorMap(buildInitialVendorColorMap(selectedModel));
  }, [selectedModel]);

  const previewRows = useMemo(() => {
    if (!selectedModel) return [];

    return selectedModel.products.slice(0, 5).map((product) => {
      const internalCode = (product.color_code ?? "").trim().toUpperCase();
      const vendorColor =
        vendorColorMap[internalCode]?.trim().toUpperCase() || "[COLOR]";
      const sizeToken =
        (product.size_code ?? product.size ?? "").trim() || "[SIZE]";

      const vendorSku = applyVendorSkuPattern(vendorSkuPattern, {
        MODEL: selectedModel.model_code,
        COLOR: vendorColor,
        SIZE: sizeToken,
      });

      return {
        id: product.id,
        internalSku: product.sku,
        vendorSku,
      };
    });
  }, [selectedModel, vendorSkuPattern, vendorColorMap]);

  function updateVendorColor(internalCode: string, value: string) {
    setVendorColorMap((current) => ({
      ...current,
      [internalCode]: value.toUpperCase().replace(/[^A-Z0-9-]/g, ""),
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;

    if (!selectedVendorId) {
      toast.error("กรุณาเลือกผู้จำหน่ายก่อน");
      return;
    }
    if (!selectedModel) {
      toast.error("กรุณาเลือกรุ่นสินค้าทางซ้าย");
      return;
    }

    const pattern = vendorSkuPattern.trim();
    if (!pattern) {
      toast.error("กรุณาระบุ Vendor SKU Pattern");
      return;
    }

    if (selectedModel.products.length === 0) {
      toast.error("รุ่นนี้ยังไม่มี SKU ให้จับคู่");
      return;
    }

    if (colorCodes.length === 0) {
      toast.error(
        "ไม่พบ color_code ใน SKU ของรุ่นนี้ — ตรวจสอบว่าสินค้ามีรหัสสี (เช่น BLK, NVY)",
      );
      return;
    }

    const missing = colorCodes.filter(
      (code) => !(vendorColorMap[code] ?? "").trim(),
    );
    if (missing.length > 0) {
      toast.error(
        `กรุณากรอก Vendor Color Code ให้ครบทุกสี (ขาด: ${missing.join(", ")})`,
      );
      return;
    }

    const rows: BulkMappingInsertRow[] = [];
    const seenVendorSkus = new Set<string>();

    for (const product of selectedModel.products) {
      const internalCode = (product.color_code ?? "").trim().toUpperCase();
      const vendorColor = (vendorColorMap[internalCode] ?? "").trim().toUpperCase();
      const sizeToken = (product.size_code ?? product.size ?? "").trim();

      if (!internalCode || !vendorColor) {
        toast.error(
          `SKU ${product.sku} ไม่มี color_code ที่จับคู่ได้ — ข้ามไม่ได้ในโหมด Bulk`,
        );
        return;
      }

      const vendorSku = applyVendorSkuPattern(pattern, {
        MODEL: selectedModel.model_code,
        COLOR: vendorColor,
        SIZE: sizeToken,
      });

      if (!vendorSku) {
        toast.error(
          `สร้าง vendor_sku จาก pattern ไม่สำเร็จสำหรับ ${product.sku}`,
        );
        return;
      }

      if (seenVendorSkus.has(vendorSku)) {
        toast.error(
          `Pattern สร้าง vendor_sku ซ้ำภายในรุ่น: ${vendorSku} — ปรับ COLOR/SIZE mapping`,
        );
        return;
      }
      seenVendorSkus.add(vendorSku);

      rows.push({
        vendor_id: selectedVendorId,
        vendor_sku: vendorSku,
        vendor_product_name: product.name,
        vendor_uom: product.base_uom || "ตัว",
        internal_product_id: product.id,
        conversion_factor: 1,
      });
    }

    setIsSaving(true);
    const result = await bulkInsertVendorMappings(rows);
    setIsSaving(false);

    if (result.error) {
      toast.error(`บันทึก Bulk Mapping ไม่สำเร็จ: ${result.error}`);
      return;
    }

    if (result.inserted === 0 && result.skipped > 0) {
      toast.message(
        `ทุกรายการมีอยู่แล้ว — ข้าม ${result.skipped.toLocaleString("th-TH")} รายการ (23505)`,
      );
    } else {
      toast.success(
        `สร้าง mapping ${result.inserted.toLocaleString("th-TH")} รายการ` +
          (result.skipped > 0
            ? ` · ข้ามซ้ำ ${result.skipped.toLocaleString("th-TH")} รายการ`
            : ""),
      );
    }

    onSuccess?.();
  }

  if (!selectedModel) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-slate-400">
          คลิกรุ่นสินค้าทางซ้ายเพื่อเปิด Smart Bulk Mapping Form
        </CardContent>
      </Card>
    );
  }

  if (!selectedVendorId) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-slate-400">
          เลือกผู้จำหน่ายด้านบนก่อน
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Smart Bulk Mapping Form</CardTitle>
        <CardDescription>
          แมป color_code ภายใน → Vendor Color Code แล้วสร้าง vendor_sku ทั้งรุ่น
        </CardDescription>
      </CardHeader>

      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-5">
          <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              รุ่นที่เลือก
            </p>
            <p className="mt-1 font-mono text-xs font-bold text-blue-700">
              {selectedModel.model_code}
            </p>
            <p className="text-sm font-semibold text-slate-800">
              {selectedModel.name}
            </p>
            <p className="text-[11px] text-slate-400">
              {selectedModel.products.length.toLocaleString("th-TH")} SKU ·{" "}
              {colorCodes.length.toLocaleString("th-TH")} color_code
            </p>
          </div>

          <div>
            <Label htmlFor="vendor-sku-pattern">
              Vendor SKU Pattern <span className="text-red-500">*</span>
            </Label>
            <Input
              id="vendor-sku-pattern"
              value={vendorSkuPattern}
              onChange={(event) => setVendorSkuPattern(event.target.value)}
              placeholder={DEFAULT_VENDOR_SKU_PATTERN}
              disabled={isSaving}
              className="font-mono"
              required
            />
            <p className="mt-1.5 text-[11px] text-slate-400">
              ใช้โทเคน{" "}
              <code className="rounded bg-slate-100 px-1">[MODEL]</code>{" "}
              <code className="rounded bg-slate-100 px-1">[COLOR]</code>{" "}
              <code className="rounded bg-slate-100 px-1">[SIZE]</code>
            </p>
          </div>

          <div>
            <Label className="mb-2">
              จับคู่ color_code ภายใน → Vendor Color Code
            </Label>
            {colorCodes.length === 0 ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                ไม่พบ color_code ใน SKU ของรุ่นนี้ (คาดหวังรหัสเช่น BLK, NVY)
              </p>
            ) : (
              <div className="space-y-2">
                {colorCodes.map((code) => (
                  <div
                    key={code}
                    className="grid grid-cols-[minmax(0,1fr)_140px] items-center gap-2"
                  >
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                      <p className="font-mono text-xs font-bold text-blue-700">
                        {code}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {colorCodeLabel(code, selectedModel.products)}
                      </p>
                    </div>
                    <Input
                      value={vendorColorMap[code] ?? ""}
                      onChange={(event) =>
                        updateVendorColor(code, event.target.value)
                      }
                      placeholder="เช่น DD"
                      disabled={isSaving}
                      className="font-mono uppercase"
                      required
                      aria-label={`Vendor color code สำหรับ ${code}`}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {previewRows.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold text-slate-700">
                ตัวอย่างผลลัพธ์ (สูงสุด 5 แถว)
              </p>
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
                      <TableHead>SKU ภายใน</TableHead>
                      <TableHead>Vendor SKU</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewRows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-mono text-xs">
                          {row.internalSku}
                        </TableCell>
                        <TableCell className="font-mono text-xs font-semibold text-blue-700">
                          {row.vendorSku}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>

        <CardFooter className="justify-between gap-3">
          <p className="text-[11px] text-slate-400">
            จะสร้าง mapping ทั้ง{" "}
            <span className="font-semibold text-slate-600">
              {selectedModel.products.length.toLocaleString("th-TH")}
            </span>{" "}
            SKU — ข้ามรายการซ้ำ (23505)
          </p>
          <Button
            type="submit"
            disabled={
              isSaving ||
              selectedModel.products.length === 0 ||
              colorCodes.length === 0
            }
          >
            {isSaving ? "กำลังบันทึก..." : "สร้าง Bulk Mapping"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
