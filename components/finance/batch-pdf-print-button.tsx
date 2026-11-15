"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Printer } from "lucide-react";

const printedTicks = new Set<string>();

export function BatchPdfPrintButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function startPrint() {
    const url = new URL(window.location.href);
    url.searchParams.set("batchPrint", "1");
    url.searchParams.set("batchTick", String(Date.now()));
    startTransition(() => {
      router.push(`${url.pathname}?${url.searchParams.toString()}`);
    });
  }

  return (
    <button
      type="button"
      onClick={startPrint}
      disabled={pending}
      className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
    >
      <Printer className="size-4" />
      {pending ? "กำลังเตรียมเอกสาร..." : "🖨️ Export เอกสารเป็น PDF (Batch PDF)"}
    </button>
  );
}

function waitForImages(root: ParentNode): Promise<void> {
  const images = Array.from(root.querySelectorAll("img"));
  const loaded = Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) {
            resolve();
            return;
          }
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        }),
    ),
  );
  const timeout = new Promise<void>((resolve) => {
    window.setTimeout(resolve, 4000);
  });
  return Promise.race([loaded.then(() => undefined), timeout]);
}

export function BatchPrintTrigger({
  active,
  tick,
}: {
  active: boolean;
  tick: string;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!active || !tick || printedTicks.has(tick)) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        if (cancelled || printedTicks.has(tick)) return;
        printedTicks.add(tick);
        const root = document.getElementById("batch-print-root");
        if (root) await waitForImages(root);
        if (cancelled) return;
        window.print();
        const url = new URL(window.location.href);
        url.searchParams.delete("batchPrint");
        url.searchParams.delete("batchTick");
        router.replace(`${url.pathname}${url.search}`, { scroll: false });
      })();
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [active, tick, router]);

  return null;
}
