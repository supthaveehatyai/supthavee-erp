"use client";

/**
 * In-house Routing — ขั้นตอนการผลิตและค่าแรง (production_job_operations)
 * Activity Types จาก Master: technician_rates × product_models (is_service)
 * Zero Client-Side Fetching — rates ผ่าน Server Action
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Save, Trash2, Workflow } from "lucide-react";
import { toast } from "sonner";
import {
  deleteJobOperation,
  getJobOperations,
  getRoutingActivityRates,
  upsertJobOperation,
} from "@/lib/actions/production/job-operations-actions";
import type {
  ProductionJobTechnicianOption,
  ProductionOperationStatus,
  RoutingActivityRate,
} from "@/types/production";
import {
  PRODUCTION_OPERATION_STATUS_LABEL,
  PRODUCTION_OPERATION_STATUSES,
} from "@/types/production";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type JobOperationsSectionProps = {
  jobId: string;
  technicians: ProductionJobTechnicianOption[];
  disabled?: boolean;
};

type OperationDraft = {
  key: string;
  id: string | null;
  /** product_models.id ของ Activity Type ที่เลือก */
  service_model_id: string;
  operation_name: string;
  technician_id: string;
  wage_cost: string;
  status: ProductionOperationStatus;
  technician_bill_id: string | null;
};

function emptyDraft(key: string): OperationDraft {
  return {
    key,
    id: null,
    service_model_id: "",
    operation_name: "",
    technician_id: "",
    wage_cost: "0",
    status: "PENDING",
    technician_bill_id: null,
  };
}

function toWageNumber(raw: string): number | null {
  const n = Number.parseFloat(String(raw ?? "").trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

function formatWageDefault(value: number): string {
  const rounded = Math.round((value + Number.EPSILON) * 10000) / 10000;
  return String(rounded);
}

function resolveServiceModelId(
  rates: RoutingActivityRate[],
  technicianId: string,
  operationName: string,
): string {
  const techId = technicianId.trim();
  const name = operationName.trim();
  if (!name) return "";

  const forTech = techId
    ? rates.filter((rate) => rate.technician_id === techId)
    : rates;

  const exact = forTech.find((rate) => rate.service_name === name);
  if (exact) return exact.service_model_id;

  const any = rates.find((rate) => rate.service_name === name);
  return any?.service_model_id ?? "";
}

export function JobOperationsSection({
  jobId,
  technicians,
  disabled = false,
}: JobOperationsSectionProps) {
  const router = useRouter();
  const reactId = useId();
  const draftSeqRef = useRef(0);
  const [drafts, setDrafts] = useState<OperationDraft[]>([]);
  const [rates, setRates] = useState<RoutingActivityRate[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSubmitting, startSubmit] = useTransition();

  const nextKey = useCallback(() => {
    draftSeqRef.current += 1;
    return `${reactId}-op-${Date.now()}-${draftSeqRef.current}`;
  }, [reactId]);

  const busy = isLoading || isSubmitting;
  const canEdit = !disabled && !busy;

  const ratesByTechnician = useMemo(() => {
    const map = new Map<string, RoutingActivityRate[]>();
    for (const rate of rates) {
      const list = map.get(rate.technician_id) ?? [];
      list.push(rate);
      map.set(rate.technician_id, list);
    }
    return map;
  }, [rates]);

  const reload = useCallback(async () => {
    const id = jobId.trim();
    if (!id) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const [opsResult, ratesResult] = await Promise.all([
        getJobOperations(id),
        getRoutingActivityRates(),
      ]);

      if (!ratesResult.success) {
        setLoadError(ratesResult.error ?? "ดึง Rate Card ขั้นตอนไม่สำเร็จ");
        setRates([]);
      } else {
        setRates(ratesResult.data);
      }

      if (!opsResult.success) {
        setLoadError(opsResult.error ?? "ดึงขั้นตอนผลิตไม่สำเร็จ");
        setDrafts([]);
        return;
      }

      const loadedRates = ratesResult.success ? ratesResult.data : [];
      setDrafts(
        opsResult.data.map((row, index) => {
          const techId = row.technician_id ?? "";
          const serviceModelId = resolveServiceModelId(
            loadedRates,
            techId,
            row.operation_name,
          );
          return {
            key: row.id || `${reactId}-loaded-${index}`,
            id: row.id,
            service_model_id: serviceModelId,
            operation_name: row.operation_name,
            technician_id: techId,
            wage_cost: String(
              Number.isFinite(row.wage_cost) ? row.wage_cost : 0,
            ),
            status:
              row.status === "COMPLETED" ? "COMPLETED" : ("PENDING" as const),
            technician_bill_id: row.technician_bill_id,
          };
        }),
      );
    } finally {
      setIsLoading(false);
    }
  }, [jobId, reactId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  function ratesForDraft(draft: OperationDraft): RoutingActivityRate[] {
    const techId = draft.technician_id.trim();
    if (!techId) return [];
    return ratesByTechnician.get(techId) ?? [];
  }

  function handleAddRow() {
    setDrafts((prev) => [...prev, emptyDraft(nextKey())]);
  }

  function handleTechnicianChange(draftKey: string, nextTechnicianId: string) {
    setDrafts((prev) =>
      prev.map((row) => {
        if (row.key !== draftKey) return row;

        const nextRates = ratesByTechnician.get(nextTechnicianId) ?? [];
        const stillValid = nextRates.some(
          (rate) =>
            rate.service_model_id === row.service_model_id ||
            rate.service_name === row.operation_name,
        );

        if (stillValid) {
          const matched =
            nextRates.find(
              (rate) => rate.service_model_id === row.service_model_id,
            ) ??
            nextRates.find((rate) => rate.service_name === row.operation_name);
          return {
            ...row,
            technician_id: nextTechnicianId,
            service_model_id: matched?.service_model_id ?? row.service_model_id,
            operation_name: matched?.service_name ?? row.operation_name,
            wage_cost: matched
              ? formatWageDefault(matched.default_wage)
              : row.wage_cost,
          };
        }

        return {
          ...row,
          technician_id: nextTechnicianId,
          service_model_id: "",
          operation_name: "",
          wage_cost: "0",
        };
      }),
    );
  }

  function handleOperationChange(draftKey: string, serviceModelId: string) {
    setDrafts((prev) =>
      prev.map((row) => {
        if (row.key !== draftKey) return row;
        if (!serviceModelId) {
          return {
            ...row,
            service_model_id: "",
            operation_name: "",
          };
        }

        const rate = ratesForDraft(row).find(
          (item) => item.service_model_id === serviceModelId,
        );
        if (!rate) {
          return {
            ...row,
            service_model_id: serviceModelId,
          };
        }

        return {
          ...row,
          service_model_id: rate.service_model_id,
          operation_name: rate.service_name,
          wage_cost: formatWageDefault(rate.default_wage),
        };
      }),
    );
  }

  function handleRemoveRow(draft: OperationDraft) {
    if (draft.technician_bill_id) {
      toast.error("ขั้นตอนนี้ถูกวางบิลช่างแล้ว — ห้ามลบ");
      return;
    }

    if (!draft.id) {
      setDrafts((prev) => prev.filter((row) => row.key !== draft.key));
      return;
    }

    startSubmit(async () => {
      const result = await deleteJobOperation(draft.id!);
      if (!result.success) {
        toast.error(result.error ?? "ลบขั้นตอนไม่สำเร็จ");
        return;
      }
      setDrafts((prev) => prev.filter((row) => row.key !== draft.key));
      toast.success("ลบขั้นตอนแล้ว");
      router.refresh();
    });
  }

  function handleSave() {
    if (!canEdit) return;

    const payloadRows: Array<{
      key: string;
      id: string | null;
      operation_name: string;
      technician_id: string | null;
      wage_cost: number;
      status: ProductionOperationStatus;
    }> = [];

    for (const draft of drafts) {
      if (draft.technician_bill_id) continue;

      const techId = draft.technician_id.trim();
      if (!techId) {
        toast.error("กรุณาเลือกช่างทุกแถว");
        return;
      }

      const name = draft.operation_name.trim();
      if (!name || !draft.service_model_id.trim()) {
        toast.error("กรุณาเลือกขั้นตอน (Activity Type) จาก Rate Card ทุกแถว");
        return;
      }

      const allowed = ratesForDraft(draft).some(
        (rate) =>
          rate.service_model_id === draft.service_model_id ||
          rate.service_name === name,
      );
      if (!allowed) {
        toast.error(
          `ขั้นตอน "${name}" ไม่อยู่ใน Rate Card ของช่างที่เลือก`,
        );
        return;
      }

      const wage = toWageNumber(draft.wage_cost);
      if (wage == null) {
        toast.error(`ค่าแรงของ "${name}" ต้องเป็นตัวเลข ≥ 0`);
        return;
      }

      payloadRows.push({
        key: draft.key,
        id: draft.id,
        operation_name: name,
        technician_id: techId,
        wage_cost: wage,
        status: draft.status,
      });
    }

    if (payloadRows.length === 0) {
      toast.error("ไม่มีขั้นตอนที่ต้องบันทึก — กดเพิ่มแถวก่อน");
      return;
    }

    startSubmit(async () => {
      const errors: string[] = [];
      const nextByKey = new Map(drafts.map((d) => [d.key, d]));

      for (const row of payloadRows) {
        const result = await upsertJobOperation({
          id: row.id,
          job_id: jobId,
          operation_name: row.operation_name,
          technician_id: row.technician_id,
          wage_cost: row.wage_cost,
          status: row.status,
        });

        if (!result.success || !result.data) {
          errors.push(
            `${row.operation_name}: ${result.error ?? "บันทึกไม่สำเร็จ"}`,
          );
          continue;
        }

        const prev = nextByKey.get(row.key);
        nextByKey.set(row.key, {
          key: row.key,
          id: result.data.id,
          service_model_id:
            prev?.service_model_id ||
            resolveServiceModelId(
              rates,
              result.data.technician_id ?? "",
              result.data.operation_name,
            ),
          operation_name: result.data.operation_name,
          technician_id: result.data.technician_id ?? "",
          wage_cost: String(result.data.wage_cost),
          status:
            result.data.status === "COMPLETED" ? "COMPLETED" : "PENDING",
          technician_bill_id: result.data.technician_bill_id,
        });
      }

      setDrafts([...nextByKey.values()]);

      if (errors.length > 0) {
        toast.error(errors[0] ?? "บันทึกขั้นตอนไม่สำเร็จ");
        return;
      }

      toast.success(`บันทึกขั้นตอนผลิต ${payloadRows.length} รายการแล้ว`);
      router.refresh();
    });
  }

  return (
    <section className="space-y-3 pb-2">
      <div className="flex items-end justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          <Workflow className="size-4 text-blue-600" aria-hidden />
          ขั้นตอนการผลิตและค่าแรง (In-house Routing)
        </h3>
        <span className="text-xs text-slate-400">
          {drafts.length} ขั้นตอน
        </span>
      </div>
      <p className="text-xs leading-relaxed text-slate-500">
        Activity Types จาก Master{" "}
        <span className="font-mono">technician_rates</span> ×{" "}
        <span className="font-mono">product_models</span> (is_service) —
        เลือกช่างก่อน แล้วเลือกขั้นตอนตาม Rate Card (ค่าแรง auto-fill แก้ทับได้)
      </p>

      {loadError ? (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          {loadError}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-blue-200">
        <Table>
          <TableHeader>
            <TableRow className="bg-blue-50/90 hover:bg-blue-50/90">
              <TableHead className="min-w-[8rem] px-2 text-xs">ช่าง</TableHead>
              <TableHead className="min-w-[9rem] px-2 text-xs">
                ขั้นตอน (Activity)
              </TableHead>
              <TableHead className="min-w-[5.5rem] px-2 text-right text-xs">
                ค่าแรง
              </TableHead>
              <TableHead className="min-w-[6.5rem] px-2 text-xs">
                สถานะ
              </TableHead>
              <TableHead className="w-10 px-1 text-xs" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="px-3 py-8 text-center text-sm text-slate-400"
                >
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" />
                    กำลังโหลดขั้นตอน / Rate Card...
                  </span>
                </TableCell>
              </TableRow>
            ) : drafts.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="px-3 py-8 text-center text-sm text-slate-400"
                >
                  ยังไม่มีขั้นตอน — กด &quot;เพิ่มขั้นตอน&quot;
                </TableCell>
              </TableRow>
            ) : (
              drafts.map((draft) => {
                const billed = Boolean(draft.technician_bill_id);
                const rowLocked = billed || busy || disabled;
                const activityOptions = ratesForDraft(draft);
                const hasOrphanName =
                  Boolean(draft.operation_name.trim()) &&
                  !activityOptions.some(
                    (rate) =>
                      rate.service_model_id === draft.service_model_id ||
                      rate.service_name === draft.operation_name,
                  );

                return (
                  <TableRow key={draft.key}>
                    <TableCell className="px-2 py-2 align-top">
                      <Select
                        value={draft.technician_id}
                        disabled={rowLocked}
                        onChange={(event) =>
                          handleTechnicianChange(
                            draft.key,
                            event.target.value,
                          )
                        }
                        className="h-9 text-xs"
                      >
                        <option value="">— เลือกช่าง —</option>
                        {technicians.map((tech) => (
                          <option key={tech.id} value={tech.id}>
                            {tech.company_name}
                          </option>
                        ))}
                      </Select>
                      {billed ? (
                        <p className="mt-1 text-[10px] text-emerald-700">
                          วางบิลแล้ว
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="px-2 py-2 align-top">
                      <Select
                        value={draft.service_model_id}
                        disabled={
                          rowLocked || !draft.technician_id.trim()
                        }
                        onChange={(event) =>
                          handleOperationChange(
                            draft.key,
                            event.target.value,
                          )
                        }
                        className="h-9 text-xs"
                      >
                        <option value="">
                          {draft.technician_id.trim()
                            ? "— เลือกขั้นตอน —"
                            : "— เลือกช่างก่อน —"}
                        </option>
                        {activityOptions.map((rate) => (
                          <option
                            key={rate.service_model_id}
                            value={rate.service_model_id}
                          >
                            {rate.model_code
                              ? `${rate.model_code} · ${rate.service_name}`
                              : rate.service_name}
                          </option>
                        ))}
                      </Select>
                      {hasOrphanName ? (
                        <p className="mt-1 text-[10px] text-amber-700">
                          ค่าเดิม &quot;{draft.operation_name}&quot; ไม่อยู่ใน Rate
                          Card — กรุณาเลือกใหม่
                        </p>
                      ) : null}
                      {draft.technician_id.trim() &&
                      activityOptions.length === 0 ? (
                        <p className="mt-1 text-[10px] text-amber-700">
                          ช่างนี้ยังไม่มี Rate Card (Activity Type)
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="px-2 py-2 align-top">
                      <Input
                        type="number"
                        min={0}
                        step="0.0001"
                        inputMode="decimal"
                        value={draft.wage_cost}
                        disabled={rowLocked}
                        onChange={(event) =>
                          setDrafts((prev) =>
                            prev.map((row) =>
                              row.key === draft.key
                                ? { ...row, wage_cost: event.target.value }
                                : row,
                            ),
                          )
                        }
                        className="h-9 text-right text-xs tabular-nums"
                      />
                    </TableCell>
                    <TableCell className="px-2 py-2 align-top">
                      <Select
                        value={draft.status}
                        disabled={rowLocked}
                        onChange={(event) =>
                          setDrafts((prev) =>
                            prev.map((row) =>
                              row.key === draft.key
                                ? {
                                    ...row,
                                    status: (event.target.value ===
                                    "COMPLETED"
                                      ? "COMPLETED"
                                      : "PENDING") as ProductionOperationStatus,
                                  }
                                : row,
                            ),
                          )
                        }
                        className="h-9 text-xs"
                      >
                        {PRODUCTION_OPERATION_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {PRODUCTION_OPERATION_STATUS_LABEL[status]}
                          </option>
                        ))}
                      </Select>
                    </TableCell>
                    <TableCell className="px-1 py-2 align-top">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 text-slate-400 hover:text-red-600"
                        disabled={rowLocked || billed}
                        aria-label="ลบขั้นตอน"
                        onClick={() => handleRemoveRow(draft)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {!disabled ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            className="h-10 flex-1 gap-2"
            disabled={busy}
            onClick={handleAddRow}
          >
            <Plus className="size-4" />
            เพิ่มขั้นตอน
          </Button>
          <Button
            type="button"
            className="h-10 flex-1 gap-2"
            disabled={busy || drafts.length === 0}
            onClick={handleSave}
          >
            {isSubmitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            Save Operations
          </Button>
        </div>
      ) : null}
    </section>
  );
}

export default JobOperationsSection;
