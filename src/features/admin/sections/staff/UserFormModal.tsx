"use client";

import { useEffect, useMemo, useState } from "react";
import { KeyRound, Lock, ShieldAlert } from "lucide-react";
import {
  Badge,
  Button,
  Input,
  Modal,
  toast,
} from "@/components/ui";
import {
  createManager,
  createOwner,
  createStaff,
  createSupervisor,
  isOk,
  updateUser,
  type PublicUser,
} from "@/features/users";
import type { Role } from "@/lib/auth";
import { cn } from "@/lib/utils";

type AssignableRole = "staff" | "supervisor" | "manager" | "owner";

type Mode =
  | { kind: "create" }
  | { kind: "edit"; user: PublicUser };

interface UserFormModalProps {
  open: boolean;
  mode: Mode | null;
  /** Active session role — limits what can be created/edited. */
  viewerRole: Role;
  /** Used to flag the row as "you" — actions on self are still allowed except deactivate. */
  viewerUserId: string;
  onClose: () => void;
  onSaved: () => void;
}

const ROLE_LABELS: Record<AssignableRole, string> = {
  staff: "Staff",
  supervisor: "Supervisor",
  manager: "Manager",
  owner: "Owner",
};

const ROLE_HINTS: Record<AssignableRole, string> = {
  staff: "PIN",
  supervisor: "PIN",
  manager: "Email",
  owner: "Email",
};

export function UserFormModal({
  open,
  mode,
  viewerRole,
  viewerUserId,
  onClose,
  onSaved,
}: UserFormModalProps) {
  const isEdit = mode?.kind === "edit";
  const target = mode?.kind === "edit" ? mode.user : null;

  const [selectedRole, setSelectedRole] = useState<AssignableRole>("staff");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"active" | "inactive">("active");

  // Auth — controlled inputs only mount when the admin opts in.
  const [showPasswordField, setShowPasswordField] = useState(false);
  const [password, setPassword] = useState("");
  const [showPinField, setShowPinField] = useState(false);
  const [pin, setPin] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !mode) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null);
    setSubmitting(false);
    setShowPasswordField(false);
    setShowPinField(false);
    setPassword("");
    setPin("");
    if (mode.kind === "edit") {
      setSelectedRole(mode.user.role);
      setName(mode.user.name);
      setEmail(mode.user.email ?? "");
      setStatus(mode.user.status);
    } else {
      setSelectedRole("staff");
      setName("");
      setEmail("");
      setStatus("active");
    }
  }, [open, mode]);

  const canCreateManager = viewerRole === "owner";
  const canCreateOwner = viewerRole === "owner";
  // Only Owner can change role on edit (privilege-escalation control).
  const canChangeRole = isEdit ? viewerRole === "owner" : true;

  // Role selection drives which fields are required.
  const isPasswordRole =
    selectedRole === "manager" || selectedRole === "owner";
  const isPinRole = selectedRole === "staff" || selectedRole === "supervisor";

  const roleChanged = isEdit && target && selectedRole !== target.role;
  const promotingToPasswordRole =
    roleChanged && isPasswordRole && !target?.hasPasswordSet;
  const promotingToPinRole = roleChanged && isPinRole && !target?.hasPinSet;
  const becomingPasswordRoleNoEmail =
    isEdit && isPasswordRole && !target?.email && !email.trim();

  // Auth controls forced open when a promotion needs new credentials.
  const passwordRequired = !isEdit
    ? isPasswordRole
    : Boolean(promotingToPasswordRole);
  const pinRequired = !isEdit
    ? selectedRole === "staff" || selectedRole === "supervisor"
    : Boolean(promotingToPinRole);

  const passwordFieldOpen = showPasswordField || passwordRequired;
  const pinFieldOpen = showPinField || pinRequired;

  // Role list visible — viewer's permission decides which are clickable.
  const roleOptions: AssignableRole[] = useMemo(() => {
    const all: AssignableRole[] = ["staff", "supervisor", "manager", "owner"];
    if (canCreateOwner) return all;
    if (canCreateManager) return all.slice(0, 3);
    return ["staff", "supervisor"];
  }, [canCreateManager, canCreateOwner]);

  function disabledRole(r: AssignableRole): boolean {
    if (!canChangeRole && isEdit) return r !== target?.role;
    if (r === "owner") return !canCreateOwner;
    if (r === "manager") return !canCreateManager;
    return false;
  }

  async function onSubmit() {
    if (submitting || !mode) return;
    setSubmitting(true);
    setError(null);

    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();

    if (mode.kind === "edit" && target) {
      const payload: Parameters<typeof updateUser>[0] = {
        id: target.id,
        name: trimmedName,
      };
      if (status !== target.status) payload.status = status;
      if (roleChanged) payload.role = selectedRole;

      // Email: only send when changed. Empty string = clear (server validates).
      if (trimmedEmail !== (target.email ?? "")) {
        payload.email = trimmedEmail === "" ? "" : trimmedEmail;
      }
      // Password: only send when admin opened the field and typed something.
      if (showPasswordField && password.length > 0) {
        payload.password = password;
      }
      // PIN: only send when admin opened the field and typed something.
      if (showPinField && pin.length > 0) {
        payload.pin = pin;
      }

      const res = await updateUser(payload);
      if (!isOk(res)) {
        setError(res.error.message);
        setSubmitting(false);
        return;
      }
      toast.success(`${trimmedName} disimpan`);
      onSaved();
      return;
    }

    // ----- Create flows -----
    if (selectedRole === "staff") {
      const res = await createStaff({ name: trimmedName, pin });
      if (!isOk(res)) {
        setError(res.error.message);
        setSubmitting(false);
        return;
      }
      toast.success(`Staff ${trimmedName} ditambahkan`);
      onSaved();
      return;
    }
    if (selectedRole === "supervisor") {
      const res = await createSupervisor({ name: trimmedName, pin });
      if (!isOk(res)) {
        setError(res.error.message);
        setSubmitting(false);
        return;
      }
      toast.success(`Supervisor ${trimmedName} ditambahkan`);
      onSaved();
      return;
    }
    if (selectedRole === "owner") {
      const res = await createOwner({
        name: trimmedName,
        email: trimmedEmail,
        password,
        pin: pin.trim() || undefined,
      });
      if (!isOk(res)) {
        setError(res.error.message);
        setSubmitting(false);
        return;
      }
      toast.success(`Owner ${trimmedName} ditambahkan`);
      onSaved();
      return;
    }
    const res = await createManager({
      name: trimmedName,
      email: trimmedEmail,
      password,
      pin: pin.trim() || undefined,
    });
    if (!isOk(res)) {
      setError(res.error.message);
      setSubmitting(false);
      return;
    }
    toast.success(`Manager ${trimmedName} ditambahkan`);
    onSaved();
  }

  const isSelf = isEdit && target?.id === viewerUserId;

  return (
    <Modal
      open={open && mode !== null}
      onClose={onClose}
      title={isEdit ? "Edit User" : "Tambah User"}
      description={
        isEdit && target
          ? `Update profile, role, status, dan auth untuk ${target.name}.`
          : "Pilih role dan isi data login user baru."
      }
      size="xl"
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
      <div className="space-y-6">
        {/* Header chip strip in edit mode */}
        {isEdit && target ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm">
            <span className="font-medium text-neutral-900">{target.name}</span>
            <RoleBadge role={target.role} />
            {target.status === "active" ? (
              <Badge variant="success">Aktif</Badge>
            ) : (
              <Badge variant="voided">Nonaktif</Badge>
            )}
            {target.hasPasswordSet ? <Badge variant="neutral">Pwd</Badge> : null}
            {target.hasPinSet ? <Badge variant="info">PIN</Badge> : null}
            {isSelf ? <Badge variant="info">Anda</Badge> : null}
          </div>
        ) : null}

        {/* ---- INFO DASAR ---- */}
        <section className="space-y-3">
          <SectionTitle>Info Dasar</SectionTitle>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Nama Lengkap"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
              maxLength={120}
            />
            <Input
              label="Email Login"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={
                isPasswordRole ? "manager@mahakan.id" : "(opsional untuk PIN-only)"
              }
              hint={
                isPasswordRole
                  ? "Dipakai untuk login back-office."
                  : "Kosongkan kalau user cuma pakai PIN."
              }
              required={isPasswordRole}
            />
          </div>
        </section>

        {/* ---- ROLE ---- */}
        {(!isEdit && canCreateManager) || (isEdit && canChangeRole) ? (
          <section className="space-y-3">
            <SectionTitle>Role</SectionTitle>
            <div
              className={cn(
                "grid gap-2",
                roleOptions.length >= 4
                  ? "grid-cols-2 sm:grid-cols-4"
                  : roleOptions.length === 3
                    ? "grid-cols-3"
                    : "grid-cols-2",
              )}
              role="radiogroup"
              aria-label="Role user"
            >
              {roleOptions.map((r) => (
                <RoleButton
                  key={r}
                  label={ROLE_LABELS[r]}
                  hint={ROLE_HINTS[r]}
                  active={selectedRole === r}
                  emphasis={r === "owner"}
                  disabled={disabledRole(r)}
                  onClick={() => setSelectedRole(r)}
                />
              ))}
            </div>
            {selectedRole === "owner" ? (
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
                    Owner bisa kelola semua data, P&amp;L, hapus transaksi,
                    ubah harga, dan menambah Owner lain. Semua aksi tercatat di
                    Audit Log.
                  </p>
                </div>
              </div>
            ) : null}
            {roleChanged ? (
              <p className="text-xs text-neutral-700">
                Mengubah role dari{" "}
                <strong>{target ? ROLE_LABELS[target.role as AssignableRole] : ""}</strong>{" "}
                → <strong>{ROLE_LABELS[selectedRole]}</strong>.
                {promotingToPasswordRole
                  ? " Butuh password baru di bawah."
                  : ""}
                {promotingToPinRole ? " Butuh PIN baru di bawah." : ""}
                {becomingPasswordRoleNoEmail ? " Email wajib diisi." : ""}
              </p>
            ) : null}
          </section>
        ) : null}

        {/* ---- STATUS (edit only) ---- */}
        {isEdit ? (
          <section className="space-y-3">
            <SectionTitle>Status</SectionTitle>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Status user">
              <StatusButton
                label="Aktif"
                tone="success"
                active={status === "active"}
                onClick={() => setStatus("active")}
              />
              <StatusButton
                label="Nonaktif"
                tone="danger"
                active={status === "inactive"}
                onClick={() => setStatus("inactive")}
                disabled={isSelf}
              />
            </div>
            {isSelf ? (
              <p className="text-xs text-neutral-500">
                Lo nggak bisa menonaktifkan akun sendiri.
              </p>
            ) : null}
          </section>
        ) : null}

        {/* ---- AUTH ---- */}
        <section className="space-y-3">
          <SectionTitle>Auth</SectionTitle>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {/* Password card */}
            <div className="rounded-md border border-neutral-200 bg-white p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Lock className="size-4 text-neutral-500" aria-hidden />
                  <span className="text-sm font-medium text-neutral-900">
                    Password
                  </span>
                  {isEdit && target?.hasPasswordSet ? (
                    <Badge variant="neutral">Tersimpan</Badge>
                  ) : !isPasswordRole ? (
                    <Badge variant="neutral">Tidak dipakai</Badge>
                  ) : (
                    <Badge variant="warning">Belum diset</Badge>
                  )}
                </div>
                {isEdit && !passwordFieldOpen && isPasswordRole ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowPasswordField(true)}
                  >
                    {target?.hasPasswordSet ? "Ubah" : "Set"}
                  </Button>
                ) : null}
              </div>
              {passwordFieldOpen || !isEdit ? (
                isPasswordRole ? (
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={
                      selectedRole === "owner"
                        ? "Min 12 karakter"
                        : "Min 8 karakter"
                    }
                    hint={
                      isEdit
                        ? "Kosongkan = tidak diubah."
                        : selectedRole === "owner"
                          ? "Owner harus password kuat. Bisa ganti setelah login."
                          : "Manager bisa ganti sendiri setelah login."
                    }
                    required={!isEdit}
                  />
                ) : (
                  <p className="text-xs text-neutral-500">
                    Role {ROLE_LABELS[selectedRole]} login pakai PIN — password
                    tidak dibutuhkan.
                  </p>
                )
              ) : null}
            </div>

            {/* PIN card */}
            <div className="rounded-md border border-neutral-200 bg-white p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <KeyRound className="size-4 text-neutral-500" aria-hidden />
                  <span className="text-sm font-medium text-neutral-900">
                    PIN POS
                  </span>
                  {isEdit && target?.hasPinSet ? (
                    <Badge variant="info">Tersimpan</Badge>
                  ) : pinRequired ? (
                    <Badge variant="warning">Wajib diset</Badge>
                  ) : (
                    <Badge variant="neutral">Opsional</Badge>
                  )}
                </div>
                {isEdit && !pinFieldOpen ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowPinField(true)}
                  >
                    {target?.hasPinSet ? "Ubah" : "Set"}
                  </Button>
                ) : null}
              </div>
              {pinFieldOpen || !isEdit ? (
                <Input
                  type="text"
                  inputMode="numeric"
                  value={pin}
                  onChange={(e) =>
                    setPin(e.target.value.replace(/[^\d]/g, "").slice(0, 6))
                  }
                  placeholder="4-6 digit"
                  hint={
                    isEdit
                      ? "Kosongkan = tidak diubah."
                      : isPasswordRole
                        ? "Opsional — untuk approver override di POS."
                        : "Wajib — dipakai login POS."
                  }
                  required={!isEdit && isPinRole}
                />
              ) : null}
            </div>
          </div>
        </section>

        {error ? (
          <p
            role="alert"
            className="rounded-md border border-danger-500/40 bg-danger-100/50 px-3 py-2 text-sm font-medium text-danger-500"
          >
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
      {children}
    </h3>
  );
}

function RoleBadge({ role }: { role: Role }) {
  if (role === "owner") return <Badge variant="signature">Owner</Badge>;
  if (role === "manager") return <Badge variant="info">Manager</Badge>;
  if (role === "supervisor") return <Badge variant="warning">Supervisor</Badge>;
  return <Badge variant="neutral">Staff</Badge>;
}

interface RoleButtonProps {
  label: string;
  hint: string;
  active: boolean;
  onClick: () => void;
  emphasis?: boolean;
  disabled?: boolean;
}

function RoleButton({
  label,
  hint,
  active,
  onClick,
  emphasis,
  disabled,
}: RoleButtonProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      aria-disabled={disabled}
      onClick={() => {
        if (!disabled) onClick();
      }}
      className={cn(
        "flex flex-col items-center justify-center gap-0.5 rounded-md border py-2.5 text-sm font-medium transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700 focus-visible:ring-offset-1",
        disabled
          ? "cursor-not-allowed border-neutral-200 bg-neutral-100 text-neutral-400"
          : active
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
          disabled
            ? "text-neutral-400"
            : active
              ? "opacity-80"
              : "text-neutral-500",
        )}
      >
        {hint}
      </span>
    </button>
  );
}

interface StatusButtonProps {
  label: string;
  tone: "success" | "danger";
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}

function StatusButton({ label, tone, active, onClick, disabled }: StatusButtonProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      aria-disabled={disabled}
      onClick={() => {
        if (!disabled) onClick();
      }}
      className={cn(
        "rounded-md border py-2.5 text-sm font-medium transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700 focus-visible:ring-offset-1",
        disabled
          ? "cursor-not-allowed border-neutral-200 bg-neutral-100 text-neutral-400"
          : active
            ? tone === "success"
              ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
              : "border-danger-500 bg-danger-100/60 text-danger-500"
            : "border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-100",
      )}
    >
      {label}
    </button>
  );
}
