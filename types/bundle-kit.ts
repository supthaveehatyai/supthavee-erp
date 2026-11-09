/**
 * Dynamic multi-model bundle / kit.
 * Column names follow `mst_bundle_kits`, `mst_bundle_slots`, `mst_bundle_slot_models`.
 * Keep this module outside `"use server"` files.
 */

export type BundleSizeUpcharge = {
  size_code: string;
  amount: number;
};

export type BundleSlotModel = {
  id: string;
  model_id: string;
  model_code: string;
  model_name: string;
  model_price_delta: number;
};

export type BundleSlot = {
  id: string;
  slot_no: number;
  slot_name: string;
  size_upcharge_rules: BundleSizeUpcharge[];
  models: BundleSlotModel[];
};

export type BundleKit = {
  id: string;
  kit_code: string;
  kit_name: string;
  short_name: string;
  base_price: number;
  is_active: boolean;
  slots: BundleSlot[];
};

export type BundleKitSearchHit = {
  id: string;
  kit_code: string;
  kit_name: string;
  short_name: string;
  base_price: number;
};

export type SaveBundleKitInput = {
  id?: string | null;
  kit_code: string;
  kit_name: string;
  short_name: string;
  base_price: number;
  slots: Array<{
    slot_name: string;
    size_upcharge_rules: BundleSizeUpcharge[];
    models: Array<{
      model_id: string;
      model_price_delta: number;
    }>;
  }>;
};
