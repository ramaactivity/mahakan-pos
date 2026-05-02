"use client";

import { useEffect, useState } from "react";
import { BookOpen, Info, Plus, RotateCcw } from "lucide-react";
import { Badge, Button, Skeleton, toast } from "@/components/ui";
import {
  fetchJournalEntries,
  reverseJournalEntry,
} from "@/features/accounting/actions";
import type {
  JournalEntryStatus,
  JournalEntryWithLines,
} from "@/features/accounting/types";
import { hasPermission, type Role } from "@/lib/auth/rbac";
import { formatRupiah } from "@/lib/money";
import { JournalEntryModal } from "./JournalEntryModal";

const STATUS_LABEL: Record<JournalEntryStatus, string> = {
  draft: "Draft",
  posted: "Posted",
  reversed: "Reversed",
};

const STATUS_VARIANT: Record<
  JournalEntryStatus,
  "warning" | "success" | "neutral"
> = {
  draft: "warning",
  posted: "success",
  reversed: "neutral",
};

export function JournalView({ viewerRole }: { viewerRole: Role }) {
  const [rows, setRows] = useState<JournalEntryWithLines[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const canDraft = hasPermission(viewerRole, "accounting.journal.draft");
  const canPost = hasPermission(viewerRole, "accounting.journal.post");
  const canReverse = hasPermission(viewerRole, "accounting.journal.reverse");

  async function load() {
    setLoading(true);
    try {
      const res = await fetchJournalEntries({ limit: 50 });
      if (res.ok) setRows(res.data);
      else toast.error(res.error.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  async function onReverse(entry: JournalEntryWithLines) {
    const reason = prompt(
      `Alasan reverse ${entry.entryNumber}? (min 10 karakter)`,
    );
    if (!reason || reason.trim().length < 10) {
      if (reason !== null) toast.error("Alasan minimal 10 karakter");
      return;
    }
    const res = await reverseJournalEntry(entry.id, reason.trim());
    if (res.ok) {
      toast.success(`Entry ${entry.entryNumber} ter-reverse`);
      void load();
    } else {
      toast.error(res.error.message);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-neutral-700">
          Daftar entri jurnal (50 terakhir). Auto-jurnal aktif kalau Owner
          toggle flag di Settings.
        </p>
        {canDraft || canPost ? (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> Buat Entry Manual
          </Button>
        ) : null}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-neutral-200 bg-neutral-50 p-10 text-center">
          <BookOpen className="mx-auto size-10 text-neutral-300" aria-hidden />
          <h3 className="mt-3 text-sm font-medium text-neutral-700">
            Belum ada entri jurnal
          </h3>
          <p className="mt-1 text-xs text-neutral-500">
            Auto-jurnal aktif kalau Owner toggle flag di Settings → Auto-Journal
            Akuntansi. Atau Owner buat manual via tombol di atas.
          </p>
          <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-neutral-500">
            <Info className="size-3" /> Cutover &ldquo;Jurnal Pembukaan&rdquo;
            saldo per 31 Mei 2026 di-post via tombol di tab Periode.
          </p>
        </div>
      ) : (
        <RowList
          rows={rows}
          canReverse={canReverse}
          onReverse={onReverse}
        />
      )}

      {createOpen ? (
        <JournalEntryModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            void load();
          }}
          isOwner={viewerRole === "owner"}
        />
      ) : null}
    </div>
  );
}

function RowList({
  rows,
  canReverse,
  onReverse,
}: {
  rows: JournalEntryWithLines[];
  canReverse: boolean;
  onReverse: (e: JournalEntryWithLines) => void;
}) {
  return (
    <div className="space-y-2">
      {rows.map((entry) => {
        const totalDebit = entry.lines.reduce(
          (s, l) => s + Number(l.debit),
          0,
        );
        return (
          <details
            key={entry.id}
            className="group rounded-md border border-neutral-200 bg-white"
          >
            <summary className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-neutral-50">
              <span className="font-mono text-xs font-medium text-neutral-700">
                {entry.entryNumber}
              </span>
              <span className="text-xs text-neutral-500">
                {String(entry.entryDate)}
              </span>
              <span className="flex-1 truncate text-neutral-800">
                {entry.description}
              </span>
              <Badge variant={STATUS_VARIANT[entry.status]}>
                {STATUS_LABEL[entry.status]}
              </Badge>
              <span className="font-mono text-sm font-medium text-neutral-900">
                {formatRupiah(totalDebit)}
              </span>
              {canReverse && entry.status === "posted" ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    onReverse(entry);
                  }}
                  className="inline-flex items-center gap-1 rounded p-1 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-danger-500"
                  aria-label={`Reverse ${entry.entryNumber}`}
                  title="Reverse entry"
                >
                  <RotateCcw className="size-3.5" />
                </button>
              ) : null}
            </summary>
            <div className="border-t border-neutral-100 bg-neutral-50/50 px-3 py-2">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="text-neutral-500">
                    <th className="py-1 text-left">Akun</th>
                    <th className="py-1 text-right">Debit</th>
                    <th className="py-1 text-right">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {entry.lines.map((l) => (
                    <tr key={l.id} className="text-neutral-800">
                      <td className="py-1">
                        <span className="font-mono text-neutral-500">
                          {l.accountCode}
                        </span>{" "}
                        {l.accountName}
                        {l.description ? (
                          <span className="ml-2 text-neutral-500">
                            — {l.description}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-1 text-right font-mono">
                        {Number(l.debit) > 0 ? formatRupiah(Number(l.debit)) : "—"}
                      </td>
                      <td className="py-1 text-right font-mono">
                        {Number(l.credit) > 0
                          ? formatRupiah(Number(l.credit))
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        );
      })}
    </div>
  );
}
