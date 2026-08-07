"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight } from "lucide-react";
import {
  Button,
  Combobox,
  DatePicker,
  Input,
  Modal,
  Select,
  Skeleton,
  toast,
} from "@/components/ui";
import { listInvestors } from "@/features/investors/actions";
import type { InvestorWithStats } from "@/features/investors/types";
import {
  convertInvestorToCreditor,
  isOk,
} from "@/features/creditors";
import { formatRupiah, parseRupiah } from "@/lib/format";
import { todayJakarta } from "@/lib/tz";

/**
 * Sesi AE-80 follow-up — Convert investor existing → kreditur.
 *
 * Flow:
 *  1. Owner pilih investor aktif dari Combobox.
 *  2. Preview: modal disetor, sharePct, dividend balance.
 *  3. Set pokok hutang (default = modalDisetor), bunga, period, tgl mulai,
 *     jatuh tempo opsional, alasan exit.
 *  4. Server: validate + lock + insert creditor + exit investor + post
 *     journal Dr 3101 / Cr 2150.
 *
 * Constraint UI: investor harus dividendBalance=0 + status=active +
 * modalDisetor > 0. Filtered & messaged via UI.
 */

interface ConvertInvestorToCreditorModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** Optional pre-selected investor (kalau dipanggil dari tombol di row). */
  initialInvestorId?: string | null;
}

const today = () => todayJakarta();

export function ConvertInvestorToCreditorModal({
  open,
  onClose,
  onSaved,
  initialInvestorId,
}: ConvertInvestorToCreditorModalProps) {
  const [investorId, setInvestorId] = useState<string | null>(null);
  const [principalText, setPrincipalText] = useState("");
  const [interestRatePct, setInterestRatePct] = useState("0");
  const [interestPeriod, setInterestPeriod] = useState<
    "monthly" | "yearly" | "flat"
  >("monthly");
  const [startDate, setStartDate] = useState(today());
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [exitReason, setExitReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const investorsQuery = useQuery({
    queryKey: ["admin", "investors", "for-convert"],
    queryFn: async () => {
      const res = await listInvestors({ status: "active", pageSize: 200 });
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data.items;
    },
    enabled: open,
    staleTime: 30 * 1000,
  });

  const investors = investorsQuery.data ?? [];
  const selected: InvestorWithStats | undefined = useMemo(
    () => investors.find((i) => i.id === investorId),
    [investors, investorId],
  );

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setInvestorId(initialInvestorId ?? null);
    setPrincipalText("");
    setInterestRatePct("0");
    setInterestPeriod("monthly");
    setStartDate(today());
    setDueDate("");
    setNotes("");
    setExitReason("");
    setSubmitting(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, initialInvestorId]);

  /* Saat investor di-pick, default principal = modalDisetor. */
  useEffect(() => {
    if (!selected) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setPrincipalText(String(selected.modalDisetor));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [selected?.id, selected?.modalDisetor]);

  const parsedPrincipal = useMemo(() => {
    try {
      return parseRupiah(principalText);
    } catch {
      return 0;
    }
  }, [principalText]);

  const investorOptions = useMemo(
    () =>
      investors
        .filter((i) => i.modalDisetor > 0)
        .map((i) => {
          const disabled = i.dividendBalance > 0;
          return {
            value: i.id,
            label: i.fullName,
            hint: disabled
              ? `⚠ saldo dividen Rp ${i.dividendBalance.toLocaleString("id-ID")} — tarik dulu`
              : `Modal ${formatRupiah(i.modalDisetor)} · Share ${Number(i.sharePct ?? 0).toFixed(2)}%`,
            disabled,
          };
        }),
    [investors],
  );

  const canSubmit =
    !!selected &&
    parsedPrincipal > 0 &&
    parsedPrincipal <= (selected?.modalDisetor ?? 0) &&
    exitReason.trim().length >= 5 &&
    (selected?.dividendBalance ?? 0) === 0;

  const overPrincipal =
    !!selected && parsedPrincipal > (selected?.modalDisetor ?? 0);

  async function handleSubmit() {
    if (submitting || !selected) return;
    if (parsedPrincipal <= 0) {
      toast.error("Pokok hutang harus > 0");
      return;
    }
    if (parsedPrincipal > selected.modalDisetor) {
      toast.error(
        `Pokok > modal Rp ${selected.modalDisetor.toLocaleString("id-ID")}`,
      );
      return;
    }
    if (exitReason.trim().length < 5) {
      toast.error("Alasan exit min 5 karakter");
      return;
    }
    if (
      !confirm(
        `Convert investor "${selected.fullName}" menjadi kreditur?\n\n` +
          `• Investor di-exit (status='exited', share 0%)\n` +
          `• Modal Rp ${selected.modalDisetor.toLocaleString("id-ID")} dipindah ke hutang kreditur Rp ${parsedPrincipal.toLocaleString("id-ID")}\n` +
          `• Share ${Number(selected.sharePct ?? 0).toFixed(2)}% → jadi treasury (masuk pengelola pool di distribusi berikutnya)\n` +
          `• Jurnal: Dr 3101 / Cr 2150 sebesar Rp ${parsedPrincipal.toLocaleString("id-ID")}\n\n` +
          `Aksi ini tidak bisa di-undo otomatis (perlu manual reverse).`,
      )
    ) {
      return;
    }
    setSubmitting(true);
    const res = await convertInvestorToCreditor({
      investorId: selected.id,
      principalOverride:
        parsedPrincipal === selected.modalDisetor ? undefined : parsedPrincipal,
      interestRatePct: Number(interestRatePct) || 0,
      interestPeriod,
      startDate,
      dueDate: dueDate || null,
      notes: notes.trim() || null,
      exitReason: exitReason.trim(),
    });
    setSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(
      `Investor "${selected.fullName}" di-convert jadi kreditur. Jurnal di-post.`,
    );
    onSaved();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Convert Investor → Kreditur"
      description="Re-classify modal investor existing menjadi hutang kreditur (equity → liability)."
      size="2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button
            onClick={handleSubmit}
            loading={submitting}
            disabled={!canSubmit}
          >
            Convert Sekarang
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {/* Investor picker */}
        {investorsQuery.isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          <Combobox
            label="Pilih Investor *"
            options={investorOptions}
            value={investorId}
            onChange={setInvestorId}
            placeholder="— pilih investor aktif —"
            searchPlaceholder="Cari nama..."
            emptyText="Tidak ada investor aktif dengan modal > 0"
            required
          />
        )}

        {/* Preview selected investor state */}
        {selected ? (
          <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <div>
                <p className="uppercase tracking-wide text-neutral-500">
                  Modal Disetor
                </p>
                <p className="font-mono font-semibold text-neutral-900">
                  {formatRupiah(selected.modalDisetor)}
                </p>
              </div>
              <div>
                <p className="uppercase tracking-wide text-neutral-500">
                  Share %
                </p>
                <p className="font-mono font-semibold text-neutral-900">
                  {Number(selected.sharePct ?? 0).toFixed(2)}%
                </p>
              </div>
              <div>
                <p className="uppercase tracking-wide text-neutral-500">
                  Saldo Dividen
                </p>
                <p
                  className={
                    selected.dividendBalance > 0
                      ? "font-mono font-semibold text-danger-700"
                      : "font-mono font-semibold text-mahakan-green-700"
                  }
                >
                  {formatRupiah(selected.dividendBalance)}
                </p>
              </div>
              <div>
                <p className="uppercase tracking-wide text-neutral-500">
                  Status
                </p>
                <p className="font-semibold text-neutral-900">
                  {selected.status}
                </p>
              </div>
            </div>
            {selected.dividendBalance > 0 ? (
              <div className="mt-2 flex items-start gap-2 rounded-md border border-danger-300 bg-danger-50 p-2 text-[11px] text-danger-700">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                <p>
                  Investor masih punya saldo dividen{" "}
                  <b>{formatRupiah(selected.dividendBalance)}</b>. Tarik dulu
                  via tab Saldo & Pencairan sebelum convert.
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="border-t border-neutral-200 pt-3" />

        {/* Pokok hutang */}
        <div className="grid gap-3 md:grid-cols-2">
          <Input
            label="Pokok Hutang Kreditur *"
            type="text"
            inputMode="numeric"
            value={principalText}
            onChange={(e) =>
              setPrincipalText(e.target.value.replace(/[^\d]/g, ""))
            }
            placeholder="default = modal disetor"
            hint={
              selected
                ? overPrincipal
                  ? `⚠ > modal Rp ${selected.modalDisetor.toLocaleString("id-ID")}`
                  : `≤ modal Rp ${selected.modalDisetor.toLocaleString("id-ID")}`
                : "Pilih investor dulu"
            }
            error={overPrincipal ? "Pokok > modal investor" : undefined}
            disabled={!selected}
            required
          />
          <Input
            label="Bunga (%)"
            type="number"
            value={interestRatePct}
            onChange={(e) => setInterestRatePct(e.target.value)}
            min={0}
            max={100}
            step={0.01}
            hint="Default 0 — owner bisa edit kalau ada agreement bunga"
          />
          <Select
            label="Period Bunga"
            options={[
              { value: "monthly", label: "Bulanan" },
              { value: "yearly", label: "Tahunan" },
              { value: "flat", label: "Flat (sekali)" },
            ]}
            value={interestPeriod}
            onValueChange={(v) =>
              setInterestPeriod(v as "monthly" | "yearly" | "flat")
            }
          />
          <DatePicker
            label="Tanggal Mulai *"
            value={startDate}
            onChange={(v) => setStartDate(v ?? today())}
            clearable={false}
            required
          />
          <DatePicker
            label="Jatuh Tempo (opsional)"
            value={dueDate || null}
            onChange={(v) => setDueDate(v ?? "")}
            clearable
          />
        </div>

        <Input
          label="Alasan Exit *"
          value={exitReason}
          onChange={(e) => setExitReason(e.target.value)}
          placeholder="mis. negotiate jadi hutang berbunga, investor minta exit"
          maxLength={500}
          hint="Min 5 karakter — tercatat di audit log + investor.exitReason"
          required
        />

        <Input
          label="Catatan Kreditur (opsional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={1000}
        />

        {/* Journal preview */}
        {selected && parsedPrincipal > 0 && !overPrincipal ? (
          <div className="rounded-md border border-mahakan-green-300 bg-mahakan-green-50 p-3 text-xs">
            <p className="mb-2 flex items-center gap-2 font-semibold text-mahakan-green-700">
              <ArrowRight className="size-3" /> Preview Jurnal
            </p>
            <div className="space-y-0.5 font-mono text-[11px] text-neutral-800">
              <p>
                Dr 3101 Modal Owner ............{" "}
                {formatRupiah(parsedPrincipal)}
              </p>
              <p className="pl-4">
                Cr 2150 Hutang Kreditur ........{" "}
                {formatRupiah(parsedPrincipal)}
              </p>
            </div>
            <p className="mt-2 text-[10.5px] italic text-neutral-600">
              Re-classify equity (modal owner) ke liability (hutang kreditur).
              Tidak ada cash flow.
            </p>
          </div>
        ) : null}

        {selected && Number(selected.sharePct ?? 0) > 0 ? (
          <div className="flex items-start gap-2 rounded-md border border-warning-300 bg-warning-50 p-2 text-[11px] text-warning-800">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" />
            <p>
              Share <b>{Number(selected.sharePct ?? 0).toFixed(2)}%</b> dari{" "}
              {selected.fullName} akan jadi treasury (sisa) — masuk pengelola
              pool di compute distribusi berikutnya. Atau rebalance manual ke
              investor lain via Mutasi Saham sebelum convert kalau mau dijaga
              di kolam investor.
            </p>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
