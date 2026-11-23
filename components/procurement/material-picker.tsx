"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { listMaterialCatalogAction, saveMaterialAction } from "@/lib/actions/materials";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import {
  MATERIAL_STOCK_MODES,
  MATERIAL_STOCK_MODE_LABELS,
  type MaterialCategory,
  type MaterialRecord,
  type MaterialStockMode,
} from "@/types/material";
import { cn } from "@/lib/utils";

export function MaterialPicker({
  disabled = false,
  onSelect,
  title = "🧵 เลือกจากทะเบียนวัตถุดิบ / วัสดุสิ้นเปลือง",
  highlightMaterialId = null,
}: {
  disabled?: boolean;
  onSelect: (material: MaterialRecord) => void;
  title?: string;
  highlightMaterialId?: string | null;
}) {
  const [materials, setMaterials] = useState<MaterialRecord[]>([]);
  const [categories, setCategories] = useState<MaterialCategory[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [openQuick, setOpenQuick] = useState(false);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [categoryCode, setCategoryCode] = useState("");
  const [mode, setMode] = useState<MaterialStockMode>("SHOP_FLOOR_ISSUE");
  const [purchaseUom, setPurchaseUom] = useState("PCS");
  const [usageUom, setUsageUom] = useState("PCS");
  const [factor, setFactor] = useState("1");
  const [referencePrice, setReferencePrice] = useState("0");

  async function load() {
    const result = await listMaterialCatalogAction();
    if (result.error) toast.error(result.error);
    setMaterials(result.materials.filter((row) => row.isActive));
    setCategories(result.categories);
    if (!categoryCode && result.categories[0]) {
      setCategoryCode(result.categories[0].code);
      setPurchaseUom(result.categories[0].defaultPurchaseUom);
      setUsageUom(result.categories[0].defaultUsageUom);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = needle
      ? materials.filter((row) =>
          `${row.materialCode} ${row.materialName} ${row.categoryName} ${row.purchaseUom}`
            .toLowerCase()
            .includes(needle),
        )
      : materials;
    return [...matched].sort((left, right) => {
      if (left.id === highlightMaterialId) return -1;
      if (right.id === highlightMaterialId) return 1;
      return left.materialCode.localeCompare(right.materialCode, "th");
    });
  }, [highlightMaterialId, materials, query]);

  function choose(material: MaterialRecord) {
    setQuery("");
    setOpen(false);
    onSelect(material);
  }

  async function quickAdd() {
    setBusy(true);
    const result = await saveMaterialAction({
      materialCode: code,
      materialName: name,
      specDescription: "",
      categoryCode,
      stockControlMode: mode,
      purchaseUom,
      usageUom,
      uomConversionFactor: Number(factor),
      referencePurchasePrice: Number(referencePrice),
      reorderPointUsageQty: 0,
      isActive: true,
    });
    setBusy(false);
    if (!result.success || !result.id) {
      toast.error(result.error ?? "เพิ่มวัตถุดิบไม่สำเร็จ");
      return;
    }
    toast.success("เพิ่มวัตถุดิบรายการใหม่แล้ว");
    setOpenQuick(false);
    await load();
    choose({
      id: result.id,
      materialCode: code.trim().toUpperCase(),
      materialName: name.trim(),
      specDescription: null,
      categoryCode,
      categoryName: categories.find((item) => item.code === categoryCode)?.nameTh ?? categoryCode,
      stockControlMode: mode,
      purchaseUom: purchaseUom.trim().toUpperCase(),
      usageUom: usageUom.trim().toUpperCase(),
      uomConversionFactor: Number(factor) || 1,
      referencePurchasePrice: Number(referencePrice) || 0,
      lastPurchasePrice: 0,
      movingAvgUsageCost: 0,
      currentUsageQty: 0,
      reorderPointUsageQty: 0,
      isActive: true,
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        <Button type="button" variant="outline" size="sm" className="h-8 shrink-0" disabled={disabled} onClick={() => setOpenQuick(true)}>
          + เพิ่มวัตถุดิบรายการใหม่ด่วน
        </Button>
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <Input
            value={query}
            disabled={disabled}
            className="h-10 w-full"
            placeholder="พิมพ์รหัสหรือชื่อวัตถุดิบ เช่น น้ำเงิน หรือ MAT-INK-003"
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") setOpen(false);
            }}
          />
        </PopoverAnchor>
        <PopoverContent
          align="start"
          sideOffset={4}
          className="max-h-[380px] w-[var(--radix-popover-trigger-width)] overflow-auto p-1"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          {visible.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-slate-500">ไม่พบวัตถุดิบที่ตรงกับคำค้น</p>
          ) : (
            visible.slice(0, 40).map((row) => {
              const current = row.id === highlightMaterialId;
              return (
                <button
                  key={row.id}
                  type="button"
                  className={cn(
                    "flex w-full items-start justify-between gap-3 rounded-lg px-2 py-2 text-left text-xs hover:bg-slate-50",
                    current && "bg-teal-50 ring-1 ring-teal-300",
                  )}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(row)}
                >
                  <span>
                    <span className="font-mono font-semibold text-slate-800">{row.materialCode}</span>
                    <span className="mt-0.5 block text-slate-700">{row.materialName}</span>
                  </span>
                  <span className="shrink-0 text-right text-slate-500">
                    {current ? <span className="mb-0.5 block font-semibold text-teal-700">ปัจจุบัน</span> : null}
                    <span className="block">{row.purchaseUom}</span>
                    <span className="block">
                      อ้างอิง {row.referencePurchasePrice.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </PopoverContent>
      </Popover>
      {openQuick ? (
        <div className="grid gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 sm:grid-cols-2">
          <Input placeholder="รหัสวัสดุ" value={code} onChange={(event) => setCode(event.target.value)} />
          <Input placeholder="ชื่อวัตถุดิบ" value={name} onChange={(event) => setName(event.target.value)} />
          <select
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm"
            value={categoryCode}
            onChange={(event) => {
              const category = categories.find((item) => item.code === event.target.value);
              setCategoryCode(event.target.value);
              if (category) {
                setPurchaseUom(category.defaultPurchaseUom);
                setUsageUom(category.defaultUsageUom);
              }
            }}
          >
            {categories.map((category) => (
              <option key={category.code} value={category.code}>
                {category.nameTh}
              </option>
            ))}
          </select>
          <select
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm"
            value={mode}
            onChange={(event) => setMode(event.target.value as MaterialStockMode)}
          >
            {MATERIAL_STOCK_MODES.map((item) => (
              <option key={item} value={item}>
                {MATERIAL_STOCK_MODE_LABELS[item]}
              </option>
            ))}
          </select>
          <Input placeholder="หน่วยซื้อ" value={purchaseUom} onChange={(event) => setPurchaseUom(event.target.value)} />
          <Input placeholder="หน่วยใช้จริง" value={usageUom} onChange={(event) => setUsageUom(event.target.value)} />
          <Input placeholder="อัตราแปลง" type="number" value={factor} onChange={(event) => setFactor(event.target.value)} />
          <Input placeholder="ราคาอ้างอิง" type="number" value={referencePrice} onChange={(event) => setReferencePrice(event.target.value)} />
          <div className="flex gap-2 sm:col-span-2">
            <Button type="button" size="sm" disabled={busy} onClick={() => void quickAdd()}>
              บันทึกและเลือก
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setOpenQuick(false)}>
              ปิด
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
