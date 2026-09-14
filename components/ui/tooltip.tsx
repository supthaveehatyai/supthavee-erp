"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

type TooltipProps = {
  children: React.ReactNode;
  content: React.ReactNode;
  className?: string;
};

/**
 * Hover tooltip (shadcn-style). Portals to document.body so table overflow
 * does not clip the panel.
 */
export function Tooltip({ children, content, className }: TooltipProps) {
  const triggerRef = React.useRef<HTMLSpanElement>(null);
  const [open, setOpen] = React.useState(false);
  const [coords, setCoords] = React.useState({ top: 0, left: 0 });

  function updatePosition() {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setCoords({
      top: rect.top - 8,
      left: rect.left + rect.width / 2,
    });
  }

  function show() {
    updatePosition();
    setOpen(true);
  }

  function hide() {
    setOpen(false);
  }

  return (
    <span
      ref={triggerRef}
      className={cn("inline-flex", className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {open
        ? createPortal(
            <span
              role="tooltip"
              className="pointer-events-none fixed z-[9999] w-max max-w-xs -translate-x-1/2 -translate-y-full rounded-md bg-slate-900 px-2.5 py-1.5 text-left text-xs font-medium leading-relaxed text-white shadow-md"
              style={{ top: coords.top, left: coords.left }}
            >
              {content}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function TooltipTrigger({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex", className)}>{children}</span>
  );
}

export function TooltipContent({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <span className={className}>{children}</span>;
}
