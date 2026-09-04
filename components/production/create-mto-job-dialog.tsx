"use client";

/**
 * Create MTO Job — Dialog + trigger button for Production Kanban.
 * Zero Client-Side Fetching via production-actions.
 */

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  createProductionJob,
  searchManufacturedModels,
} from "@/lib/actions/production-actions";
import type { ManufacturedModelOption } from "@/types/production";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

function todayYmdBangkok(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
}

export function CreateMtoJobDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [comboOpen, setComboOpen] = useState(false);
  const [isSubmitting, startSubmit] = useTransition();
  const [isSearching, startSearch] = useTransition();

  const [selectedModel, setSelectedModel] =
    useState<ManufacturedModelOption | null>(null);
  const [options, setOptions] = useState<ManufacturedModelOption[]>([]);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [targetQuantity, setTargetQuantity] = useState("1");
  const [estimatedCompletionDate, setEstimatedCompletionDate] =
    useState(todayYmdBangkok);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchSeqRef = useRef(0);

  const resetForm = useCallback(() => {
    setSelectedModel(null);
    setOptions([]);
    setSearchKeyword("");
    setTargetQuantity("1");
    setEstimatedCompletionDate(todayYmdBangkok());
    setComboOpen(false);
  }, []);

  const runSearch = useCallback((keyword: string) => {
    const seq = ++searchSeqRef.current;
    startSearch(async () => {
      const result = await searchManufacturedModels(keyword);
      if (seq !== searchSeqRef.current) return;
      if (!result.success) {
        toast.error(result.error);
        setOptions([]);
        return;
      }
      setOptions(result.data);
    });
  }, []);

  useEffect(() => {
    if (!comboOpen) return;
    const timer = window.setTimeout(() => {
      runSearch(searchKeyword);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [comboOpen, searchKeyword, runSearch]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) resetForm();
  }

  function handleComboOpenChange(next: boolean) {
    setComboOpen(next);
    if (next) {
      setSearchKeyword("");
      runSearch("");
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedModel) {
      toast.error("กรุณาเลือกสินค้าที่ต้องการผลิต");
      return;
    }

    const qty = Number(targetQuantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error("จำนวนที่ต้องการผลิตต้องมากกว่า 0");
      return;
    }

    const date = estimatedCompletionDate.trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      toast.error("กรุณาระบุวันที่คาดว่าจะเสร็จ");
      return;
    }

    startSubmit(async () => {
      const result = await createProductionJob({
        finished_model_id: selectedModel.id,
        target_quantity: qty,
        estimated_completion_date: date,
      });

      if (!result.success || !result.data) {
        toast.error(result.error ?? "เปิดใบสั่งผลิตไม่สำเร็จ");
        return;
      }

      toast.success(
        `เปิดใบสั่งผลิต ${result.data.job_no} แล้ว (${result.data.materials_count} รายการวัตถุดิบ)`,
      );
      handleOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" className="shrink-0 gap-1.5">
          <Plus className="size-4" aria-hidden />
          เปิดใบสั่งผลิต
        </Button>
      </DialogTrigger>

      <DialogContent
        className="sm:max-w-md"
        onInteractOutside={(event) => {
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
          <DialogTitle>เปิดใบสั่งผลิต (Create MTO)</DialogTitle>
          <DialogDescription>
            เลือกรุ่นสินค้าผลิตเอง ระบุจำนวน และวันคาดเสร็จ —
            ระบบจะ Snapshot สูตร BOM อัตโนมัติ
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="mto-model">สินค้า (ผลิตเอง)</Label>
            <Popover
              modal={true}
              open={comboOpen}
              onOpenChange={handleComboOpenChange}
            >
              <PopoverTrigger asChild>
                <Button
                  id="mto-model"
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={comboOpen}
                  className="h-10 w-full justify-between font-normal"
                  disabled={isSubmitting}
                >
                  <span className="truncate text-left">
                    {selectedModel
                      ? `${selectedModel.model_code} — ${selectedModel.name}`
                      : "ค้นหารุ่นสินค้าผลิตเอง..."}
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
                  event.preventDefault();
                }}
              >
                <Command shouldFilter={false}>
                  <CommandInput
                    ref={searchInputRef}
                    placeholder="ค้นหารหัสหรือชื่อรุ่น..."
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
                    ) : options.length === 0 ? (
                      <CommandEmpty>
                        ไม่พบรุ่นที่ตั้งค่าเป็นผลิตเอง (is_manufactured)
                      </CommandEmpty>
                    ) : (
                      <CommandGroup>
                        {options.map((option) => (
                          <CommandItem
                            key={option.id}
                            value={`${option.model_code} ${option.name}`}
                            onSelect={() => {
                              setSelectedModel(option);
                              setComboOpen(false);
                              setSearchKeyword("");
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 size-4",
                                selectedModel?.id === option.id
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

          <div className="space-y-1.5">
            <Label htmlFor="mto-qty">จำนวนที่ต้องการผลิต</Label>
            <Input
              id="mto-qty"
              type="number"
              min={0.0001}
              step="any"
              inputMode="decimal"
              value={targetQuantity}
              onChange={(event) => setTargetQuantity(event.target.value)}
              disabled={isSubmitting}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mto-due">วันที่คาดว่าจะเสร็จ</Label>
            <Input
              id="mto-due"
              type="date"
              value={estimatedCompletionDate}
              onChange={(event) =>
                setEstimatedCompletionDate(event.target.value)
              }
              disabled={isSubmitting}
              required
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => handleOpenChange(false)}
            >
              ยกเลิก
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                  กำลังสร้าง...
                </>
              ) : (
                "เปิดใบสั่งผลิต"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
