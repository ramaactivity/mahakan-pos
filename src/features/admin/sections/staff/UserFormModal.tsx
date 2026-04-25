"use client";

import { useEffect, useState } from "react";
import { Button, Input, Modal, toast } from "@/components/ui";
import {
  createManager,
  createStaff,
  isOk,
  updateUser,
} from "@/features/users";
import type { Role } from "@/lib/auth";
import { cn } from "@/lib/utils";

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
  const [createRole, setCreateRole] = useState<"staff" | "manager">("staff");
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
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setCreateRole("staff")}
                className={cn(
                  "rounded-md border py-2 text-sm font-medium transition-all",
                  createRole === "staff"
                    ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
                    : "border-neutral-300 bg-white hover:bg-neutral-100",
                )}
              >
                Staff (PIN)
              </button>
              <button
                type="button"
                onClick={() => setCreateRole("manager")}
                className={cn(
                  "rounded-md border py-2 text-sm font-medium transition-all",
                  createRole === "manager"
                    ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
                    : "border-neutral-300 bg-white hover:bg-neutral-100",
                )}
              >
                Manager (Email)
              </button>
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

        {!isEdit && createRole === "manager" ? (
          <>
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="manager@mahakan.id"
              required
            />
            <Input
              label="Password Sementara (min 8 karakter)"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              hint="Manager bisa ganti sendiri setelah login"
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
