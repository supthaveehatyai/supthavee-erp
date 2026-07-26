"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type AccordionContextValue = {
  type: "single" | "multiple";
  value: string[];
  toggle: (itemValue: string) => void;
};

const AccordionContext = React.createContext<AccordionContextValue | null>(
  null,
);

const AccordionItemContext = React.createContext<{ value: string } | null>(
  null,
);

type AccordionProps = {
  type?: "single" | "multiple";
  value?: string | string[];
  defaultValue?: string | string[];
  onValueChange?: (value: string | string[]) => void;
  className?: string;
  children: React.ReactNode;
  collapsible?: boolean;
};

function Accordion({
  type = "single",
  value: controlledValue,
  defaultValue,
  onValueChange,
  className,
  children,
  collapsible = true,
}: AccordionProps) {
  const toArray = (input: string | string[] | undefined): string[] => {
    if (!input) return [];
    return Array.isArray(input) ? input : [input];
  };

  const [uncontrolled, setUncontrolled] = React.useState<string[]>(
    toArray(defaultValue),
  );

  const isControlled = controlledValue !== undefined;
  const value = isControlled ? toArray(controlledValue) : uncontrolled;

  function toggle(itemValue: string) {
    let next: string[];

    if (type === "single") {
      const isOpen = value.includes(itemValue);
      if (isOpen && collapsible) next = [];
      else if (isOpen) next = value;
      else next = [itemValue];
    } else {
      next = value.includes(itemValue)
        ? value.filter((item) => item !== itemValue)
        : [...value, itemValue];
    }

    if (!isControlled) setUncontrolled(next);
    onValueChange?.(type === "single" ? (next[0] ?? "") : next);
  }

  return (
    <AccordionContext.Provider value={{ type, value, toggle }}>
      <div className={cn("w-full", className)}>{children}</div>
    </AccordionContext.Provider>
  );
}

function AccordionItem({
  value,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { value: string }) {
  return (
    <AccordionItemContext.Provider value={{ value }}>
      <div
        data-slot="accordion-item"
        className={cn("border-b border-slate-100 last:border-b-0", className)}
        {...props}
      >
        {children}
      </div>
    </AccordionItemContext.Provider>
  );
}

function AccordionTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<"button">) {
  const accordion = React.useContext(AccordionContext);
  const item = React.useContext(AccordionItemContext);
  if (!accordion || !item) {
    throw new Error("AccordionTrigger must be used within AccordionItem");
  }

  const open = accordion.value.includes(item.value);

  return (
    <button
      type="button"
      aria-expanded={open}
      data-state={open ? "open" : "closed"}
      className={cn(
        "flex w-full items-center justify-between gap-3 py-3 text-left text-sm font-semibold text-slate-800 transition hover:text-blue-700",
        className,
      )}
      {...props}
      onClick={(event) => {
        props.onClick?.(event);
        accordion.toggle(item.value);
      }}
    >
      <span className="min-w-0 flex-1">{children}</span>
      <ChevronDown
        className={cn(
          "size-4 shrink-0 text-slate-400 transition-transform duration-200",
          open && "rotate-180",
        )}
      />
    </button>
  );
}

function AccordionContent({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  const accordion = React.useContext(AccordionContext);
  const item = React.useContext(AccordionItemContext);
  if (!accordion || !item) {
    throw new Error("AccordionContent must be used within AccordionItem");
  }

  const open = accordion.value.includes(item.value);
  if (!open) return null;

  return (
    <div
      data-state="open"
      className={cn("pb-3 text-sm text-slate-600", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };
