"use client";

import { createContext, useContext } from "react";
import type { AccessibleModules } from "@/types/rbac";

type AccessContextValue = {
  roleCode: string | null;
  accessibleModules: AccessibleModules | null;
  isSuperAdmin: boolean;
};

const AccessContext = createContext<AccessContextValue | null>(null);

export function AccessProvider({
  roleCode,
  accessibleModules,
  isSuperAdmin = false,
  children,
}: AccessContextValue & { children: React.ReactNode }) {
  return (
    <AccessContext.Provider value={{ roleCode, accessibleModules, isSuperAdmin }}>
      {children}
    </AccessContext.Provider>
  );
}

export function useAccessContext(): AccessContextValue | null {
  return useContext(AccessContext);
}
