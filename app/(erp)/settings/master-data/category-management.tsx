"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Power } from "lucide-react";
import { toast } from "sonner";
import {
  createCategory,
  toggleCategoryStatus,
  updateCategory,
} from "@/lib/actions/master-data-actions";
import {
  CHILD_CATEGORY_CODE_LENGTH,
  CHILD_CODE_ERROR_MESSAGE,
  PARENT_CATEGORY_CODE_LENGTH,
  PARENT_CODE_ERROR_MESSAGE,
  normalizeCategoryCode,
} from "@/lib/validations/master-category";
import type {
  CategoryKind,
  MasterCategoryRow,
} from "@/types/master-category";
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
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type CategoryFormState = {
  kind: CategoryKind;
  category_code: string;
  category_name: string;
  parent_id: string;
};

const EMPTY_FORM: CategoryFormState = {
  kind: "parent",
  category_code: "",
  category_name: "",
  parent_id: "",
};

function StatusBadge({ active }: { active: boolean }) {
  if (active) {
    return <Badge variant="emerald">Active</Badge>;
  }
  return <Badge className="bg-slate-100 text-slate-500">Inactive</Badge>;
}

function compareCategoryCode(left: string, right: string) {
  return left.localeCompare(right, "en");
}

export function CategoryManagement({
  categories,
}: {
  categories: MasterCategoryRow[];
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MasterCategoryRow | null>(null);
  const [form, setForm] = useState<CategoryFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const isEdit = Boolean(editing);
  const codeMaxLength =
    form.kind === "parent"
      ? PARENT_CATEGORY_CODE_LENGTH
      : CHILD_CATEGORY_CODE_LENGTH;

  const childCountByParent = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of categories) {
      if (!row.parent_id) continue;
      counts.set(row.parent_id, (counts.get(row.parent_id) ?? 0) + 1);
    }
    return counts;
  }, [categories]);

  const hasChildren = Boolean(
    editing && (childCountByParent.get(editing.id) ?? 0) > 0,
  );

  const groupedRows = useMemo(() => {
    const parents = categories
      .filter((row) => !row.parent_id)
      .sort((left, right) =>
        compareCategoryCode(left.category_code, right.category_code),
      );
    const children = categories.filter((row) => row.parent_id);
    const used = new Set<string>();
    const rows: { row: MasterCategoryRow; depth: 0 | 1 }[] = [];

    for (const parent of parents) {
      rows.push({ row: parent, depth: 0 });
      const kids = children
        .filter((child) => child.parent_id === parent.id)
        .sort((left, right) =>
          compareCategoryCode(left.category_code, right.category_code),
        );
      for (const kid of kids) {
        rows.push({ row: kid, depth: 1 });
        used.add(kid.id);
      }
    }

    const orphans = children
      .filter((child) => !used.has(child.id))
      .sort((left, right) =>
        compareCategoryCode(left.category_code, right.category_code),
      );
    for (const orphan of orphans) {
      rows.push({ row: orphan, depth: 1 });
    }

    return rows;
  }, [categories]);

  const parentOptions = useMemo(() => {
    return categories
      .filter((row) => {
        if (row.parent_id) return false;
        if (editing && row.id === editing.id) return false;
        if (!row.is_active && row.id !== form.parent_id) return false;
        return true;
      })
      .sort((left, right) =>
        compareCategoryCode(left.category_code, right.category_code),
      );
  }, [categories, editing, form.parent_id]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setDialogOpen(true);
  }

  function openEdit(row: MasterCategoryRow) {
    setEditing(row);
    setForm({
      kind: row.parent_id ? "child" : "parent",
      category_code: row.category_code,
      category_name: row.category_name,
      parent_id: row.parent_id ?? "",
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

  function applyKind(nextKind: CategoryKind) {
    if (hasChildren && nextKind === "child") return;
    setForm((current) => {
      const parent = parentOptions.find((row) => row.id === current.parent_id);
      let nextCode = normalizeCategoryCode(current.category_code);
      if (nextKind === "parent") {
        nextCode = nextCode.slice(0, PARENT_CATEGORY_CODE_LENGTH);
        return {
          ...current,
          kind: nextKind,
          parent_id: "",
          category_code: nextCode,
        };
      }
      const prefix = parent?.category_code.slice(0, 1) ?? "";
      if (prefix) {
        nextCode = `${prefix}${nextCode.slice(1)}`.slice(
          0,
          CHILD_CATEGORY_CODE_LENGTH,
        );
      } else {
        nextCode = nextCode.slice(0, CHILD_CATEGORY_CODE_LENGTH);
      }
      return { ...current, kind: nextKind, category_code: nextCode };
    });
    setFormError(null);
  }

  function applyParent(parentId: string) {
    const parent = parentOptions.find((row) => row.id === parentId);
    const prefix = parent?.category_code.slice(0, 1) ?? "";
    setForm((current) => {
      const rest = normalizeCategoryCode(current.category_code).slice(1);
      const nextCode = prefix
        ? `${prefix}${rest}`.slice(0, CHILD_CATEGORY_CODE_LENGTH)
        : current.category_code;
      return { ...current, parent_id: parentId, category_code: nextCode };
    });
    setFormError(null);
  }

  const canSubmit = useMemo(() => {
    if (isSubmitting) return false;
    if (!form.category_name.trim()) return false;
    if (!form.category_code.trim()) return false;
    if (form.kind === "child" && !form.parent_id) return false;
    return true;
  }, [form, isSubmitting]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    setFormError(null);
    try {
      const payload = {
        category_code: normalizeCategoryCode(form.category_code),
        category_name: form.category_name.trim(),
        kind: form.kind,
        parent_id: form.kind === "child" ? form.parent_id : null,
      };
      const result =
        isEdit && editing
          ? await updateCategory({ id: editing.id, ...payload })
          : await createCategory(payload);

      if (!result.success) {
        setFormError(result.error);
        toast.error(result.error);
        return;
      }

      toast.success(
        isEdit
          ? `อัปเดตหมวดหมู่ ${result.data.category_name} แล้ว`
          : `เพิ่มหมวดหมู่ ${result.data.category_name} แล้ว`,
      );
      setDialogOpen(false);
      setEditing(null);
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleToggle(row: MasterCategoryRow) {
    if (togglingId) return;
    setTogglingId(row.id);
    try {
      const result = await toggleCategoryStatus(row.id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.data.is_active
          ? `เปิดใช้งานหมวดหมู่ ${result.data.category_name} แล้ว`
          : `ปิดใช้งานหมวดหมู่ ${result.data.category_name} แล้ว`,
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
          เพิ่มหมวดหมู่ใหม่
        </Button>
      </div>

      {groupedRows.length === 0 ? (
        <p className="px-2 py-10 text-center text-sm text-slate-500">
          ยังไม่มีหมวดหมู่ในระบบ — กด &quot;เพิ่มหมวดหมู่ใหม่&quot; เพื่อเริ่มต้น
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>รหัส</TableHead>
              <TableHead>ชื่อหมวดหมู่</TableHead>
              <TableHead>ประเภท</TableHead>
              <TableHead>หมวดหมู่หลัก</TableHead>
              <TableHead>สถานะ</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groupedRows.map(({ row, depth }) => (
              <TableRow
                key={row.id}
                className={row.is_active ? undefined : "opacity-60"}
              >
                <TableCell
                  className={`font-mono text-sm font-semibold ${
                    depth === 1 ? "pl-8 text-slate-600" : ""
                  }`}
                >
                  {depth === 1 ? (
                    <span className="mr-1 text-slate-400">↳</span>
                  ) : null}
                  {row.category_code}
                </TableCell>
                <TableCell className={depth === 1 ? "pl-4" : undefined}>
                  {row.category_name}
                </TableCell>
                <TableCell>
                  {row.parent_id ? (
                    <Badge variant="slate">หมวดหมู่ย่อย</Badge>
                  ) : (
                    <Badge variant="blue">หมวดหมู่หลัก</Badge>
                  )}
                </TableCell>
                <TableCell className="text-sm text-slate-600">
                  {row.parent_name
                    ? `${row.parent_name} (${row.parent_code ?? "—"})`
                    : "—"}
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
                {isEdit ? "แก้ไขหมวดหมู่" : "เพิ่มหมวดหมู่ใหม่"}
              </DialogTitle>
              <DialogDescription>
                บันทึกลงตาราง{" "}
                <span className="font-mono text-xs">mst_categories</span> —
                หมวดหลัก 1 ตัวอักษร · หมวดย่อย 2 ตัวอักษร (ตัวแรกสืบทอดจากแม่)
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div>
                <Label>ประเภทหมวดหมู่</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => applyKind("parent")}
                    className={`rounded-xl border px-3 py-2.5 text-left text-xs font-semibold transition ${
                      form.kind === "parent"
                        ? "border-blue-400 bg-blue-50 text-blue-800"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                    }`}
                  >
                    เป็นหมวดหมู่หลัก
                    <span className="mt-0.5 block font-normal text-[11px] text-slate-500">
                      รหัส 1 ตัวอักษร · ไม่มีแม่
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting || hasChildren}
                    onClick={() => applyKind("child")}
                    className={`rounded-xl border px-3 py-2.5 text-left text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      form.kind === "child"
                        ? "border-blue-400 bg-blue-50 text-blue-800"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                    }`}
                  >
                    เป็นหมวดหมู่ย่อย
                    <span className="mt-0.5 block font-normal text-[11px] text-slate-500">
                      รหัส 2 ตัวอักษร · เลือกแม่
                    </span>
                  </button>
                </div>
                {hasChildren ? (
                  <p className="mt-1 text-[11px] text-slate-400">
                    หมวดหมู่นี้มีลูกอยู่แล้ว จึงล็อกเป็นหมวดหมู่หลัก
                  </p>
                ) : null}
              </div>

              {form.kind === "child" ? (
                <div>
                  <Label htmlFor="category-parent">
                    หมวดหมู่หลัก <span className="text-red-500">*</span>
                  </Label>
                  <Select
                    id="category-parent"
                    required
                    value={form.parent_id}
                    disabled={isSubmitting}
                    onChange={(event) => applyParent(event.target.value)}
                  >
                    <option value="">เลือกหมวดหมู่หลัก</option>
                    {parentOptions.map((parent) => (
                      <option key={parent.id} value={parent.id}>
                        {parent.category_name} ({parent.category_code})
                        {parent.is_active ? "" : " — Inactive"}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null}

              <div>
                <Label htmlFor="category-code">
                  รหัสหมวดหมู่ (Code) <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="category-code"
                  required
                  value={form.category_code}
                  maxLength={codeMaxLength}
                  disabled={isSubmitting}
                  className="font-mono uppercase tracking-widest"
                  placeholder={form.kind === "parent" ? "เช่น A" : "เช่น AT"}
                  onChange={(event) => {
                    const parentPrefix =
                      form.kind === "child"
                        ? parentOptions
                            .find((row) => row.id === form.parent_id)
                            ?.category_code.slice(0, 1) ?? ""
                        : "";
                    let next = normalizeCategoryCode(event.target.value).slice(
                      0,
                      codeMaxLength,
                    );
                    if (form.kind === "child" && parentPrefix) {
                      next =
                        next.length === 0
                          ? parentPrefix
                          : `${parentPrefix}${next.slice(1)}`.slice(
                              0,
                              CHILD_CATEGORY_CODE_LENGTH,
                            );
                    }
                    setForm((current) => ({
                      ...current,
                      category_code: next,
                    }));
                    setFormError(null);
                  }}
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  {form.kind === "parent"
                    ? PARENT_CODE_ERROR_MESSAGE
                    : CHILD_CODE_ERROR_MESSAGE}
                </p>
              </div>

              <div>
                <Label htmlFor="category-name">
                  ชื่อหมวดหมู่ <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="category-name"
                  required
                  maxLength={100}
                  value={form.category_name}
                  disabled={isSubmitting}
                  placeholder="เช่น กีฬา, เสื้อยืด"
                  onChange={(event) => {
                    setForm((current) => ({
                      ...current,
                      category_name: event.target.value,
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
                    : "บันทึกหมวดหมู่"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
