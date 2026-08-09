"use client";

/**
 * Phase 8 — System Audit Trail table (display-only).
 * Data + parsed summaries come from Server Actions (Zero Client-Side Fetching).
 */

import type { RecentAuditLog } from "@/types/audit";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

function formatDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("th-TH", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function truncateId(id: string, max = 12): string {
  if (id.length <= max) return id;
  return `${id.slice(0, 8)}…`;
}

function ActionBadge({ action }: { action: RecentAuditLog["action"] }) {
  if (action === "INSERT") {
    return <Badge variant="emerald">INSERT</Badge>;
  }
  if (action === "UPDATE") {
    return <Badge variant="blue">UPDATE</Badge>;
  }
  return (
    <Badge
      variant="amber"
      className="bg-red-100 text-red-700 ring-1 ring-red-200/60"
    >
      DELETE
    </Badge>
  );
}

export type AuditTrailTableProps = {
  logs: RecentAuditLog[];
  className?: string;
};

export function AuditTrailTable({ logs, className }: AuditTrailTableProps) {
  if (logs.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 py-12 text-center text-sm text-slate-500">
        ยังไม่มีรายการ Audit Log ในระบบ
      </div>
    );
  }

  return (
    <div
      className={cn(
        "overflow-x-auto rounded-md border border-slate-200",
        className,
      )}
    >
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
            <TableHead className="whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-slate-500">
              วัน/เวลา
            </TableHead>
            <TableHead className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              ผู้ใช้
            </TableHead>
            <TableHead className="text-center text-xs font-semibold uppercase tracking-wide text-slate-500">
              การกระทำ
            </TableHead>
            <TableHead className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              ตาราง
            </TableHead>
            <TableHead className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Record ID
            </TableHead>
            <TableHead className="min-w-[16rem] text-xs font-semibold uppercase tracking-wide text-slate-500">
              รายละเอียดการเปลี่ยนแปลง (Changes)
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {logs.map((row) => (
            <TableRow key={row.id} className="align-top">
              <TableCell className="whitespace-nowrap text-xs text-slate-600">
                {formatDateTime(row.changed_at)}
              </TableCell>
              <TableCell>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium text-slate-900">
                    {row.changed_by_display || "ระบบ"}
                  </span>
                  {row.changed_by_role ? (
                    <span className="truncate text-[11px] text-slate-400">
                      {row.changed_by_role}
                    </span>
                  ) : null}
                  {row.changed_by_email &&
                  row.changed_by_email !== row.changed_by_display ? (
                    <span className="truncate text-[11px] text-slate-400">
                      {row.changed_by_email}
                    </span>
                  ) : null}
                </div>
              </TableCell>
              <TableCell className="text-center">
                <ActionBadge action={row.action} />
              </TableCell>
              <TableCell>
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-slate-800">
                    {row.table_label}
                  </span>
                  <code className="w-fit rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                    {row.table_name}
                  </code>
                </div>
              </TableCell>
              <TableCell>
                <code
                  className="text-[11px] text-slate-600"
                  title={row.record_id}
                >
                  {truncateId(row.record_id)}
                </code>
              </TableCell>
              <TableCell className="max-w-md">
                <p
                  className="text-sm leading-snug text-slate-700"
                  title={row.change_summary}
                >
                  {row.change_summary}
                </p>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default AuditTrailTable;
