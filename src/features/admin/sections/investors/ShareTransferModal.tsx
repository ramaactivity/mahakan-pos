"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  Button,
  Combobox,
  Input,
  Modal,
  toast,
} from "@/components/ui";
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
  const [sharePctDelta, setSharePctDelta] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setFromId(null);
    setToId(null);
    setSharePctDelta("");
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
  const delta = Number(sharePctDelta) || 0;
  const fromCurrent = fromInvestor ? Number(fromInvestor.sharePct) : 0;
  const toCurrent = toInvestor ? Number(toInvestor.sharePct) : 0;
  const fromAfter = fromCurrent - delta;
  const toAfter = toCurrent + delta;

  const validation = useMemo(() => {
    if (!fromId) return { ok: false, message: "Pilih investor sumber" };
    if (!toId) return { ok: false, message: "Pilih investor target" };
    if (fromId === toId)
      return { ok: false, message: "Source dan target sama" };
    if (delta <= 0)
      return { ok: false, message: "Delta harus > 0" };
    if (delta > 100) return { ok: false, message: "Delta max 100%" };
    if (fromCurrent < delta)
      return {
        ok: false,
        message: `${fromInvestor?.fullName} hanya punya ${fromCurrent.toFixed(4)}% share`,
      };
    return { ok: true, message: "" };
  }, [fromId, toId, delta, fromCurrent, fromInvestor]);

  async function handleSubmit() {
    if (submitting || !validation.ok || !fromId || !toId) return;
    if (
      !confirm(
        `P2P transfer ${delta}% dari ${fromInvestor?.fullName} ke ${toInvestor?.fullName}?\n\nAfter:\n${fromInvestor?.fullName}: ${fromCurrent.toFixed(4)}% → ${fromAfter.toFixed(4)}%\n${toInvestor?.fullName}: ${toCurrent.toFixed(4)}% → ${toAfter.toFixed(4)}%\n\nTidak ada jurnal (transaksi internal antar pribadi).`,
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
      `Transfer ${delta}% share dari ${fromInvestor?.fullName} ke ${toInvestor?.fullName}`,
    );
    onSaved();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="P2P Share Transfer"
      description="Pindah share antar investor. Tidak ada jurnal (transaksi internal antar pribadi)."
      size="lg"
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
                        hint: `${Number(i.sharePct).toFixed(4)}%`,
                      })),
                    },
                  ]}
                  value={fromId}
                  onChange={setFromId}
                />
                {fromInvestor ? (
                  <p className="mt-1 text-[11px] text-neutral-600">
                    Share saat ini: {fromCurrent.toFixed(4)}%
                  </p>
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
                          hint: `${Number(i.sharePct).toFixed(4)}%`,
                        })),
                    },
                  ]}
                  value={toId}
                  onChange={setToId}
                />
                {toInvestor ? (
                  <p className="mt-1 text-[11px] text-neutral-600">
                    Share saat ini: {toCurrent.toFixed(4)}%
                  </p>
                ) : null}
              </div>
            </div>

            <Input
              label="Delta Share % (yang dipindah)"
              type="number"
              value={sharePctDelta}
              onChange={(e) => setSharePctDelta(e.target.value)}
              placeholder="5"
              step={0.0001}
              min={0}
              max={100}
            />

            {validation.ok && delta > 0 ? (
              <div className="rounded-md border border-mahakan-green-200 bg-mahakan-green-50/40 p-3 text-xs">
                <p className="mb-2 font-semibold text-mahakan-green-900">
                  Preview After Transfer:
                </p>
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span>{fromInvestor?.fullName}</span>
                    <span className="font-mono">
                      {fromCurrent.toFixed(4)}% →{" "}
                      <strong className="text-danger-600">
                        {fromAfter.toFixed(4)}%
                      </strong>
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>{toInvestor?.fullName}</span>
                    <span className="font-mono">
                      {toCurrent.toFixed(4)}% →{" "}
                      <strong className="text-success-600">
                        {toAfter.toFixed(4)}%
                      </strong>
                    </span>
                  </div>
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
