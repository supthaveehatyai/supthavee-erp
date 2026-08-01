"use client";

/**
 * Searchable expense category combobox + on-the-fly create dialog.
 * Options are owned by parent; create mutates via Server Action then parent updates list.
 */

import { useMemo, useState, useTransition } from "react";
import { Check, ChevronsUpDown, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  createExpenseCategory,
  type ExpenseCategory,
} from "@/app/actions/expenses";
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
import { cn } from "@/lib/utils";

export type ExpenseCategoryComboboxProps = {
  options: ExpenseCategory[];
  value: string;
  onChange: (categoryId: string) => void;
  onCategoryCreated: (category: ExpenseCategory) => void;
  disabled?: boolean;
};

export function ExpenseCategoryCombobox({
  options,
  value,
  onChange,
  onCategoryCreated,
  disabled = false,
}: ExpenseCategoryComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [isCreating, startCreateTransition] = useTransition();

  const selected = options.find((item) => item.id === value);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("th");
    if (!keyword) return options;
    return options.filter((item) =>
      item.category_name.toLocaleLowerCase("th").includes(keyword),
    );
  }, [options, search]);

  function openCreateDialog() {
    setNewName(search.trim());
    setOpen(false);
    setDialogOpen(true);
  }

  function handleCreate() {
    const name = newName.trim();
    if (!name) {
      toast.error("กรุณาระบุชื่อหมวดหมู่");
      return;
    }

    startCreateTransition(async () => {
      try {
        const result = await createExpenseCategory(name);
        if (result.error || !result.data) {
          toast.error(result.error ?? "สร้างหมวดหมู่ไม่สำเร็จ");
          return;
        }
        onCategoryCreated(result.data);
        onChange(result.data.id);
        setDialogOpen(false);
        setNewName("");
        setSearch("");
        toast.success(`เพิ่มหมวดหมู่ “${result.data.category_name}” แล้ว`);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "สร้างหมวดหมู่ไม่สำเร็จ",
        );
      }
    });
  }

  return (
    <>
      <div className="flex gap-2">
        <Popover
          open={open}
          onOpenChange={(next) => {
            if (disabled) return;
            setOpen(next);
            if (!next) setSearch("");
          }}
        >
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              disabled={disabled}
              className="h-10 flex-1 justify-between font-normal"
            >
              <span
                className={cn(
                  "truncate",
                  selected ? "text-slate-800" : "text-slate-400",
                )}
              >
                {selected
                  ? selected.category_name
                  : "ค้นหาและเลือกหมวดหมู่..."}
              </span>
              <ChevronsUpDown className="size-4 shrink-0 text-slate-400" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" sideOffset={6} className="p-0">
            <Command shouldFilter={false}>
              <CommandInput
                placeholder="พิมพ์ชื่อหมวดหมู่..."
                value={search}
                onValueChange={setSearch}
              />
              <CommandList>
                <CommandEmpty>ไม่พบหมวดหมู่</CommandEmpty>
                <CommandGroup>
                  {filtered.map((category) => {
                    const isSelected = category.id === value;
                    return (
                      <CommandItem
                        key={category.id}
                        value={category.id}
                        onSelect={() => {
                          onChange(category.id);
                          setOpen(false);
                          setSearch("");
                        }}
                      >
                        <span className="flex-1 truncate">
                          {category.category_name}
                        </span>
                        <Check
                          className={cn(
                            "size-4 text-blue-600",
                            isSelected ? "opacity-100" : "opacity-0",
                          )}
                        />
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
              <div className="border-t border-slate-100 p-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="w-full justify-start"
                  onClick={openCreateDialog}
                >
                  <Plus className="size-4" />
                  เพิ่มหมวดหมู่ใหม่
                </Button>
              </div>
            </Command>
          </PopoverContent>
        </Popover>

        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={disabled}
          title="เพิ่มหมวดหมู่ใหม่"
          onClick={openCreateDialog}
        >
          <Plus className="size-4" />
        </Button>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>เพิ่มหมวดหมู่ค่าใช้จ่าย</DialogTitle>
            <DialogDescription>
              สร้างหมวดหมู่ใหม่แบบ On-the-fly แล้วเลือกให้อัตโนมัติ
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="new_category_name">ชื่อหมวดหมู่</Label>
            <Input
              id="new_category_name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="เช่น ค่าขนส่ง, ค่าโฆษณา"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleCreate();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isCreating}
              onClick={() => setDialogOpen(false)}
            >
              ยกเลิก
            </Button>
            <Button
              type="button"
              disabled={isCreating || !newName.trim()}
              onClick={handleCreate}
            >
              {isCreating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              บันทึกหมวดหมู่
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
