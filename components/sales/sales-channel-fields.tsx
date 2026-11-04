"use client";

/**
 * Phase 19 — Sales Channel + One-Time Customer fields.
 * Client island only; persistence stays in Server Actions.
 */

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  SALES_CHANNEL_LABELS,
  SALES_CHANNEL_OPTIONS,
  isEcommercePlatformChannel,
  isSalesChannel,
  selectableSalesChannel,
  shouldShowRetailBuyerFields,
  type SalesChannelCode,
} from "@/lib/constants/document";
import { cn } from "@/lib/utils";
import type { SalesChannel } from "@/types/document";

export type SalesChannelFieldsValue = {
  sales_channel: SalesChannel;
  ecommerce_order_no: string;
  ecommerce_buyer_name: string;
  tracking_no: string;
  one_time_address: string;
};

export const INITIAL_SALES_CHANNEL_FIELDS: SalesChannelFieldsValue = {
  sales_channel: "STORE",
  ecommerce_order_no: "",
  ecommerce_buyer_name: "",
  tracking_no: "",
  one_time_address: "",
};

export function salesChannelFieldsFromDocument(doc?: {
  sales_channel?: SalesChannel | string | null;
  ecommerce_order_no?: string | null;
  ecommerce_buyer_name?: string | null;
  tracking_no?: string | null;
  one_time_address?: string | null;
} | null): SalesChannelFieldsValue {
  const channel = selectableSalesChannel(doc?.sales_channel);
  return {
    sales_channel: channel,
    ecommerce_order_no: doc?.ecommerce_order_no ?? "",
    ecommerce_buyer_name: doc?.ecommerce_buyer_name ?? "",
    tracking_no: doc?.tracking_no ?? "",
    one_time_address: doc?.one_time_address ?? "",
  };
}

export type SalesChannelFieldsProps = {
  value: SalesChannelFieldsValue;
  onChange: (next: SalesChannelFieldsValue) => void;
  disabled?: boolean;
  /** ประเภทเอกสาร — ใช้เปิดบล็อกขาจร (ABB / CS_TAX + STORE) */
  docType?: string;
  /** ชื่อคู่ค้าที่เลือก — เปิดกล่องผู้ซื้อจรเมื่อเป็นลูกค้าปลีกหน้าร้าน */
  contactName?: string | null;
  /** col-span ของกล่องฟิลด์แพลตฟอร์ม เมื่ออยู่ใน CSS grid ของฟอร์ม */
  platformClassName?: string;
  /** channel = เฉพาะ dropdown, details = ฟิลด์แพลตฟอร์ม/ขาจร */
  section?: "all" | "channel" | "details";
};

export default function SalesChannelFields({
  value,
  onChange,
  disabled = false,
  docType,
  contactName,
  platformClassName,
  section = "all",
}: SalesChannelFieldsProps) {
  const showPlatformFields = isEcommercePlatformChannel(value.sales_channel);
  const walkInFilled = Boolean(
    value.ecommerce_buyer_name.trim() || value.one_time_address.trim(),
  );
  const [walkInOpen, setWalkInOpen] = useState(walkInFilled);
  const showWalkInFields = shouldShowRetailBuyerFields({
    docType: docType ?? "",
    salesChannel: value.sales_channel,
    contactName,
  });

  function patch(partial: Partial<SalesChannelFieldsValue>) {
    onChange({ ...value, ...partial });
  }

  const channelSelect = (
      <div className="space-y-1.5">
        <Label htmlFor="sales-channel">ช่องทางขาย</Label>
        <Select
          id="sales-channel"
          name="sales_channel"
          value={selectableSalesChannel(value.sales_channel)}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value;
            if (!isSalesChannel(next)) return;
            patch({ sales_channel: selectableSalesChannel(next) as SalesChannelCode });
          }}
        >
          {SALES_CHANNEL_OPTIONS.map((channel) => (
            <option key={channel} value={channel}>
              {SALES_CHANNEL_LABELS[channel]}
            </option>
          ))}
        </Select>
      </div>
  );

  if (section === "channel") return channelSelect;

  const details =
    showPlatformFields || showWalkInFields ? (
      <>
      {showPlatformFields ? (
        <div
          className={cn(
            "grid gap-4 rounded-xl border border-violet-200 bg-violet-50/60 p-4 sm:grid-cols-3",
            platformClassName,
          )}
        >
          <div className="space-y-1.5 sm:col-span-3">
            <p className="text-xs font-semibold text-violet-800">
              ลูกค้าแพลตฟอร์ม (One-Time Customer)
            </p>
            <p className="text-[11px] text-violet-700/80">
              ไม่สร้าง Contact Master ใหม่ — บันทึกชื่อ ที่อยู่ และเลขคำสั่งซื้อที่หัวเอกสาร
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ecommerce-order-no">
              เลขคำสั่งซื้อแพลตฟอร์ม{" "}
              <span className="text-red-500">*</span>
            </Label>
            <Input
              id="ecommerce-order-no"
              name="ecommerce_order_no"
              value={value.ecommerce_order_no}
              disabled={disabled}
              maxLength={100}
              placeholder="เช่น 240915ABCDEF"
              required
              onChange={(event) =>
                patch({ ecommerce_order_no: event.target.value })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ecommerce-buyer-name">ชื่อลูกค้า One-Time</Label>
            <Input
              id="ecommerce-buyer-name"
              name="ecommerce_buyer_name"
              value={value.ecommerce_buyer_name}
              disabled={disabled}
              maxLength={255}
              placeholder="ชื่อ-นามสกุลจริงบนแพลตฟอร์ม"
              onChange={(event) =>
                patch({ ecommerce_buyer_name: event.target.value })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tracking-no">เลขพัสดุ</Label>
            <Input
              id="tracking-no"
              name="tracking_no"
              value={value.tracking_no}
              disabled={disabled}
              maxLength={100}
              placeholder="Tracking No."
              onChange={(event) => patch({ tracking_no: event.target.value })}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-3">
            <Label htmlFor="one-time-address">ที่อยู่ One-Time</Label>
            <Textarea
              id="one-time-address"
              name="one_time_address"
              value={value.one_time_address}
              disabled={disabled}
              rows={2}
              maxLength={2000}
              placeholder="ที่อยู่จัดส่ง / ที่อยู่บนแพลตฟอร์ม"
              onChange={(event) =>
                patch({ one_time_address: event.target.value })
              }
            />
          </div>
        </div>
      ) : null}

      {showWalkInFields && !walkInOpen ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setWalkInOpen(true)}
          className={cn(
            "h-9 rounded-lg border border-dashed border-amber-300 bg-amber-50 px-3 text-left text-xs font-semibold text-amber-950 hover:bg-amber-100",
            platformClassName,
          )}
        >
          + ระบุชื่อผู้ซื้อจร / ที่อยู่บนใบเสร็จ (Optional)
        </button>
      ) : null}
      {showWalkInFields && walkInOpen ? (
        <div
          className={cn(
            "grid gap-4 rounded-xl border border-amber-200 bg-amber-50/60 p-4 sm:grid-cols-2",
            platformClassName,
          )}
        >
          <div className="space-y-1.5 sm:col-span-2">
            <p className="text-xs font-semibold text-amber-900">
              ข้อมูลลูกค้าจร / ชื่อผู้ซื้อหน้าร้าน (Optional)
            </p>
            <p className="text-[11px] text-amber-800/80">
              พิมพ์ชื่อลูกค้าจรกำกับบิลได้ เช่น คุณสมชาย 081-xxx-xxxx
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="walk-in-buyer-name">ชื่อผู้ซื้อ / ชื่องาน</Label>
            <Input
              id="walk-in-buyer-name"
              name="ecommerce_buyer_name"
              value={value.ecommerce_buyer_name}
              disabled={disabled}
              maxLength={255}
              placeholder="เช่น คุณสมชาย 081-xxx-xxxx"
              onChange={(event) =>
                patch({ ecommerce_buyer_name: event.target.value })
              }
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="walk-in-address">ที่อยู่/เบอร์โทรบนใบเสร็จ</Label>
            <Textarea
              id="walk-in-address"
              name="one_time_address"
              value={value.one_time_address}
              disabled={disabled}
              rows={2}
              maxLength={2000}
              placeholder="ที่อยู่สำหรับพิมพ์บนใบเสร็จ (ถ้ามี)"
              onChange={(event) =>
                patch({ one_time_address: event.target.value })
              }
            />
          </div>
        </div>
      ) : null}
      </>
    ) : null;

  if (section === "details") return details;

  return (
    <>
      {channelSelect}
      {details}
    </>
  );
}
