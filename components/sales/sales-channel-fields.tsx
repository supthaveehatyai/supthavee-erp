"use client";

/**
 * Phase 19 — Sales Channel + One-Time Customer fields.
 * Client island only; persistence stays in Server Actions.
 */

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  DEFAULT_SALES_CHANNEL,
  SALES_CHANNELS,
  SALES_CHANNEL_LABELS,
  isEcommercePlatformChannel,
  isSalesChannel,
  type SalesChannelCode,
} from "@/lib/constants/document";
import { cn } from "@/lib/utils";
import type { SalesChannel } from "@/types/document";

export type SalesChannelFieldsValue = {
  sales_channel: SalesChannel;
  ecommerce_order_no: string;
  ecommerce_buyer_name: string;
  tracking_no: string;
};

export const INITIAL_SALES_CHANNEL_FIELDS: SalesChannelFieldsValue = {
  sales_channel: DEFAULT_SALES_CHANNEL,
  ecommerce_order_no: "",
  ecommerce_buyer_name: "",
  tracking_no: "",
};

export function salesChannelFieldsFromDocument(doc?: {
  sales_channel?: SalesChannel | string | null;
  ecommerce_order_no?: string | null;
  ecommerce_buyer_name?: string | null;
  tracking_no?: string | null;
} | null): SalesChannelFieldsValue {
  const channel = isSalesChannel(doc?.sales_channel)
    ? doc.sales_channel
    : DEFAULT_SALES_CHANNEL;
  return {
    sales_channel: channel,
    ecommerce_order_no: doc?.ecommerce_order_no ?? "",
    ecommerce_buyer_name: doc?.ecommerce_buyer_name ?? "",
    tracking_no: doc?.tracking_no ?? "",
  };
}

export type SalesChannelFieldsProps = {
  value: SalesChannelFieldsValue;
  onChange: (next: SalesChannelFieldsValue) => void;
  disabled?: boolean;
  /** col-span ของกล่องฟิลด์แพลตฟอร์ม เมื่ออยู่ใน CSS grid ของฟอร์ม */
  platformClassName?: string;
};

export default function SalesChannelFields({
  value,
  onChange,
  disabled = false,
  platformClassName,
}: SalesChannelFieldsProps) {
  const showPlatformFields = isEcommercePlatformChannel(value.sales_channel);

  function patch(partial: Partial<SalesChannelFieldsValue>) {
    onChange({ ...value, ...partial });
  }

  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="sales-channel">ช่องทางขาย</Label>
        <Select
          id="sales-channel"
          name="sales_channel"
          value={value.sales_channel}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value;
            if (!isSalesChannel(next)) return;
            patch({ sales_channel: next as SalesChannelCode });
          }}
        >
          {SALES_CHANNELS.map((channel) => (
            <option key={channel} value={channel}>
              {SALES_CHANNEL_LABELS[channel]}
            </option>
          ))}
        </Select>
      </div>

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
              ไม่สร้าง Contact Master ใหม่ — บันทึกชื่อผู้ซื้อและเลขคำสั่งซื้อที่หัวเอกสาร
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ecommerce-order-no">เลขคำสั่งซื้อแพลตฟอร์ม</Label>
            <Input
              id="ecommerce-order-no"
              name="ecommerce_order_no"
              value={value.ecommerce_order_no}
              disabled={disabled}
              maxLength={100}
              placeholder="เช่น 240915ABCDEF"
              onChange={(event) =>
                patch({ ecommerce_order_no: event.target.value })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ecommerce-buyer-name">ชื่อลูกค้าสำหรับออกบิล</Label>
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
        </div>
      ) : null}
    </>
  );
}
