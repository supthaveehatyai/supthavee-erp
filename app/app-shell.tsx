"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { canAccessPath, canSeeNavItem, isAuthPath, isLiffPath, normalizePathname, STOCK_CARD_PATH } from "@/lib/auth/module-access";
import { AccessProvider } from "@/components/auth/access-context";
import { WORKSPACE_THEMES, type WorkspaceKey, type WorkspaceRole } from "@/types/holding";
import type { AccessibleModules, ErpModuleKey } from "@/types/rbac";

type IconName =
  | "dashboard"
  | "database"
  | "document"
  | "wallet"
  | "warehouse"
  | "book"
  | "clipboard"
  | "settings";

type NavigationItem = {
  label: string;
  href: string;
  /** ถ้ากำหนด จะโชว์เฉพาะเมื่อโมดูลนี้เป็น true (ไม่ตาม path ของ href) */
  requiresModule?: ErpModuleKey;
  /** Phase 20 — ศูนย์รายงาน: เฉพาะ Admin / Finance / Manager / Accountant */
  requiresReportCenter?: boolean;
  /** URL ของแท็บย่อยที่ต้องไฮไลต์เมนูหลักนี้ด้วย */
  activePaths?: string[];
  /** path ที่อยู่ในเมนูอื่นแล้ว ไม่ให้ prefix ของรายการนี้ติด Active */
  excludePaths?: string[];
};

type NavigationGroup = {
  label: string;
  icon: IconName;
  items: NavigationItem[];
};

const WORKSPACE_NAV: Record<Exclude<WorkspaceKey, "supthavee">, NavigationItem[]> = {
  fnb: [
    { label: "ภาพรวม & ยอดขาย 5 สาขา", href: "/fnb" },
    { label: "ปฏิบัติการหน้าร้าน 3 ช่วงเวลา", href: "/fnb/operations" },
    { label: "ตั้งค่าระเบียบหน้าร้าน & กะสาขา", href: "/fnb/sop-settings" },
    { label: "วิเคราะห์เมนูขายดี & จัดโปรรายสาขา", href: "/fnb/analytics" },
    { label: "รับของเข้า & ชนบิลภาษี (คุณจวง)", href: "/fnb/procurement" },
    { label: "วัตถุดิบ หลายแหล่งซื้อ & นำเข้าราคา", href: "/fnb/items" },
    { label: "เมนู สูตรชง & เบสเตรียมขาย (BOM)", href: "/fnb/menus" },
    { label: "โอนของข้ามสาขา & นับสต็อก Blind Count", href: "/fnb/inventory" },
    { label: "บุคลากร & เงินเดือนร้านน้ำ", href: "/fnb/people" },
  ],
  agri: [
    { label: "ภาพรวมสวนยางพารา", href: "/plantation" },
    { label: "โซนสวนสงขลา & สกลนคร", href: "/plantation?tab=zones" },
    { label: "สมุดบัญชีรับเงินยาง", href: "/holding/bank-accounts?workspace=agri" },
    { label: "คลังเอกสารบริษัท", href: "/holding/vault?workspace=agri" },
  ],
  prop: [
    { label: "ภาพรวมบ้านเช่า & ที่ดิน", href: "/property" },
    { label: "ทะเบียนโฉนด & ภาษีที่ดิน", href: "/property?tab=land-tax" },
    { label: "สมุดบัญชี & QR ค่าเช่า", href: "/holding/bank-accounts?workspace=prop" },
    { label: "คลังเอกสารบริษัท", href: "/holding/vault?workspace=prop" },
  ],
  holding: [
    { label: "ภาพรวมโฮลดิ้ง", href: "/holding" },
    { label: "บุคลากร & สิทธิ์ทั้งเครือ (IAM & HR Hub)", href: "/holding/people" },
    { label: "คลังเอกสารบริษัท PDF/ภาพ", href: "/holding/vault" },
    { label: "ทะเบียนนิติบุคคล", href: "/holding/entities" },
    { label: "สมุดบัญชีธนาคาร & QR ทุกธุรกิจ", href: "/holding/bank-accounts" },
    { label: "ตั้งค่า LINE OA & อนุมัติสิทธิ์ LIFF", href: "/holding/line-access" },
  ],
};

function workspaceFromPath(pathname: string): WorkspaceKey {
  if (pathname === "/fnb" || pathname.startsWith("/fnb/")) return "fnb";
  if (pathname === "/plantation" || pathname.startsWith("/plantation/")) return "agri";
  if (pathname === "/property" || pathname.startsWith("/property/")) return "prop";
  if (pathname === "/holding" || pathname.startsWith("/holding/")) return "holding";
  return "supthavee";
}

const navigationGroups: NavigationGroup[] = [
  {
    label: "ฐานข้อมูลหลัก",
    icon: "database",
    items: [
      { label: "คู่ค้าและผู้ติดต่อ", href: "/contacts" },
      { label: "สินค้าและราคา", href: "/products" },
    ],
  },
  {
    label: "เอกสาร / บัญชี",
    icon: "document",
    items: [
      {
        label: "เอกสารขาย",
        href: "/sales",
        excludePaths: ["/sales/catalog"],
      },
      {
        label: "แคตตาล็อกรูป & สต็อก",
        href: "/sales/catalog",
      },
      {
        label: "เอกสารซื้อ",
        href: "/purchases",
        excludePaths: ["/purchases/manual-receipt"],
      },
    ],
  },
  {
    label: "จัดซื้อ / การเงิน",
    icon: "wallet",
    items: [
      {
        label: "รับสินค้าอัจฉริยะ",
        href: "/dashboard/procurement/goods-receipt",
        activePaths: ["/purchases/manual-receipt"],
      },
      { label: "ผูกรหัสซัพพลายเออร์", href: "/dashboard/procurement/vendor-mapping" },
      {
        label: "รับและจ่ายเงิน",
        href: "/finance/payments",
        activePaths: ["/finance/ap-payment"],
      },
      {
        label: "ตัดหนี้สูญ (AR Write-off)",
        href: "/finance/ar-writeoff/create",
        activePaths: ["/finance/ar-writeoff", "/finance/ap-writeoff"],
      },
      {
        label: "รับ/จ่าย เงินมัดจำ",
        href: "/finance/deposits",
        requiresModule: "finance",
        activePaths: ["/finance/refunds"],
      },
      { label: "ระบบวางบิล", href: "/finance/billing-notes" },
      { label: "ค่าใช้จ่าย (Expenses)", href: "/expenses" },
      { label: "เงินเดือน / ประกันสังคม (Payroll)", href: "/finance/payroll" },
      {
        label: "ศูนย์รายงาน (Report Center)",
        href: "/finance/tax-reports",
        requiresReportCenter: true,
        activePaths: ["/tax/wht-report", "/profit-analysis"],
      },
      { label: "เจ้าหนี้ / ลูกหนี้", href: "/finance/ap-ar" },
      { label: "ปิดงบรายเดือน (Period Lock)", href: "/accounting-periods" },
      { label: "สินทรัพย์ถาวร (Fixed Assets)", href: "/fixed-assets" },
    ],
  },
  {
    label: "คลังสินค้า / ผลิต",
    icon: "warehouse",
    items: [
      { label: "บัตรสต็อก (Stock Card)", href: STOCK_CARD_PATH },
      { label: "ปรับปรุงคลังสินค้า", href: "/inventory/adjustments" },
      { label: "Production Kanban", href: "/production/kanban" },
    ],
  },
  {
    label: "คู่มือการใช้งาน (Knowledge Base)",
    icon: "book",
    items: [
      {
        label: "มาตรฐานเอกสาร (Document Standards)",
        href: "/knowledge-base/document-standards",
      },
    ],
  },
];

function Icon({
  name,
  className = "size-5",
}: {
  name: IconName;
  className?: string;
}) {
  const paths: Record<IconName, React.ReactNode> = {
    dashboard: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    database: (
      <>
        <ellipse cx="12" cy="5" rx="8" ry="3" />
        <path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
        <path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
      </>
    ),
    document: (
      <>
        <path d="M6 2h9l4 4v16H6z" />
        <path d="M14 2v5h5M9 12h6M9 16h6" />
      </>
    ),
    wallet: (
      <>
        <path d="M4 6h15a2 2 0 0 1 2 2v11H4a2 2 0 0 1-2-2V6a3 3 0 0 1 3-3h13" />
        <path d="M16 11h5v5h-5a2.5 2.5 0 0 1 0-5Z" />
      </>
    ),
    warehouse: (
      <>
        <path d="m3 10 9-6 9 6v11H3z" />
        <path d="M8 21v-7h8v7M3 10h18" />
      </>
    ),
    book: (
      <>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        <path d="M8 7h8M8 11h6" />
      </>
    ),
    clipboard: (
      <>
        <path d="M9 5h6a1 1 0 0 1 1 1v1H8V6a1 1 0 0 1 1-1Z" />
        <path d="M8 5.5A2 2 0 0 1 9.8 4h4.4A2 2 0 0 1 16 5.5" />
        <path d="M6 7h12v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2Z" />
        <path d="M9 12h6M9 16h4" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.56 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.2 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2.4v-4h.09A1.7 1.7 0 0 0 4.2 8.56a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8.56 4.2a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V2.4h4v.09A1.7 1.7 0 0 0 15 4.2a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 8.56a1.7 1.7 0 0 0 .6 1c.3.26.7.4 1.1.4h.09v4h-.09A1.7 1.7 0 0 0 19.4 15Z" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

function visibleWorkspaceItems(
  workspace: Exclude<WorkspaceKey, "supthavee">,
  isSuperAdmin: boolean,
  role: WorkspaceRole,
): NavigationItem[] {
  const items = WORKSPACE_NAV[workspace];
  if (workspace !== "fnb" || isSuperAdmin) return items;
  if (role === "FNB_HR_ACCOUNTANT") {
    return items.filter((item) => item.href === "/fnb/people" || item.href.startsWith("/fnb/procurement"));
  }
  if (role === "FNB_HR") return items.filter((item) => item.href === "/fnb/people");
  if (role === "FNB_ACCOUNTANT") return items.filter((item) => item.href.startsWith("/fnb/procurement"));
  if (role === "FNB_BRANCH_MANAGER") return items.filter((item) => item.href.startsWith("/fnb/operations"));
  return items.filter((item) => item.href === "/fnb/people");
}

function SidebarContent({
  closeMenu,
  roleCode,
  accessibleModules,
  isSuperAdmin,
  workspace,
  workspaceRole,
}: {
  closeMenu: () => void;
  roleCode: string | null;
  accessibleModules: AccessibleModules | null;
  isSuperAdmin: boolean;
  workspace: WorkspaceKey;
  workspaceRole: WorkspaceRole;
}) {
  const pathname = usePathname();
  const theme = WORKSPACE_THEMES[workspace];
  const visibleGroups = navigationGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        canSeeNavItem(
          item.href,
          accessibleModules,
          roleCode,
          item.requiresModule,
          item.requiresReportCenter,
        ),
      ),
    }))
    .filter((group) => group.items.length > 0);
  const canOpenSettings = canAccessPath(
    "/settings/company",
    accessibleModules,
    roleCode,
  );
  const canOpenDashboard = canAccessPath(
    "/dashboard",
    accessibleModules,
    roleCode,
  );
  const canOpenApprovals = canAccessPath(
    "/approvals",
    accessibleModules,
    roleCode,
  );
  const settingsHubActive = [
    "/settings/company",
    "/settings/parameters",
    "/settings/master-data",
    "/finance/bank-accounts",
    "/settings/users",
  ].some((href) => {
    const itemPath = normalizePathname(href);
    return pathname === itemPath || pathname.startsWith(`${itemPath}/`);
  });

  return (
    <>
      <div className="flex h-20 items-center gap-3 border-b border-white/10 px-5">
        <div className={`grid size-10 shrink-0 place-items-center rounded-xl bg-white text-[13px] font-black tracking-tight shadow-sm ${theme.badgeTextClass}`}>
          {theme.badge}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-white">
            {workspace === "supthavee" ? "SUPTHAVEE ERP" : theme.label}
          </p>
          <p className={`truncate text-[11px] ${theme.softTextClass}`}>
            {workspace === "supthavee" ? "Business Management" : theme.subtitle}
          </p>
        </div>
      </div>
      {isSuperAdmin ? (
        <div className="grid grid-cols-2 gap-1 border-b border-white/10 px-3 py-2">
          {(["supthavee", "fnb", "agri", "prop"] as const).map((key) => {
            const item = WORKSPACE_THEMES[key];
            const active = workspace === key;
            return (
              <Link
                key={key}
                href={item.href}
                onNavigate={closeMenu}
                className={`rounded-md px-2 py-1.5 text-[11px] font-semibold ${active ? "bg-white/20 text-white" : "text-white/80 hover:bg-white/10"}`}
              >
                {item.badge} {item.label}
              </Link>
            );
          })}
          <Link
            href={WORKSPACE_THEMES.holding.href}
            onNavigate={closeMenu}
            className={`col-span-2 rounded-md px-2 py-1.5 text-[11px] font-semibold ${workspace === "holding" ? "bg-white/20 text-white" : "text-white/80 hover:bg-white/10"}`}
          >
            HD ศูนย์โฮลดิ้ง & คลังเอกสารบริษัท
          </Link>
        </div>
      ) : null}

      {workspace !== "supthavee" ? (
        <nav className="sidebar-scroll flex-1 overflow-y-auto px-3 py-5">
          <div className="space-y-1">
            {visibleWorkspaceItems(workspace, isSuperAdmin, workspaceRole).map((item) => {
              const itemPath = normalizePathname(item.href);
              const exactOnly = itemPath === "/fnb" || itemPath === "/plantation" || itemPath === "/property" || itemPath === "/holding";
              const isActive = exactOnly
                ? pathname === itemPath
                : pathname === itemPath || pathname.startsWith(`${itemPath}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onNavigate={closeMenu}
                  className={`block rounded-lg px-3 py-2.5 text-sm transition ${
                    isActive ? theme.activeLinkClass : "text-white/85 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>
      ) : (
      <>
      <nav className="sidebar-scroll flex-1 overflow-y-auto px-3 py-5">
        <p className="mb-2 px-3 text-[10px] font-semibold tracking-[0.16em] text-blue-300/80">
          ภาพรวม
        </p>
        <div className="mb-6 space-y-1">
          {canOpenDashboard ? (
            <Link
              href="/dashboard"
              onNavigate={closeMenu}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
                pathname === "/dashboard"
                  ? "bg-white text-blue-700 shadow-sm"
                  : "text-blue-100 hover:bg-white/10 hover:text-white"
              }`}
            >
              <Icon name="dashboard" />
              <span className="font-medium">แดชบอร์ด</span>
            </Link>
          ) : null}
          {canOpenApprovals ? (
            <Link
              href="/approvals"
              onNavigate={closeMenu}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
                pathname === "/approvals" || pathname.startsWith("/approvals/")
                  ? "bg-white text-blue-700 shadow-sm"
                  : "text-blue-100 hover:bg-white/10 hover:text-white"
              }`}
            >
              <Icon name="clipboard" />
              <span className="font-medium">ศูนย์อนุมัติ</span>
            </Link>
          ) : null}
        </div>

        <p className="mb-2 px-3 text-[10px] font-semibold tracking-[0.16em] text-blue-300/80">
          เมนูหลัก
        </p>
        <div className="space-y-5">
          {visibleGroups.map((group) => (
            <section key={group.label}>
              <div className="flex items-center gap-3 px-3 py-1.5 text-blue-100">
                <Icon name={group.icon} className="size-[18px]" />
                <h2 className="text-xs font-semibold">{group.label}</h2>
              </div>
              <div className="mt-1 space-y-0.5 border-l border-blue-400/25 pl-3 ml-[21px]">
                {group.items.map((item) => {
                  const matches = (href: string) => {
                    const itemPath = normalizePathname(href);
                    return (
                      pathname === itemPath ||
                      pathname.startsWith(`${itemPath}/`)
                    );
                  };
                  const excluded = (item.excludePaths ?? []).some(matches);
                  const isActive =
                    !excluded &&
                    [item.href, ...(item.activePaths ?? [])].some(matches);

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onNavigate={closeMenu}
                      className={`block rounded-md px-3 py-2 text-xs transition ${
                        isActive
                          ? "bg-white/15 font-medium text-white"
                          : "text-blue-200 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </nav>

      <div className="border-t border-white/10 p-3">
        {canOpenSettings ? (
          <Link
            href="/settings/company"
            onNavigate={closeMenu}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-xs transition ${
              settingsHubActive
                ? "bg-white/15 font-medium text-white"
                : "text-blue-200 hover:bg-white/10 hover:text-white"
            }`}
          >
            <Icon name="settings" className="size-[18px]" />
            ตั้งค่าระบบ (Settings)
          </Link>
        ) : null}
        {isSuperAdmin ? (
          <Link
            href="/holding/vault?workspace=supthavee"
            onNavigate={closeMenu}
            className="mt-1 flex items-center gap-3 rounded-lg px-3 py-2.5 text-xs text-blue-200 transition hover:bg-white/10 hover:text-white"
          >
            คลังเอกสารบริษัท (Vault)
          </Link>
        ) : null}
      </div>
      </>
      )}
    </>
  );
}

export default function AppShell({
  children,
  userDisplayName,
  roleCode = null,
  accessibleModules = null,
  isSuperAdmin = false,
  workspaceRole = "SUPTHAVEE_STAFF",
}: {
  children: React.ReactNode;
  /** จาก `user_profiles.full_name` ผ่าน Root Layout — ไม่ใช้ brand เป็น fallback */
  userDisplayName?: string | null;
  roleCode?: string | null;
  accessibleModules?: AccessibleModules | null;
  isSuperAdmin?: boolean;
  workspaceRole?: WorkspaceRole;
}) {
  const pathname = usePathname();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const fnbDesk = !isSuperAdmin && pathname.startsWith("/fnb") && (workspaceRole === "FNB_HR" || workspaceRole === "FNB_HR_ACCOUNTANT" || workspaceRole === "FNB_ACCOUNTANT" || workspaceRole === "FNB_BRANCH_MANAGER");
  const workspace: WorkspaceKey = isSuperAdmin ? workspaceFromPath(pathname) : fnbDesk ? "fnb" : "supthavee";
  const theme = WORKSPACE_THEMES[workspace];

  // Auth and LINE LIFF routes render without ERP chrome (sidebar / top bar).
  if (isAuthPath(pathname) || isLiffPath(pathname)) {
    return (
      <AccessProvider roleCode={roleCode} accessibleModules={accessibleModules} isSuperAdmin={isSuperAdmin}>
        {children}
      </AccessProvider>
    );
  }

  const resolvedUserName = userDisplayName?.trim() || null;
  const canOpenApprovals = canAccessPath(
    "/approvals",
    accessibleModules,
    roleCode,
  );

  return (
    <AccessProvider roleCode={roleCode} accessibleModules={accessibleModules} isSuperAdmin={isSuperAdmin}>
    <div className="min-h-dvh bg-slate-50">
      <aside className={`app-shell-sidebar fixed inset-y-0 left-0 z-40 hidden w-64 flex-col print:hidden lg:flex ${theme.shellClass}`}>
        <SidebarContent
          closeMenu={() => setIsMenuOpen(false)}
          roleCode={roleCode}
          accessibleModules={accessibleModules}
          isSuperAdmin={isSuperAdmin}
          workspace={workspace}
          workspaceRole={workspaceRole}
        />
      </aside>

      {isMenuOpen && (
        <button
          type="button"
          aria-label="ปิดเมนู"
          className="app-shell-mobile-overlay fixed inset-0 z-40 bg-slate-950/45 backdrop-blur-[2px] print:hidden lg:hidden"
          onClick={() => setIsMenuOpen(false)}
        />
      )}

      <aside
        className={`app-shell-sidebar fixed inset-y-0 left-0 z-50 flex w-72 flex-col shadow-2xl transition-transform duration-200 print:hidden lg:hidden ${theme.shellClass} ${
          isMenuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <SidebarContent
          closeMenu={() => setIsMenuOpen(false)}
          roleCode={roleCode}
          accessibleModules={accessibleModules}
          isSuperAdmin={isSuperAdmin}
          workspace={workspace}
          workspaceRole={workspaceRole}
        />
      </aside>

      <div className="app-shell-content lg:pl-64 print:pl-0">
        <header className="app-shell-header sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur print:hidden md:px-7">
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="เปิดเมนู"
              aria-expanded={isMenuOpen}
              onClick={() => setIsMenuOpen(true)}
              className="grid size-9 place-items-center rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-50 lg:hidden"
            >
              <span className="flex flex-col gap-1">
                <span className="h-0.5 w-4 rounded bg-current" />
                <span className="h-0.5 w-4 rounded bg-current" />
                <span className="h-0.5 w-4 rounded bg-current" />
              </span>
            </button>
            <div>
              <p className="text-sm font-semibold text-slate-800">
                {workspace === "supthavee" ? "บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด" : theme.headerTitle}
              </p>
              <p className="hidden text-[11px] text-slate-400 sm:block">
                {workspace === "supthavee" ? "ระบบบริหารจัดการทรัพยากรองค์กร" : theme.headerSubtitle}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {canOpenApprovals ? (
              <Link
                href="/approvals"
                className={`inline-flex h-9 items-center rounded-lg border px-3 text-xs font-semibold transition ${
                  pathname === "/approvals" || pathname.startsWith("/approvals/")
                    ? "border-blue-200 bg-blue-50 text-blue-700"
                    : "border-slate-200 text-slate-700 hover:bg-slate-50"
                }`}
              >
                ศูนย์อนุมัติ
              </Link>
            ) : null}
            <div className="hidden text-right sm:block">
              <p className="text-xs font-semibold text-slate-700">ผู้ใช้งาน</p>
              <p className="text-[11px] text-slate-400">
                {resolvedUserName ?? "—"}
              </p>
            </div>
            <SignOutButton />
          </div>
        </header>

        <main className="app-shell-main min-h-[calc(100dvh-4rem)] p-4 md:p-7 print:min-h-0 print:p-0">
          {children}
        </main>
      </div>
    </div>
    </AccessProvider>
  );
}
