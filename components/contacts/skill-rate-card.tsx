"use client";

/**
 * Skill & Rate Card — ตั้งทักษะ/ค่าแรงมาตรฐานของ Vendor / Technician
 * Zero Client-Side Fetching: getServiceModels / getTechnicianRates / upsert / delete
 */

import { useEffect, useState, useTransition } from "react";
import { Loader2, Plus, Trash2, Wrench } from "lucide-react";
import { toast } from "sonner";
import {
  deleteTechnicianRate,
  getServiceModels,
  getTechnicianRates,
  upsertTechnicianRate,
} from "@/lib/actions/technician-rates";
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
  const [serviceModelId, setServiceModelId] = useState("");
  const [wage, setWage] = useState("");
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

    void reload().then(() => {
      if (!cancelled) setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [technicianId]);

  const assignedIds = new Set(rates.map((row) => row.service_model_id));
  const availableModels = models.filter((model) => !assignedIds.has(model.id));

  function handleSave() {
    if (isSaving || isDeleting) return;
    const wageNumber = Number.parseFloat(wage);
    if (!serviceModelId) {
      toast.error("กรุณาเลือกงานบริการ");
      return;
    }
    if (!Number.isFinite(wageNumber) || wageNumber < 0) {
      toast.error("ค่าแรงต้องเป็นตัวเลขมากกว่าหรือเท่ากับ 0");
      return;
    }

    startSave(async () => {
      const result = await upsertTechnicianRate({
        technician_id: technicianId,
        service_model_id: serviceModelId,
        default_wage: wageNumber,
      });
      if (!result.success) {
        toast.error(result.error ?? "บันทึก Rate Card ไม่สำเร็จ");
        return;
      }
      toast.success("บันทึกทักษะและค่าแรงแล้ว");
      setServiceModelId("");
      setWage("");
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
      setPendingDelete(null);
      await reload();
    });
  }

  const busy = isSaving || isDeleting;

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
              <Label htmlFor="rate_service_model">งานบริการ</Label>
              <Select
                id="rate_service_model"
                value={serviceModelId}
                disabled={busy || availableModels.length === 0}
                onChange={(event) => setServiceModelId(event.target.value)}
              >
                <option value="">
                  {availableModels.length === 0
                    ? "ไม่มีงานบริการที่ยังไม่ได้ตั้งเรต"
                    : "— เลือกงานบริการ —"}
                </option>
                {availableModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.model_code} · {model.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="rate_default_wage">ค่าแรง (บาท)</Label>
              <Input
                id="rate_default_wage"
                type="number"
                min={0}
                step="0.0001"
                inputMode="decimal"
                placeholder="0.00"
                value={wage}
                disabled={busy}
                onChange={(event) => setWage(event.target.value)}
                className="tabular-nums"
              />
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                className="h-10 w-full gap-1.5 sm:w-auto"
                disabled={busy || !serviceModelId}
                onClick={handleSave}
              >
                {isSaving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                เพิ่มเรต
              </Button>
            </div>
          </div>

          {rates.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-xs text-slate-400">
              ยังไม่มีทักษะใน Rate Card — เลือกงานบริการแล้วระบุค่าแรง
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[420px] text-left">
                <thead className="border-b border-slate-200 bg-slate-50/80">
                  <tr>
                    <th className="px-3 py-2.5 text-[11px] font-semibold text-slate-500">
                      รหัสงาน
                    </th>
                    <th className="px-3 py-2.5 text-[11px] font-semibold text-slate-500">
                      งานบริการ
                    </th>
                    <th className="px-3 py-2.5 text-right text-[11px] font-semibold text-slate-500">
                      ค่าแรงมาตรฐาน
                    </th>
                    <th className="px-3 py-2.5 text-right text-[11px] font-semibold text-slate-500">
                      จัดการ
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rates.map((row) => (
                    <tr key={row.id} className="bg-white">
                      <td className="px-3 py-2.5 font-mono text-xs font-semibold text-slate-800">
                        {row.service_model_code}
                      </td>
                      <td className="px-3 py-2.5 text-sm text-slate-700">
                        {row.service_model_name}
                      </td>
                      <td className="px-3 py-2.5 text-right text-sm font-semibold tabular-nums text-slate-800">
                        {formatWage(row.default_wage)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
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
