import { ForbiddenScreen } from "@/components/auth/forbidden-screen";
import {
  ERP_MODULE_LABELS,
  resolveModuleForPath,
} from "@/lib/auth/module-access";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ from?: string | string[] }>;
}

function readParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0]?.trim() || "";
  return value?.trim() || "";
}

export default async function ForbiddenPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const from = readParam(params.from);
  const moduleKey = from ? resolveModuleForPath(from) : null;

  return (
    <ForbiddenScreen
      pathname={from || undefined}
      moduleLabel={moduleKey ? ERP_MODULE_LABELS[moduleKey] : null}
    />
  );
}
