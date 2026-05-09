"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Banknote,
  Edit2,
  Landmark,
  Plus,
  Trash2,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Modal,
  Skeleton,
  toast,
} from "@/components/ui";
import {
  createBankAccount,
  deleteBankAccount,
  formatBankAccountDisplay,
  listBankAccounts,
  updateBankAccount,
  type BankAccount,
} from "@/features/bank-accounts";
import { hasPermission, type Role } from "@/lib/auth/rbac";

interface Props {
  viewerRole: Role;
}

/**
 * Sesi AE-13 — Settings card untuk daftar rekening bank master.
 * Owner CRUD, manager+supervisor view-only.
 */
export function BankAccountsCard({ viewerRole }: Props) {
  const canManage = hasPermission(viewerRole, "bank_account.manage");
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<BankAccount | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const accountsQuery = useQuery({
    queryKey: ["bank-accounts", "list", "all"],
    queryFn: async () => {
      const res = await listBankAccounts({ includeInactive: true });
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    staleTime: 60 * 1000,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await deleteBankAccount(id);
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    onSuccess: () => {
      toast.success("Rekening dihapus");
      void queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Gagal hapus"),
    onSettled: () => setDeletingId(null),
  });

  const accounts = accountsQuery.data ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>
              <span className="inline-flex items-center gap-2">
                <Landmark className="size-5" aria-hidden /> Rekening Bank
              </span>
            </CardTitle>
            <CardDescription>
              Daftar rekening tujuan setoran. Dipakai di Catat Setoran +
              Tutup Shift via dropdown — anti-typo & konsisten reporting.
            </CardDescription>
          </div>
          {canManage ? (
            <Button onClick={() => setCreateOpen(true)} size="sm">
              <Plus className="size-4" aria-hidden /> Tambah
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {accountsQuery.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : accounts.length === 0 ? (
          <div className="rounded-md border border-dashed border-neutral-300 bg-neutral-50 p-6 text-center text-sm text-neutral-600">
            <Banknote
              className="mx-auto mb-2 size-6 text-neutral-400"
              aria-hidden
            />
            Belum ada rekening.{" "}
            {canManage
              ? "Klik Tambah untuk daftar rekening tujuan setoran."
              : "Owner perlu daftar rekening dulu."}
          </div>
        ) : (
          <ul className="space-y-2">
            {accounts.map((b) => (
              <li
                key={b.id}
                className={
                  "flex flex-wrap items-center justify-between gap-2 rounded-md border border-neutral-200 bg-white p-3 " +
                  (b.isActive ? "" : "opacity-60")
                }
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-neutral-900">
                      {formatBankAccountDisplay(b)}
                    </span>
                    {!b.isActive ? (
                      <Badge variant="neutral">Non-aktif</Badge>
                    ) : null}
                  </div>
                  {b.notes ? (
                    <p className="mt-0.5 text-[11px] italic text-neutral-600">
                      {b.notes}
                    </p>
                  ) : null}
                </div>
                {canManage ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditing(b)}
                    >
                      <Edit2 className="size-3.5" aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeletingId(b.id)}
                      disabled={deleteMutation.isPending}
                      className="text-danger-500 hover:bg-danger-100"
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <BankAccountFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={() => {
          setCreateOpen(false);
          void queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
        }}
      />
      <BankAccountFormModal
        open={editing !== null}
        editing={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
        }}
      />
      <Modal
        open={deletingId !== null}
        onClose={() => setDeletingId(null)}
        title="Hapus rekening?"
        description="Rekening yang sudah dipakai di setoran historis tetap valid (soft delete). Pilih opsi non-aktifkan kalau cuma mau hide dari dropdown."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeletingId(null)}>
              Batal
            </Button>
            <Button
              onClick={() =>
                deletingId ? deleteMutation.mutate(deletingId) : undefined
              }
              loading={deleteMutation.isPending}
              variant="outline"
              className="!border-danger-500 !text-danger-700"
            >
              Hapus
            </Button>
          </>
        }
      >
        <p className="text-sm text-neutral-700">
          Rekening akan di-soft-delete + hilang dari dropdown.
        </p>
      </Modal>
    </Card>
  );
}

// ============================================================
// Form modal (create + edit)
// ============================================================

function BankAccountFormModal({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing?: BankAccount | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [bankName, setBankName] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setError(null);
    setSubmitting(false);
    setBankName(editing?.bankName ?? "");
    setAccountName(editing?.accountName ?? "");
    setAccountNumber(editing?.accountNumber ?? "");
    setNotes(editing?.notes ?? "");
    setIsActive(editing?.isActive ?? true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, editing]);

  async function onSubmit() {
    setError(null);
    if (bankName.trim().length === 0) {
      setError("Nama bank wajib");
      return;
    }
    if (accountName.trim().length === 0) {
      setError("Nama pemilik wajib");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        bankName: bankName.trim(),
        accountName: accountName.trim(),
        accountNumber: accountNumber.trim(),
        notes: notes.trim() || null,
      };
      const res = editing
        ? await updateBankAccount({
            id: editing.id,
            ...payload,
            isActive,
          })
        : await createBankAccount(payload);
      if (res.ok) {
        toast.success(editing ? "Rekening diupdate" : "Rekening ditambahkan");
        onSaved();
      } else {
        setError(res.error.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={submitting ? () => undefined : onClose}
      title={editing ? "Edit Rekening" : "Tambah Rekening"}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button onClick={onSubmit} loading={submitting}>
            {editing ? "Update" : "Simpan"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          label="Nama Bank"
          placeholder="BCA / BRI / Mandiri / Tunai (Kas Owner)"
          value={bankName}
          onChange={(e) => setBankName(e.target.value)}
          required
        />
        <Input
          label="Nama Pemilik Rekening"
          placeholder="Galih Rama Pratama / Mahakan Coffee"
          value={accountName}
          onChange={(e) => setAccountName(e.target.value)}
          required
        />
        <Input
          label="Nomor Rekening"
          placeholder="1234567890 (kosongin kalau tunai)"
          value={accountNumber}
          onChange={(e) => setAccountNumber(e.target.value)}
        />
        <Input
          label="Catatan (opsional)"
          placeholder="Mis. BCA Owner pribadi / BRI shop"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        {editing ? (
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="size-4 rounded border-neutral-300 text-mahakan-green-700 focus:ring-mahakan-green-700"
            />
            <span>
              Aktif (tampil di dropdown setoran)
            </span>
          </label>
        ) : null}
        {error ? (
          <p className="rounded-md border border-danger-300 bg-danger-100 px-3 py-2 text-sm font-medium text-danger-700">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

