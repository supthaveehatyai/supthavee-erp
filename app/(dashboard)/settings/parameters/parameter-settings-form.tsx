"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LockKeyhole, Save } from "lucide-react";
import { toast } from "sonner";
import { requestParameterChange } from "@/lib/actions/parameter-actions";
import type { SystemParameterView } from "@/types/parameter";
import type { Json } from "@/src/types/supabase";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ParameterSettingsFormProps = {
  parameters: SystemParameterView[];
  pendingParamKeys: string[];
};

function jsonToFormValue(value: Json | null, dataType: string | null): string {
  if (value === null || value === undefined) return "";
  if (dataType === "number") {
    return typeof value === "number" ? String(value) : String(value);
  }
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function parseSubmittedValue(
  paramKey: string,
  raw: string,
  dataType: string | null,
): unknown {
  const trimmed = raw.trim();
  if (paramKey === "WHT_RATE" || dataType === "number") {
    const num = Number(trimmed);
    if (!Number.isFinite(num)) {
      throw new Error("กรุณากรอกตัวเลขที่ถูกต้อง");
    }
    if (num < 0 || num > 100) {
      throw new Error("อัตราหัก ณ ที่จ่ายต้องอยู่ระหว่าง 0–100");
    }
    return num;
  }
  if (!trimmed) {
    throw new Error("กรุณากรอกค่าให้ครบถ้วน");
  }
  return trimmed;
}

export function ParameterSettingsForm({
  parameters,
  pendingParamKeys,
}: ParameterSettingsFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const initialValues = useMemo(() => {
    const map: Record<string, string> = {};
    for (const param of parameters) {
      map[param.param_key] = jsonToFormValue(
        param.param_value,
        param.data_type,
      );
    }
    return map;
  }, [parameters]);

  const [formValues, setFormValues] =
    useState<Record<string, string>>(initialValues);
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);

  const pendingSet = useMemo(
    () => new Set(pendingParamKeys.map((key) => key.toUpperCase())),
    [pendingParamKeys],
  );

  const dirtyKeys = useMemo(() => {
    return parameters
      .filter((param) => formValues[param.param_key] !== initialValues[param.param_key])
      .map((param) => param.param_key);
  }, [parameters, formValues, initialValues]);

  const isDirty = dirtyKeys.length > 0;
  const hasBlockedPending = dirtyKeys.some((key) => pendingSet.has(key));

  function updateField(key: string, value: string) {
    setFormValues((prev) => ({ ...prev, [key]: value }));
  }

  function handleSaveClick() {
    if (!isDirty) {
      toast.message("ไม่มีการเปลี่ยนแปลงค่า");
      return;
    }
    if (hasBlockedPending) {
      toast.error("มีคำขอที่รออนุมัติอยู่แล้วสำหรับพารามิเตอร์ที่แก้ไข");
      return;
    }

    try {
      for (const key of dirtyKeys) {
        const param = parameters.find((item) => item.param_key === key);
        parseSubmittedValue(key, formValues[key] ?? "", param?.data_type ?? null);
      }
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : "ข้อมูลไม่ถูกต้อง",
      );
      return;
    }

    setPin("");
    setPinError(null);
    setPinOpen(true);
  }

  function handlePinConfirm() {
    const pinInput = pin.trim();
    if (!/^\d{6}$/.test(pinInput)) {
      setPinError("รหัส PIN ต้องเป็นตัวเลข 6 หลัก");
      return;
    }

    startTransition(async () => {
      setPinError(null);
      const errors: string[] = [];
      let successCount = 0;

      for (const key of dirtyKeys) {
        const param = parameters.find((item) => item.param_key === key);
        let newValue: unknown;
        try {
          newValue = parseSubmittedValue(
            key,
            formValues[key] ?? "",
            param?.data_type ?? null,
          );
        } catch (error: unknown) {
          errors.push(
            `${key}: ${error instanceof Error ? error.message : "invalid"}`,
          );
          continue;
        }

        const result = await requestParameterChange(key, newValue, pinInput);
        if (!result.success) {
          errors.push(result.error ?? `ส่งคำขอ ${key} ไม่สำเร็จ`);
        } else {
          successCount += 1;
        }
      }

      if (successCount > 0) {
        toast.success(
          successCount === 1
            ? "ส่งคำขอแก้ไขพารามิเตอร์แล้ว — รอ Admin อนุมัติ"
            : `ส่งคำขอแก้ไข ${successCount} รายการแล้ว — รอ Admin อนุมัติ`,
        );
        setPinOpen(false);
        setPin("");
        router.refresh();
      }

      if (errors.length > 0) {
        setPinError(errors.join(" · "));
        if (successCount === 0) {
          toast.error(errors[0]);
        }
      }
    });
  }

  const nasParam = parameters.find((item) => item.param_key === "NAS_BACKUP_PATH");
  const whtParam = parameters.find((item) => item.param_key === "WHT_RATE");

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>ค่าพารามิเตอร์ปัจจุบัน</CardTitle>
          <CardDescription>
            การบันทึกจะส่งคำขอเข้าคิวอนุมัติเท่านั้น — ค่าจริงจะเปลี่ยนเมื่อ Admin
            กด Approve
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="nas-backup-path">NAS Backup Path</Label>
              <Input
                id="nas-backup-path"
                value={formValues.NAS_BACKUP_PATH ?? ""}
                disabled={
                  isPending || pendingSet.has("NAS_BACKUP_PATH")
                }
                placeholder="nas_storage"
                onChange={(event) =>
                  updateField("NAS_BACKUP_PATH", event.target.value)
                }
              />
              {nasParam?.description ? (
                <p className="text-xs text-slate-500">{nasParam.description}</p>
              ) : null}
              {pendingSet.has("NAS_BACKUP_PATH") ? (
                <p className="text-xs font-medium text-amber-700">
                  มีคำขอแก้ไขรออนุมัติอยู่
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="wht-rate">อัตราหัก ณ ที่จ่าย (%)</Label>
              <Input
                id="wht-rate"
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step={0.01}
                value={formValues.WHT_RATE ?? ""}
                disabled={isPending || pendingSet.has("WHT_RATE")}
                onChange={(event) => updateField("WHT_RATE", event.target.value)}
              />
              {whtParam?.description ? (
                <p className="text-xs text-slate-500">{whtParam.description}</p>
              ) : null}
              {pendingSet.has("WHT_RATE") ? (
                <p className="text-xs font-medium text-amber-700">
                  มีคำขอแก้ไขรออนุมัติอยู่
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              type="button"
              disabled={!isDirty || isPending || hasBlockedPending}
              className="gap-2"
              onClick={handleSaveClick}
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              บันทึกคำขอ
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={pinOpen}
        onOpenChange={(open) => {
          if (!isPending) {
            setPinOpen(open);
            if (!open) {
              setPin("");
              setPinError(null);
            }
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>ยืนยันรหัส PIN</DialogTitle>
            <DialogDescription>
              กรอกรหัส PIN 6 หลักเพื่อส่งคำขอแก้ไขพารามิเตอร์ (
              {dirtyKeys.join(", ")})
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="parameter-pin">รหัส PIN 6 หลัก</Label>
            <div className="relative">
              <LockKeyhole className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                id="parameter-pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                pattern="\d{6}"
                disabled={isPending}
                placeholder="••••••"
                value={pin}
                onChange={(event) => {
                  const next = event.target.value.replace(/\D/g, "").slice(0, 6);
                  setPin(next);
                  setPinError(null);
                }}
                className="h-11 pl-10 tracking-[0.35em]"
              />
            </div>
            {pinError ? (
              <p role="alert" className="text-sm text-red-600">
                {pinError}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => setPinOpen(false)}
            >
              ยกเลิก
            </Button>
            <Button
              type="button"
              disabled={isPending || pin.length !== 6}
              className="gap-2"
              onClick={handlePinConfirm}
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <LockKeyhole className="size-4" />
              )}
              ยืนยันและส่งคำขอ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
