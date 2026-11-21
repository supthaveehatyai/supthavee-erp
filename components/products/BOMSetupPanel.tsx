"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  getModelMaterialBom,
  saveModelMaterialBom,
  searchBomMaterials,
} from "@/lib/actions/bom-actions";
import type {
  BomMaterialOption,
  BomPanelHandle,
  ModelMaterialBomLine,
} from "@/types/bom";

const USAGE_UOM_TH: Record<string, string> = {
  KG: "กก.",
  M: "เมตร",
  PCS: "ชิ้น",
  ROLL: "ม้วน",
  DOZ: "โหล",
  BTL: "ขวด",
  BAG: "ถุง",
  PACK: "แพ็ค",
};

const MODE_LABEL: Record<string, string> = {
  BOM_BACKFLUSH: "ตัดตามสูตร",
  SHOP_FLOOR_ISSUE: "เบิกหน้างาน",
};

function usageUnitLabel(code: string): string {
  const key = code.trim().toUpperCase();
  if (!key) return "—";
  const thai = USAGE_UOM_TH[key];
  return thai ? `${key} (${thai})` : key;
}

function lineMaterialCost(
  usageQtyPerUnit: number,
  wastePct: number,
  movingAvgUsageCost: number,
): number {
  const qty = Number(usageQtyPerUnit);
  const waste = Number(wastePct);
  const cost = Number(movingAvgUsageCost);
  if (![qty, waste, cost].every(Number.isFinite)) return 0;
  return qty * (1 + waste / 100) * cost;
}

function formatBaht(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

type BOMSetupPanelProps = {
  modelId: string;
};

export const BOMSetupPanel = forwardRef<BomPanelHandle, BOMSetupPanelProps>(
  function BOMSetupPanel({ modelId }, ref) {
    const [items, setItems] = useState<ModelMaterialBomLine[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [keyword, setKeyword] = useState("");
    const [options, setOptions] = useState<BomMaterialOption[]>([]);
    const [searching, setSearching] = useState(false);
    const [selected, setSelected] = useState<BomMaterialOption | null>(null);
    const [usageQty, setUsageQty] = useState("");
    const [wastePct, setWastePct] = useState("0");
    const itemsRef = useRef(items);
    const loadingRef = useRef(loading);
    itemsRef.current = items;
    loadingRef.current = loading;

    const loadBom = useCallback(async () => {
      const id = modelId.trim();
      if (!id) {
        setItems([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      const result = await getModelMaterialBom(id);
      if (!result.success) {
        setItems([]);
        setError(result.error);
      } else {
        setItems(result.data);
      }
      setLoading(false);
    }, [modelId]);

    useEffect(() => {
      void loadBom();
    }, [loadBom]);

    useImperativeHandle(
      ref,
      () => ({
        save: async () => {
          if (loadingRef.current) {
            return {
              success: false,
              error: "กำลังโหลดสูตรการผลิต กรุณารอสักครู่แล้วบันทึกอีกครั้ง",
            };
          }
          return saveModelMaterialBom(
            modelId,
            itemsRef.current.map((line) => ({
              materialId: line.materialId,
              usageQtyPerUnit: line.usageQtyPerUnit,
              wastePct: line.wastePct,
            })),
          );
        },
      }),
      [modelId],
    );

    useEffect(() => {
      if (!dialogOpen) return;
      const timer = window.setTimeout(() => {
        void (async () => {
          setSearching(true);
          const result = await searchBomMaterials(keyword);
          setSearching(false);
          if (!result.success) {
            setOptions([]);
            toast.error(result.error);
            return;
          }
          setOptions(result.data);
        })();
      }, 200);
      return () => window.clearTimeout(timer);
    }, [dialogOpen, keyword]);

    const totalCost = useMemo(
      () =>
        items.reduce(
          (sum, line) =>
            sum +
            lineMaterialCost(
              line.usageQtyPerUnit,
              line.wastePct,
              line.movingAvgUsageCost,
            ),
          0,
        ),
      [items],
    );

    function openDialog() {
      setKeyword("");
      setSelected(null);
      setUsageQty("");
      setWastePct("0");
      setDialogOpen(true);
    }

    function addLocalLine() {
      if (!selected) {
        toast.error("กรุณาเลือกวัตถุดิบ");
        return;
      }
      const qty = Number(usageQty);
      const waste = wastePct.trim() === "" ? 0 : Number(wastePct);
      if (!Number.isFinite(qty) || qty <= 0) {
        toast.error("ปริมาณที่ใช้ต่อ 1 ตัว ต้องมากกว่า 0");
        return;
      }
      if (!Number.isFinite(waste) || waste < 0 || waste > 100) {
        toast.error("เผื่อเสีย % ต้องอยู่ระหว่าง 0 ถึง 100");
        return;
      }
      if (items.some((line) => line.materialId === selected.id)) {
        toast.error("วัตถุดิบนี้มีในสูตรแล้ว");
        return;
      }
      setItems((current) => [
        ...current,
        {
          materialId: selected.id,
          materialCode: selected.materialCode,
          materialName: selected.materialName,
          usageUom: selected.usageUom,
          stockControlMode: selected.stockControlMode,
          usageQtyPerUnit: qty,
          wastePct: waste,
          movingAvgUsageCost: selected.movingAvgUsageCost,
        },
      ]);
      setDialogOpen(false);
    }

    function updateLine(
      materialId: string,
      patch: Partial<Pick<ModelMaterialBomLine, "usageQtyPerUnit" | "wastePct">>,
    ) {
      setItems((current) =>
        current.map((line) =>
          line.materialId === materialId ? { ...line, ...patch } : line,
        ),
      );
    }

    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              สูตรการผลิต (BOM)
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              เลือกวัตถุดิบจากทะเบียนวัสดุ ระบบแสดงหน่วยตัดใช้ตามวัตถุดิบนั้น
              และคำนวณต้นทุนต่อตัวทันที กดบันทึกการแก้ไขเพื่อเก็บสูตรของรุ่นนี้
            </p>
          </div>
          <button
            type="button"
            onClick={openDialog}
            className="inline-flex h-9 shrink-0 items-center rounded-xl bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-800"
          >
            + เพิ่มวัตถุดิบ
          </button>
        </div>

        {error ? (
          <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        ) : null}

        <div className="mt-4 overflow-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[760px] text-left">
            <thead className="bg-slate-50">
              <tr>
                {[
                  "วัตถุดิบ",
                  "หน่วยตัดใช้",
                  "ปริมาณต่อ 1 ตัว",
                  "เผื่อเสีย %",
                  "ต้นทุน / ตัว",
                  "",
                ].map((heading) => (
                  <th
                    key={heading || "action"}
                    className="border-b border-slate-200 px-3 py-2 text-[11px] font-semibold text-slate-500"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-xs text-slate-500">
                    กำลังโหลดสูตรการผลิต...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-xs text-slate-500">
                    ยังไม่มีวัตถุดิบในสูตรของรุ่นนี้
                  </td>
                </tr>
              ) : (
                items.map((line) => {
                  const cost = lineMaterialCost(
                    line.usageQtyPerUnit,
                    line.wastePct,
                    line.movingAvgUsageCost,
                  );
                  return (
                    <tr key={line.materialId}>
                      <td className="px-3 py-2">
                        <div className="text-xs font-semibold text-slate-800">
                          {line.materialName}
                        </div>
                        <div className="font-mono text-[11px] text-slate-500">
                          {line.materialCode}
                          {MODE_LABEL[line.stockControlMode]
                            ? ` · ${MODE_LABEL[line.stockControlMode]}`
                            : ""}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-700">
                        {usageUnitLabel(line.usageUom)}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.usageQtyPerUnit}
                          onChange={(event) =>
                            updateLine(line.materialId, {
                              usageQtyPerUnit: Number(event.target.value),
                            })
                          }
                          className="h-8 w-28 rounded-lg border border-slate-200 px-2 text-xs"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={line.wastePct}
                          onChange={(event) =>
                            updateLine(line.materialId, {
                              wastePct: Number(event.target.value),
                            })
                          }
                          className="h-8 w-20 rounded-lg border border-slate-200 px-2 text-xs"
                        />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs font-medium text-slate-800">
                        {formatBaht(cost)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() =>
                            setItems((current) =>
                              current.filter(
                                (row) => row.materialId !== line.materialId,
                              ),
                            )
                          }
                          className="text-xs font-medium text-red-600 hover:text-red-700"
                        >
                          ลบ
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-sm font-semibold text-slate-900">
          ต้นทุนวัตถุดิบตามสูตรรวม: {formatBaht(totalCost)} ฿ / ตัว
        </p>

        {dialogOpen ? (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/40 p-4">
            <div
              role="dialog"
              aria-modal="true"
              className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl"
            >
              <h4 className="text-sm font-semibold text-slate-900">
                เพิ่มวัตถุดิบในสูตร
              </h4>
              <label className="mt-4 block text-xs font-medium text-slate-600">
                ค้นหาวัตถุดิบ
                <input
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="ผ้าขาวโอโม่, กระดาษซับลิเมชั่น, ปกโปโล, สาบแขน"
                  className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm"
                />
              </label>
              <div className="mt-2 max-h-48 overflow-auto rounded-xl border border-slate-200">
                {searching ? (
                  <p className="px-3 py-3 text-xs text-slate-500">กำลังค้นหา...</p>
                ) : options.length === 0 ? (
                  <p className="px-3 py-3 text-xs text-slate-500">
                    ไม่พบวัตถุดิบในกลุ่มตัดตามสูตรหรือเบิกหน้างาน
                  </p>
                ) : (
                  options.map((option) => {
                    const active = selected?.id === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setSelected(option)}
                        className={`flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-xs ${
                          active ? "bg-blue-50" : "hover:bg-slate-50"
                        }`}
                      >
                        <span>
                          <span className="font-semibold text-slate-800">
                            {option.materialName}
                          </span>
                          <span className="mt-0.5 block font-mono text-[11px] text-slate-500">
                            {option.materialCode}
                            {MODE_LABEL[option.stockControlMode]
                              ? ` · ${MODE_LABEL[option.stockControlMode]}`
                              : ""}
                          </span>
                        </span>
                        <span className="shrink-0 text-slate-600">
                          {usageUnitLabel(option.usageUom)}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>

              {selected ? (
                <p className="mt-3 text-xs text-slate-600">
                  หน่วยตัดใช้:{" "}
                  <strong>{usageUnitLabel(selected.usageUom)}</strong>
                  {" · "}
                  ต้นทุนเฉลี่ย {formatBaht(selected.movingAvgUsageCost)} ฿ /{" "}
                  {usageUnitLabel(selected.usageUom)}
                </p>
              ) : null}

              <div className="mt-3 grid grid-cols-2 gap-3">
                <label className="text-xs font-medium text-slate-600">
                  ปริมาณที่ใช้ต่อ 1 ตัว
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={usageQty}
                    onChange={(event) => setUsageQty(event.target.value)}
                    placeholder="0.22"
                    className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm"
                  />
                </label>
                <label className="text-xs font-medium text-slate-600">
                  เผื่อเสีย %
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={wastePct}
                    onChange={(event) => setWastePct(event.target.value)}
                    className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm"
                  />
                </label>
              </div>

              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDialogOpen(false)}
                  className="h-9 rounded-xl border border-slate-200 px-4 text-xs font-medium text-slate-600"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={addLocalLine}
                  className="h-9 rounded-xl bg-blue-600 px-4 text-xs font-semibold text-white"
                >
                  เพิ่มในสูตร
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    );
  },
);
