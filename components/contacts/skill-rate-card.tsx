"use client";

/**
 * Skill & Rate Card — CRUD เรตค่าแรงของ Vendor / Technician ตาม contact_id
 *
 * Schema จริง (technician_rates):
 * - service_model_id → ชื่องานบริการ (service_name ผ่าน join product_models)
 * - default_wage → ต้นทุนค่าแรง (cost_price / COGS)
 *
 * Zero Client-Side Fetching: Server Actions จาก `@/app/actions/contacts`
 */

import { useEffect, useState, useTransition } from "react";
import { Loader2, Pencil, Plus, Trash2, Wrench, X } from "lucide-react";
import { toast } from "sonner";
import {
  deleteTechnicianRate,
  getServiceModels,
  getTechnicianRates,
  updateTechnicianRate,
  upsertTechnicianRate,
} from "@/app/actions/contacts";
import type {
  ServiceModelOption,
  TechnicianRateRow,
} from "@/types/technician-rate";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

function formatWage(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

export type SkillRateCardProps = {
  /** contacts.id ของช่าง / ผู้จำหน่าย */
  technicianId: string;
  technicianName?: string;
};

export function SkillRateCard({
  technicianId,
  technicianName,
}: SkillRateCardProps) {
  const [models, setModels] = useState<ServiceModelOption[]>([]);
  const [rates, setRates] = useState<TechnicianRateRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [serviceModelId, setServiceModelId] = useState("");
  const [costPrice, setCostPrice] = useState("");

  const [isSaving, startSave] = useTransition();
  const [isDeleting, startDelete] = useTransition();
  const [pendingDelete, setPendingDelete] = useState<TechnicianRateRow | null>(
    null,
  );

  async function reload() {
    const [modelsResult, ratesResult] = await Promise.all([
      getServiceModels(),
      getTechnicianRates(technicianId),
    ]);

    setModels(Array.isArray(modelsResult.data) ? modelsResult.data : []);
    setRates(Array.isArray(ratesResult.data) ? ratesResult.data : []);

    const errors = [
      modelsResult.success ? null : modelsResult.error,
      ratesResult.success ? null : ratesResult.error,
    ].filter((msg): msg is string => Boolean(msg));
    setLoadError(errors.length > 0 ? errors.join(" · ") : null);
  }

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);
    setEditingId(null);
    setServiceModelId("");
    setCostPrice("");

    void reload().then(() => {
      if (!cancelled) setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [technicianId]);

  const assignedIds = new Set(
    rates
      .filter((row) => row.id !== editingId)
      .map((row) => row.service_model_id),
  );
  const availableModels = models.filter((model) => !assignedIds.has(model.id));

  function resetForm() {
    setEditingId(null);
    setServiceModelId("");
    setCostPrice("");
  }

  function startEdit(row: TechnicianRateRow) {
    setEditingId(row.id);
    setServiceModelId(row.service_model_id);
    setCostPrice(String(row.default_wage));
  }

  function handleSave() {
    if (isSaving || isDeleting) return;

    const costNumber = Number.parseFloat(costPrice);
    if (!editingId && !serviceModelId) {
      toast.error("กรุณาเลือกชื่องานบริการ");
      return;
    }
    if (!Number.isFinite(costNumber) || costNumber < 0) {
      toast.error("ต้นทุนค่าแรงต้องเป็นตัวเลขมากกว่าหรือเท่ากับ 0");
      return;
    }

    startSave(async () => {
      if (editingId) {
        const result = await updateTechnicianRate(editingId, costNumber);
        if (!result.success) {
          toast.error(result.error ?? "อัปเดต Rate Card ไม่สำเร็จ");
          return;
        }
        toast.success("อัปเดตต้นทุนค่าแรงแล้ว");
      } else {
        const result = await upsertTechnicianRate({
          technician_id: technicianId,
          service_model_id: serviceModelId,
          product_model_id: serviceModelId,
          default_wage: costNumber,
        });
        if (!result.success) {
          toast.error(result.error ?? "บันทึก Rate Card ไม่สำเร็จ");
          return;
        }
        toast.success("เพิ่มทักษะและค่าแรงแล้ว");
      }

      resetForm();
      await reload();
    });
  }

  function handleConfirmDelete() {
    if (!pendingDelete || isSaving || isDeleting) return;
    const target = pendingDelete;

    startDelete(async () => {
      const result = await deleteTechnicianRate(target.id);
      if (!result.success) {
        toast.error(result.error ?? "ลบ Rate Card ไม่สำเร็จ");
        return;
      }
      toast.success("ลบเรตค่าแรงแล้ว");
      if (editingId === target.id) resetForm();
      setPendingDelete(null);
      await reload();
    });
  }

  const busy = isSaving || isDeleting;
  const isEditMode = Boolean(editingId);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <Wrench className="mt-0.5 size-4 shrink-0 text-amber-600" />
        <div>
          <p className="text-sm font-semibold text-slate-800">
            ทักษะและค่าแรง (Skill & Rate Card)
          </p>
          <p className="text-xs text-slate-500">
            {technicianName
              ? `ตั้งเรตมาตรฐานของ ${technicianName} ตามประเภทงานบริการ`
              : "ตั้งเรตค่าแรงมาตรฐานตามประเภทงานบริการ"}
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
          <Loader2 className="size-4 animate-spin" />
          กำลังโหลด Rate Card...
        </div>
      ) : (
        <>
          {loadError ? (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700"
            >
              {loadError}
            </div>
          ) : null}

          <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3 sm:grid-cols-[1fr_8rem_auto]">
            <div>
              <Label htmlFor="rate_service_model">
                งานบริการ (product_models · is_service)
              </Label>
              {isEditMode ? (
                <Input
                  id="rate_service_model"
                  readOnly
                  disabled
                  value={(() => {
                    const row = rates.find((item) => item.id === editingId);
                    return row
                      ? `${row.service_model_code} · ${row.service_model_name}`
                      : "";
                  })()}
                  className="bg-slate-100"
                />
              ) : (
                <Select
                  id="rate_service_model"
                  value={serviceModelId}
                  disabled={busy || availableModels.length === 0}
                  onChange={(event) => setServiceModelId(event.target.value)}
                >
                  <option value="">
                    {models.length === 0
                      ? "ยังไม่มีรุ่นงานบริการ (is_service = true)"
                      : availableModels.length === 0
                        ? "ตั้งเรตครบทุกงานบริการแล้ว"
                        : "— เลือกงานบริการ —"}
                  </option>
                  {availableModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.model_code} · {model.name}
                    </option>
                  ))}
                </Select>
              )}
            </div>
            <div>
              <Label htmlFor="rate_cost_price">ต้นทุนค่าแรง (cost_price)</Label>
              <Input
                id="rate_cost_price"
                type="number"
                min={0}
                step="0.0001"
                inputMode="decimal"
                placeholder="0.00"
                value={costPrice}
                disabled={busy}
                onChange={(event) => setCostPrice(event.target.value)}
                className="tabular-nums"
              />
            </div>
            <div className="flex items-end gap-2">
              {isEditMode ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 gap-1.5"
                  disabled={busy}
                  onClick={resetForm}
                >
                  <X className="size-4" />
                  ยกเลิก
                </Button>
              ) : null}
              <Button
                type="button"
                className="h-10 w-full gap-1.5 sm:w-auto"
                disabled={busy || (!isEditMode && !serviceModelId)}
                onClick={handleSave}
              >
                {isSaving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : isEditMode ? (
                  <Pencil className="size-4" />
                ) : (
                  <Plus className="size-4" />
                )}
                {isEditMode ? "บันทึกแก้ไข" : "เพิ่มเรต"}
              </Button>
            </div>
          </div>

          {rates.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-xs text-slate-400">
              ยังไม่มีทักษะใน Rate Card — เลือกงานบริการ (is_service) แล้วระบุต้นทุนค่าแรง
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[480px] text-left">
                <thead className="border-b border-slate-200 bg-slate-50/80">
                  <tr>
                    <th className="px-3 py-2.5 text-[11px] font-semibold text-slate-500">
                      รหัสงาน
                    </th>
                    <th className="px-3 py-2.5 text-[11px] font-semibold text-slate-500">
                      ชื่องานบริการ
                    </th>
                    <th className="px-3 py-2.5 text-right text-[11px] font-semibold text-slate-500">
                      ต้นทุนค่าแรง
                    </th>
                    <th className="px-3 py-2.5 text-right text-[11px] font-semibold text-slate-500">
                      จัดการ
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rates.map((row) => (
                    <tr
                      key={row.id}
                      className={
                        editingId === row.id ? "bg-amber-50/60" : "bg-white"
                      }
                    >
                      <td className="px-3 py-2.5 font-mono text-xs font-semibold text-slate-800">
                        {row.service_model_code}
                      </td>
                      <td className="px-3 py-2.5 text-sm text-slate-700">
                        {row.service_model_name}
                      </td>
                      <td className="px-3 py-2.5 text-right text-sm font-semibold tabular-nums text-slate-800">
                        {formatWage(row.default_wage)}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex justify-end gap-1.5">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1"
                            disabled={busy}
                            onClick={() => startEdit(row)}
                          >
                            <Pencil className="size-3.5" />
                            แก้ไข
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            className="h-8 gap-1"
                            disabled={busy}
                            onClick={() => setPendingDelete(row)}
                          >
                            <Trash2 className="size-3.5" />
                            ลบ
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <AlertDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(next) => {
          if (!busy && !next) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันลบเรตค่าแรง</AlertDialogTitle>
            <AlertDialogDescription>
              ช่างคนนี้จะไม่ถูกเสนอในงานบริการนี้บน Kanban อีก
              {pendingDelete ? (
                <span className="mt-2 block font-medium text-slate-700">
                  {pendingDelete.service_model_code} ·{" "}
                  {pendingDelete.service_model_name}
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy} />
            <AlertDialogAction
              disabled={busy}
              className="bg-red-600 hover:bg-red-700 disabled:bg-red-400"
              onClick={(event) => {
                event.preventDefault();
                handleConfirmDelete();
              }}
            >
              {isDeleting ? "กำลังลบ..." : "ยืนยันลบ"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
