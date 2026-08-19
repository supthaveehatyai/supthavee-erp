"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import BulkMappingForm from "./components/BulkMappingForm";
import {
  deleteVendorMapping,
  fetchMappingsByVendor,
  fetchModelsByVendor,
} from "./api";
import { getActiveVendors } from "@/lib/actions/mapping";
import { MappingTable } from "./mapping-table";
import { ModelTreePanel } from "./model-tree-panel";
import type {
  FlattenedVendorMapping,
  ProductModelGroup,
  VendorOption,
} from "./types";
import { VendorSelect } from "./vendor-select";

export default function VendorMappingClient() {
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [models, setModels] = useState<ProductModelGroup[]>([]);
  const [mappings, setMappings] = useState<FlattenedVendorMapping[]>([]);

  const [vendorId, setVendorId] = useState("");
  const [selectedModel, setSelectedModel] = useState<ProductModelGroup | null>(
    null,
  );

  const [isBootLoading, setIsBootLoading] = useState(true);
  const [isModelsLoading, setIsModelsLoading] = useState(false);
  const [isListLoading, setIsListLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [bootError, setBootError] = useState("");

  const selectedVendorName = useMemo(
    () => vendors.find((item) => item.id === vendorId)?.company_name ?? "",
    [vendors, vendorId],
  );

  const totalSkuCount = useMemo(
    () => models.reduce((sum, model) => sum + model.products.length, 0),
    [models],
  );

  const loadVendors = useCallback(async () => {
    setIsBootLoading(true);
    setBootError("");
    const result = await getActiveVendors();
    if (result.error) {
      setVendors([]);
      setBootError(result.error);
      setIsBootLoading(false);
      return;
    }
    setVendors(result.data);
    setIsBootLoading(false);
  }, []);

  const loadModels = useCallback(async (selectedVendorId: string) => {
    if (!selectedVendorId) {
      setModels([]);
      setSelectedModel(null);
      return;
    }

    setIsModelsLoading(true);
    const { data, error } = await fetchModelsByVendor(selectedVendorId);
    if (error) {
      setModels([]);
      toast.error(`โหลดรุ่นสินค้าไม่สำเร็จ: ${error}`);
      setIsModelsLoading(false);
      return;
    }

    setModels(data);
    setSelectedModel(null);
    setIsModelsLoading(false);
  }, []);

  const loadMappings = useCallback(async (selectedVendorId: string) => {
    if (!selectedVendorId) {
      setMappings([]);
      return;
    }

    setIsListLoading(true);
    const { data, error } = await fetchMappingsByVendor(selectedVendorId);
    if (error) {
      setMappings([]);
      toast.error(`โหลดรายการจับคู่ไม่สำเร็จ: ${error}`);
      setIsListLoading(false);
      return;
    }

    setMappings(data);
    setIsListLoading(false);
  }, []);

  useEffect(() => {
    void loadVendors();
  }, [loadVendors]);

  useEffect(() => {
    void loadModels(vendorId);
    void loadMappings(vendorId);
  }, [vendorId, loadModels, loadMappings]);

  function handleVendorChange(nextVendorId: string) {
    setVendorId(nextVendorId);
  }

  function handleSelectModel(model: ProductModelGroup) {
    setSelectedModel(model);
  }

  async function handleDelete(mappingId: string) {
    if (deletingId) return;
    const confirmed = window.confirm("ยืนยันลบการจับคู่นี้?");
    if (!confirmed) return;

    setDeletingId(mappingId);
    const { error } = await deleteVendorMapping(mappingId);
    if (error) {
      toast.error(`ลบไม่สำเร็จ: ${error}`);
      setDeletingId(null);
      return;
    }

    toast.success("ลบการจับคู่แล้ว");
    setMappings((prev) => prev.filter((row) => row.id !== mappingId));
    setDeletingId(null);
  }

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <header>
        <p className="text-xs font-semibold text-blue-600">
          PHASE 3 · PROCUREMENT
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">
          Smart Bulk Matrix Mapping
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          จับคู่รหัสโรงงานทั้งรุ่นในครั้งเดียว — แมป color_code → Vendor Color
          แล้วสร้าง vendor_sku จาก Pattern
        </p>
      </header>

      {bootError && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {bootError}{" "}
          <button
            type="button"
            onClick={() => void loadVendors()}
            className="font-semibold underline"
          >
            ลองใหม่
          </button>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>เลือกผู้จำหน่าย</CardTitle>
          <CardDescription>
            โหลด product_models ที่ vendor_id ตรงกับ Vendor ที่เลือก
          </CardDescription>
        </CardHeader>
        <CardContent>
          <VendorSelect
            vendors={vendors}
            value={vendorId}
            onChange={handleVendorChange}
            disabled={isBootLoading}
          />
          {selectedVendorName && (
            <div className="mt-3 flex flex-wrap gap-3">
              <div className="rounded-xl bg-slate-50 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  รุ่น
                </p>
                <p className="text-sm font-bold text-slate-800">
                  {models.length.toLocaleString("th-TH")}
                </p>
              </div>
              <div className="rounded-xl bg-blue-50 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-600">
                  SKU ในรุ่น
                </p>
                <p className="text-sm font-bold text-blue-700">
                  {totalSkuCount.toLocaleString("th-TH")}
                </p>
              </div>
              <div className="rounded-xl bg-emerald-50 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600">
                  Mapping ที่มีอยู่
                </p>
                <p className="text-sm font-bold text-emerald-700">
                  {mappings.length.toLocaleString("th-TH")}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        <Card className="min-h-[520px] overflow-hidden">
          <CardHeader>
            <CardTitle>รุ่นสินค้า (Nested Grouping)</CardTitle>
            <CardDescription>
              Model → ขยายดู internal SKUs — ไม่แสดงรายการแบน 600+ รายการ
            </CardDescription>
          </CardHeader>
          <CardContent className="max-h-[640px] overflow-y-auto pt-0">
            {!vendorId ? (
              <p className="py-10 text-center text-sm text-slate-400">
                เลือกผู้จำหน่ายด้านบนก่อน
              </p>
            ) : (
              <ModelTreePanel
                models={models}
                selectedModelId={selectedModel?.id ?? ""}
                onSelectModel={handleSelectModel}
                isLoading={isModelsLoading}
              />
            )}
          </CardContent>
        </Card>

        <BulkMappingForm
          selectedModel={selectedModel}
          selectedVendorId={vendorId}
          onSuccess={() => void loadMappings(vendorId)}
        />
      </div>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>รายการจับคู่ของ Vendor</CardTitle>
          <CardDescription>
            {vendorId
              ? `${mappings.length.toLocaleString("th-TH")} รายการ`
              : "ยังไม่ได้เลือกผู้จำหน่าย"}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-2">
          <MappingTable
            mappings={mappings}
            isLoading={isListLoading}
            deletingId={deletingId}
            onDelete={(id) => void handleDelete(id)}
            vendorSelected={!!vendorId}
          />
        </CardContent>
      </Card>
    </div>
  );
}
