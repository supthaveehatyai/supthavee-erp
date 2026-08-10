"use client";

import {
  useRef,
  useState,
  useTransition,
  type ChangeEvent,
} from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Building2, ImagePlus, Loader2, Save, Trash2, Warehouse } from "lucide-react";

import {
  updateSystemSettings,
  uploadCompanyLogo,
} from "@/lib/actions/settings";
import { companySettingsSchema } from "@/lib/validations/system-settings";
import type { SystemSettings } from "@/types/system-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type CompanySettingsFormValues = z.infer<typeof companySettingsSchema>;

type CompanySettingsFormProps = {
  initialData: SystemSettings;
};

function toVatRate(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 7;
}

export function CompanySettingsForm({ initialData }: CompanySettingsFormProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [isUploading, setIsUploading] = useState(false);
  /** Cache-bust เฉพาะหลังอัปโหลดใหม่ฝั่ง Client — null ตอน SSR/initial เพื่อกัน Hydration mismatch */
  const [cacheBust, setCacheBust] = useState<number | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isDirty },
  } = useForm<CompanySettingsFormValues>({
    resolver: zodResolver(companySettingsSchema),
    defaultValues: {
      company_name: initialData.company_name,
      tax_id: initialData.tax_id,
      branch_code: initialData.branch_code || "00000",
      branch_name: initialData.branch_name || "สำนักงานใหญ่",
      address: initialData.address,
      phone: initialData.phone,
      email: initialData.email || "",
      vat_rate: toVatRate(initialData.vat_rate),
      logo_url: initialData.logo_url || "",
      allow_negative_inventory: Boolean(initialData.allow_negative_inventory),
    },
  });

  const logoUrl = watch("logo_url") || "";
  const allowNegativeInventory = watch("allow_negative_inventory");
  const baseLogoUrl = logoUrl.split("?")[0];
  // URL จาก DB แสดงตรงๆ; ใส่ ?t= เฉพาะหลังอัปโหลดใหม่
  const previewSrc =
    !baseLogoUrl
      ? ""
      : cacheBust != null
        ? `${baseLogoUrl}?t=${cacheBust}`
        : baseLogoUrl;

  const onSubmit = (values: CompanySettingsFormValues) => {
    startTransition(async () => {
      const result = await updateSystemSettings({
        ...values,
        logo_url: values.logo_url?.trim().split("?")[0] || "",
        allow_negative_inventory: Boolean(values.allow_negative_inventory),
      });

      if (!result.success) {
        toast.error(result.error || "บันทึกไม่สำเร็จ");
        return;
      }

      reset({
        company_name: result.data.company_name,
        tax_id: result.data.tax_id,
        branch_code: result.data.branch_code || "00000",
        branch_name: result.data.branch_name || "สำนักงานใหญ่",
        address: result.data.address,
        phone: result.data.phone,
        email: result.data.email || "",
        vat_rate: toVatRate(result.data.vat_rate),
        logo_url: result.data.logo_url || "",
        allow_negative_inventory: Boolean(result.data.allow_negative_inventory),
      });
      setCacheBust(null);
      toast.success("บันทึกข้อมูลบริษัทเรียบร้อยแล้ว");
    });
  };

  const handleLogoPick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await uploadCompanyLogo(formData);

      if (!result.success) {
        toast.error(result.error || "อัปโหลดโลโก้ไม่สำเร็จ");
        return;
      }

      setValue("logo_url", result.url, {
        shouldDirty: true,
        shouldValidate: true,
      });
      setCacheBust(Date.now());
      toast.success("อัปโหลดโลโก้สำเร็จ — กดบันทึกเพื่อยืนยัน");
    } finally {
      setIsUploading(false);
    }
  };

  const clearLogo = () => {
    setValue("logo_url", "", { shouldDirty: true, shouldValidate: true });
    setCacheBust(null);
  };

  const busy = isPending || isUploading;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="size-5 text-blue-600" />
          ข้อมูลบริษัท
        </CardTitle>
        <CardDescription>
          Single Source of Truth สำหรับเอกสารพิมพ์และรายงานภาษี (แถว id = 1)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          id="company-settings-form"
          onSubmit={handleSubmit(onSubmit)}
          className="grid grid-cols-1 gap-4 md:grid-cols-2"
          noValidate
        >
          <input type="hidden" {...register("logo_url")} />

          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="company_name">
              ชื่อบริษัท <span className="text-red-500">*</span>
            </Label>
            <Input
              id="company_name"
              placeholder="บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด"
              disabled={busy}
              {...register("company_name")}
            />
            {errors.company_name ? (
              <p className="text-xs text-red-600">{errors.company_name.message}</p>
            ) : null}
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <Label>โลโก้บริษัท</Label>
            <div className="flex flex-col gap-3 rounded-xl border border-dashed border-slate-200 bg-slate-50/80 p-4 sm:flex-row sm:items-center">
              <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white">
                {previewSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewSrc}
                    alt="โลโก้บริษัท"
                    className="max-h-full max-w-full object-contain p-1"
                    suppressHydrationWarning={true}
                  />
                ) : (
                  <ImagePlus className="size-8 text-slate-300" />
                )}
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <p className="text-xs text-slate-500">
                  อัปโหลดเข้า Storage <code>company_assets</code> (JPG/PNG/WEBP/SVG
                  สูงสุด 5MB) แล้วเก็บ Public URL ในฟอร์ม
                </p>
                <div className="flex flex-wrap gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/svg+xml"
                    className="hidden"
                    onChange={handleLogoPick}
                    disabled={busy}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    className="inline-flex items-center gap-2"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {isUploading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ImagePlus className="size-4" />
                    )}
                    {isUploading ? "กำลังอัปโหลด..." : "เลือกไฟล์โลโก้"}
                  </Button>
                  {logoUrl ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      className="inline-flex items-center gap-2 text-red-600 hover:text-red-700"
                      onClick={clearLogo}
                    >
                      <Trash2 className="size-4" />
                      ลบโลโก้
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tax_id">เลขประจำตัวผู้เสียภาษี</Label>
            <Input
              id="tax_id"
              inputMode="numeric"
              maxLength={13}
              placeholder="13 หลัก"
              disabled={busy}
              {...register("tax_id")}
            />
            {errors.tax_id ? (
              <p className="text-xs text-red-600">{errors.tax_id.message}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="vat_rate">
              อัตรา VAT มาตรฐาน (%) <span className="text-red-500">*</span>
            </Label>
            <Input
              id="vat_rate"
              type="number"
              step="0.01"
              min={0}
              max={100}
              disabled={busy}
              {...register("vat_rate", { valueAsNumber: true })}
            />
            {errors.vat_rate ? (
              <p className="text-xs text-red-600">{errors.vat_rate.message}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="branch_code">
              รหัสสาขา <span className="text-red-500">*</span>
            </Label>
            <Input
              id="branch_code"
              placeholder="00000"
              disabled={busy}
              {...register("branch_code")}
            />
            {errors.branch_code ? (
              <p className="text-xs text-red-600">{errors.branch_code.message}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="branch_name">
              ชื่อสาขา <span className="text-red-500">*</span>
            </Label>
            <Input
              id="branch_name"
              placeholder="สำนักงานใหญ่"
              disabled={busy}
              {...register("branch_name")}
            />
            {errors.branch_name ? (
              <p className="text-xs text-red-600">{errors.branch_name.message}</p>
            ) : null}
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="address">ที่อยู่</Label>
            <Textarea
              id="address"
              rows={3}
              placeholder="ที่อยู่บริษัทบนเอกสารพิมพ์"
              disabled={busy}
              {...register("address")}
            />
            {errors.address ? (
              <p className="text-xs text-red-600">{errors.address.message}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="phone">เบอร์โทรศัพท์</Label>
            <Input
              id="phone"
              placeholder="0x-xxx-xxxx"
              disabled={busy}
              {...register("phone")}
            />
            {errors.phone ? (
              <p className="text-xs text-red-600">{errors.phone.message}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">อีเมล</Label>
            <Input
              id="email"
              type="email"
              placeholder="info@example.com"
              disabled={busy}
              {...register("email")}
            />
            {errors.email ? (
              <p className="text-xs text-red-600">{errors.email.message}</p>
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-3 md:col-span-2">
            <Button
              type="submit"
              disabled={busy || !isDirty}
              className="inline-flex items-center gap-2"
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              {isPending ? "กำลังบันทึก..." : "บันทึกการตั้งค่า"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Warehouse className="size-5 text-orange-600" />
          ตั้งค่าขั้นสูง (คลังสินค้า)
        </CardTitle>
        <CardDescription>
          ควบคุมนโยบายสต็อกติดลบเมื่อออกบิลขาย (INV_DO / TAX_INV / CS_TAX / ABB)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-4">
          <div className="min-w-0 space-y-1">
            <Label htmlFor="allow_negative_inventory" className="text-sm font-semibold text-slate-900">
              อนุญาตสต็อกติดลบ (Allow Negative Inventory)
            </Label>
            <p className="text-xs leading-relaxed text-slate-500">
              ปิด = ห้ามตัดสต็อกเมื่อจำนวนไม่พอ (Error: สต็อกไม่เพียงพอ) · เปิด =
              ยอมให้ Ledger ติดลบได้เมื่อขายเกินของที่มี
            </p>
          </div>
          <Switch
            id="allow_negative_inventory"
            checked={Boolean(allowNegativeInventory)}
            disabled={busy}
            onCheckedChange={(next) =>
              setValue("allow_negative_inventory", next, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
          />
        </div>

        <div className="mt-4 flex justify-end">
          <Button
            type="submit"
            form="company-settings-form"
            disabled={busy || !isDirty}
            className="inline-flex items-center gap-2"
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            {isPending ? "กำลังบันทึก..." : "บันทึกการตั้งค่า"}
          </Button>
        </div>
      </CardContent>
    </Card>
    </div>
  );
}
