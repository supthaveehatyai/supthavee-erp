"use client";

/**
 * Approval Center — Maker-Checker UI (Server Actions only).
 * Expense rows open slide-over via `?view_expense=` (URL-driven).
 */

import { useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  ClipboardCheck,
  Eye,
  Loader2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { processApproval } from "@/app/actions/approval";
import type {
  ApprovalTab,
  ApprovalTargetType,
  PendingApprovalItem,
  PendingApprovalsPayload,
} from "@/types/approval";
import { buildViewExpenseHref } from "./expense-approval-review-sheet";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

export type ApprovalCenterPanelProps = {
  data: PendingApprovalsPayload;
  initialTab: ApprovalTab;
};

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium" }).format(date);
}

function creatorLabel(item: PendingApprovalItem): string {
  if (item.created_by_name) return item.created_by_name;
  if (item.created_by_email) return item.created_by_email;
  return "—";
}

function PendingApprovalTable({
  items,
  targetType,
  emptyLabel,
}: {
  items: PendingApprovalItem[];
  targetType: ApprovalTargetType;
  emptyLabel: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [rejectTarget, setRejectTarget] = useState<PendingApprovalItem | null>(
    null,
  );
  const [rejectComment, setRejectComment] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);

  function openExpenseReview(item: PendingApprovalItem) {
    if (targetType !== "EXPENSE") return;
    router.replace(
      buildViewExpenseHref(pathname, searchParams.toString(), item.id),
    );
  }

  function runApproval(
    item: PendingApprovalItem,
    action: "APPROVED" | "REJECTED",
    comment?: string,
  ) {
    if (isPending) return;

    startTransition(async () => {
      try {
        const result = await processApproval(
          item.id,
          targetType,
          action,
          comment,
        );
        if (!result.success) {
          toast.error(result.error ?? "ดำเนินการไม่สำเร็จ");
          return;
        }

        toast.success(
          action === "APPROVED"
            ? `อนุมัติ ${item.document_no} สำเร็จ`
            : `ปฏิเสธ ${item.document_no} แล้ว`,
        );
        setRejectTarget(null);
        setRejectComment("");
        setCommentError(null);

        // Close slide-over after decision
        if (targetType === "EXPENSE" && searchParams.get("view_expense")) {
          const params = new URLSearchParams(searchParams.toString());
          params.delete("view_expense");
          const qs = params.toString();
          router.replace(qs ? `${pathname}?${qs}` : pathname);
        }
        router.refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "ดำเนินการไม่สำเร็จ",
        );
      }
    });
  }

  function handleRejectConfirm() {
    if (!rejectTarget) return;
    const trimmed = rejectComment.trim();
    if (!trimmed) {
      setCommentError("กรุณาระบุเหตุผลในการปฏิเสธ");
      return;
    }
    setCommentError(null);
    runApproval(rejectTarget, "REJECTED", trimmed);
  }

  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 py-12 text-center text-sm text-slate-500">
        {emptyLabel}
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-md border border-slate-200">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead>เลขที่เอกสาร</TableHead>
              <TableHead>วันที่</TableHead>
              <TableHead>ผู้สร้าง</TableHead>
              <TableHead className="text-right">ยอดเงินรวม</TableHead>
              <TableHead className="text-center">จัดการ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow
                key={item.id}
                className={
                  targetType === "EXPENSE"
                    ? "cursor-pointer hover:bg-slate-50"
                    : undefined
                }
                onClick={() => {
                  if (targetType === "EXPENSE") openExpenseReview(item);
                }}
              >
                <TableCell>
                  <div className="space-y-1">
                    {targetType === "EXPENSE" ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 font-medium text-blue-700 underline-offset-2 hover:underline"
                        onClick={(event) => {
                          event.stopPropagation();
                          openExpenseReview(item);
                        }}
                      >
                        <Eye className="size-3.5" />
                        {item.document_no}
                      </button>
                    ) : (
                      <p className="font-medium text-slate-900">
                        {item.document_no}
                      </p>
                    )}
                    {item.doc_type ? (
                      <Badge variant="slate" className="font-mono text-[10px]">
                        {item.doc_type}
                      </Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-slate-700">
                  {formatDate(item.doc_date)}
                </TableCell>
                <TableCell className="text-slate-700">
                  {creatorLabel(item)}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums text-slate-900">
                  {formatMoney(item.grand_total)}
                </TableCell>
                <TableCell onClick={(event) => event.stopPropagation()}>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={isPending}
                      className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                      onClick={() => runApproval(item, "APPROVED")}
                    >
                      {isPending ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="size-3.5" />
                      )}
                      อนุมัติ
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={isPending}
                      className="gap-1.5"
                      onClick={() => {
                        setRejectTarget(item);
                        setRejectComment("");
                        setCommentError(null);
                      }}
                    >
                      <XCircle className="size-3.5" />
                      ปฏิเสธ
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AlertDialog
        open={rejectTarget != null}
        onOpenChange={(open) => {
          if (!open && !isPending) {
            setRejectTarget(null);
            setRejectComment("");
            setCommentError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันการปฏิเสธ</AlertDialogTitle>
            <AlertDialogDescription>
              กรุณาระบุเหตุผลในการปฏิเสธเอกสาร{" "}
              <strong>{rejectTarget?.document_no}</strong> — บังคับกรอก Comments
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reject-comment">
              เหตุผล (Comments) <span className="text-red-600">*</span>
            </Label>
            <Textarea
              id="reject-comment"
              value={rejectComment}
              disabled={isPending}
              required
              placeholder="ระบุเหตุผลที่ปฏิเสธ..."
              rows={4}
              onChange={(event) => {
                setRejectComment(event.target.value);
                if (commentError) setCommentError(null);
              }}
            />
            {commentError ? (
              <p className="text-sm text-red-600">{commentError}</p>
            ) : null}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending || !rejectComment.trim()}
              className="bg-red-600 hover:bg-red-700"
              onClick={(event) => {
                event.preventDefault();
                handleRejectConfirm();
              }}
            >
              {isPending ? "กำลังบันทึก..." : "ยืนยันปฏิเสธ"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function ApprovalCenterPanel({
  data,
  initialTab,
}: ApprovalCenterPanelProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeTab = initialTab;

  function handleTabChange(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", next);
    if (next !== "expenses") {
      params.delete("view_expense");
    }
    router.replace(`${pathname}?${params.toString()}`);
  }

  const documentCount = data.documents.length;
  const expenseCount = data.expenses.length;

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-2">
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-900">
          <ClipboardCheck className="h-8 w-8 text-blue-600" />
          Approval Center
        </h1>
        <p className="text-slate-500">
          Maker-Checker — อนุมัติหรือปฏิเสธเอกสารและค่าใช้จ่ายที่รอดำเนินการ
          (Admin)
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="documents" className="gap-2">
            เอกสารระบบ
            <Badge
              variant={documentCount > 0 ? "amber" : "default"}
              className="min-w-6 justify-center px-1.5"
            >
              {documentCount}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="expenses" className="gap-2">
            ค่าใช้จ่าย
            <Badge
              variant={expenseCount > 0 ? "amber" : "default"}
              className="min-w-6 justify-center px-1.5"
            >
              {expenseCount}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="documents" className="mt-4">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">เอกสารระบบ (Documents)</CardTitle>
              <CardDescription>
                รายการจากตาราง documents ที่ approval_status = PENDING
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PendingApprovalTable
                items={data.documents}
                targetType="DOCUMENT"
                emptyLabel="ไม่มีเอกสารที่รออนุมัติ"
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="expenses" className="mt-4">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">ค่าใช้จ่าย (Expenses)</CardTitle>
              <CardDescription>
                คลิกแถวเพื่อเปิด Slide-over รีวิวรายละเอียดก่อนอนุมัติ
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PendingApprovalTable
                items={data.expenses}
                targetType="EXPENSE"
                emptyLabel="ไม่มีค่าใช้จ่ายที่รออนุมัติ"
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
