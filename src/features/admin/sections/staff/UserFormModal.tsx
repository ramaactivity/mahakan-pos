"use client";

import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Button, Input, Modal, toast } from "@/components/ui";
import {
  createManager,
  createOwner,
  createStaff,
  isOk,
  updateUser,
} from "@/features/users";
import type { Role } from "@/lib/auth";
import { cn } from "@/lib/utils";

type CreateRole = "staff" | "manager" | "owner";

type Mode = { kind: "create" } | { kind: "edit"; userId: string; name: string };

interface UserFormModalProps {
  open: boolean;
  mode: Mode | null;
  /** Active session role — limits what can be created. */
  viewerRole: Role;
  /** Kept for callsite compat; action derives from session. */
  viewerUserId: string;
  onClose: () => void;
  onSaved: () => void;
}

export function UserFormModal({
  open,
  mode,
  viewerRole,
  onClose,
  onSaved,
}: UserFormModalProps) {
  const [createRole, setCreateRole] = useState<CreateRole>("staff");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !mode) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null);
    setSubmitting(false);
    setCreateRole("staff");
    setName(mode.kind === "edit" ? mode.name : "");
    setEmail("");
    setPassword("");
    setPin("");
  }, [open, mode]);

  async function onSubmit() {
    if (submitting || !mode) return;
    setSubmitting(true);
    setError(null);

    if (mode.kind === "edit") {
      const res = await updateUser({
        id: mode.userId,
        name: name.trim(),
      });
      if (!isOk(res)) {
        setError(res.error.message);
        setSubmitting(false);
        return;
      }
      toast.success("User disimpan");
      onSaved();
      return;
    }

    // Create
    if (createRole === "staff") {
      const res = await createStaff({
        name: name.trim(),
        pin,
      });
      if (!isOk(res)) {
        setError(res.error.message);
        setSubmitting(false);
        return;
      }
      toast.success(`Staff ${name} ditambahkan`);
      onSaved();
      return;
    }

    if (createRole === "owner") {
      const res = await createOwner({
        name: name.trim(),
        email: email.trim(),
        password,
        pin: pin.trim() || undefined,
      });
      if (!isOk(res)) {
        setError(res.error.message);
        setSubmitting(false);
        return;
      }
      toast.success(`Owner ${name} ditambahkan`);
      onSaved();
      return;
    }

    // Create manager
    const res = await createManager({
      name: name.trim(),
      email: email.trim(),
      password,
      pin: pin.trim() || undefined,
    });
    if (!isOk(res)) {
      setError(res.error.message);
      setSubmitting(false);
      return;
    }
    toast.success(`Manager ${name} ditambahkan`);
    onSaved();
  }

  const isEdit = mode?.kind === "edit";
  const canCreateManager = viewerRole === "owner";
  const canCreateOwner = viewerRole === "owner";
  const needsEmail = createRole === "manager" || createRole === "owner";

  return (
    <Modal
      open={open && mode !== null}
      onClose={onClose}
      title={isEdit ? "Edit User" : "Tambah User"}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button onClick={onSubmit} loading={submitting}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!isEdit && canCreateManager ? (
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-neutral-900">
              Role
            </label>
            <div
              className={cn(
                "grid gap-2",
                canCreateOwner ? "grid-cols-3" : "grid-cols-2",
              )}
              role="radiogroup"
              aria-label="Role user"
            >
              <RoleButton
                label="Staff"
                hint="PIN"
                active={createRole === "staff"}
                onClick={() => setCreateRole("staff")}
              />
              <RoleButton
                label="Manager"
                hint="Email"
                active={createRole === "manager"}
                onClick={() => setCreateRole("manager")}
              />
              {canCreateOwner ? (
                <RoleButton
                  label="Owner"
                  hint="Email"
                  active={createRole === "owner"}
                  onClick={() => setCreateRole("owner")}
                  emphasis
                />
              ) : null}
            </div>
          </div>
        ) : null}

        {!isEdit && createRole === "owner" ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-warning-500/40 bg-warning-100/50 p-3 text-xs text-warning-500"
          >
            <ShieldAlert className="size-4 shrink-0" aria-hidden />
            <div className="space-y-1">
              <p className="font-semibold uppercase tracking-wide">
                Owner = akses penuh sistem
              </p>
              <p className="text-warning-500/90">
                User Owner baru bisa mengelola semua data, lihat P&amp;L, hapus
                transaksi, mengubah harga, dan menambah Owner lain. Hanya buat
                Owner kalau lo benar-benar percaya orangnya. Semua aksi tercatat
                di Audit Log.
              </p>
            </div>
          </div>
        ) : null}

        <Input
          label="Nama Lengkap"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
          maxLength={120}
        />

        {!isEdit && needsEmail ? (
          <>
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={
                createRole === "owner"
                  ? "owner@mahakan.id"
                  : "manager@mahakan.id"
              }
              required
            />
            <Input
              label={
                createRole === "owner"
                  ? "Password Sementara (min 12 karakter)"
                  : "Password Sementara (min 8 karakter)"
              }
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              hint={
                createRole === "owner"
                  ? "Owner harus pakai password kuat. Owner baru bisa ganti setelah login."
                  : "Manager bisa ganti sendiri setelah login"
              }
              required
            />
            <Input
              label="PIN POS (opsional, 4-6 digit)"
              type="text"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/[^\d]/g, "").slice(0, 6))}
              hint="Untuk approver override di POS"
            />
          </>
        ) : !isEdit ? (
          <Input
            label="PIN (4-6 digit)"
            type="text"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/[^\d]/g, "").slice(0, 6))}
            placeholder="1234"
            required
          />
        ) : null}

        {error ? (
          <p role="alert" className="text-sm font-medium text-danger-500">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

interface RoleButtonProps {
  label: string;
  hint: string;
  active: boolean;
  onClick: () => void;
  emphasis?: boolean;
}

function RoleButton({ label, hint, active, onClick, emphasis }: RoleButtonProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center gap-0.5 rounded-md border py-2 text-sm font-medium transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700 focus-visible:ring-offset-1",
        active
          ? emphasis
            ? "border-warning-500 bg-warning-100/60 text-warning-500"
            : "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
          : "border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-100",
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          "text-[10px] uppercase tracking-wide",
          active ? "opacity-80" : "text-neutral-500",
        )}
      >
        {hint}
      </span>
    </button>
  );
}
