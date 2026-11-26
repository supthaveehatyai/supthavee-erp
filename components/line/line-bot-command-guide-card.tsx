"use client";

import { useState } from "react";
import { Check, Copy, MessageSquare, PackageSearch, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type GuideCommand = {
  title: string;
  examples: string[];
  badge: string;
  badgeVariant: "emerald" | "amber" | "blue";
  detail: string;
  icon: typeof MessageSquare;
};

const COMMANDS: GuideCommand[] = [
  {
    title: "#รูป <คำค้นหรือรหัสรุ่น>",
    examples: ["#รูป เสื้อกีฬา สีฟ้า", "#รูป PS031S"],
    badge: "ส่งลูกค้าได้ · ซ่อนจำนวนสต็อก",
    badgeVariant: "emerald",
    detail:
      "แสดงทุกรุ่นในระบบแม้สต็อกเป็น 0 (รองรับสั่งโรงงาน) โชว์รูป สี ราคาปลีก และเฉพาะชื่อไซส์ที่มี (ไซส์: S M L...) ไม่มีตัวเลขสต็อก",
    icon: MessageSquare,
  },
  {
    title: "#สต็อก <คำค้นหรือรหัสรุ่น>",
    examples: ["#สต็อก เสื้อกีฬา สีฟ้า", "#พร้อมส่ง โปโล กรม", "#เช็ค PS031S"],
    badge: "ใช้เช็กภายใน · แสดงจำนวนสต็อก",
    badgeVariant: "amber",
    detail:
      "คำพ้อง #พร้อมส่ง และ #เช็ค คัดเฉพาะรุ่นที่มีของพร้อมส่งมากกว่า 0 พร้อมตัวเลขคงเหลือรายไซส์ เช่น พร้อมส่ง: S(30) M(30) หลีกเลี่ยงการพิมพ์ในแชทลูกค้าที่เป็นร้านค้าคู่แข่ง",
    icon: PackageSearch,
  },
  {
    title: "#แคตตาล็อก <รหัสรุ่น>",
    examples: ["#แคตตาล็อก PS031S", "#catalog PS031S"],
    badge: "ส่งลูกค้าได้",
    badgeVariant: "emerald",
    detail: "คำพ้อง #catalog ส่งรูปแผ่นใบ Catalog รวมสีและตารางขนาดเต็มจอ",
    icon: ShieldCheck,
  },
  {
    title: "#ไซส์ <รหัสรุ่น>",
    examples: ["#ไซส์ PS031S", "#ตารางขนาด PS031S", "#size PS031S"],
    badge: "ส่งลูกค้าได้",
    badgeVariant: "emerald",
    detail: "คำพ้อง #ตารางขนาด และ #size ส่งรูปตารางขนาด (รอบอก/ความยาว) ความละเอียดสูง",
    icon: ShieldCheck,
  },
  {
    title: "#คู่มือ",
    examples: ["#คู่มือ", "#คำสั่ง", "#help"],
    badge: "ส่งโพยกลับในแชท",
    badgeVariant: "blue",
    detail: "คำพ้อง #คำสั่ง และ #help ส่งสรุปโพยคำสั่งกลับในแชท LINE ทันที",
    icon: MessageSquare,
  },
];

function CopyCommandButton({ text, compact }: { text: string; compact: boolean }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(`คัดลอก ${text}`);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("คัดลอกคำสั่งไม่สำเร็จ");
    }
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={cn("h-7 gap-1 font-mono", compact ? "px-2 text-[11px]" : "text-xs")}
      onClick={() => void copy()}
    >
      {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
      {text}
    </Button>
  );
}

export function LineBotCommandGuideCard({ compact = false }: { compact?: boolean }) {
  return (
    <Card className={compact ? "shadow-none" : undefined}>
      <CardHeader className={compact ? "px-4 py-3" : undefined}>
        <CardTitle className={compact ? "text-sm" : "text-base"}>
          โพยคำสั่ง LINE OA @hzr1801v
        </CardTitle>
        <CardDescription>
          คัดลอกคำสั่งไปวางในกลุ่ม LINE ได้ทันที แยกคำสั่งที่ส่งลูกค้าออกจากคำสั่งเช็กสต็อกภายใน
        </CardDescription>
      </CardHeader>
      <CardContent className={cn("flex flex-col", compact ? "gap-2 px-4 pb-4" : "gap-3")}>
        {COMMANDS.map((command) => {
          const Icon = command.icon;
          return (
            <div
              key={command.title}
              className="rounded-xl border border-slate-200 bg-slate-50/70 p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Icon className="size-4 text-slate-500" />
                <p className={cn("font-semibold text-slate-900", compact ? "text-xs" : "text-sm")}>
                  {command.title}
                </p>
                <Badge variant={command.badgeVariant}>{command.badge}</Badge>
              </div>
              <p className={cn("mt-1 text-slate-600", compact ? "text-[11px]" : "text-xs")}>
                {command.detail}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {command.examples.map((example) => (
                  <CopyCommandButton key={example} text={example} compact={compact} />
                ))}
              </div>
            </div>
          );
        })}
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          ข้อความลูกค้าและสลิปโอนที่ไม่มี # นำหน้าจะถูกเพิกเฉย (SKIPPED) บอทไม่ตอบกลับ
          จุดเขียว Unread บน LINE OA Manager ของฝ่ายบัญชีและฝ่ายขายจึงยังอยู่
        </div>
      </CardContent>
    </Card>
  );
}
