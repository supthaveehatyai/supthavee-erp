"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  getModelsByVendor,
  type ModelProductSku,
  type VendorProductModel,
} from "@/lib/actions/mapping";
import { cn } from "@/lib/utils";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
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

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type MockVendor = {
  id: string;
  company_name: string;
};

/** One row ready for vendor_product_mapping upsert */
export type BulkMappingUpsertRow = {
  vendor_id: string;
  vendor_sku: string;
  vendor_product_name: string | null;
  internal_product_id: string;
  conversion_factor: number;
};

export type BulkMatrixMappingUIProps = {
  /** Optional override for mock vendors (useful in tests / wiring) */
  vendors?: MockVendor[];
  /** Called when user clicks Save Mapping with a non-empty payload */
  onSaveMapping?: (payload: BulkMappingUpsertRow[]) => Promise<void> | void;
};

/* -------------------------------------------------------------------------- */
/* Mock data                                                                  */
/* -------------------------------------------------------------------------- */

const MOCK_VENDORS: MockVendor[] = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    company_name: "บริษัท อินเตอร์ สเทรง จำกัด",
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    company_name: "บริษัท สยาม อะพาเรล ซัพพลาย จำกัด",
  },
  {
    id: "33333333-3333-3333-3333-333333333333",
    company_name: "ห้างหุ้นส่วนจำกัด ไทยแฟชั่น เทรดดิ้ง",
  },
];

/* -------------------------------------------------------------------------- */
/* Vendor Combobox                                                            */
/* -------------------------------------------------------------------------- */

function VendorCombobox({
  vendors,
  value,
  onChange,
  disabled = false,
}: {
  vendors: MockVendor[];
  value: string;
  onChange: (vendorId: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selected = vendors.find((item) => item.id === value);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("th");
    if (!keyword) return vendors;
    return vendors.filter((item) =>
      item.company_name.toLocaleLowerCase("th").includes(keyword),
    );
  }, [vendors, search]);

  return (
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
          className="h-11 w-full max-w-xl justify-between font-normal"
        >
          <span
            className={cn(
              "truncate",
              selected ? "text-slate-800" : "text-slate-400",
            )}
          >
            {selected
              ? selected.company_name
              : "ค้นหาและเลือกผู้จำหน่าย (Vendor)..."}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-slate-400" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="พิมพ์ชื่อผู้จำหน่าย..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>ไม่พบผู้จำหน่าย</CommandEmpty>
            <CommandGroup>
              {filtered.map((vendor) => {
                const isSelected = vendor.id === value;
                return (
                  <CommandItem
                    key={vendor.id}
                    value={vendor.id}
                    onSelect={() => {
                      onChange(vendor.id);
                      setOpen(false);
                      setSearch("");
                    }}
                  >
                    <span className="flex-1 truncate">{vendor.company_name}</span>
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
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/* -------------------------------------------------------------------------- */
/* Model SKU table                                                            */
/* -------------------------------------------------------------------------- */

function ModelSkuTable({
  products,
  vendorSkuByProductId,
  onVendorSkuChange,
  disabled = false,
}: {
  products: ModelProductSku[];
  vendorSkuByProductId: Record<string, string>;
  onVendorSkuChange: (productId: string, value: string) => void;
  disabled?: boolean;
}) {
  if (products.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
        โมเดลนี้ยังไม่มี SKU
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Internal SKU</TableHead>
          <TableHead>Color</TableHead>
          <TableHead>Size</TableHead>
          <TableHead className="min-w-[180px]">Vendor SKU</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {products.map((product) => (
          <TableRow key={product.id}>
            <TableCell>
              <div className="flex flex-col gap-0.5">
                <span className="font-mono text-xs font-medium text-slate-800">
                  {product.sku}
                </span>
                <span className="text-xs text-slate-400">{product.name}</span>
              </div>
            </TableCell>
            <TableCell>{product.color ?? "—"}</TableCell>
            <TableCell>{product.size ?? "—"}</TableCell>
            <TableCell>
              <Input
                value={vendorSkuByProductId[product.id] ?? ""}
                onChange={(event) =>
                  onVendorSkuChange(product.id, event.target.value)
                }
                placeholder="รหัสสินค้าโรงงาน"
                disabled={disabled}
                className="h-9 font-mono text-xs"
                aria-label={`vendor_sku for ${product.sku}`}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function buildUpsertPayload(
  vendorId: string,
  model: VendorProductModel,
  vendorSkuByProductId: Record<string, string>,
): BulkMappingUpsertRow[] {
  return model.products
    .map((product) => {
      const vendorSku = (vendorSkuByProductId[product.id] ?? "").trim();
      if (!vendorSku) return null;
      return {
        vendor_id: vendorId,
        vendor_sku: vendorSku,
        vendor_product_name: product.name,
        internal_product_id: product.id,
        conversion_factor: 1,
      } satisfies BulkMappingUpsertRow;
    })
    .filter((row): row is BulkMappingUpsertRow => row !== null);
}

/* -------------------------------------------------------------------------- */
/* Main component                                                             */
/* -------------------------------------------------------------------------- */

export default function BulkMatrixMappingUI({
  vendors = MOCK_VENDORS,
  onSaveMapping,
}: BulkMatrixMappingUIProps) {
  const [selectedVendorId, setSelectedVendorId] = useState("");
  const [models, setModels] = useState<VendorProductModel[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [vendorSkuByProductId, setVendorSkuByProductId] = useState<
    Record<string, string>
  >({});
  const [savingModelId, setSavingModelId] = useState<string | null>(null);

  const [isLoadingModels, startLoadTransition] = useTransition();
  const [isSaving, startSaveTransition] = useTransition();

  const loadModels = useCallback((vendorId: string) => {
    startLoadTransition(async () => {
      setLoadError(null);
      setModels([]);
      setVendorSkuByProductId({});

      const result = await getModelsByVendor(vendorId);
      if (result.error) {
        setLoadError(result.error);
        toast.error(result.error);
        return;
      }

      setModels(result.data);
      if (result.data.length === 0) {
        toast.message("ไม่พบ product_models ของ Vendor นี้");
      }
    });
  }, []);

  function handleVendorChange(vendorId: string) {
    setSelectedVendorId(vendorId);
    if (vendorId) loadModels(vendorId);
  }

  function handleVendorSkuChange(productId: string, value: string) {
    setVendorSkuByProductId((current) => ({
      ...current,
      [productId]: value,
    }));
  }

  function handleSaveMapping(model: VendorProductModel) {
    if (!selectedVendorId) {
      toast.error("กรุณาเลือกผู้จำหน่ายก่อน");
      return;
    }

    const payload = buildUpsertPayload(
      selectedVendorId,
      model,
      vendorSkuByProductId,
    );

    if (payload.length === 0) {
      toast.error("กรุณากรอก Vendor SKU อย่างน้อย 1 รายการ");
      return;
    }

    setSavingModelId(model.id);
    startSaveTransition(async () => {
      try {
        if (onSaveMapping) {
          await onSaveMapping(payload);
        } else {
          // Default: surface payload for wiring / debugging until upsert API is connected
          console.info("[BulkMatrixMappingUI] upsert payload", payload);
          toast.success(
            `พร้อม upsert ${payload.length} รายการสำหรับ ${model.model_code}`,
          );
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "บันทึก mapping ไม่สำเร็จ";
        toast.error(message);
      } finally {
        setSavingModelId(null);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-700">
          ผู้จำหน่าย (Vendor)
        </label>
        <VendorCombobox
          vendors={vendors}
          value={selectedVendorId}
          onChange={handleVendorChange}
          disabled={isLoadingModels}
        />
      </div>

      {!selectedVendorId && (
        <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
          เลือก Vendor เพื่อโหลด product_models และ SKU ที่เกี่ยวข้อง
        </p>
      )}

      {selectedVendorId && isLoadingModels && (
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-8 text-sm text-slate-500">
          <Loader2 className="size-4 animate-spin" />
          กำลังโหลด product_models...
        </div>
      )}

      {selectedVendorId && !isLoadingModels && loadError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError}
        </div>
      )}

      {selectedVendorId && !isLoadingModels && !loadError && models.length > 0 && (
        <Accordion type="multiple" className="rounded-xl border border-slate-200 bg-white px-4">
          {models.map((model) => {
            const filledCount = model.products.filter(
              (product) => (vendorSkuByProductId[product.id] ?? "").trim(),
            ).length;
            const isSavingThis = isSaving && savingModelId === model.id;

            return (
              <AccordionItem key={model.id} value={model.id}>
                <AccordionTrigger>
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-blue-600">
                      {model.model_code}
                    </span>
                    <span className="truncate">{model.name}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                      {model.products.length} SKU
                      {filledCount > 0 ? ` · กรอกแล้ว ${filledCount}` : ""}
                    </span>
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-4 rounded-lg border border-slate-100 bg-slate-50/50 p-3">
                    <ModelSkuTable
                      products={model.products}
                      vendorSkuByProductId={vendorSkuByProductId}
                      onVendorSkuChange={handleVendorSkuChange}
                      disabled={isSavingThis}
                    />
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        onClick={() => handleSaveMapping(model)}
                        disabled={isSavingThis || model.products.length === 0}
                      >
                        {isSavingThis ? (
                          <>
                            <Loader2 className="mr-2 size-4 animate-spin" />
                            กำลังบันทึก...
                          </>
                        ) : (
                          "Save Mapping"
                        )}
                      </Button>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}

      {selectedVendorId &&
        !isLoadingModels &&
        !loadError &&
        models.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
            ไม่พบ product_models ของ Vendor นี้
          </p>
        )}
    </div>
  );
}
