import type { Metadata } from "next";
import Link from "next/link";
import { Users } from "lucide-react";
import { getAppRoles, getUsers } from "@/lib/actions/user.actions";
import type { ManagedUser } from "@/types/user";
import {
  DATA_ACCESS_SCOPE_LABELS,
  USER_PROFILE_SEARCH_PARAM,
} from "@/types/user";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CreateUserDialog } from "./create-user-dialog";
import { UserProfileFormSheet } from "./user-profile-form-sheet";
import { UserRowActions } from "./user-row-actions";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    [key: string]: string | string[] | undefined;
  }>;
}

function readSearchParam(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const value = params[key];
  if (Array.isArray(value)) return value[0]?.trim() || undefined;
  return value?.trim() || undefined;
}

export const metadata: Metadata = {
  title: "จัดการผู้ใช้งาน | User Management",
  description:
    "สร้างและจัดการผู้ใช้งาน ERP ด้วย PIN + ABAC Data Access Scope / Approval Limit (Admin only)",
};

function StatusBadge({ active }: { active: boolean }) {
  if (active) {
    return (
      <Badge className="border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-50">
        Active
      </Badge>
    );
  }
  return (
    <Badge className="border-red-200 bg-red-50 text-red-700 hover:bg-red-50">
      Inactive
    </Badge>
  );
}

function UsersTable({ users }: { users: ManagedUser[] }) {
  if (users.length === 0) {
    return (
      <p className="px-2 py-10 text-center text-sm text-slate-500">
        ยังไม่มีผู้ใช้งานในระบบ — กด &quot;สร้างผู้ใช้งานใหม่&quot; เพื่อเริ่มต้น
      </p>
    );
  }

  return (
    <div className="w-full">
      <Table className="table-fixed" wrapperClassName="overflow-x-hidden">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[18%]">ชื่อ</TableHead>
            <TableHead className="w-[22%]">อีเมล</TableHead>
            <TableHead className="w-[16%]">สิทธิ์ / Role</TableHead>
            <TableHead className="w-[14%]">Data Access</TableHead>
            <TableHead className="w-[12%] text-right">Approval Limit</TableHead>
            <TableHead className="w-[10%] min-w-[120px]">สถานะ</TableHead>
            <TableHead className="w-[8%] min-w-[150px] text-right">
              จัดการ
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => (
            <TableRow
              key={user.id}
              className={user.is_active ? undefined : "bg-slate-50/80"}
            >
              <TableCell className="break-words font-medium text-slate-900">
                <Link
                  href={`/settings/users?${USER_PROFILE_SEARCH_PARAM}=${encodeURIComponent(user.id)}`}
                  className="text-slate-900 hover:text-blue-700 hover:underline"
                >
                  {user.full_name}
                </Link>
              </TableCell>
              <TableCell className="break-all text-slate-700">
                {user.email}
              </TableCell>
              <TableCell className="break-words">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium text-slate-800">
                    {user.role_name_th}
                  </p>
                  <p className="font-mono text-[11px] text-slate-400">
                    {user.role_code}
                  </p>
                </div>
              </TableCell>
              <TableCell className="text-sm text-slate-700">
                {DATA_ACCESS_SCOPE_LABELS[user.data_access_scope]}
              </TableCell>
              <TableCell className="text-right font-mono text-sm tabular-nums text-slate-800">
                {new Intl.NumberFormat("th-TH", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                }).format(user.approval_limit)}
              </TableCell>
              <TableCell className="align-middle">
                <StatusBadge active={user.is_active} />
              </TableCell>
              <TableCell className="min-w-[150px] text-right align-middle">
                <div className="flex justify-end">
                  <UserRowActions user={user} />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default async function UsersSettingsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const profileUserId = readSearchParam(params, USER_PROFILE_SEARCH_PARAM) ?? "";

  const [usersResult, rolesResult] = await Promise.all([
    getUsers(),
    getAppRoles(),
  ]);

  const profileUser = profileUserId
    ? (usersResult.data.find((row) => row.id === profileUserId) ?? null)
    : null;
  const profileError =
    profileUserId && !profileUser
      ? "ไม่พบผู้ใช้ที่ต้องการแก้ไขโปรไฟล์"
      : null;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-900">
            <Users className="h-8 w-8 text-blue-600" />
            จัดการผู้ใช้งาน
          </h1>
          <p className="text-slate-500">
            สร้างผู้ใช้พร้อม PIN, กำหนด Data Access Scope / Approval Limit
            (ABAC) และระงับสิทธิ์แบบ Soft Delete — เฉพาะ Admin
          </p>
        </div>
        <CreateUserDialog roles={rolesResult.data} />
      </div>

      {!usersResult.success ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {usersResult.error}
        </div>
      ) : null}

      {!rolesResult.success ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          โหลดรายการสิทธิ์ไม่สำเร็จ: {rolesResult.error}
        </div>
      ) : null}

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">รายชื่อผู้ใช้งาน</CardTitle>
          <CardDescription>
            {usersResult.data.length} คน · Inactive = ระงับสิทธิ์ (ไม่ลบประวัติ)
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          <UsersTable users={usersResult.data} />
        </CardContent>
      </Card>

      <UserProfileFormSheet
        user={profileUser}
        error={profileError}
        closeHref="/settings/users"
      />
    </div>
  );
}
