import Link from "next/link";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const LIST_PATH = "/finance/ap-writeoff";

export function ApWriteoffQueryFilter({ query }: { query: string }) {
  const hasQuery = Boolean(query.trim());

  return (
    <form
      action={LIST_PATH}
      method="get"
      className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-end"
    >
      <div className="relative min-w-0 flex-1">
        <label
          htmlFor="ap-writeoff-query"
          className="mb-1.5 block text-xs font-semibold text-slate-600"
        >
          ค้นหาเลขที่เอกสาร
        </label>
        <Search className="pointer-events-none absolute bottom-2.5 left-3 size-4 text-slate-400" />
        <Input
          id="ap-writeoff-query"
          name="query"
          defaultValue={query}
          placeholder="เช่น PWO-2569-0001 หรือ DRAFT-..."
          className="pl-9"
        />
      </div>
      <div className="flex shrink-0 gap-2">
        <Button type="submit" className="gap-1.5">
          <Search className="size-4" />
          ค้นหา
        </Button>
        {hasQuery ? (
          <Link
            href={LIST_PATH}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <X className="size-4" />
            ล้างตัวกรอง
          </Link>
        ) : null}
      </div>
    </form>
  );
}
