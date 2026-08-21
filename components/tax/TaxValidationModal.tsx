"use client";

/**
 * Phase 8.5 — Tax Validation modal for vendor contacts.
 * Submits via Server Action only (Zero Client-Side Fetching).
 */

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateVendorTaxInfo } from "@/app/actions/tax-actions";
import type { TaxEntityType, WHTContactTax } from "@/types/tax";
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

export type TaxValidationModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string | null;
  companyName?: string | null;
  initial?: Partial<WHTContactTax> | null;
};

export function TaxValidationModal({
  open,
  onOpenChange,
  contactId,
  companyName,
  initial,
}: TaxValidationModalProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [entityType, setEntityType] = useState<TaxEntityType>("CORPORATE");
  const [taxId, setTaxId] = useState("");
  const [branchCode, setBranchCode] = useState("00000");
  const [taxAddress, setTaxAddress] = useState("");

  useEffect(() => {
    if (!open) return;
    const et = initial?.entity_type;
    setEntityType(et === "INDIVIDUAL" ? "INDIVIDUAL" : "CORPORATE");
    setTaxId(initial?.tax_id?.trim() ?? "");
    setBranchCode(
      initial?.tax_branch_code?.trim()
        ? initial.tax_branch_code.trim().padStart(5, "0")
        : "00000",
    );
    setTaxAddress(initial?.tax_address?.trim() ?? "");
  }, [open, initial]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!contactId) {
      toast.error("ไม่พบรหัสผู้จำหน่าย (contact_id)");
      return;
    }

    startTransition(async () => {
      const result = await updateVendorTaxInfo(contactId, {
        entity_type: entityType,
        tax_id: taxId,
        tax_branch_code: branchCode,
        tax_address: taxAddress,
      });

      if (!result.success) {
        toast.error(result.error ?? "อัปเดตข้อมูลภาษีไม่สำเร็จ");
        return;
      }

      toast.success("อัปเดตข้อมูลผู้จำหน่ายและยืนยัน Tax Validation แล้ว");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>อัปเดตข้อมูลผู้จำหน่าย (Tax Validation)</DialogTitle>
          <DialogDescription>
            กรอกข้อมูลภาษีให้ครบเพื่อแยกแบบฟอร์ม ภ.ง.ด.3 / ภ.ง.ด.53
            {companyName ? (
              <>
                {" "}
                · <span className="font-medium text-slate-700">{companyName}</span>
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tax-entity-type">ประเภท</Label>
            <Select
              id="tax-entity-type"
              value={entityType}
              disabled={isPending}
              onChange={(e) =>
                setEntityType(e.target.value as TaxEntityType)
              }
              required
            >
              <option value="INDIVIDUAL">บุคคลธรรมดา (ภ.ง.ด.3)</option>
              <option value="CORPORATE">นิติบุคคล (ภ.ง.ด.53)</option>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tax-id">เลขประจำตัวผู้เสียภาษี</Label>
            <Input
              id="tax-id"
              inputMode="numeric"
              maxLength={13}
              pattern="\d{13}"
              placeholder="1234567890123"
              value={taxId}
              disabled={isPending}
              onChange={(e) =>
                setTaxId(e.target.value.replace(/\D/g, "").slice(0, 13))
              }
              required
            />
            <p className="text-xs text-slate-400">ตัวเลข 13 หลัก</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tax-branch-code">สาขา (tax_branch_code)</Label>
            <Input
              id="tax-branch-code"
              inputMode="numeric"
              maxLength={5}
              placeholder="00000"
              value={branchCode}
              disabled={isPending}
              onChange={(e) =>
                setBranchCode(e.target.value.replace(/\D/g, "").slice(0, 5))
              }
            />
            <p className="text-xs text-slate-400">
              ค่าเริ่มต้น 00000 = สำนักงานใหญ่
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tax-address">ที่อยู่สำหรับยื่นภาษี</Label>
            <Textarea
              id="tax-address"
              rows={3}
              placeholder="ที่อยู่ตามทะเบียนภาษี"
              value={taxAddress}
              disabled={isPending}
              onChange={(e) => setTaxAddress(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => onOpenChange(false)}
            >
              ยกเลิก
            </Button>
            <Button type="submit" disabled={isPending || !contactId}>
              {isPending ? "กำลังบันทึก…" : "บันทึกและยืนยัน"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
