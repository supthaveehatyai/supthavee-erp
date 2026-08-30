import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono, Sarabun } from "next/font/google";
import { Toaster } from "sonner";
import { ForbiddenScreen } from "@/components/auth/forbidden-screen";
import { getCurrentAuthUser } from "@/lib/auth/current-user";
import {
  canAccessPath,
  ERP_MODULE_LABELS,
  isAuthPath,
  resolveModuleForPath,
} from "@/lib/auth/module-access";
import AppShell from "./app-shell";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/** Official Thai government-document font (50 ทวิ / ภ.ง.ด. print) */
const sarabun = Sarabun({
  variable: "--font-sarabun",
  weight: ["300", "400", "500", "600", "700"],
  subsets: ["thai", "latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Supthavee ERP",
    template: "%s | Supthavee ERP",
  },
  description: "ระบบบริหารจัดการทรัพยากรองค์กร บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headerList = await headers();
  const pathname = headerList.get("x-pathname") ?? "";
  const onAuthPage = isAuthPath(pathname);

  // Never call getCurrentAuthUser on /login or /auth — cookie refresh in RSC
  // causes an HTTP-200 re-render loop (ERR_TOO_MANY_REDIRECTS-style navigation).
  const currentUser = onAuthPage ? null : await getCurrentAuthUser();

  const allowed =
    onAuthPage ||
    !currentUser ||
    canAccessPath(
      pathname,
      currentUser.accessibleModules,
      currentUser.roleCode,
    );
  const deniedModule = allowed ? null : resolveModuleForPath(pathname);

  return (
    <html lang="th" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className={sarabun.variable}>
        <AppShell
          userDisplayName={currentUser?.displayName ?? null}
          roleCode={currentUser?.roleCode ?? null}
          accessibleModules={currentUser?.accessibleModules ?? null}
        >
          {allowed ? (
            children
          ) : (
            <ForbiddenScreen
              pathname={pathname}
              moduleLabel={
                deniedModule ? ERP_MODULE_LABELS[deniedModule] : null
              }
            />
          )}
        </AppShell>
        <Toaster richColors position="top-right" closeButton />
      </body>
    </html>
  );
}
