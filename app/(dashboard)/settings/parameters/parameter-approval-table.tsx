"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  approveParameterChange,
  rejectParameterChange,
} from "@/lib/actions/parameter-actions";
import type { PendingParameterChangeRequest } from "@/types/parameter";
import type { Json } from "@/src/types/supabase";
import { formatThaiDate } from "@/lib/utils/date-formatter";
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
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

type ParameterApprovalTableProps = {
  rows: PendingParameterChangeRequest[];
  isAdmin: boolean;
};

function formatParamValue(value: Json | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

export function ParameterApprovalTable({
  rows,
  isAdmin,
}: ParameterApprovalTableProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectComment, setRejectComment] = useState("");

  function runApprove(requestId: string) {
    startTransition(async () => {
      setActiveRequestId(requestId);
      const result = await approveParameterChange(requestId);
      setActiveRequestId(null);

      if (!result.success) {
        toast.error(result.error ?? "อนุมัติไม่สำเร็จ");
        return;
      }

      toast.success(result.message ?? "อนุมัติเรียบร้อยแล้ว");
      router.refresh();
    });
  }

  function openRejectDialog(requestId: string) {
    setActiveRequestId(requestId);
    setRejectComment("");
    setRejectOpen(true);
  }

  function runReject() {
    if (!activeRequestId) return;
    const comment = rejectComment.trim();
    if (!comment) {
      toast.error("กรุณาระบุเหตุผลการปฏิเสธ");
      return;
    }

    startTransition(async () => {
      const result = await rejectParameterChange(activeRequestId, comment);
      setRejectOpen(false);
      setActiveRequestId(null);
      setRejectComment("");

      if (!result.success) {
        toast.error(result.error ?? "ปฏิเสธไม่สำเร็จ");
        return;
      }

      toast.success(result.message ?? "ปฏิเสธคำขอแล้ว");
      router.refresh();
    });
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>คิวรออนุมัติ (Maker-Checker)</CardTitle>
          <CardDescription>
            รายการคำขอแก้ไขพารามิเตอร์สถานะ PENDING — Admin สามารถ Approve
            หรือ Reject ได้
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              ไม่มีคำขอที่รออนุมัติ
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>พารามิเตอร์</TableHead>
                    <TableHead>ค่าเดิม</TableHead>
                    <TableHead>ค่าใหม่</TableHead>
                    <TableHead>ผู้ขอ</TableHead>
                    <TableHead>วันที่ขอ</TableHead>
                    <TableHead className="text-center">สถานะ</TableHead>
                    {isAdmin ? (
                      <TableHead className="text-center">การดำเนินการ</TableHead>
                    ) : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const rowBusy = isPending && activeRequestId === row.id;
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="font-mono text-sm font-medium text-slate-900">
                          {row.param_key}
                        </TableCell>
                        <TableCell className="text-slate-700">
                          {formatParamValue(row.old_value)}
                        </TableCell>
                        <TableCell className="font-medium text-slate-900">
                          {formatParamValue(row.new_value)}
                        </TableCell>
                        <TableCell className="text-slate-700">
                          {row.requested_by_name ?? "—"}
                        </TableCell>
                        <TableCell className="text-slate-700">
                          {row.created_at
                            ? formatThaiDate(row.created_at, "short")
                            : "—"}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="amber">{row.status}</Badge>
                        </TableCell>
                        {isAdmin ? (
                          <TableCell>
                            <div className="flex flex-wrap items-center justify-center gap-2">
                              <Button
                                type="button"
                                size="sm"
                                disabled={isPending}
                                className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                                onClick={() => runApprove(row.id)}
                              >
                                {rowBusy ? (
                                  <Loader2 className="size-3.5 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="size-3.5" />
                                )}
                                Approve
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={isPending}
                                className="gap-1.5 text-red-700 hover:bg-red-50"
                                onClick={() => openRejectDialog(row.id)}
                              >
                                <XCircle className="size-3.5" />
                                Reject
                              </Button>
                            </div>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={rejectOpen}
        onOpenChange={(open) => {
          if (!isPending) {
            setRejectOpen(open);
            if (!open) {
              setActiveRequestId(null);
              setRejectComment("");
            }
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ปฏิเสธคำขอแก้ไขพารามิเตอร์</AlertDialogTitle>
            <AlertDialogDescription>
              ระบุเหตุผลการปฏิเสธ — ค่าใน system_parameters จะไม่ถูกเปลี่ยนแปลง
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <Label htmlFor="reject-comment">เหตุผล</Label>
            <Textarea
              id="reject-comment"
              rows={3}
              disabled={isPending}
              value={rejectComment}
              onChange={(event) => setRejectComment(event.target.value)}
              placeholder="เช่น ค่าไม่ถูกต้องตามนโยบายบริษัท"
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending || !rejectComment.trim()}
              className="bg-red-600 hover:bg-red-700"
              onClick={(event) => {
                event.preventDefault();
                runReject();
              }}
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "ยืนยันปฏิเสธ"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
