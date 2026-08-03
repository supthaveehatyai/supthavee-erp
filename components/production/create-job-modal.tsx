"use client";

/**
 * Phase 7 MTO — Create Production Job modal.
 * Opens from sales document detail (ISSUED) → Server Action createProductionJob.
 */

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Factory } from "lucide-react";
import { toast } from "sonner";
import { createProductionJob } from "@/app/actions/kanban-actions";
import {
  PRODUCTION_JOB_TYPES,
  type ProductionJobType,
} from "@/types/kanban";
import { Button } from "@/components/ui/button";
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
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const JOB_TYPE_LABEL: Record<ProductionJobType, string> = {
  SCREEN: "สกรีน (SCREEN)",
  EMBROIDERY: "ปัก (EMBROIDERY)",
  SEWING: "เย็บ (SEWING)",
  OTHER: "อื่นๆ (OTHER)",
};

export type CreateJobModalProps = {
  document_id: string;
  /** แสดงบนคำอธิบาย modal */
  docNo?: string | null;
};

export function CreateJobModal({ document_id, docNo }: CreateJobModalProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [jobType, setJobType] = useState<ProductionJobType>("SCREEN");
  const [dueDate, setDueDate] = useState("");
  const [details, setDetails] = useState("");

  useEffect(() => {
    if (!open) return;
    setJobType("SCREEN");
    setDueDate("");
    setDetails("");
  }, [open]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!document_id?.trim()) {
      toast.error("ไม่พบรหัสเอกสาร (document_id)");
      return;
    }
    if (!dueDate) {
      toast.error("กรุณาเลือกวันกำหนดส่ง");
      return;
    }
    if (!details.trim()) {
      toast.error("กรุณากรอกรายละเอียดคำสั่งทำ");
      return;
    }

    startTransition(async () => {
      const result = await createProductionJob({
        document_id,
        job_type: jobType,
        due_date: dueDate,
        details: details.trim(),
      });

      if (!result.success || !result.data) {
        toast.error(result.error ?? "สร้างใบสั่งผลิตไม่สำเร็จ");
        return;
      }

      toast.success(`สร้างใบสั่งผลิต ${result.data.job_no} แล้ว`);
      setOpen(false);
      router.refresh();
      router.push("/production/kanban");
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={isPending}
        onClick={() => setOpen(true)}
        className="h-10 gap-2 border-violet-200 bg-violet-50 font-semibold text-violet-800 hover:bg-violet-100"
      >
        <Factory className="size-4" />
        🛠️ ส่งงานผลิต (Send to Production)
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>สร้างใบสั่งผลิต (MTO)</DialogTitle>
            <DialogDescription>
              เชื่อมบิลขายเข้าสายการผลิต — สถานะเริ่มต้น TODO
              {docNo ? (
                <>
                  {" "}
                  · อ้างอิง{" "}
                  <span className="font-mono font-semibold text-slate-700">
                    {docNo}
                  </span>
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="mto-job-type">ประเภทงาน</Label>
              <Select
                id="mto-job-type"
                value={jobType}
                disabled={isPending}
                onChange={(e) =>
                  setJobType(e.target.value as ProductionJobType)
                }
              >
                {PRODUCTION_JOB_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {JOB_TYPE_LABEL[type]}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="mto-due-date">วันกำหนดส่ง</Label>
              <Input
                id="mto-due-date"
                type="date"
                value={dueDate}
                disabled={isPending}
                required
                onChange={(e) => setDueDate(e.target.value)}
                className="h-10"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="mto-details">รายละเอียดคำสั่งทำ</Label>
              <Textarea
                id="mto-details"
                value={details}
                disabled={isPending}
                required
                rows={4}
                placeholder="เช่น สกรีนอกซ้าย 1 สี · ปักโลโก้หน้าอก"
                onChange={(e) => setDetails(e.target.value)}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={isPending}
                onClick={() => setOpen(false)}
              >
                ยกเลิก
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "กำลังสร้าง..." : "สร้างใบสั่งผลิต"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
