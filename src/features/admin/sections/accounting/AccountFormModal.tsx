"use client";

import { useState } from "react";
import { Button, Input, Modal, Select, toast } from "@/components/ui";
import {
  createAccount,
  deactivateAccount,
  updateAccount,
} from "@/features/accounting/actions";
import type {
  AccountType,
  ChartOfAccount,
  NormalBalance,
} from "@/features/accounting/types";

const TYPE_OPTIONS = [
  { value: "asset", label: "Aset" },
  { value: "liability", label: "Kewajiban" },
  { value: "equity", label: "Ekuitas" },
  { value: "revenue", label: "Pendapatan" },
  { value: "cogs", label: "HPP" },
  { value: "expense", label: "Beban" },
];

const BALANCE_OPTIONS = [
  { value: "debit", label: "Debit" },
  { value: "credit", label: "Credit" },
];

interface CreateProps {
  mode: "create";
  onClose: () => void;
  onSaved: () => void;
}

interface EditProps {
  mode: "edit";
  account: ChartOfAccount;
  onClose: () => void;
  onSaved: () => void;
}

type Props = CreateProps | EditProps;

export function AccountFormModal(props: Props) {
  const editing = props.mode === "edit" ? props.account : null;
  const isSystem = editing?.isSystem ?? false;

  const [code, setCode] = useState(editing?.code ?? "");
  const [name, setName] = useState(editing?.name ?? "");
  const [type, setType] = useState<AccountType>(
    (editing?.type as AccountType) ?? "expense",
  );
  const [normalBalance, setNormalBalance] = useState<NormalBalance>(
    (editing?.normalBalance as NormalBalance) ?? "debit",
  );
  const [parentCode, setParentCode] = useState(editing?.parentCode ?? "");
  const [isContra, setIsContra] = useState(editing?.isContra ?? false);
  const [displayOrder, setDisplayOrder] = useState(
    String(editing?.displayOrder ?? 0),
  );
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [isActive, setIsActive] = useState(editing?.isActive ?? true);

  const [submitting, setSubmitting] = useState(false);

  async function onSubmit() {
    setSubmitting(true);
    try {
      if (props.mode === "create") {
        const res = await createAccount({
          code: code.trim(),
          name: name.trim(),
          type,
          normalBalance,
          parentCode: parentCode.trim() || null,
          isContra,
          displayOrder: Number(displayOrder) || 0,
          notes: notes.trim() || null,
        });
        if (res.ok) {
          toast.success(`Akun ${res.data.code} ditambahkan`);
          props.onSaved();
        } else {
          toast.error(res.error.message);
        }
      } else {
        const res = await updateAccount({
          id: props.account.id,
          ...(isSystem
            ? {}
            : {
                name: name.trim(),
                parentCode: parentCode.trim() || null,
                isActive,
              }),
          displayOrder: Number(displayOrder) || 0,
          notes: notes.trim() || null,
        });
        if (res.ok) {
          toast.success(`Akun ${res.data.code} diperbarui`);
          props.onSaved();
        } else {
          toast.error(res.error.message);
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function onDeactivate() {
    if (!editing) return;
    if (!confirm(`Nonaktifkan akun ${editing.code} ${editing.name}?`)) return;
    setSubmitting(true);
    try {
      const res = await deactivateAccount({ id: editing.id });
      if (res.ok) {
        toast.success("Akun dinonaktifkan");
        props.onSaved();
      } else {
        toast.error(res.error.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      onClose={props.onClose}
      title={
        props.mode === "create"
          ? "Tambah Akun"
          : `Edit Akun ${editing?.code ?? ""}`
      }
      description={
        isSystem
          ? "Akun sistem — hanya catatan + display order yang dapat diubah."
          : undefined
      }
      size="md"
      footer={
        <div className="flex items-center justify-between gap-2">
          {props.mode === "edit" && !isSystem && editing?.isActive ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onDeactivate}
              disabled={submitting}
            >
              Nonaktifkan
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={props.onClose}
              disabled={submitting}
            >
              Batal
            </Button>
            <Button
              size="sm"
              onClick={onSubmit}
              loading={submitting}
              disabled={submitting}
            >
              Simpan
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Kode Akun"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="1xxx–6xxx"
            maxLength={4}
            disabled={props.mode === "edit"}
            hint={props.mode === "edit" ? "Tidak dapat diubah" : "4 digit numerik"}
          />
          <Input
            label="Display Order"
            type="number"
            value={displayOrder}
            onChange={(e) => setDisplayOrder(e.target.value)}
            min={0}
            max={9999}
          />
        </div>

        <Input
          label="Nama Akun"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          required
          disabled={isSystem}
        />

        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Tipe"
            options={TYPE_OPTIONS}
            value={type}
            onValueChange={(v) => setType(v as AccountType)}
            disabled={props.mode === "edit"}
          />
          <Select
            label="Normal Balance"
            options={BALANCE_OPTIONS}
            value={normalBalance}
            onValueChange={(v) => setNormalBalance(v as NormalBalance)}
            disabled={props.mode === "edit"}
          />
        </div>

        <Input
          label="Parent Code (opsional)"
          value={parentCode}
          onChange={(e) => setParentCode(e.target.value)}
          placeholder="contoh: 1100"
          maxLength={4}
          hint="Untuk grouping di laporan; kosongkan kalau standalone"
          disabled={isSystem}
        />

        {props.mode === "create" ? (
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={isContra}
              onChange={(e) => setIsContra(e.target.checked)}
              className="size-4 rounded border-neutral-300"
            />
            Akun kontra (mis. Diskon Penjualan, Akumulasi Penyusutan — flip
            normal balance)
          </label>
        ) : null}

        {props.mode === "edit" && !isSystem ? (
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="size-4 rounded border-neutral-300"
            />
            Aktif
          </label>
        ) : null}

        <div>
          <label className="mb-1 block text-sm font-medium text-neutral-700">
            Catatan
          </label>
          <textarea
            value={notes ?? ""}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={500}
            rows={2}
            className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm focus:border-mahakan-green-700 focus:outline-none focus:ring-1 focus:ring-mahakan-green-700"
            placeholder="Optional — penjelasan kapan akun ini dipakai"
          />
        </div>
      </div>
    </Modal>
  );
}
