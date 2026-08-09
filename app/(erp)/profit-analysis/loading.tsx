/**
 * Route-level loading UI for /profit-analysis
 * (initial navigation + soft transitions that suspend).
 */

export default function ProfitAnalysisLoading() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="h-9 w-72 animate-pulse rounded-lg bg-slate-200/80" />
          <div className="h-4 w-96 max-w-full animate-pulse rounded bg-slate-100" />
        </div>
        <div className="h-16 w-52 animate-pulse rounded-xl bg-slate-100" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-32 animate-pulse rounded-xl border border-slate-200 bg-slate-50"
          />
        ))}
      </div>

      <div className="h-80 animate-pulse rounded-xl border border-slate-200 bg-slate-50" />
    </div>
  );
}
