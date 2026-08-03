"use client";

/**
 * Triggers browser print dialog once the 50 ทวิ page has mounted.
 */

import { useEffect } from "react";

export function AutoPrint() {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.print();
    }, 350);
    return () => window.clearTimeout(timer);
  }, []);

  return null;
}
