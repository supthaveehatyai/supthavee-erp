"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  bulkUpsertVendorMapping,
  getActiveVendors,
  getVendorMappingData,
  type ExistingVendorMapping,
  type MappedProductSku,
  type VendorMappingModel,
  type VendorOption,
} from "@/lib/actions/mapping";
import VendorCombobox from "@/components/procurement/VendorCombobox";
import PatternGeneratorModal from "@/components/procurement/PatternGeneratorModal";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

/** productId → vendor_sku draft value */
type VendorSkuDraftMap = Record<string, string>;

const OVERWRITE_WARNING =
  "สินค้ารุ่นนี้มีการจับคู่รหัสซัพพลายเออร์แล้ว การบันทึกใหม่จะเป็นการเขียนทับข้อมูลเดิม คุณต้องการดำเนินการต่อหรือไม่?";

/* -------------------------------------------------------------------------- */
/* Model SKU table                                                            */
/* -------------------------------------------------------------------------- */

function ModelSkuTable({
  products,
  draftByProductId,
  onVendorSkuChange,
  disabled = false,
}: {
  products: MappedProductSku[];
  draftByProductId: VendorSkuDraftMap;
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
          <TableHead className="min-w-[200px]">Vendor SKU</TableHead>
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
                value={draftByProductId[product.id] ?? ""}
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
/* Existing mappings table (bottom section)                                   */
/* -------------------------------------------------------------------------- */

function ExistingMappingsTable({
  mappings,
  isLoading,
}: {
  mappings: ExistingVendorMapping[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-slate-500">
        <Loader2 className="size-4 animate-spin" />
        กำลังโหลดรายการจับคู่...
      </div>
    );
  }

  if (mappings.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-sm text-slate-400">
        ยังไม่มีการจับคู่สำหรับ Vendor นี้
      </p>
    );
  }

  return (
    <Table className="min-w-[640px]">
      <TableHeader>
        <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
          <TableHead>รหัสโรงงาน (Vendor SKU)</TableHead>
          <TableHead>SKU ภายใน</TableHead>
          <TableHead>Color</TableHead>
          <TableHead>Size</TableHead>
          <TableHead>ชื่อสินค้า</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {mappings.map((row) => (
          <TableRow key={row.id}>
            <TableCell>
              <span className="font-mono text-xs font-semibold text-slate-800">
                {row.vendor_sku}
              </span>
            </TableCell>
            <TableCell>
              <span className="font-mono text-xs text-slate-700">
                {row.product?.sku ?? "—"}
              </span>
            </TableCell>
            <TableCell>{row.product?.color ?? "—"}</TableCell>
            <TableCell>{row.product?.size ?? "—"}</TableCell>
            <TableCell className="max-w-[220px] truncate text-sm text-slate-600">
              {row.product?.name ?? row.vendor_product_name ?? "—"}
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

function buildDraftFromModels(models: VendorMappingModel[]): {
  draft: VendorSkuDraftMap;
  original: VendorSkuDraftMap;
} {
  const draft: VendorSkuDraftMap = {};
  const original: VendorSkuDraftMap = {};

  for (const model of models) {
    for (const product of model.products) {
      const value = (product.vendor_sku ?? "").trim();
      draft[product.id] = value;
      original[product.id] = value;
    }
  }

  return { draft, original };
}

function collectModifiedMappings(
  vendorId: string,
  models: VendorMappingModel[],
  draft: VendorSkuDraftMap,
  original: VendorSkuDraftMap,
): Array<{
  vendor_id: string;
  vendor_sku: string;
  internal_product_id: string;
}> {
  const rows: Array<{
    vendor_id: string;
    vendor_sku: string;
    internal_product_id: string;
  }> = [];

  for (const model of models) {
    for (const product of model.products) {
      const current = (draft[product.id] ?? "").trim();
      const baseline = (original[product.id] ?? "").trim();

      if (!current) continue;
      if (current === baseline) continue;

      rows.push({
        vendor_id: vendorId,
        vendor_sku: current,
        internal_product_id: product.id,
      });
    }
  }

  return rows;
}

function countExistingMappingsInModel(model: VendorMappingModel): number {
  return model.products.filter(
    (product) =>
      Boolean(product.mapping_id) || Boolean((product.vendor_sku ?? "").trim()),
  ).length;
}

/**
 * True when any model touched by the save payload already has mappings
 * (overwrite risk).
 */
function payloadTouchesMappedModels(
  models: VendorMappingModel[],
  payloadProductIds: Set<string>,
): boolean {
  return models.some((model) => {
    const touchesModel = model.products.some((product) =>
      payloadProductIds.has(product.id),
    );
    if (!touchesModel) return false;
    return countExistingMappingsInModel(model) > 0;
  });
}

/* -------------------------------------------------------------------------- */
/* Main component                                                             */
/* -------------------------------------------------------------------------- */

export default function BulkMatrixMappingUI() {
  const router = useRouter();
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [selectedVendorId, setSelectedVendorId] = useState("");
  const [models, setModels] = useState<VendorMappingModel[]>([]);
  const [existingMappings, setExistingMappings] = useState<
    ExistingVendorMapping[]
  >([]);
  const [draftByProductId, setDraftByProductId] = useState<VendorSkuDraftMap>(
    {},
  );
  const [originalByProductId, setOriginalByProductId] =
    useState<VendorSkuDraftMap>({});
  const [vendorsError, setVendorsError] = useState<string | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [patternModelId, setPatternModelId] = useState<string | null>(null);

  const [isLoadingVendors, startVendorsTransition] = useTransition();
  const [isLoadingModels, startModelsTransition] = useTransition();
  const [isSaving, startSaveTransition] = useTransition();

  const modifiedCount = useMemo(() => {
    if (!selectedVendorId) return 0;
    return collectModifiedMappings(
      selectedVendorId,
      models,
      draftByProductId,
      originalByProductId,
    ).length;
  }, [selectedVendorId, models, draftByProductId, originalByProductId]);

  const loadVendors = useCallback(() => {
    startVendorsTransition(async () => {
      setVendorsError(null);

      // Server Action only — never call a browser supabase client here
      const result = await getActiveVendors();
      const nextVendors = result?.data ?? [];
      const nextError = result?.error ?? null;

      if (nextError) {
        setVendors([]);
        setVendorsError(nextError);
        toast.error(nextError);
        return;
      }

      setVendors(nextVendors);
    });
  }, []);

  useEffect(() => {
    void loadVendors();
  }, [loadVendors]);

  const applyVendorMappingResult = useCallback(
    (result: Awaited<ReturnType<typeof getVendorMappingData>>) => {
      const { draft, original } = buildDraftFromModels(result.data);
      setModels(result.data);
      setExistingMappings(result.existingMappings);
      setDraftByProductId(draft);
      setOriginalByProductId(original);
    },
    [],
  );

  const loadModels = useCallback(
    (vendorId: string) => {
      startModelsTransition(async () => {
        setModelsError(null);
        setModels([]);
        setExistingMappings([]);
        setDraftByProductId({});
        setOriginalByProductId({});

        const result = await getVendorMappingData(vendorId);
        if (result.error) {
          setModelsError(result.error);
          toast.error(result.error);
          return;
        }

        applyVendorMappingResult(result);

        if (result.data.length === 0) {
          toast.message("ไม่พบ product_models ของ Vendor นี้");
        }
      });
    },
    [applyVendorMappingResult],
  );

  function handleVendorChange(vendorId: string) {
    setSelectedVendorId(vendorId);
    if (vendorId) loadModels(vendorId);
  }

  function handleVendorSkuChange(productId: string, value: string) {
    setDraftByProductId((current) => ({
      ...current,
      [productId]: value,
    }));
  }

  function handleApplyPattern(values: Record<string, string>) {
    if (Object.keys(values).length === 0) return;
    setDraftByProductId((current) => ({ ...current, ...values }));
    toast.success(`Auto-Pattern กรอกรหัสให้ ${Object.keys(values).length} SKU`);
  }

  const patternModel = models.find((model) => model.id === patternModelId) ?? null;

  function executeSave(
    payload: Array<{
      vendor_id: string;
      vendor_sku: string;
      internal_product_id: string;
    }>,
  ) {
    startSaveTransition(async () => {
      const result = await bulkUpsertVendorMapping(payload);

      if (result.error || !result.upserted) {
        toast.error(
          result.error ?? "บันทึกไม่สำเร็จ — ไม่มีการอัปเดตในฐานข้อมูล",
        );
        return;
      }

      toast.success(`บันทึก mapping สำเร็จ ${result.upserted} รายการ`);

      // Force RSC/page to re-fetch after revalidatePath in the server action
      router.refresh();

      // Refresh client state: models + existingMappings bottom table
      const refreshed = await getVendorMappingData(selectedVendorId);
      if (refreshed.error) {
        toast.error(refreshed.error);
        return;
      }

      applyVendorMappingResult(refreshed);
    });
  }

  function handleSaveMapping() {
    if (!selectedVendorId) {
      toast.error("กรุณาเลือกผู้จำหน่ายก่อน");
      return;
    }

    const payload = collectModifiedMappings(
      selectedVendorId,
      models,
      draftByProductId,
      originalByProductId,
    );

    if (payload.length === 0) {
      toast.message("ไม่มีการเปลี่ยนแปลงที่ต้องบันทึก");
      return;
    }

    const payloadProductIds = new Set(
      payload.map((row) => row.internal_product_id),
    );

    // Intercept overwrite when touched model(s) already have mappings
    if (payloadTouchesMappedModels(models, payloadProductIds)) {
      const confirmed = window.confirm(OVERWRITE_WARNING);
      if (!confirmed) return;
    }

    executeSave(payload);
  }

  const busy = isLoadingModels || isSaving;

  return (
    <div className="space-y-6">
      {/* Top — Vendor smart combobox */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-700">
          ผู้จำหน่าย (Vendor)
        </label>
        <VendorCombobox
          options={vendors}
          value={selectedVendorId}
          onChange={handleVendorChange}
          disabled={busy}
          isLoading={isLoadingVendors}
        />
        {vendorsError && (
          <p className="text-sm text-red-600">{vendorsError}</p>
        )}
        {selectedVendorId && !isLoadingModels && (
          <p className="text-xs text-slate-500">
            Mapping ที่มีอยู่{" "}
            <span className="font-semibold text-emerald-700">
              {existingMappings.length.toLocaleString("th-TH")}
            </span>{" "}
            รายการ
          </p>
        )}
      </div>

      {/* Empty / loading / error states */}
      {!selectedVendorId && (
        <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
          เลือก Vendor เพื่อโหลด product_models และ SKU ที่เกี่ยวข้อง
        </p>
      )}

      {selectedVendorId && isLoadingModels && (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-12 text-sm text-slate-500">
          <Loader2 className="size-5 animate-spin text-blue-600" />
          กำลังโหลดข้อมูล mapping...
        </div>
      )}

      {selectedVendorId && !isLoadingModels && modelsError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {modelsError}
        </div>
      )}

      {selectedVendorId &&
        !isLoadingModels &&
        !modelsError &&
        models.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
            ไม่พบ product_models ของ Vendor นี้
          </p>
        )}

      {/* Models accordion + tables */}
      {selectedVendorId &&
        !isLoadingModels &&
        !modelsError &&
        models.length > 0 && (
          <>
            <Accordion
              type="multiple"
              className="rounded-xl border border-slate-200 bg-white px-4"
            >
              {models.map((model) => {
                const mappedCount = countExistingMappingsInModel(model);
                const filledCount = model.products.filter((product) =>
                  (draftByProductId[product.id] ?? "").trim(),
                ).length;

                return (
                  <AccordionItem key={model.id} value={model.id}>
                    <div className="flex items-center gap-2">
                      <AccordionTrigger className="min-w-0 flex-1">
                        <span className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="font-mono text-xs text-blue-600">
                            {model.model_code}
                          </span>
                          <span className="truncate">{model.name}</span>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                            {model.products.length} SKU
                            {filledCount > 0
                              ? ` · กรอก ${filledCount}`
                              : ""}
                          </span>
                          {mappedCount > 0 && (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                              จับคู่แล้ว {mappedCount}
                            </span>
                          )}
                        </span>
                      </AccordionTrigger>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="shrink-0"
                        disabled={isSaving || model.products.length === 0}
                        onClick={() => setPatternModelId(model.id)}
                      >
                        <Sparkles className="mr-1 size-3.5" />
                        Auto-Pattern
                      </Button>
                    </div>
                    <AccordionContent>
                      <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-3">
                        <ModelSkuTable
                          products={model.products}
                          draftByProductId={draftByProductId}
                          onVendorSkuChange={handleVendorSkuChange}
                          disabled={isSaving}
                        />
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>

            {/* Save Mapping */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-sm text-slate-500">
                {modifiedCount > 0
                  ? `มีการแก้ไข ${modifiedCount} รายการที่ยังไม่ได้บันทึก`
                  : "ยังไม่มีการแก้ไข mapping"}
              </p>
              <Button
                type="button"
                onClick={handleSaveMapping}
                disabled={isSaving || modifiedCount === 0}
              >
                {isSaving ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    กำลังบันทึก...
                  </>
                ) : (
                  "Save Mapping"
                )}
              </Button>
            </div>
          </>
        )}

      {/* Bottom — รายการจับคู่ของ Vendor */}
      {selectedVendorId && !modelsError && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-800">
              รายการจับคู่ของ Vendor
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {isLoadingModels
                ? "กำลังโหลด..."
                : `${existingMappings.length.toLocaleString("th-TH")} รายการ`}
            </p>
          </div>
          <div className="px-0 pb-2">
            <ExistingMappingsTable
              mappings={existingMappings}
              isLoading={isLoadingModels}
            />
          </div>
        </section>
      )}

      {/* Smart Pattern Autofill modal — pure client-side derivation, no fetch */}
      {patternModel && (
        <PatternGeneratorModal
          open={Boolean(patternModelId)}
          onOpenChange={(next) => {
            if (!next) setPatternModelId(null);
          }}
          modelCode={patternModel.model_code}
          modelName={patternModel.name}
          products={patternModel.products}
          draftByProductId={draftByProductId}
          onApply={handleApplyPattern}
        />
      )}
    </div>
  );
}
