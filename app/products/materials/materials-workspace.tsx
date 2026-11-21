"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  issueMaterialToShopFloorAction,
  listMaterialCatalogAction,
  saveMaterialAction,
} from "@/lib/actions/materials";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MATERIAL_STOCK_MODE_LABELS,
  MATERIAL_STOCK_MODES,
  type MaterialCategory,
  type MaterialDraft,
  type MaterialRecord,
  type MaterialStockMode,
} from "@/types/material";

function money(value: number): string {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function qty(value: number): string {
  return value.toLocaleString("th-TH", { maximumFractionDigits: 4 });
}

function emptyDraft(category?: MaterialCategory): MaterialDraft {
  return {
    materialCode: "",
    materialName: "",
    specDescription: "",
    categoryCode: category?.code ?? "",
    stockControlMode: "SHOP_FLOOR_ISSUE",
    purchaseUom: category?.defaultPurchaseUom ?? "PCS",
    usageUom: category?.defaultUsageUom ?? "PCS",
    uomConversionFactor: 1,
    referencePurchasePrice: 0,
    reorderPointUsageQty: 0,
    isActive: true,
  };
}

export default function MaterialsWorkspace() {
  const [categories, setCategories] = useState<MaterialCategory[]>([]);
  const [materials, setMaterials] = useState<MaterialRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<MaterialDraft | null>(null);
  const [issueTarget, setIssueTarget] = useState<MaterialRecord | null>(null);
  const [issueQty, setIssueQty] = useState("");
  const [issueNotes, setIssueNotes] = useState("");
  const [busy, setBusy] = useState(false);

  async function reload() {
    const result = await listMaterialCatalogAction();
    setCategories(result.categories);
    setMaterials(result.materials);
    setError(result.error);
  }

  useEffect(() => {
    void reload();
  }, []);

  const grouped = useMemo(
    () =>
      categories.map((category) => ({
        category,
        rows: materials.filter((row) => row.categoryCode === category.code),
      })),
    [categories, materials],
  );

  async function saveDraft() {
    if (!draft) return;
    setBusy(true);
    const result = await saveMaterialAction(draft);
    setBusy(false);
    if (!result.success) {
      toast.error(result.error ?? "บันทึกวัตถุดิบไม่สำเร็จ");
      return;
    }
    toast.success(draft.id ? "แก้ไขวัตถุดิบแล้ว" : "เพิ่มวัตถุดิบแล้ว");
    setDraft(null);
    await reload();
  }

  async function issue() {
    if (!issueTarget) return;
    setBusy(true);
    const result = await issueMaterialToShopFloorAction({
      materialId: issueTarget.id,
      usageQty: Number(issueQty),
      notes: issueNotes,
    });
    setBusy(false);
    if (!result.success) {
      toast.error(result.error ?? "เบิกหน้างานไม่สำเร็จ");
      return;
    }
    toast.success("เบิกเปิดขวด/ม้วนใช้หน้างานแล้ว");
    setIssueTarget(null);
    setIssueQty("");
    setIssueNotes("");
    await reload();
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5">
        <div>
          <p className="text-xs font-semibold text-amber-700">MATERIALS</p>
          <h1 className="text-2xl font-bold text-slate-950">ทะเบียนวัตถุดิบและวัสดุสิ้นเปลือง</h1>
          <p className="mt-1 text-sm text-slate-500">
            แยกจากสินค้าสำเร็จรูป {materials.length.toLocaleString("th-TH")} รายการใน mst_materials
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/products"
            className="inline-flex h-11 items-center rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700"
          >
            กลับหน้าสินค้า
          </Link>
          <Button type="button" onClick={() => setDraft(emptyDraft(categories[0]))}>
            + เพิ่มวัตถุดิบใหม่
          </Button>
        </div>
      </header>
      {error ? <p className="text-sm font-medium text-red-700">{error}</p> : null}
      {grouped.map(({ category, rows }) => (
        <section key={category.code} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-bold text-slate-900">{category.nameTh}</h2>
            <p className="text-xs text-slate-500">{rows.length.toLocaleString("th-TH")} รายการ</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[1100px] w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2">รหัส</th>
                  <th className="px-3 py-2">ชื่อและรายละเอียด</th>
                  <th className="px-3 py-2">โหมดคุมสต็อก</th>
                  <th className="px-3 py-2">อัตราแปลงหน่วย</th>
                  <th className="px-3 py-2 text-right">ราคาซื้ออ้างอิง</th>
                  <th className="px-3 py-2 text-right">ราคาซื้อล่าสุด</th>
                  <th className="px-3 py-2 text-right">ต้นทุนต่อหน่วยใช้จริง</th>
                  <th className="px-3 py-2 text-right">คงเหลือ</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-6 text-center text-slate-400">
                      ยังไม่มีรายการในหมวดนี้
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-mono text-xs">{row.materialCode}</td>
                      <td className="px-3 py-2">
                        <p className="font-semibold text-slate-900">{row.materialName}</p>
                        {row.specDescription ? (
                          <p className="text-xs text-slate-500">{row.specDescription}</p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-xs">{MATERIAL_STOCK_MODE_LABELS[row.stockControlMode]}</td>
                      <td className="px-3 py-2 text-xs">
                        1 {row.purchaseUom} = {qty(row.uomConversionFactor)} {row.usageUom}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(row.referencePurchasePrice)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(row.lastPurchasePrice)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(row.movingAvgUsageCost)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {qty(row.currentUsageQty)} {row.usageUom}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setDraft({
                                id: row.id,
                                materialCode: row.materialCode,
                                materialName: row.materialName,
                                specDescription: row.specDescription ?? "",
                                categoryCode: row.categoryCode,
                                stockControlMode: row.stockControlMode,
                                purchaseUom: row.purchaseUom,
                                usageUom: row.usageUom,
                                uomConversionFactor: row.uomConversionFactor,
                                referencePurchasePrice: row.referencePurchasePrice,
                                reorderPointUsageQty: row.reorderPointUsageQty,
                                isActive: row.isActive,
                              })
                            }
                          >
                            แก้ไข
                          </Button>
                          {row.stockControlMode !== "DIRECT_CONSUMABLE" ? (
                            <Button type="button" size="sm" variant="outline" onClick={() => setIssueTarget(row)}>
                              เบิกเปิดขวด/ม้วนใช้หน้างาน
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {draft ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5">
            <h3 className="text-lg font-bold">{draft.id ? "แก้ไขวัตถุดิบ" : "เพิ่มวัตถุดิบใหม่"}</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <Label>รหัสวัสดุ</Label>
                <Input value={draft.materialCode} onChange={(event) => setDraft({ ...draft, materialCode: event.target.value })} />
              </label>
              <label className="space-y-1 text-sm">
                <Label>หมวด</Label>
                <select
                  className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm"
                  value={draft.categoryCode}
                  onChange={(event) => {
                    const category = categories.find((item) => item.code === event.target.value);
                    setDraft({
                      ...draft,
                      categoryCode: event.target.value,
                      purchaseUom: category?.defaultPurchaseUom ?? draft.purchaseUom,
                      usageUom: category?.defaultUsageUom ?? draft.usageUom,
                    });
                  }}
                >
                  {categories.map((category) => (
                    <option key={category.code} value={category.code}>
                      {category.nameTh}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm sm:col-span-2">
                <Label>ชื่อวัตถุดิบ</Label>
                <Input value={draft.materialName} onChange={(event) => setDraft({ ...draft, materialName: event.target.value })} />
              </label>
              <label className="space-y-1 text-sm sm:col-span-2">
                <Label>รายละเอียด</Label>
                <Input value={draft.specDescription} onChange={(event) => setDraft({ ...draft, specDescription: event.target.value })} />
              </label>
              <label className="space-y-1 text-sm sm:col-span-2">
                <Label>โหมดคุมสต็อก</Label>
                <select
                  className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm"
                  value={draft.stockControlMode}
                  onChange={(event) =>
                    setDraft({ ...draft, stockControlMode: event.target.value as MaterialStockMode })
                  }
                >
                  {MATERIAL_STOCK_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {MATERIAL_STOCK_MODE_LABELS[mode]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <Label>หน่วยซื้อ</Label>
                <Input value={draft.purchaseUom} onChange={(event) => setDraft({ ...draft, purchaseUom: event.target.value })} />
              </label>
              <label className="space-y-1 text-sm">
                <Label>หน่วยใช้จริง</Label>
                <Input value={draft.usageUom} onChange={(event) => setDraft({ ...draft, usageUom: event.target.value })} />
              </label>
              <label className="space-y-1 text-sm">
                <Label>1 หน่วยซื้อ = กี่หน่วยใช้จริง</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.0001"
                  value={draft.uomConversionFactor}
                  onChange={(event) => setDraft({ ...draft, uomConversionFactor: Number(event.target.value) })}
                />
              </label>
              <label className="space-y-1 text-sm">
                <Label>ราคาซื้ออ้างอิง</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={draft.referencePurchasePrice}
                  onChange={(event) => setDraft({ ...draft, referencePurchasePrice: Number(event.target.value) })}
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={() => setDraft(null)}>
                ยกเลิก
              </Button>
              <Button type="button" disabled={busy} onClick={() => void saveDraft()}>
                บันทึก
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {issueTarget ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5">
            <h3 className="text-lg font-bold">เบิกเปิดขวด/ม้วนใช้หน้างาน</h3>
            <p className="mt-1 text-sm text-slate-600">
              {issueTarget.materialName} · คงเหลือ {qty(issueTarget.currentUsageQty)} {issueTarget.usageUom}
            </p>
            <label className="mt-4 block space-y-1 text-sm">
              <Label>จำนวนที่เบิก ({issueTarget.usageUom})</Label>
              <Input type="number" min={0} step="0.0001" value={issueQty} onChange={(event) => setIssueQty(event.target.value)} />
            </label>
            <label className="mt-3 block space-y-1 text-sm">
              <Label>หมายเหตุ</Label>
              <Input value={issueNotes} onChange={(event) => setIssueNotes(event.target.value)} />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={() => setIssueTarget(null)}>
                ยกเลิก
              </Button>
              <Button type="button" disabled={busy} onClick={() => void issue()}>
                บันทึกการเบิก
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
