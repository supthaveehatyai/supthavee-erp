"use client";

/**
 * Create Bank Account form — calls Server Action + Toast on Unique Violation (23505).
 * Zero Client-Side Fetching: mutations only via `createBankAccount`.
 */

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createBankAccount } from "@/lib/actions/bank-accounts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function CreateBankAccountForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;

    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await createBankAccount(formData);
      if (!result.success) {
        toast.error(
          result.error ?? "ไม่สามารถสร้างบัญชีได้",
        );
        return;
      }

      toast.success("บันทึกบัญชีธนาคารแล้ว");
      formRef.current?.reset();
      router.refresh();
    });
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="space-y-4"
    >
      <div className="space-y-2">
        <Label htmlFor="bank_name">
          ธนาคาร (เช่น KBANK) <span className="text-red-500">*</span>
        </Label>
        <Input
          id="bank_name"
          name="bank_name"
          placeholder="เช่น กสิกรไทย"
          required
          disabled={isPending}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="account_no">
          เลขที่บัญชี <span className="text-red-500">*</span>
        </Label>
        <Input
          id="account_no"
          name="account_no"
          placeholder="xxx-x-xxxxx-x"
          required
          disabled={isPending}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="account_name">
          ชื่อบัญชี <span className="text-red-500">*</span>
        </Label>
        <Input
          id="account_name"
          name="account_name"
          placeholder="บจก. ทรัพย์ทวี หาดใหญ่"
          required
          disabled={isPending}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="branch_name">สาขา (ถ้ามี)</Label>
        <Input
          id="branch_name"
          name="branch_name"
          placeholder="เช่น สาขาหาดใหญ่"
          disabled={isPending}
        />
      </div>
      <Button type="submit" className="mt-4 w-full" disabled={isPending}>
        {isPending ? "กำลังบันทึก..." : "บันทึกบัญชี"}
      </Button>
    </form>
  );
}
