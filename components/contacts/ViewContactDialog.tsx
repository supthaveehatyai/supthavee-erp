"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  getContactDetails,
  type ContactDetails,
  type ContactPersonRow,
} from "@/app/actions/contacts";
import { SkillRateCard } from "@/components/contacts/skill-rate-card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type ViewContactDialogProps = {
  contactId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function displayValue(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : "—";
}

function DetailField({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-[11px] font-semibold tracking-wide text-slate-400">
        {label}
      </p>
      <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{value}</p>
    </div>
  );
}

export default function ViewContactDialog({
  contactId,
  open,
  onOpenChange,
}: ViewContactDialogProps) {
  const [details, setDetails] = useState<ContactDetails | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !contactId) {
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError("");
    setDetails(null);

    void getContactDetails(contactId).then((result) => {
      if (cancelled) return;
      setIsLoading(false);
      if (result.error || !result.data) {
        const message = result.error ?? "โหลดรายละเอียดคู่ค้าไม่สำเร็จ";
        setError(message);
        toast.error(message);
        return;
      }
      setDetails(result.data);
    });

    return () => {
      cancelled = true;
    };
  }, [open, contactId]);

  const contact = details?.contact ?? null;
  const persons: ContactPersonRow[] = details?.persons ?? [];
  const canEditRates =
    contact?.contact_type === "Vendor" || contact?.contact_type === "Technician";

  function contactTypeLabel(value: string | null | undefined): string {
    if (value === "Vendor") return "ผู้จำหน่าย";
    if (value === "Technician") return "ช่างรับเหมา";
    return "ลูกค้า";
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>รายละเอียดคู่ค้า</DialogTitle>
          <DialogDescription>
            ข้อมูลองค์กรและผู้ประสานงาน (อ่านอย่างเดียว)
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3 py-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="h-10 animate-pulse rounded-lg bg-slate-100"
              />
            ))}
          </div>
        ) : error ? (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700"
          >
            {error}
          </div>
        ) : contact ? (
          <Tabs defaultValue="profile" className="space-y-1">
            {canEditRates ? (
              <TabsList>
                <TabsTrigger value="profile">ข้อมูลคู่ค้า</TabsTrigger>
                <TabsTrigger value="rates">ทักษะและค่าแรง</TabsTrigger>
              </TabsList>
            ) : null}

            <TabsContent value="profile" className="space-y-5">
            <section className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
              <p className="text-xs font-semibold text-slate-500">ข้อมูลคู่ค้า</p>
              <h3 className="mt-2 text-lg font-bold text-slate-900">
                {displayValue(contact.company_name)}
              </h3>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <DetailField
                  label="เลขประจำตัวผู้เสียภาษี"
                  value={displayValue(contact.tax_id)}
                />
                <DetailField
                  label="สาขา"
                  value={displayValue(contact.branch_code || "สำนักงานใหญ่")}
                />
                <DetailField
                  label="เบอร์โทร"
                  value={displayValue(contact.phone)}
                />
                <DetailField
                  label="ประเภท"
                  value={contactTypeLabel(contact.contact_type)}
                />
                <DetailField
                  label="ที่อยู่"
                  value={displayValue(contact.address)}
                  className="sm:col-span-2"
                />
              </div>
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-800">
                  ผู้ประสานงาน
                </p>
                <p className="text-xs text-slate-400">
                  {persons.length.toLocaleString("th-TH")} รายการ
                </p>
              </div>

              {persons.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-xs text-slate-400">
                  ยังไม่มีผู้ประสานงาน
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full min-w-[520px] text-left">
                    <thead className="border-b border-slate-200 bg-slate-50/80">
                      <tr>
                        {["ชื่อ", "ตำแหน่ง", "เบอร์โทร", "อีเมล"].map(
                          (heading) => (
                            <th
                              key={heading}
                              className="px-3 py-2.5 text-[11px] font-semibold text-slate-500"
                            >
                              {heading}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {persons.map((person) => (
                        <tr key={person.id} className="bg-white">
                          <td className="px-3 py-2.5 text-sm text-slate-800">
                            <span className="font-medium">{person.name}</span>
                            {person.is_primary ? (
                              <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                                หลัก
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-slate-600">
                            {displayValue(person.department_or_role)}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-slate-600">
                            {displayValue(person.phone)}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-slate-600">
                            {displayValue(person.email)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            </TabsContent>

            {canEditRates ? (
              <TabsContent value="rates">
                <SkillRateCard
                  technicianId={contact.id}
                  technicianName={contact.company_name}
                />
              </TabsContent>
            ) : null}
          </Tabs>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            ปิด
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
