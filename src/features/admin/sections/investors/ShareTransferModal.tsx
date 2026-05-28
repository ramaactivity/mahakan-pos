"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  Button,
  Combobox,
  Input,
  Modal,
  NumericInput,
  toast,
} from "@/components/ui";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  isOk,
  listInvestors,
  type InvestorWithStats,
  isOk as investorsIsOk,
} from "@/features/investors";
import {
  transferShareP2P,
  isOk as shareIsOk,
} from "@/features/share-transactions";

/**
 * Sesi AE-80 — P2P share transfer modal.
 *
 * Internal swap antar investor (uang antar pribadi, di luar buku).
 * NO journal. Validasi: from.share_pct ≥ delta, post-op sum tetap 100%.
 */

interface ShareTransferModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function ShareTransferModal({
  open,
  onClose,
  onSaved,
}: ShareTransferModalProps) {
  const [investors, setInvestors] = useState<InvestorWithStats[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  /* Sesi AE-160e — Sekal feedback: deal antar pribadi pakai NOMINAL, bukan
   * persen. Default input mode = "nominal". Toggle "persen" untuk power user
   * yang punya target % spesifik. */
  const [inputMode, setInputMode] = useState<"nominal" | "percent">("nominal");
  const [nominalIdrInput, setNominalIdrInput] = useState("");
  const [sharePctInput, setSharePctInput] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setFromId(null);
    setToId(null);
    setInputMode("nominal");
    setNominalIdrInput("");
    setSharePctInput("");
    setDescription("");
    setSubmitting(false);
    setLoadingList(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    let cancelled = false;
    void listInvestors({ status: "active", pageSize: 200 }).then((res) => {
      if (cancelled) return;
      if (investorsIsOk(res)) setInvestors(res.data.items);
      setLoadingList(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const fromInvestor = investors.find((i) => i.id === fromId) ?? null;
  const toInvestor = investors.find((i) => i.id === toId) ?? null;
  const fromCurrent = fromInvestor ? Number(fromInvestor.sharePct) : 0;
  const toCurrent = toInvestor ? Number(toInvestor.sharePct) : 0;

  /* Sesi AE-160d — Estimasi nilai nominal saham. Pakai total modal pool
   * aktif sebagai basis valuasi. P2P transfer tidak mengubah modalDisetor —
   * itu historical setoran. Tapi "nilai 1% saham" ≈ totalPool / 100 untuk
   * konteks ekuivalen. */
  const totalModalPool = useMemo(
    () => investors.reduce((s, i) => s + Number(i.modalDisetor ?? 0), 0),
    [investors],
  );
  const valuePerPct = totalModalPool / 100;
  const poolReady = valuePerPct > 0;

  /* Derive delta % (canonical untuk submit) berdasar input mode aktif.
   * - Nominal mode: pct = idr / valuePerPct (rounded ke 4 desimal sesuai
   *   precision kolom sharePctDelta numeric(7,4))
   * - Percent mode: pct = sharePctInput langsung */
  const delta = useMemo(() => {
    if (inputMode === "nominal") {
      const n = Number(nominalIdrInput) || 0;
      if (!poolReady || n <= 0) return 0;
      const raw = n / valuePerPct;
      return Math.round(raw * 10000) / 10000;
    }
    return Number(sharePctInput) || 0;
  }, [inputMode, nominalIdrInput, sharePctInput, valuePerPct, poolReady]);

  const deltaValue = delta * valuePerPct;
  const fromAfter = fromCurrent - delta;
  const toAfter = toCurrent + delta;

  const validation = useMemo(() => {
    if (!fromId) return { ok: false, message: "Pilih investor sumber" };
    if (!toId) return { ok: false, message: "Pilih investor target" };
    if (fromId === toId)
      return { ok: false, message: "Source dan target sama" };
    if (delta <= 0) {
      return {
        ok: false,
        message:
          inputMode === "nominal"
            ? "Nominal transfer harus > 0"
            : "Delta share harus > 0",
      };
    }
    if (delta > 100) return { ok: false, message: "Delta max 100% share" };
    if (fromCurrent < delta) {
      const maxNominal = fromCurrent * valuePerPct;
      return {
        ok: false,
        message:
          inputMode === "nominal" && poolReady
            ? `${fromInvestor?.fullName} maks ${formatRupiah(maxNominal)} (${fromCurrent.toFixed(4)}% share)`
            : `${fromInvestor?.fullName} hanya punya ${fromCurrent.toFixed(4)}% share`,
      };
    }
    return { ok: true, message: "" };
  }, [
    fromId,
    toId,
    delta,
    fromCurrent,
    fromInvestor,
    inputMode,
    poolReady,
    valuePerPct,
  ]);

  async function handleSubmit() {
    if (submitting || !validation.ok || !fromId || !toId) return;
    const headline =
      inputMode === "nominal" && poolReady
        ? `${formatRupiah(Number(nominalIdrInput) || 0)} (${delta.toFixed(4)}% share)`
        : `${delta.toFixed(4)}% share`;
    if (
      !confirm(
        `P2P transfer ${headline} dari ${fromInvestor?.fullName} ke ${toInvestor?.fullName}?\n\nAfter:\n${fromInvestor?.fullName}: ${fromCurrent.toFixed(4)}% → ${fromAfter.toFixed(4)}%\n${toInvestor?.fullName}: ${toCurrent.toFixed(4)}% → ${toAfter.toFixed(4)}%\n\nTidak ada jurnal (transaksi internal antar pribadi).`,
      )
    ) {
      return;
    }
    setSubmitting(true);
    const res = await transferShareP2P({
      fromInvestorId: fromId,
      toInvestorId: toId,
      sharePctDelta: delta,
      description: description.trim() || null,
    });
    setSubmitting(false);
    if (!shareIsOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(
      `Transfer ${headline} dari ${fromInvestor?.fullName} ke ${toInvestor?.fullName}`,
    );
    onSaved();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="P2P Share Transfer"
      description="Pindah share antar investor. Tidak ada jurnal (transaksi internal antar pribadi)."
      size="2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button
            onClick={handleSubmit}
            loading={submitting}
            disabled={!validation.ok}
          >
            Transfer
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {loadingList ? (
          <div className="flex items-center gap-2 text-sm text-neutral-500">
            <Loader2 className="size-4 animate-spin" /> Memuat investor…
          </div>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-neutral-900">
                  Dari Investor
                </label>
                <Combobox
                  placeholder="Pilih sumber…"
                  searchPlaceholder="Cari investor…"
                  clearable={false}
                  groups={[
                    {
                      label: "",
                      options: investors.map((i) => ({
                        value: i.id,
                        label: i.fullName,
                        hint: `${Number(i.sharePct).toFixed(4)}% · ${formatRupiah(Number(i.modalDisetor ?? 0))}`,
                      })),
                    },
                  ]}
                  value={fromId}
                  onChange={setFromId}
                />
                {fromInvestor ? (
                  <div className="mt-1 space-y-0.5 text-[11px] text-neutral-600">
                    <p>
                      Share saat ini:{" "}
                      <strong>{fromCurrent.toFixed(4)}%</strong>
                      {totalModalPool > 0 ? (
                        <span className="text-neutral-500">
                          {" "}
                          ≈ {formatRupiah(fromCurrent * valuePerPct)}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-neutral-500">
                      Modal disetor historis:{" "}
                      {formatRupiah(Number(fromInvestor.modalDisetor ?? 0))}
                    </p>
                  </div>
                ) : null}
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-900">
                  Ke Investor
                </label>
                <Combobox
                  placeholder="Pilih target…"
                  searchPlaceholder="Cari investor…"
                  clearable={false}
                  groups={[
                    {
                      label: "",
                      options: investors
                        .filter((i) => i.id !== fromId)
                        .map((i) => ({
                          value: i.id,
                          label: i.fullName,
                          hint: `${Number(i.sharePct).toFixed(4)}% · ${formatRupiah(Number(i.modalDisetor ?? 0))}`,
                        })),
                    },
                  ]}
                  value={toId}
                  onChange={setToId}
                />
                {toInvestor ? (
                  <div className="mt-1 space-y-0.5 text-[11px] text-neutral-600">
                    <p>
                      Share saat ini:{" "}
                      <strong>{toCurrent.toFixed(4)}%</strong>
                      {totalModalPool > 0 ? (
                        <span className="text-neutral-500">
                          {" "}
                          ≈ {formatRupiah(toCurrent * valuePerPct)}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-neutral-500">
                      Modal disetor historis:{" "}
                      {formatRupiah(Number(toInvestor.modalDisetor ?? 0))}
                    </p>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="space-y-2">
              {/* Toggle mode: nominal (default, default karena deal personal
                  biasanya pakai Rp) atau persen (alternatif kalau punya
                  target % spesifik). */}
              <div className="flex items-center gap-2 text-xs">
                <span className="text-neutral-600">Input pakai:</span>
                <div className="inline-flex overflow-hidden rounded-md border border-neutral-300">
                  <button
                    type="button"
                    onClick={() => setInputMode("nominal")}
                    disabled={!poolReady}
                    className={cn(
                      "px-3 py-1 text-xs font-medium transition-colors",
                      inputMode === "nominal"
                        ? "bg-mahakan-green-700 text-white"
                        : "bg-white text-neutral-700 hover:bg-neutral-100",
                      !poolReady &&
                        "cursor-not-allowed opacity-50 hover:bg-white",
                    )}
                    title={
                      poolReady
                        ? undefined
                        : "Total modal pool 0 — tidak bisa konversi nominal. Pakai persen."
                    }
                  >
                    Nominal (Rp)
                  </button>
                  <button
                    type="button"
                    onClick={() => setInputMode("percent")}
                    className={cn(
                      "px-3 py-1 text-xs font-medium transition-colors",
                      inputMode === "percent"
                        ? "bg-mahakan-green-700 text-white"
                        : "bg-white text-neutral-700 hover:bg-neutral-100",
                    )}
                  >
                    Persen (%)
                  </button>
                </div>
              </div>

              {inputMode === "nominal" ? (
                <div>
                  <NumericInput
                    label="Nominal Transfer (Rp)"
                    value={nominalIdrInput}
                    onChange={setNominalIdrInput}
                    placeholder="5.000.000"
                    prefix="Rp"
                  />
                  {delta > 0 ? (
                    <p className="mt-1 text-[11px] text-neutral-600">
                      Setara: <strong>{delta.toFixed(4)}%</strong> share{" "}
                      <span className="text-neutral-500">
                        (basis: total modal pool{" "}
                        {formatRupiah(totalModalPool)})
                      </span>
                    </p>
                  ) : (
                    <p className="mt-1 text-[11px] text-neutral-500">
                      Total modal pool: {formatRupiah(totalModalPool)} ·{" "}
                      Rp 1.000.000 ≈{" "}
                      {poolReady
                        ? (1_000_000 / valuePerPct).toFixed(4)
                        : "—"}
                      % share
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <Input
                    label="Delta Share % (yang dipindah)"
                    type="number"
                    value={sharePctInput}
                    onChange={(e) => setSharePctInput(e.target.value)}
                    placeholder="5"
                    step={0.0001}
                    min={0}
                    max={100}
                  />
                  {delta > 0 && poolReady ? (
                    <p className="mt-1 text-[11px] text-neutral-600">
                      Setara: <strong>{formatRupiah(deltaValue)}</strong>{" "}
                      <span className="text-neutral-500">
                        (basis: total modal pool{" "}
                        {formatRupiah(totalModalPool)})
                      </span>
                    </p>
                  ) : null}
                </div>
              )}
            </div>

            {validation.ok && delta > 0 ? (
              <div className="rounded-lg border border-mahakan-green-200 bg-mahakan-green-50/40 p-4 text-xs">
                <p className="mb-3 text-sm font-semibold text-mahakan-green-900">
                  Preview Setelah Transfer
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-[10px] uppercase tracking-wider text-neutral-500">
                      <tr>
                        <th className="pb-1 text-left font-medium">
                          Investor
                        </th>
                        <th className="pb-1 text-right font-medium">
                          Share %
                        </th>
                        {poolReady ? (
                          <th className="pb-1 text-right font-medium">
                            Nilai Nominal
                          </th>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-mahakan-green-100/50">
                      <tr>
                        <td className="py-2 pr-3 align-top font-medium text-neutral-900">
                          {fromInvestor?.fullName}
                          <div className="text-[10px] font-normal text-danger-600">
                            ↓ kurang {delta.toFixed(4)}%
                          </div>
                        </td>
                        <td className="py-2 text-right font-mono">
                          <div className="text-neutral-500">
                            {fromCurrent.toFixed(4)}%
                          </div>
                          <div className="text-sm font-bold text-danger-600">
                            {fromAfter.toFixed(4)}%
                          </div>
                        </td>
                        {poolReady ? (
                          <td className="py-2 pl-3 text-right font-mono">
                            <div className="text-neutral-500">
                              {formatRupiah(fromCurrent * valuePerPct)}
                            </div>
                            <div className="text-sm font-bold text-danger-600">
                              {formatRupiah(fromAfter * valuePerPct)}
                            </div>
                          </td>
                        ) : null}
                      </tr>
                      <tr>
                        <td className="py-2 pr-3 align-top font-medium text-neutral-900">
                          {toInvestor?.fullName}
                          <div className="text-[10px] font-normal text-success-600">
                            ↑ tambah {delta.toFixed(4)}%
                          </div>
                        </td>
                        <td className="py-2 text-right font-mono">
                          <div className="text-neutral-500">
                            {toCurrent.toFixed(4)}%
                          </div>
                          <div className="text-sm font-bold text-success-600">
                            {toAfter.toFixed(4)}%
                          </div>
                        </td>
                        {poolReady ? (
                          <td className="py-2 pl-3 text-right font-mono">
                            <div className="text-neutral-500">
                              {formatRupiah(toCurrent * valuePerPct)}
                            </div>
                            <div className="text-sm font-bold text-success-600">
                              {formatRupiah(toAfter * valuePerPct)}
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            <Input
              label="Catatan (opsional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
            />

            {!validation.ok && (fromId || toId) ? (
              <div className="flex items-start gap-2 rounded-md border border-warning-300 bg-warning-50 p-2 text-xs text-warning-700">
                <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                <span>{validation.message}</span>
              </div>
            ) : null}
          </>
        )}
      </div>
    </Modal>
  );
}

/* Suppress unused-import warning. */
void isOk;
