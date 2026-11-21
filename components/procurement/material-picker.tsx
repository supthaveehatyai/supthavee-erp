"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { listMaterialCatalogAction, saveMaterialAction } from "@/lib/actions/materials";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MATERIAL_STOCK_MODES,
  MATERIAL_STOCK_MODE_LABELS,
  type MaterialCategory,
  type MaterialRecord,
  type MaterialStockMode,
} from "@/types/material";

export function MaterialPicker({
  disabled = false,
  onSelect,
}: {
  disabled?: boolean;
  onSelect: (material: MaterialRecord) => void;
}) {
  const [materials, setMaterials] = useState<MaterialRecord[]>([]);
  const [categories, setCategories] = useState<MaterialCategory[]>([]);
  const [query, setQuery] = useState("");
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
    if (!needle) return materials;
    return materials.filter((row) =>
      `${row.materialCode} ${row.materialName} ${row.categoryName}`.toLowerCase().includes(needle),
    );
  }, [materials, query]);

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
    onSelect({
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
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-slate-800">🧵 เลือกจากทะเบียนวัตถุดิบ / วัสดุสิ้นเปลือง</p>
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setOpenQuick(true)}>
          + เพิ่มวัตถุดิบรายการใหม่ด่วน
        </Button>
      </div>
      <Input
        value={query}
        disabled={disabled}
        placeholder="ค้นรหัสหรือชื่อวัตถุดิบ"
        onChange={(event) => setQuery(event.target.value)}
      />
      <select
        disabled={disabled}
        className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
        value=""
        onChange={(event) => {
          const material = materials.find((row) => row.id === event.target.value);
          if (material) onSelect(material);
        }}
      >
        <option value="">เลือกวัตถุดิบเพื่อลงรายการรับเข้า</option>
        {visible.map((row) => (
          <option key={row.id} value={row.id}>
            {row.materialCode} · {row.materialName} · {row.purchaseUom} · อ้างอิง {row.referencePurchasePrice.toLocaleString("th-TH")}
          </option>
        ))}
      </select>
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
