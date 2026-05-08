"use client";

import { useEffect, useState } from "react";
import { KeyRound, Pencil, Plus, Power, Users } from "lucide-react";
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
  type PublicUser,
} from "@/features/users";
import type { Role } from "@/lib/auth";

interface StaffSectionProps {
  viewerRole: Role;
  viewerUserId: string;
}

type FormMode = { kind: "create" } | { kind: "edit"; userId: string; name: string };

export function StaffSection({ viewerRole, viewerUserId }: StaffSectionProps) {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const [formMode, setFormMode] = useState<FormMode | null>(null);
  const [resetPinFor, setResetPinFor] = useState<PublicUser | null>(null);
  const [pendingDeactivate, setPendingDeactivate] = useState<PublicUser | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await listUsers();
      if (cancelled) return;
      if (isOk(res)) setUsers(res.data.items);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshKey, viewerRole]);

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
    setRefreshKey((k) => k + 1);
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
                      onClick={() =>
                        setFormMode({
                          kind: "edit",
                          userId: u.id,
                          name: u.name,
                        })
                      }
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
          setRefreshKey((k) => k + 1);
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
          setRefreshKey((k) => k + 1);
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
