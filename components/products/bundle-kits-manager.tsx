"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { searchProductModels } from "@/lib/actions/product.actions";
import { listBundleKits, saveBundleKit } from "@/lib/actions/product-actions";
import type { BundleKit, BundleSizeUpcharge } from "@/types/bundle-kit";
import type { ProductModelSearchItem } from "@/types/product-sale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type DraftModel = {
  model_id: string;
  model_code: string;
  model_name: string;
  model_price_delta: string;
};

type DraftSlot = {
  slot_name: string;
  rules: Array<{ size_code: string; amount: string }>;
  models: DraftModel[];
};

type DraftKit = {
  id: string | null;
  kit_code: string;
  kit_name: string;
  short_name: string;
  base_price: string;
  slots: DraftSlot[];
};

function emptySlot(name: string): DraftSlot {
  return { slot_name: name, rules: [], models: [] };
}

function emptyDraft(): DraftKit {
  return {
    id: null,
    kit_code: "",
    kit_name: "",
    short_name: "",
    base_price: "",
    slots: [emptySlot("เสื้อกีฬา"), emptySlot("กางเกงกีฬา")],
  };
}

function fromKit(kit: BundleKit): DraftKit {
  return {
    id: kit.id,
    kit_code: kit.kit_code,
    kit_name: kit.kit_name,
    short_name: kit.short_name,
    base_price: String(kit.base_price),
    slots:
      kit.slots.length > 0
        ? kit.slots.map((slot) => ({
            slot_name: slot.slot_name,
            rules: slot.size_upcharge_rules.map((rule) => ({
              size_code: rule.size_code,
              amount: String(rule.amount),
            })),
            models: slot.models.map((model) => ({
              model_id: model.model_id,
              model_code: model.model_code,
              model_name: model.model_name,
              model_price_delta: String(model.model_price_delta || 0),
            })),
          }))
        : [emptySlot("เสื้อกีฬา"), emptySlot("กางเกงกีฬา")],
  };
}

export function BundleKitsManager({ onClose }: { onClose: () => void }) {
  const [kits, setKits] = useState<BundleKit[]>([]);
  const [draft, setDraft] = useState<DraftKit>(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [modelQuery, setModelQuery] = useState<Record<number, string>>({});
  const [modelHits, setModelHits] = useState<Record<number, ProductModelSearchItem[]>>({});

  function reload() {
    startTransition(async () => {
      const result = await listBundleKits();
      if (result.error) {
        setError(result.error);
        return;
      }
      setError(null);
      setKits(result.data);
    });
  }

  useEffect(() => {
    reload();
    // โหลดครั้งแรกเมื่อเปิดแผง
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateSlot(index: number, patch: Partial<DraftSlot>) {
    setDraft((current) => ({
      ...current,
      slots: current.slots.map((slot, slotIndex) =>
        slotIndex === index ? { ...slot, ...patch } : slot,
      ),
    }));
  }

  function searchModels(index: number) {
    const keyword = modelQuery[index]?.trim() ?? "";
    if (!keyword) return;
    startTransition(async () => {
      const result = await searchProductModels(keyword);
      setModelHits((current) => ({
        ...current,
        [index]: result.success ? result.data : [],
      }));
      if (!result.success) toast.error(result.error);
    });
  }

  function addModel(index: number, model: ProductModelSearchItem) {
    const slot = draft.slots[index];
    if (!slot || slot.models.some((row) => row.model_id === model.id)) return;
    updateSlot(index, {
      models: [
        ...slot.models,
        {
          model_id: model.id,
          model_code: model.model_code,
          model_name: model.name,
          model_price_delta: "0",
        },
      ],
    });
  }

  function save() {
    const rules = (rows: DraftSlot["rules"]): BundleSizeUpcharge[] =>
      rows
        .map((row) => ({
          size_code: row.size_code.trim().toUpperCase(),
          amount: Number(row.amount),
        }))
        .filter((row) => row.size_code && Number.isFinite(row.amount));
    startTransition(async () => {
      const result = await saveBundleKit({
        id: draft.id,
        kit_code: draft.kit_code,
        kit_name: draft.kit_name,
        short_name: draft.short_name,
        base_price: Number(draft.base_price),
        slots: draft.slots.map((slot) => ({
          slot_name: slot.slot_name,
          size_upcharge_rules: rules(slot.rules),
          models: slot.models.map((model) => ({
            model_id: model.model_id,
            model_price_delta: Number(model.model_price_delta) || 0,
          })),
        })),
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("บันทึกชุดเซ็ตแล้ว");
      setDraft(emptyDraft());
      reload();
    });
  }

  return (
    <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-950">จัดการชุดเซ็ตจับคู่ (Bundle Kits)</h2>
          <p className="mt-1 text-xs text-slate-500">
            แต่ละช่องผูกได้หลายรุ่น และกำหนดส่วนต่างราคาตามรุ่นกับไซส์ใหญ่ได้เอง
          </p>
        </div>
        <Button type="button" variant="outline" onClick={onClose}>
          ปิด
        </Button>
      </div>
      {error ? (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <div className="mt-4 grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="space-y-2">
          <Button type="button" variant="outline" className="w-full" onClick={() => setDraft(emptyDraft())}>
            + สร้างชุดใหม่
          </Button>
          {kits.map((kit) => (
            <button
              key={kit.id}
              type="button"
              onClick={() => setDraft(fromKit(kit))}
              className="block w-full rounded-xl border border-slate-200 px-3 py-2 text-left hover:bg-slate-50"
            >
              <span className="block font-mono text-xs font-semibold text-slate-800">{kit.kit_code}</span>
              <span className="block text-xs text-slate-500">
                {kit.short_name || kit.kit_name} · {kit.base_price.toLocaleString("th-TH")} ฿
              </span>
            </button>
          ))}
          {kits.length === 0 && !pending ? (
            <p className="text-xs text-slate-400">ยังไม่มีชุดเซ็ต</p>
          ) : null}
        </div>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-slate-600">
              รหัสชุด
              <Input
                value={draft.kit_code}
                onChange={(event) => setDraft((current) => ({ ...current, kit_code: event.target.value }))}
                className="mt-1"
                placeholder="STVK01"
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              ราคาฐาน / ชุด
              <Input
                type="number"
                min={0}
                step="0.01"
                value={draft.base_price}
                onChange={(event) => setDraft((current) => ({ ...current, base_price: event.target.value }))}
                className="mt-1"
                placeholder="160.00"
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              ชื่อชุด
              <Input
                value={draft.kit_name}
                onChange={(event) => setDraft((current) => ({ ...current, kit_name: event.target.value }))}
                className="mt-1"
                placeholder="ชุดกีฬาเด็กแขนสั้น STVK01"
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              ชื่อย่อบนใบกำกับ
              <Input
                value={draft.short_name}
                onChange={(event) => setDraft((current) => ({ ...current, short_name: event.target.value }))}
                className="mt-1"
                placeholder="ชุดกีฬาเด็กแขนสั้น"
              />
            </label>
          </div>
          {draft.slots.map((slot, index) => (
            <div key={`${slot.slot_name}-${index}`} className="rounded-xl border border-slate-200 p-3">
              <label className="text-xs font-medium text-slate-600">
                ชื่อช่องที่ {index + 1}
                <Input
                  value={slot.slot_name}
                  onChange={(event) => updateSlot(index, { slot_name: event.target.value })}
                  className="mt-1"
                />
              </label>
              <div className="mt-3 flex gap-2">
                <Input
                  value={modelQuery[index] ?? ""}
                  onChange={(event) =>
                    setModelQuery((current) => ({ ...current, [index]: event.target.value }))
                  }
                  placeholder="ค้นหารุ่น เช่น K12S"
                />
                <Button type="button" variant="outline" onClick={() => searchModels(index)}>
                  ค้นหา
                </Button>
              </div>
              {(modelHits[index] ?? []).length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {modelHits[index].map((model) => (
                    <button
                      key={model.id}
                      type="button"
                      className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700"
                      onClick={() => addModel(index, model)}
                    >
                      + {model.model_code}
                    </button>
                  ))}
                </div>
              ) : null}
              <ul className="mt-3 space-y-2">
                {slot.models.map((model) => (
                  <li key={model.model_id} className="flex items-center gap-2 text-xs">
                    <span className="min-w-0 flex-1 font-mono">
                      {model.model_code} — {model.model_name}
                    </span>
                    <Input
                      type="number"
                      className="h-8 w-24"
                      value={model.model_price_delta}
                      aria-label={`ส่วนต่างราคา ${model.model_code}`}
                      onChange={(event) =>
                        updateSlot(index, {
                          models: slot.models.map((row) =>
                            row.model_id === model.model_id
                              ? { ...row, model_price_delta: event.target.value }
                              : row,
                          ),
                        })
                      }
                    />
                    <button
                      type="button"
                      className="text-red-600"
                      onClick={() =>
                        updateSlot(index, {
                          models: slot.models.filter((row) => row.model_id !== model.model_id),
                        })
                      }
                    >
                      เอาออก
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-3 space-y-2">
                <p className="text-xs font-medium text-slate-600">ราคาบวกเพิ่มสำหรับไซส์ใหญ่</p>
                {slot.rules.map((rule, ruleIndex) => (
                  <div key={`${rule.size_code}-${ruleIndex}`} className="flex gap-2">
                    <Input
                      value={rule.size_code}
                      placeholder="2XL"
                      className="h-8 w-24"
                      onChange={(event) =>
                        updateSlot(index, {
                          rules: slot.rules.map((row, rowIndex) =>
                            rowIndex === ruleIndex ? { ...row, size_code: event.target.value } : row,
                          ),
                        })
                      }
                    />
                    <Input
                      type="number"
                      value={rule.amount}
                      placeholder="20"
                      className="h-8 w-24"
                      onChange={(event) =>
                        updateSlot(index, {
                          rules: slot.rules.map((row, rowIndex) =>
                            rowIndex === ruleIndex ? { ...row, amount: event.target.value } : row,
                          ),
                        })
                      }
                    />
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    updateSlot(index, { rules: [...slot.rules, { size_code: "", amount: "" }] })
                  }
                >
                  + เพิ่มไซส์
                </Button>
              </div>
            </div>
          ))}
          <Button type="button" disabled={pending} onClick={save}>
            {pending ? "กำลังบันทึก..." : "บันทึกชุดเซ็ต"}
          </Button>
        </div>
      </div>
    </section>
  );
}
