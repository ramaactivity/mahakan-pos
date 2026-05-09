"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Landmark, Plus } from "lucide-react";
import { Combobox, type ComboboxGroup } from "@/components/ui";
import { listBankAccounts } from "./actions";
import { formatBankAccountDisplay, type BankAccount } from "./types";

interface Props {
  label?: string;
  value: string | null;
  onChange: (value: string | null, account: BankAccount | null) => void;
  /** Free-text fallback — when "Lainnya / ketik manual" picked, parent
   * shows a separate text input. Useful for legacy bank destinations
   * yang belum di-register. */
  allowFreeText?: boolean;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  onAddNew?: () => void;
}

const FREE_TEXT_VALUE = "__free_text__";

/**
 * Sesi AE-13 — dropdown selector untuk bank account master. Reuse
 * Combobox dengan groups: "Rekening Aktif" + (kalau allowFreeText)
 * "Manual" entry. Settings link via onAddNew callback (parent wires).
 *
 * Cache via TanStack Query supaya dropdown ga refetch tiap modal open.
 */
export function BankAccountSelect({
  label,
  value,
  onChange,
  allowFreeText = false,
  hint,
  required,
  disabled,
  onAddNew,
}: Props) {
  const accountsQuery = useQuery({
    queryKey: ["bank-accounts", "list", "active"],
    queryFn: async () => {
      const res = await listBankAccounts();
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    staleTime: 5 * 60 * 1000, // 5 menit — master data jarang berubah
  });

  const accounts = useMemo(
    () => accountsQuery.data ?? [],
    [accountsQuery.data],
  );

  const groups = useMemo<ComboboxGroup[]>(() => {
    const out: ComboboxGroup[] = [];
    if (accounts.length > 0) {
      out.push({
        label: "Rekening Terdaftar",
        options: accounts.map((b) => ({
          value: b.id,
          label: formatBankAccountDisplay(b),
          hint: b.notes ?? undefined,
          keywords: [b.bankName, b.accountName, b.accountNumber],
        })),
      });
    }
    if (allowFreeText) {
      out.push({
        label: "Lainnya",
        options: [
          {
            value: FREE_TEXT_VALUE,
            label: "Ketik manual (free-text)",
            hint: "Untuk rekening yang belum di-register",
          },
        ],
      });
    }
    return out;
  }, [accounts, allowFreeText]);

  function handleChange(v: string | null) {
    if (v === null) {
      onChange(null, null);
      return;
    }
    if (v === FREE_TEXT_VALUE) {
      onChange(FREE_TEXT_VALUE, null);
      return;
    }
    const acc = accounts.find((b) => b.id === v) ?? null;
    onChange(v, acc);
  }

  return (
    <div className="space-y-1">
      <Combobox
        label={label}
        placeholder={
          accountsQuery.isLoading
            ? "Memuat rekening…"
            : accounts.length === 0 && !allowFreeText
              ? "Belum ada rekening — daftar di Pengaturan"
              : "Pilih rekening tujuan"
        }
        searchPlaceholder="Cari bank / nama…"
        groups={groups}
        value={value}
        onChange={handleChange}
        clearable
        required={required}
        disabled={disabled || accountsQuery.isLoading}
        hint={hint}
      />
      {onAddNew ? (
        <button
          type="button"
          onClick={onAddNew}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-mahakan-green-700 hover:text-mahakan-green-900 hover:underline"
        >
          <Plus className="size-3" aria-hidden /> Tambah rekening baru
        </button>
      ) : null}
      {accounts.length === 0 && !accountsQuery.isLoading ? (
        <p className="text-[11px] text-warning-700">
          <Landmark className="mr-1 inline size-3" aria-hidden />
          Belum ada rekening. Owner perlu daftar dulu di{" "}
          <strong>Pengaturan → Rekening Bank</strong>.
        </p>
      ) : null}
    </div>
  );
}

export { FREE_TEXT_VALUE };
