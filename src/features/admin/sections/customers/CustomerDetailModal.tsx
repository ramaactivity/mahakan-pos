"use client";

import { useEffect, useState } from "react";
import { Heart, Pencil, Phone, StickyNote, TrendingUp, Wallet } from "lucide-react";
import { Button, Input, Modal, toast } from "@/components/ui";
import {
  isOk,
  updateCustomer,
  type Customer,
} from "@/features/customers";
import { formatRupiah } from "@/lib/format";

interface CustomerDetailModalProps {
  open: boolean;
  customer: Customer | null;
  onClose: () => void;
  onUpdated: (next: Customer) => void;
}

export function CustomerDetailModal({
  open,
  customer,
  onClose,
  onUpdated,
}: CustomerDetailModalProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setEditing(false);
    setError(null);
    setSubmitting(false);
    if (customer) {
      setName(customer.name);
      setPhone(customer.phone);
      setNotes(customer.notes ?? "");
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, customer]);

  if (!customer) return null;

  async function onSave() {
    if (!customer || submitting) return;
    setError(null);
    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();
    if (trimmedName.length === 0 || trimmedName.length > 80) {
      setError("Nama wajib diisi (1-80 karakter)");
      return;
    }
    if (trimmedPhone.length === 0) {
      setError("Nomor HP wajib diisi");
      return;
    }
    setSubmitting(true);
    const res = await updateCustomer({
      id: customer.id,
      name: trimmedName !== customer.name ? trimmedName : undefined,
      phone: trimmedPhone !== customer.phone ? trimmedPhone : undefined,
      notes:
        (notes.trim().length === 0 ? null : notes.trim()) !==
        (customer.notes ?? null)
          ? notes.trim().length === 0
            ? null
            : notes.trim()
          : undefined,
    });
    setSubmitting(false);
    if (!isOk(res)) {
      setError(res.error.message);
      return;
    }
    toast.success("Member diupdate");
    onUpdated(res.data);
    setEditing(false);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "Edit Member" : customer.name}
      description={editing ? "Edit informasi member" : `No HP ${customer.phone}`}
      size="lg"
      footer={
        editing ? (
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setEditing(false)}
              disabled={submitting}
            >
              Batal
            </Button>
            <Button onClick={onSave} disabled={submitting}>
              {submitting ? "Menyimpan..." : "Simpan"}
            </Button>
          </div>
        ) : (
          <div className="flex justify-between gap-2">
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil className="size-4" /> Edit
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Tutup
            </Button>
          </div>
        )
      }
    >
      {editing ? (
        <div className="space-y-4">
          <Input
            label="Nama"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            autoFocus
          />
          <Input
            label="Nomor HP"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            hint="Digit-only normalisasi otomatis"
          />
          <div>
            <label
              htmlFor="customer-notes"
              className="block text-xs font-medium text-neutral-700"
            >
              Catatan (opsional)
            </label>
            <textarea
              id="customer-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={500}
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-mahakan-green-700 focus:outline-none focus:ring-2 focus:ring-mahakan-green-700/20"
              placeholder="Preferensi minuman, alergi, catatan owner..."
            />
          </div>
          {error ? (
            <p className="text-sm text-danger-500" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <StatTile
              Icon={TrendingUp}
              label="Saldo Poin"
              value={customer.totalPoints.toLocaleString("id-ID")}
              accent="success"
            />
            <StatTile
              Icon={Wallet}
              label="Lifetime Spend"
              value={formatRupiah(customer.totalSpent)}
            />
          </div>

          <div className="space-y-2 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm">
            <Row Icon={Heart} label="Nama" value={customer.name} />
            <Row Icon={Phone} label="No HP" value={customer.phone} mono />
            <Row
              Icon={StickyNote}
              label="Catatan"
              value={
                customer.notes && customer.notes.trim().length > 0
                  ? customer.notes
                  : "—"
              }
              muted={!customer.notes}
            />
          </div>

          <div className="flex flex-col gap-1 text-xs text-neutral-500">
            <p>
              Bergabung{" "}
              {new Date(customer.createdAt).toLocaleDateString("id-ID", {
                day: "2-digit",
                month: "long",
                year: "numeric",
              })}
            </p>
            <p>
              Diupdate{" "}
              {new Date(customer.updatedAt).toLocaleDateString("id-ID", {
                day: "2-digit",
                month: "long",
                year: "numeric",
              })}
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
}

function StatTile({
  Icon,
  label,
  value,
  accent,
}: {
  Icon: typeof Heart;
  label: string;
  value: string;
  accent?: "success";
}) {
  return (
    <div className="rounded-md border border-neutral-200 bg-white p-3">
      <div className="flex items-center gap-2 text-xs text-neutral-500">
        <Icon className="size-4" aria-hidden />
        {label}
      </div>
      <p
        className={`mt-1 font-mono text-xl font-bold ${
          accent === "success" ? "text-mahakan-green-900" : "text-neutral-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function Row({
  Icon,
  label,
  value,
  mono,
  muted,
}: {
  Icon: typeof Heart;
  label: string;
  value: string;
  mono?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-neutral-400" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-xs uppercase tracking-wide text-neutral-500">
          {label}
        </p>
        <p
          className={`break-words ${mono ? "font-mono" : ""} ${
            muted ? "text-neutral-400" : "text-neutral-900"
          }`}
        >
          {value}
        </p>
      </div>
    </div>
  );
}

