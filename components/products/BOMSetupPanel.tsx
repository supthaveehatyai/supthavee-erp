"use client";

/**
 * BOM Setup Panel — สูตรการผลิต (product_boms) ต่อรุ่นสินค้า
 * Zero Client-Side Fetching via `@/lib/actions/bom-actions`
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { Check, ChevronsUpDown, Info, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  addBOMItem,
  getBOMByModelId,
  removeBOMItem,
  searchRawMaterialModels,
} from "@/lib/actions/bom-actions";
import type { BOMItemRow, RawMaterialModelOption } from "@/types/bom";
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
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

function formatQty(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

function formatPercent(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Debounce a string value (typing delay for Server Action search). */
function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

export type BOMSetupPanelProps = {
  modelId: string;
};

export function BOMSetupPanel({ modelId }: BOMSetupPanelProps) {
  const [items, setItems] = useState<BOMItemRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [comboOpen, setComboOpen] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState("");
  const debouncedKeyword = useDebounce(searchKeyword, 300);
  const [materialOptions, setMaterialOptions] = useState<
    RawMaterialModelOption[]
  >([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedMaterial, setSelectedMaterial] =
    useState<RawMaterialModelOption | null>(null);
  const [quantityRequired, setQuantityRequired] = useState("");
  const [wastePercent, setWastePercent] = useState("0");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [pendingDelete, setPendingDelete] = useState<BOMItemRow | null>(null);
  const [isAdding, startAdd] = useTransition();
  const [isDeleting, startDelete] = useTransition();

  const assignedMaterialIds = useMemo(
    () => new Set(items.map((row) => row.raw_material_model_id)),
    [items],
  );

  const reload = useCallback(async () => {
    const result = await getBOMByModelId(modelId);
    setItems(result.data ?? []);
    if (!result.success) {
      setLoadError(result.error ?? "ดึงสูตรการผลิตไม่สำเร็จ");
    } else {
      setLoadError(null);
    }
  }, [modelId]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);

    void reload().finally(() => {
      if (!cancelled) setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [reload]);

  /** Search raw materials when ComboBox is open (debounced keyword → Server Action). */
  useEffect(() => {
    if (!addOpen || !comboOpen) return;

    let cancelled = false;
    setIsSearching(true);

    void searchRawMaterialModels(debouncedKeyword).then((result) => {
      if (cancelled) return;
      if (!result.success) {
        toast.error(result.error ?? "ค้นหาวัตถุดิบไม่สำเร็จ");
        setMaterialOptions([]);
      } else {
        setMaterialOptions(result.data);
      }
      setIsSearching(false);
    });

    return () => {
      cancelled = true;
    };
  }, [addOpen, comboOpen, debouncedKeyword]);

  function resetAddForm() {
    setSelectedMaterial(null);
    setSearchKeyword("");
    setMaterialOptions([]);
    setIsSearching(false);
    setQuantityRequired("");
    setWastePercent("0");
    setComboOpen(false);
  }

  function openAddDialog() {
    resetAddForm();
    setAddOpen(true);
  }

  function handleComboOpenChange(nextOpen: boolean) {
    if (isAdding) return;
    setComboOpen(nextOpen);
    if (!nextOpen) {
      setSearchKeyword("");
    }
  }

  function handleAdd() {
    if (isAdding) return;

    if (!selectedMaterial) {
      toast.error("กรุณาเลือกวัตถุดิบ");
      return;
    }
    if (assignedMaterialIds.has(selectedMaterial.id)) {
      toast.error("วัตถุดิบนี้มีในสูตรแล้ว");
      return;
    }
    if (!selectedMaterial.base_uom_id) {
      toast.error("วัตถุดิบที่เลือกยังไม่ได้กำหนดหน่วยนับหลัก");
      return;
    }

    const qty = Number(quantityRequired);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error("ปริมาณที่ใช้ต้องเป็นตัวเลขมากกว่า 0");
      return;
    }

    const waste = Number(wastePercent);
    if (!Number.isFinite(waste) || waste < 0 || waste > 100) {
      toast.error("%เผื่อเสียต้องอยู่ระหว่าง 0 ถึง 100");
      return;
    }

    startAdd(async () => {
      const result = await addBOMItem({
        finished_model_id: modelId,
        raw_material_model_id: selectedMaterial.id,
        quantity_required: qty,
        waste_percent: waste,
      });

      if (!result.success) {
        toast.error(result.error ?? "เพิ่มวัตถุดิบไม่สำเร็จ");
        return;
      }

      toast.success("เพิ่มวัตถุดิบในสูตรการผลิตแล้ว");
      setAddOpen(false);
      resetAddForm();
      await reload();
    });
  }

  function confirmDelete() {
    if (!pendingDelete || isDeleting) return;

    startDelete(async () => {
      const result = await removeBOMItem(pendingDelete.id);
      if (!result.success) {
        toast.error(result.error ?? "ลบรายการไม่สำเร็จ");
        return;
      }
      toast.success("ลบรายการออกจากสูตรแล้ว");
      setPendingDelete(null);
      await reload();
    });
  }

  const filteredOptions = materialOptions.filter(
    (option) => !assignedMaterialIds.has(option.id),
  );

  const estimatedMaterialTotal = useMemo(
    () =>
      items.reduce((sum, row) => sum + (Number(row.estimated_cost) || 0), 0),
    [items],
  );

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900">สูตรการผลิต (BOM)</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            กำหนดวัตถุดิบและปริมาณที่ใช้ต่อ 1 หน่วยสินค้าสำเร็จรูป
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={openAddDialog}
          disabled={isLoading || isAdding}
        >
          <Plus className="size-3.5" />
          เพิ่มวัตถุดิบ
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400">
          <Loader2 className="size-4 animate-spin" />
          กำลังโหลดสูตรการผลิต...
        </div>
      ) : loadError ? (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-xs text-slate-400">
          ยังไม่มีวัตถุดิบในสูตร — กด &quot;เพิ่มวัตถุดิบ&quot; เพื่อเริ่มต้น
        </div>
      ) : (
        <div className="space-y-3">
          <Table wrapperClassName="rounded-xl border border-slate-200">
            <TableHeader>
              <TableRow className="bg-slate-50 hover:bg-slate-50">
                <TableHead>รหัสวัตถุดิบ</TableHead>
                <TableHead>ชื่อ</TableHead>
                <TableHead className="text-right">ปริมาณที่ใช้</TableHead>
                <TableHead className="text-right">%เผื่อเสีย</TableHead>
                <TableHead>หน่วยนับ</TableHead>
                <TableHead className="text-right">ต้นทุนประเมิน</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs font-semibold text-slate-800">
                    {row.raw_material_model_code}
                  </TableCell>
                  <TableCell className="text-sm text-slate-800">
                    {row.raw_material_model_name}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatQty(row.quantity_required)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatPercent(row.waste_percent)}%
                  </TableCell>
                  <TableCell className="text-sm text-slate-600">
                    {row.uom_code}
                    {row.uom_name && row.uom_name !== row.uom_code
                      ? ` — ${row.uom_name}`
                      : ""}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.cost_price == null ? (
                      <span
                        className="text-xs text-amber-600"
                        title="ยังไม่มี SKU หรือต้นทุนของวัตถุดิบนี้"
                      >
                        —
                      </span>
                    ) : (
                      <span className="font-medium text-slate-800">
                        {formatMoney(row.estimated_cost)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-red-600 hover:bg-red-50 hover:text-red-700"
                      aria-label={`ลบ ${row.raw_material_model_name}`}
                      disabled={isDeleting}
                      onClick={() => setPendingDelete(row)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs font-semibold text-slate-600">
              รวมต้นทุนวัตถุดิบประเมิน (Estimated Material Cost)
            </p>
            <p className="text-right text-base font-bold tabular-nums text-slate-900">
              {formatMoney(estimatedMaterialTotal)} ฿
            </p>
          </div>

          <div
            role="note"
            className="flex gap-2 rounded-xl border border-blue-100 bg-blue-50/70 px-3 py-2.5 text-[11px] leading-relaxed text-blue-900"
            title="ต้นทุนประเมินจาก BOM ยังไม่รวมค่าแรงช่าง"
          >
            <Info className="mt-0.5 size-3.5 shrink-0 text-blue-600" aria-hidden />
            <p>
              นี่คือต้นทุนวัตถุดิบประเมินเท่านั้น ต้นทุนสินค้าจริงจะถูกคำนวณเมื่อมีการเปิดใบสั่งผลิต
              (MTO) และรวมค่าแรงช่าง (Technician Billing) แล้ว
            </p>
          </div>
        </div>
      )}

      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) resetAddForm();
        }}
      >
        <DialogContent
          className="sm:max-w-md"
          onInteractOutside={(event) => {
            // Popover portals outside Dialog — don't dismiss Dialog while Combo is open
            if (comboOpen) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (comboOpen) event.preventDefault();
          }}
          onFocusOutside={(event) => {
            if (comboOpen) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>เพิ่มวัตถุดิบในสูตร</DialogTitle>
            <DialogDescription>
              เลือกรุ่นวัตถุดิบ กำหนดปริมาณที่ใช้ และ %เผื่อเสีย
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>วัตถุดิบ</Label>
              <Popover
                modal={true}
                open={comboOpen}
                onOpenChange={handleComboOpenChange}
              >
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={comboOpen}
                    className="h-10 w-full justify-between font-normal"
                    disabled={isAdding}
                  >
                    <span className="truncate text-left">
                      {selectedMaterial
                        ? `${selectedMaterial.model_code} — ${selectedMaterial.name}`
                        : "ค้นหาวัตถุดิบ..."}
                    </span>
                    {isSearching && comboOpen ? (
                      <Loader2 className="size-4 shrink-0 animate-spin opacity-50" />
                    ) : (
                      <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="z-[10050] w-[var(--radix-popover-trigger-width)] p-0"
                  align="start"
                  sideOffset={6}
                  onOpenAutoFocus={(event) => {
                    event.preventDefault();
                    searchInputRef.current?.focus();
                  }}
                  onCloseAutoFocus={(event) => {
                    // Keep focus inside Dialog after Popover closes
                    event.preventDefault();
                  }}
                >
                  <Command shouldFilter={false}>
                    <CommandInput
                      ref={searchInputRef}
                      placeholder="ค้นหารหัสหรือชื่อวัตถุดิบ..."
                      value={searchKeyword}
                      onValueChange={setSearchKeyword}
                    />
                    <CommandList>
                      {isSearching ? (
                        <CommandEmpty>
                          <span className="inline-flex items-center gap-2">
                            <Loader2 className="size-3.5 animate-spin" />
                            กำลังค้นหา...
                          </span>
                        </CommandEmpty>
                      ) : filteredOptions.length === 0 ? (
                        <CommandEmpty>ไม่พบวัตถุดิบ</CommandEmpty>
                      ) : (
                        <CommandGroup>
                          {filteredOptions.map((option) => (
                            <CommandItem
                              key={option.id}
                              value={`${option.model_code} ${option.name}`}
                              onSelect={() => {
                                setSelectedMaterial(option);
                                setComboOpen(false);
                                setSearchKeyword("");
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 size-4",
                                  selectedMaterial?.id === option.id
                                    ? "opacity-100"
                                    : "opacity-0",
                                )}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="font-mono text-xs font-semibold text-slate-800">
                                  {option.model_code}
                                </span>
                                <span className="ml-2 text-sm text-slate-600">
                                  {option.name}
                                </span>
                                {option.uom_code ? (
                                  <span className="ml-2 text-[11px] text-slate-400">
                                    ({option.uom_code})
                                  </span>
                                ) : null}
                              </span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {selectedMaterial ? (
              <p className="text-[11px] text-slate-500">
                หน่วยนับ:{" "}
                {selectedMaterial.uom_code
                  ? `${selectedMaterial.uom_code} — ${selectedMaterial.uom_name ?? ""}`
                  : "ยังไม่กำหนดหน่วยนับหลัก"}
              </p>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="bom-quantity-required">ปริมาณที่ใช้</Label>
                <Input
                  id="bom-quantity-required"
                  type="number"
                  min="0"
                  step="0.0001"
                  inputMode="decimal"
                  value={quantityRequired}
                  disabled={isAdding}
                  onChange={(event) => setQuantityRequired(event.target.value)}
                  placeholder="เช่น 1.5"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bom-waste-percent">%เผื่อเสีย</Label>
                <Input
                  id="bom-waste-percent"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  inputMode="decimal"
                  value={wastePercent}
                  disabled={isAdding}
                  onChange={(event) => setWastePercent(event.target.value)}
                  placeholder="0"
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isAdding}
              onClick={() => setAddOpen(false)}
            >
              ยกเลิก
            </Button>
            <Button type="button" disabled={isAdding} onClick={handleAdd}>
              {isAdding ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  กำลังบันทึก...
                </>
              ) : (
                "เพิ่มในสูตร"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ลบวัตถุดิบออกจากสูตร?</AlertDialogTitle>
            <AlertDialogDescription>
              จะลบ{" "}
              <span className="font-medium text-slate-700">
                {pendingDelete?.raw_material_model_name ?? "รายการนี้"}
              </span>
              ออกจากสูตรการผลิต — การดำเนินการนี้ไม่สามารถย้อนกลับได้
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={(event) => {
                event.preventDefault();
                confirmDelete();
              }}
              className="bg-red-600 hover:bg-red-700"
            >
              {isDeleting ? "กำลังลบ..." : "ลบรายการ"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
