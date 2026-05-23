"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  BellOff,
  KeyRound,
  Pencil,
  Plus,
  Power,
  RotateCcw,
  Users,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  EmptyCard,
  Modal,
  ResponsiveTable,
  Skeleton,
  toast,
  type ResponsiveColumn,
} from "@/components/ui";
import { UserFormModal } from "./staff/UserFormModal";
import { ResetPinModal } from "./staff/ResetPinModal";
import {
  deactivateUser,
  isOk,
  listUsers,
  reactivateUser,
  type PublicUser,
} from "@/features/users";
import type { Role } from "@/lib/auth";

interface StaffSectionProps {
  viewerRole: Role;
  viewerUserId: string;
}

type FormMode = { kind: "create" } | { kind: "edit"; user: PublicUser };

export function StaffSection({ viewerRole, viewerUserId }: StaffSectionProps) {
  const queryClient = useQueryClient();
  const {
    data: users = [],
    isLoading: loading,
  } = useQuery({
    queryKey: ["admin", "users", { viewerRole }],
    queryFn: async () => {
      const res = await listUsers();
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data.items;
    },
  });

  const [formMode, setFormMode] = useState<FormMode | null>(null);
  const [resetPinFor, setResetPinFor] = useState<PublicUser | null>(null);
  const [pendingDeactivate, setPendingDeactivate] = useState<PublicUser | null>(
    null,
  );
  const [pendingReactivate, setPendingReactivate] =
    useState<PublicUser | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["admin", "users"] });

  async function handleDeactivate() {
    if (!pendingDeactivate || submitting) return;
    setSubmitting(true);
    const res = await deactivateUser(pendingDeactivate.id);
    if (!isOk(res)) {
      toast.error(res.error.message);
      setSubmitting(false);
      return;
    }
    toast.success(`${pendingDeactivate.name} dinonaktifkan`);
    setPendingDeactivate(null);
    setSubmitting(false);
    void refresh();
  }

  async function handleReactivate() {
    if (!pendingReactivate || submitting) return;
    setSubmitting(true);
    const res = await reactivateUser(pendingReactivate.id);
    if (!isOk(res)) {
      toast.error(res.error.message);
      setSubmitting(false);
      return;
    }
    toast.success(`${pendingReactivate.name} diaktifkan kembali`);
    setPendingReactivate(null);
    setSubmitting(false);
    void refresh();
  }

  return (
    <div className="space-y-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-mahakan-green-900">
            Staff Management
          </h1>
          <p className="text-sm text-neutral-700">
            {viewerRole === "owner"
              ? "Owner melihat semua user. Bisa create Manager + Supervisor + Staff."
              : viewerRole === "manager"
                ? "Manager bisa create + manage Supervisor + Staff."
                : "Supervisor bisa lihat staff list + reset PIN saja."}
          </p>
        </div>
        {viewerRole === "owner" || viewerRole === "manager" ? (
          <Button onClick={() => setFormMode({ kind: "create" })}>
            <Plus className="size-4" aria-hidden /> Tambah User
          </Button>
        ) : null}
      </header>

      <Card>
        <CardHeader />
        <CardContent className="px-0">
          {loading ? (
            <div className="space-y-2 p-4" role="status" aria-label="Memuat user">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <div className="px-3 pb-3 pointer:px-0 pointer:pb-0">
              <ResponsiveTable<PublicUser>
                rows={users}
                rowKey={(u) => u.id}
                columns={staffColumns(viewerUserId)}
                emptyState={
                  <EmptyCard
                    icon={Users}
                    title="Belum ada user"
                    description="Tambah staff/manager untuk akses POS dan back-office."
                  />
                }
                rowActions={(u) => (
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setFormMode({ kind: "edit", user: u })}
                      aria-label={`Edit ${u.name}`}
                    >
                      <Pencil className="size-4" aria-hidden />
                    </Button>
                    {u.hasPinSet ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setResetPinFor(u)}
                        aria-label={`Reset PIN ${u.name}`}
                      >
                        <KeyRound className="size-4" aria-hidden />
                      </Button>
                    ) : null}
                    {u.status === "active" && u.id !== viewerUserId ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setPendingDeactivate(u)}
                        aria-label={`Nonaktifkan ${u.name}`}
                        className="text-danger-500 hover:bg-danger-100"
                      >
                        <Power className="size-4" aria-hidden />
                      </Button>
                    ) : u.status === "inactive" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setPendingReactivate(u)}
                        aria-label={`Aktifkan ${u.name}`}
                        className="text-mahakan-green-900 hover:bg-mahakan-green-100"
                      >
                        <RotateCcw className="size-4" aria-hidden />
                      </Button>
                    ) : null}
                  </div>
                )}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <UserFormModal
        open={formMode !== null}
        mode={formMode}
        viewerRole={viewerRole}
        viewerUserId={viewerUserId}
        onClose={() => setFormMode(null)}
        onSaved={() => {
          setFormMode(null);
          void refresh();
        }}
      />

      <ResetPinModal
        open={resetPinFor !== null}
        userId={resetPinFor?.id ?? null}
        userName={resetPinFor?.name ?? ""}
        updatedBy={viewerUserId}
        onClose={() => setResetPinFor(null)}
        onReset={() => {
          setResetPinFor(null);
          void refresh();
        }}
      />

      <Modal
        open={pendingDeactivate !== null}
        onClose={() => setPendingDeactivate(null)}
        title="Nonaktifkan user?"
        description={
          pendingDeactivate
            ? `${pendingDeactivate.name} tidak bisa login sampai diaktifkan kembali.`
            : undefined
        }
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setPendingDeactivate(null)}
              disabled={submitting}
            >
              Batal
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeactivate}
              loading={submitting}
            >
              Nonaktifkan
            </Button>
          </>
        }
      >
        <p className="text-sm text-neutral-700">
          User bisa diaktifkan kembali via aksi yang sama (tampil di list).
          Last-Owner protected — Owner terakhir tidak bisa dinonaktifkan.
        </p>
      </Modal>

      <Modal
        open={pendingReactivate !== null}
        onClose={() => setPendingReactivate(null)}
        title="Aktifkan kembali user?"
        description={
          pendingReactivate
            ? `${pendingReactivate.name} akan bisa login lagi sesuai role-nya.`
            : undefined
        }
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setPendingReactivate(null)}
              disabled={submitting}
            >
              Batal
            </Button>
            <Button onClick={handleReactivate} loading={submitting}>
              Aktifkan
            </Button>
          </>
        }
      >
        <p className="text-sm text-neutral-700">
          Auth (password/PIN) yang tersimpan tetap berlaku. Pastikan user masih
          berhak akses sistem.
        </p>
      </Modal>
    </div>
  );
}

function RoleBadge({ role }: { role: Role }) {
  if (role === "owner") return <Badge variant="signature">Owner</Badge>;
  if (role === "manager") return <Badge variant="info">Manager</Badge>;
  if (role === "supervisor")
    return <Badge variant="warning">Supervisor</Badge>;
  return <Badge variant="neutral">Staff</Badge>;
}

function staffColumns(viewerUserId: string): ResponsiveColumn<PublicUser>[] {
  return [
    {
      key: "name",
      label: "Nama",
      primary: true,
      render: (u) => (
        <span>
          {u.name}
          {u.id === viewerUserId ? (
            <Badge variant="info" className="ml-2">
              Anda
            </Badge>
          ) : null}
        </span>
      ),
    },
    {
      key: "email",
      label: "Email",
      render: (u) => (
        <span className="text-neutral-700">{u.email ?? "—"}</span>
      ),
    },
    {
      key: "role",
      label: "Role",
      render: (u) => <RoleBadge role={u.role} />,
    },
    {
      key: "auth",
      label: "Auth",
      align: "center",
      render: (u) => (
        <div className="flex items-center justify-center gap-1">
          {u.hasPasswordSet ? <Badge variant="neutral">Pwd</Badge> : null}
          {u.hasPinSet ? <Badge variant="info">PIN</Badge> : null}
          {!u.hasPasswordSet && !u.hasPinSet ? (
            <span className="text-xs text-neutral-400">—</span>
          ) : null}
        </div>
      ),
    },
    {
      key: "notif",
      label: "Notif",
      align: "center",
      render: (u) => <NotifBadge user={u} />,
    },
    {
      key: "status",
      label: "Status",
      align: "center",
      render: (u) =>
        u.status === "active" ? (
          <Badge variant="success">Aktif</Badge>
        ) : (
          <Badge variant="voided">Nonaktif</Badge>
        ),
    },
  ];
}

function NotifBadge({ user }: { user: PublicUser }) {
  if (user.pushDeviceCount > 0) {
    /* Sesi AE-135 HOTFIX — defensive: nilai bisa Date | string | null
     * dari serialization, jangan asumsi instanceof Date. */
    const last = formatRelativeShort(user.pushLatestSubscribedAt);
    const label =
      user.pushDeviceCount === 1
        ? "Aktif"
        : `${user.pushDeviceCount} device`;
    return (
      <div
        className="inline-flex items-center justify-center gap-1"
        title={
          last ? `Subscribe terakhir: ${last}` : "Notifikasi push aktif"
        }
      >
        <Bell className="size-3.5 text-mahakan-green-700" aria-hidden />
        <Badge variant="success">{label}</Badge>
      </div>
    );
  }
  return (
    <div
      className="inline-flex items-center justify-center gap-1"
      title="Belum aktifkan notifikasi. Minta user buka /m atau /dashboard lalu tap Aktifkan."
    >
      <BellOff className="size-3.5 text-neutral-400" aria-hidden />
      <span className="text-xs text-neutral-500">Belum</span>
    </div>
  );
}

function formatRelativeShort(raw: Date | string | null | undefined): string | null {
  if (!raw) return null;
  const date = raw instanceof Date ? raw : new Date(raw);
  if (!Number.isFinite(date.getTime())) return null;
  const ms = Date.now() - date.getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "baru saja";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} menit lalu`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} jam lalu`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days} hari lalu`;
  return date.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
