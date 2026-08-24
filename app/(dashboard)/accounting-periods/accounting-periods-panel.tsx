"use client";

/**
 * Period Lock Dashboard — client interactions (Server Actions only).
 */

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Loader2, PlusCircle } from "lucide-react";
import { toast } from "sonner";
import {
  createAccountingPeriod,
  togglePeriodStatus,
} from "@/app/actions/accounting-period";
import type { AccountingPeriodListItem } from "@/types/accounting-period";
import {
  formatAccountingPeriodLabel,
  THAI_MONTH_LABELS,
} from "@/types/accounting-period";
import { RunDepreciationButton } from "./run-depreciation-button";
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
import { Badge } from "@/components/ui/badge";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type AccountingPeriodsPanelProps = {
  periods: AccountingPeriodListItem[];
};

function formatClosedAt(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function closedByLabel(period: AccountingPeriodListItem): string {
  if (period.closed_by_name) return period.closed_by_name;
  if (period.closed_by_email) return period.closed_by_email;
  return "—";
}

function PeriodStatusBadge({ isClosed }: { isClosed: boolean }) {
  if (isClosed) {
    return (
      <Badge className="border-red-200 bg-red-50 text-red-700 hover:bg-red-50">
        ปิดงบ
      </Badge>
    );
  }
  return (
    <Badge className="border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-50">
      เปิด
    </Badge>
  );
}

function CreatePeriodDialog() {
  const router = useRouter();
  const currentYear = new Date().getFullYear();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(String(currentYear));
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [isPending, startTransition] = useTransition();

  function resetForm() {
    setYear(String(currentYear));
    setMonth(String(new Date().getMonth() + 1));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;

    const parsedYear = Number(year);
    const parsedMonth = Number(month);

    startTransition(async () => {
      const result = await createAccountingPeriod(parsedYear, parsedMonth);
      if (!result.success) {
        toast.error(result.error ?? "สร้างรอบบัญชีไม่สำเร็จ");
        return;
      }

      toast.success(
        `สร้างรอบบัญชี ${formatAccountingPeriodLabel(parsedYear, parsedMonth)} สำเร็จ`,
      );
      resetForm();
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (isPending) return;
        setOpen(next);
        if (!next) resetForm();
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" className="gap-2">
          <PlusCircle className="size-4" />
          สร้างรอบบัญชีใหม่
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>สร้างรอบบัญชีใหม่</DialogTitle>
          <DialogDescription>
            เลือกปีและเดือนที่ต้องการเปิดงวดบัญชี (เริ่มต้นสถานะ &quot;เปิด&quot;)
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="period-year">ปี ค.ศ.</Label>
              <Input
                id="period-year"
                type="number"
                min={2000}
                max={2100}
                required
                value={year}
                disabled={isPending}
                onChange={(event) => setYear(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="period-month">เดือน</Label>
              <Select
                id="period-month"
                value={month}
                disabled={isPending}
                onChange={(event) => setMonth(event.target.value)}
              >
                {THAI_MONTH_LABELS.map((label, index) => (
                  <option key={label} value={String(index + 1)}>
                    {index + 1} — {label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending} className="gap-2">
              {isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <PlusCircle className="size-4" />
              )}
              บันทึกรอบบัญชี
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PeriodLockSwitch({ period }: { period: AccountingPeriodListItem }) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function runToggle() {
    if (isPending) return;

    startTransition(async () => {
      const result = await togglePeriodStatus(period.id, period.is_closed);
      if (!result.success) {
        toast.error(result.error ?? "อัปเดตสถานะงวดบัญชีไม่สำเร็จ");
        setConfirmOpen(false);
        return;
      }

      toast.success(
        result.data.is_closed
          ? `ปิดงบ ${formatAccountingPeriodLabel(result.data.period_year, result.data.period_month)} แล้ว`
          : `เปิดงวด ${formatAccountingPeriodLabel(result.data.period_year, result.data.period_month)} แล้ว`,
      );
      setConfirmOpen(false);
      router.refresh();
    });
  }

  function handleCheckedChange(checked: boolean) {
    if (isPending) return;

    if (checked && !period.is_closed) {
      setConfirmOpen(true);
      return;
    }

    if (!checked && period.is_closed) {
      runToggle();
    }
  }

  return (
    <>
      <Switch
        checked={period.is_closed}
        disabled={isPending}
        aria-label={
          period.is_closed
            ? `เปิดงวด ${period.period_month}/${period.period_year}`
            : `ปิดงวด ${period.period_month}/${period.period_year}`
        }
        onCheckedChange={handleCheckedChange}
      />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันปิดงบรายเดือน</AlertDialogTitle>
            <AlertDialogDescription>
              คุณกำลังจะปิดงวด{" "}
              <strong>
                {formatAccountingPeriodLabel(
                  period.period_year,
                  period.period_month,
                )}
              </strong>
              . ระบบจะล็อกการบันทึก/แก้ไขเอกสารและค่าใช้จ่ายในเดือนนี้
              ตามมาตรฐาน Period Closing (GAAP/TFRS)
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              className="bg-red-600 hover:bg-red-700"
              onClick={(event) => {
                event.preventDefault();
                runToggle();
              }}
            >
              {isPending ? "กำลังปิดงบ..." : "ยืนยันปิดงบ"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function AccountingPeriodsPanel({ periods }: AccountingPeriodsPanelProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-900">
            <CalendarClock className="h-8 w-8 text-blue-600" />
            Period Lock Dashboard
          </h1>
          <p className="text-slate-500">
            ปิดงบรายเดือน (Period Closing) — ล็อกเอกสารและค่าใช้จ่ายย้อนหลัง
            เฉพาะ Admin
          </p>
        </div>
        <CreatePeriodDialog />
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">รายการงวดบัญชี</CardTitle>
          <CardDescription>
            {periods.length} งวด · เรียงจากล่าสุด · สวิตช์ ON = ปิดงบแล้ว · คำนวณค่าเสื่อมได้เฉพาะงวดที่ยังเปิด
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          {periods.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-slate-500">
              ยังไม่มีรอบบัญชี — กด &quot;สร้างรอบบัญชีใหม่&quot; เพื่อเริ่มต้น
            </p>
          ) : (
            <div className="w-full">
              <Table wrapperClassName="overflow-x-auto">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[10%]">ปี</TableHead>
                    <TableHead className="w-[18%]">เดือน</TableHead>
                    <TableHead className="w-[12%]">สถานะ</TableHead>
                    <TableHead className="w-[10%]">สวิตช์</TableHead>
                    <TableHead className="w-[18%]">ค่าเสื่อม</TableHead>
                    <TableHead className="w-[16%]">ผู้ปิดงบ</TableHead>
                    <TableHead className="w-[22%]">วันที่ปิดงบ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {periods.map((period) => (
                    <TableRow key={period.id}>
                      <TableCell className="font-medium text-slate-900">
                        {period.period_year}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-0.5">
                          <p className="text-sm font-medium text-slate-800">
                            {THAI_MONTH_LABELS[period.period_month - 1] ??
                              period.period_month}
                          </p>
                          <p className="text-xs text-slate-400">
                            เดือน {period.period_month}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <PeriodStatusBadge isClosed={period.is_closed} />
                      </TableCell>
                      <TableCell>
                        <PeriodLockSwitch period={period} />
                      </TableCell>
                      <TableCell>
                        <RunDepreciationButton
                          periodId={period.id}
                          periodLabel={formatAccountingPeriodLabel(
                            period.period_year,
                            period.period_month,
                          )}
                          disabled={period.is_closed}
                        />
                      </TableCell>
                      <TableCell className="text-sm text-slate-700">
                        {period.is_closed ? closedByLabel(period) : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        {period.is_closed
                          ? formatClosedAt(period.closed_at)
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
