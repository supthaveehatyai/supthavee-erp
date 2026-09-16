"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Power } from "lucide-react";
import { toast } from "sonner";
import {
  createSize,
  toggleSizeStatus,
  updateSize,
} from "@/lib/actions/master-data-actions";
import {
  SIZE_CODE_ERROR_MESSAGE,
  SIZE_CODE_MAX_LENGTH,
  normalizeSizeCode,
} from "@/lib/validations/master-size";
import type { MasterSizeRow } from "@/types/master-size";
import { Badge } from "@/components/ui/badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type SizeFormState = {
  size_code: string;
  size_label: string;
  sort_order: string;
};

const EMPTY_FORM: SizeFormState = {
  size_code: "",
  size_label: "",
  sort_order: "",
};

function StatusBadge({ active }: { active: boolean }) {
  if (active) {
    return <Badge variant="emerald">Active</Badge>;
  }
  return (
    <Badge className="bg-slate-100 text-slate-500">Inactive</Badge>
  );
}

export function SizesManager({ sizes }: { sizes: MasterSizeRow[] }) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MasterSizeRow | null>(null);
  const [form, setForm] = useState<SizeFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const isEdit = Boolean(editing);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setDialogOpen(true);
  }

  function openEdit(row: MasterSizeRow) {
    setEditing(row);
    setForm({
      size_code: row.size_code,
      size_label: row.size_label,
      sort_order: String(row.sort_order),
    });
    setFormError(null);
    setDialogOpen(true);
  }

  function closeDialog() {
    if (isSubmitting) return;
    setDialogOpen(false);
    setEditing(null);
    setFormError(null);
  }

  const canSubmit = useMemo(() => {
    return (
      !isSubmitting &&
      form.size_label.trim().length > 0 &&
      form.size_code.trim().length > 0 &&
      form.sort_order.trim().length > 0
    );
  }, [form, isSubmitting]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const sortOrder = Number(form.sort_order);
    if (!Number.isInteger(sortOrder) || sortOrder < 0) {
      setFormError("ลำดับต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป");
      return;
    }

    setIsSubmitting(true);
    setFormError(null);
    try {
      const payload = {
        size_code: normalizeSizeCode(form.size_code),
        size_label: form.size_label.trim(),
        sort_order: sortOrder,
      };
      const result = isEdit && editing
        ? await updateSize({ id: editing.id, ...payload })
        : await createSize(payload);

      if (!result.success) {
        setFormError(result.error);
        toast.error(result.error);
        return;
      }

      toast.success(
        isEdit
          ? `อัปเดตไซส์ ${result.data.size_label} แล้ว`
          : `เพิ่มไซส์ ${result.data.size_label} แล้ว`,
      );
      setDialogOpen(false);
      setEditing(null);
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleToggle(row: MasterSizeRow) {
    if (togglingId) return;
    setTogglingId(row.id);
    try {
      const result = await toggleSizeStatus(row.id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.data.is_active
          ? `เปิดใช้งานไซส์ ${result.data.size_label} แล้ว`
          : `ปิดใช้งานไซส์ ${result.data.size_label} แล้ว`,
      );
      router.refresh();
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button type="button" onClick={openCreate} className="gap-2">
          <Plus className="size-4" />
          เพิ่มไซส์ใหม่
        </Button>
      </div>

      {sizes.length === 0 ? (
        <p className="px-2 py-10 text-center text-sm text-slate-500">
          ยังไม่มีไซส์ในระบบ — กด &quot;เพิ่มไซส์ใหม่&quot; เพื่อเริ่มต้น
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>รหัสไซส์ (Code)</TableHead>
              <TableHead>ชื่อป้ายไซส์ (Label)</TableHead>
              <TableHead className="text-right">ลำดับ (Sort Order)</TableHead>
              <TableHead>สถานะ</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sizes.map((row) => (
              <TableRow
                key={row.id}
                className={row.is_active ? undefined : "opacity-60"}
              >
                <TableCell className="font-mono text-sm font-semibold">
                  {row.size_code}
                </TableCell>
                <TableCell>{row.size_label}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.sort_order}
                </TableCell>
                <TableCell>
                  <StatusBadge active={row.is_active} />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => openEdit(row)}
                    >
                      <Pencil className="size-3.5" />
                      แก้ไข
                    </Button>
                    <Button
                      type="button"
                      variant={row.is_active ? "outline" : "secondary"}
                      size="sm"
                      className="gap-1.5"
                      disabled={togglingId === row.id}
                      onClick={() => handleToggle(row)}
                    >
                      <Power className="size-3.5" />
                      {row.is_active ? "ปิดใช้งาน" : "เปิดใช้งาน"}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog
        open={dialogOpen}
        onOpenChange={(next) => {
          if (!next) closeDialog();
        }}
      >
        <DialogContent>
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>
                {isEdit ? "แก้ไขไซส์" : "เพิ่มไซส์ใหม่"}
              </DialogTitle>
              <DialogDescription>
                บันทึกลงตาราง{" "}
                <span className="font-mono text-xs">mst_sizes</span> —
                รหัสสูงสุด {SIZE_CODE_MAX_LENGTH} ตัวอักษร · ลำดับแนะนำ Gap of
                10
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div>
                <Label htmlFor="size-code">
                  รหัสไซส์ (Code) <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="size-code"
                  required
                  value={form.size_code}
                  maxLength={SIZE_CODE_MAX_LENGTH}
                  disabled={isSubmitting || isEdit}
                  className="font-mono uppercase tracking-widest"
                  placeholder="เช่น S, XL, 10"
                  onChange={(event) => {
                    setForm((current) => ({
                      ...current,
                      size_code: event.target.value
                        .toUpperCase()
                        .replace(/[^A-Z0-9]/g, "")
                        .slice(0, SIZE_CODE_MAX_LENGTH),
                    }));
                    setFormError(null);
                  }}
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  {SIZE_CODE_ERROR_MESSAGE}
                  {isEdit ? " — แก้ไขรหัสไซส์ไม่ได้เพื่อรักษา SKU" : ""}
                </p>
              </div>

              <div>
                <Label htmlFor="size-label">
                  ชื่อป้ายไซส์ (Label) <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="size-label"
                  required
                  maxLength={20}
                  value={form.size_label}
                  disabled={isSubmitting}
                  placeholder="เช่น ไซส์ S, เบอร์ 10"
                  onChange={(event) => {
                    setForm((current) => ({
                      ...current,
                      size_label: event.target.value,
                    }));
                    setFormError(null);
                  }}
                />
              </div>

              <div>
                <Label htmlFor="size-sort">
                  ลำดับ (Sort Order) <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="size-sort"
                  required
                  type="number"
                  min={0}
                  step={10}
                  value={form.sort_order}
                  disabled={isSubmitting}
                  placeholder="เช่น 10, 20, 30"
                  className="tabular-nums"
                  onChange={(event) => {
                    setForm((current) => ({
                      ...current,
                      sort_order: event.target.value,
                    }));
                    setFormError(null);
                  }}
                />
              </div>

              {formError ? (
                <p
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700"
                >
                  {formError}
                </p>
              ) : null}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                onClick={closeDialog}
              >
                ยกเลิก
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {isSubmitting
                  ? "กำลังบันทึก..."
                  : isEdit
                    ? "บันทึกการแก้ไข"
                    : "บันทึกไซส์"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
