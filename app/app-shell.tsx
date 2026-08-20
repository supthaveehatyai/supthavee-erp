"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { SignOutButton } from "@/components/auth/sign-out-button";

type IconName =
  | "dashboard"
  | "database"
  | "document"
  | "wallet"
  | "warehouse"
  | "book"
  | "history"
  | "settings";

type NavigationItem = {
  label: string;
  href: string;
};

type NavigationGroup = {
  label: string;
  icon: IconName;
  items: NavigationItem[];
};

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
      { label: "เอกสารขาย", href: "/sales" },
      { label: "เปิดบิลขาย", href: "/sales/create" },
      { label: "เอกสารซื้อ", href: "/purchases" },
      { label: "วิเคราะห์กำไร", href: "/profit-analysis" },
    ],
  },
  {
    label: "จัดซื้อ / การเงิน",
    icon: "wallet",
    items: [
      { label: "รับสินค้าอัจฉริยะ", href: "/dashboard/procurement/goods-receipt" },
      { label: "รับสินค้า (Manual)", href: "/purchases/manual-receipt" },
      { label: "ผูกรหัสซัพพลายเออร์", href: "/dashboard/procurement/vendor-mapping" },
      { label: "รับและจ่ายเงิน", href: "/finance/payments" },
      { label: "จ่ายชำระหนี้ซัพพลายเออร์", href: "/finance/ap-payment" },
      { label: "รับ/จ่าย เงินมัดจำ", href: "/finance/deposits" },
      { label: "ระบบวางบิล", href: "/finance/billing-notes" },
      { label: "ค่าใช้จ่าย (Expenses)", href: "/expenses" },
      { label: "รายงานหัก ณ ที่จ่าย (WHT)", href: "/tax/wht-report" },
      { label: "สมุดบัญชีธนาคาร", href: "/finance/bank-accounts" },
      { label: "เจ้าหนี้ / ลูกหนี้", href: "/finance/ap-ar" },
      { label: "ปิดงบรายเดือน (Period Lock)", href: "/accounting-periods" },
      { label: "ศูนย์อนุมัติ (Approval Center)", href: "/approvals" },
    ],
  },
  {
    label: "คลังสินค้า / ผลิต",
    icon: "warehouse",
    items: [
      { label: "บัตรสต็อก (Stock Card)", href: "/inventory/ledger" },
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
    history: (
      <>
        <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
        <path d="M3 3v5h5M12 7v5l3 2" />
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

function SidebarContent({ closeMenu }: { closeMenu: () => void }) {
  const pathname = usePathname();

  return (
    <>
      <div className="flex h-20 items-center gap-3 border-b border-white/10 px-5">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-[13px] font-black tracking-tight text-blue-700 shadow-sm">
          ST
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-white">SUPTHAVEE ERP</p>
          <p className="truncate text-[11px] text-blue-200">Business Management</p>
        </div>
      </div>

      <nav className="sidebar-scroll flex-1 overflow-y-auto px-3 py-5">
        <p className="mb-2 px-3 text-[10px] font-semibold tracking-[0.16em] text-blue-300/80">
          ภาพรวม
        </p>
        <Link
          href="/dashboard"
          onNavigate={closeMenu}
          className={`mb-6 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
            pathname === "/dashboard"
              ? "bg-white text-blue-700 shadow-sm"
              : "text-blue-100 hover:bg-white/10 hover:text-white"
          }`}
        >
          <Icon name="dashboard" />
          <span className="font-medium">แดชบอร์ด</span>
        </Link>

        <p className="mb-2 px-3 text-[10px] font-semibold tracking-[0.16em] text-blue-300/80">
          เมนูหลัก
        </p>
        <div className="space-y-5">
          {navigationGroups.map((group) => (
            <section key={group.label}>
              <div className="flex items-center gap-3 px-3 py-1.5 text-blue-100">
                <Icon name={group.icon} className="size-[18px]" />
                <h2 className="text-xs font-semibold">{group.label}</h2>
              </div>
              <div className="mt-1 space-y-0.5 border-l border-blue-400/25 pl-3 ml-[21px]">
                {group.items.map((item) => {
                  const isActive =
                    pathname === item.href ||
                    pathname.startsWith(`${item.href}/`);

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
        <Link
          href="/audit-logs"
          onNavigate={closeMenu}
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-xs text-blue-200 transition hover:bg-white/10 hover:text-white"
        >
          <Icon name="history" className="size-[18px]" />
          ประวัติการทำงาน
        </Link>
        <Link
          href="/settings/users"
          onNavigate={closeMenu}
          className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-xs transition ${
            pathname === "/settings/users" ||
            pathname.startsWith("/settings/users/")
              ? "bg-white/15 font-medium text-white"
              : "text-blue-200 hover:bg-white/10 hover:text-white"
          }`}
        >
          <Icon name="database" className="size-[18px]" />
          จัดการผู้ใช้งาน
        </Link>
        <Link
          href="/settings/company"
          onNavigate={closeMenu}
          className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-xs transition ${
            pathname === "/settings/company" ||
            pathname.startsWith("/settings/company/")
              ? "bg-white/15 font-medium text-white"
              : "text-blue-200 hover:bg-white/10 hover:text-white"
          }`}
        >
          <Icon name="settings" className="size-[18px]" />
          ตั้งค่าข้อมูลบริษัท
        </Link>
      </div>
    </>
  );
}

export default function AppShell({
  children,
  userDisplayName,
}: {
  children: React.ReactNode;
  /** จาก `user_profiles.full_name` ผ่าน Root Layout — ไม่ใช้ brand เป็น fallback */
  userDisplayName?: string | null;
}) {
  const pathname = usePathname();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Auth routes render without ERP chrome (sidebar / top bar).
  const isAuthRoute =
    pathname === "/login" || pathname.startsWith("/login/");

  if (isAuthRoute) {
    return <>{children}</>;
  }

  const resolvedUserName = userDisplayName?.trim() || null;

  return (
    <div className="min-h-dvh bg-slate-50">
      <aside className="app-shell-sidebar fixed inset-y-0 left-0 z-40 hidden w-64 flex-col bg-blue-700 print:hidden lg:flex">
        <SidebarContent closeMenu={() => setIsMenuOpen(false)} />
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
        className={`app-shell-sidebar fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-blue-700 shadow-2xl transition-transform duration-200 print:hidden lg:hidden ${
          isMenuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <SidebarContent closeMenu={() => setIsMenuOpen(false)} />
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
              <p className="text-sm font-semibold text-slate-800">บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด</p>
              <p className="hidden text-[11px] text-slate-400 sm:block">
                ระบบบริหารจัดการทรัพยากรองค์กร
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
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
  );
}
