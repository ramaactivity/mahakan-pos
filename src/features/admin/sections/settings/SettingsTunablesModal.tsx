"use client";

import { useEffect, useState } from "react";
import { Button, Input, Modal, toast } from "@/components/ui";
import {
  isOk,
  updateApproval,
  updateFeatures,
  updateReceiptSettings,
  updateThresholds,
  type Outlet,
} from "@/features/outlets";
import { formatRupiah, parseRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  outlet: Outlet;
  onClose: () => void;
  onSaved: (next: Outlet) => void;
}

/**
 * Combined modal for Receipt + Thresholds + Features. Bundled because the
 * fields are short and Owner usually edits these together.
 */
export function SettingsTunablesModal({ open, outlet, onClose, onSaved }: Props) {
  const initial = {
    footerText: outlet.settings?.receipt?.footerText ?? "Terima kasih, sampai jumpa!",
    showQrRating: outlet.settings?.receipt?.showQrRating ?? false,
    variance: outlet.settings?.thresholds?.shiftVarianceAlert ?? 10_000,
    showHpp: outlet.settings?.features?.showHppToStaff ?? false,
    voidMode: outlet.settings?.approval?.voidMode === "code" ? "code" : "pin",
    refundMode: outlet.settings?.approval?.refundMode === "code" ? "code" : "pin",
    notifyEmail: outlet.settings?.approval?.notifyEmail ?? "",
  } as const;
  const [footer, setFooter] = useState(initial.footerText);
  const [showQr, setShowQr] = useState(initial.showQrRating);
  const [variance, setVariance] = useState(String(initial.variance));
  const [showHpp, setShowHpp] = useState(initial.showHpp);
  const [voidCodeMode, setVoidCodeMode] = useState(initial.voidMode === "code");
  const [refundCodeMode, setRefundCodeMode] = useState(
    initial.refundMode === "code",
  );
  const [notifyEmail, setNotifyEmail] = useState(initial.notifyEmail);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setFooter(initial.footerText);
    setShowQr(initial.showQrRating);
    setVariance(String(initial.variance));
    setShowHpp(initial.showHpp);
    setVoidCodeMode(initial.voidMode === "code");
    setRefundCodeMode(initial.refundMode === "code");
    setNotifyEmail(initial.notifyEmail);
    setError(null);
    setSubmitting(false);
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, outlet]);

  let parsedVariance = 0;
  try {
    parsedVariance = parseRupiah(variance);
  } catch {
    parsedVariance = -1;
  }

  async function onSubmit() {
    if (submitting) return;
    if (parsedVariance < 0) {
      setError("Threshold harus angka non-negatif");
      return;
    }
    if (footer.length > 200) {
      setError("Footer struk maks 200 karakter");
      return;
    }
    setSubmitting(true);
    setError(null);

    // Three independent calls — Owner sees one combined modal but each section
    // has its own permission and audit entry.
    let last: Outlet | null = null;

    if (
      footer.trim() !== initial.footerText ||
      showQr !== initial.showQrRating
    ) {
      const r1 = await updateReceiptSettings({
        footerText: footer.trim(),
        showQrRating: showQr,
      });
      if (!isOk(r1)) {
        setError(r1.error.message);
        setSubmitting(false);
        return;
      }
      last = r1.data;
    }
    if (parsedVariance !== initial.variance) {
      const r2 = await updateThresholds({ shiftVarianceAlert: parsedVariance });
      if (!isOk(r2)) {
        setError(r2.error.message);
        setSubmitting(false);
        return;
      }
      last = r2.data;
    }
    if (showHpp !== initial.showHpp) {
      const r3 = await updateFeatures({ showHppToStaff: showHpp });
      if (!isOk(r3)) {
        setError(r3.error.message);
        setSubmitting(false);
        return;
      }
      last = r3.data;
    }

    const wantVoidMode = voidCodeMode ? "code" : "pin";
    const wantRefundMode = refundCodeMode ? "code" : "pin";
    const wantNotifyEmail = notifyEmail.trim();
    if (
      wantVoidMode !== initial.voidMode ||
      wantRefundMode !== initial.refundMode ||
      wantNotifyEmail !== initial.notifyEmail
    ) {
      const r4 = await updateApproval({
        voidMode: wantVoidMode,
        refundMode: wantRefundMode,
        notifyEmail: wantNotifyEmail || undefined,
      });
      if (!isOk(r4)) {
        setError(r4.error.message);
        setSubmitting(false);
        return;
      }
      last = r4.data;
    }

    if (last) {
      toast.success("Settings tersimpan");
      onSaved(last);
    } else {
      onClose();
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Receipt, Threshold & Feature Flags"
      size="lg"
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
      <div className="space-y-5">
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-mahakan-green-900">
            Struk
          </h3>
          <div className="space-y-3">
            <Input
              label="Footer struk"
              value={footer}
              onChange={(e) => setFooter(e.target.value)}
              maxLength={200}
              placeholder="Terima kasih, sampai jumpa!"
              hint="Tampil di akhir struk thermal."
            />
            <ToggleRow
              label="Tampilkan QR rating di struk"
              hint="Phase 2: tautan ke form rating customer."
              checked={showQr}
              onChange={setShowQr}
            />
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-mahakan-green-900">
            Threshold
          </h3>
          <Input
            label="Alert variance shift (Rp)"
            type="text"
            inputMode="numeric"
            value={variance}
            onChange={(e) => setVariance(e.target.value.replace(/[^\d]/g, ""))}
            hint={
              parsedVariance >= 0
                ? `Selisih kas > ${formatRupiah(parsedVariance)} = warning di shift report.`
                : "Angka non-negatif"
            }
          />
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-mahakan-green-900">
            Feature Flags
          </h3>
          <ToggleRow
            label="HPP terlihat ke Staff"
            hint="Default off. Aktifkan kalau staff perlu lihat margin per item."
            checked={showHpp}
            onChange={setShowHpp}
          />
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-mahakan-green-900">
            Approval Void / Refund
          </h3>
          <p className="mb-2 text-xs text-neutral-500">
            Mode <strong>PIN</strong>: Manager / Owner approve via PIN di tablet
            kasir (legacy). Mode <strong>Kode Email</strong>: kode 6-digit
            single-use dikirim ke email Owner, Owner forward via WA — fraud
            harder, butuh email connectivity.
          </p>
          <div className="space-y-2">
            <ToggleRow
              label="Void pakai Kode Email (Owner-only)"
              hint={
                voidCodeMode
                  ? "Aktif — kasir minta kode dari Owner via email."
                  : "PIN mode — Manager / Owner approve langsung di tablet."
              }
              checked={voidCodeMode}
              onChange={setVoidCodeMode}
            />
            <ToggleRow
              label="Refund pakai Kode Email (Owner-only)"
              hint={
                refundCodeMode
                  ? "Aktif — kasir minta kode dari Owner via email."
                  : "PIN mode — Manager / Owner approve langsung di tablet."
              }
              checked={refundCodeMode}
              onChange={setRefundCodeMode}
            />
            <Input
              label="Email override (opsional)"
              type="email"
              value={notifyEmail}
              onChange={(e) => setNotifyEmail(e.target.value)}
              placeholder="ex: approval@mahakancoffee.id"
              hint="Default: email Owner pertama yang aktif. Isi kalau approval mau dikirim ke email khusus."
            />
          </div>
        </section>

        {error ? (
          <p role="alert" className="text-sm font-medium text-danger-500">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border border-neutral-200 bg-white px-3 py-2.5">
      <div>
        <p className="text-sm font-medium text-neutral-900">{label}</p>
        {hint ? <p className="text-xs text-neutral-500">{hint}</p> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors",
          checked
            ? "border-mahakan-green-700 bg-mahakan-green-700"
            : "border-neutral-300 bg-neutral-200",
        )}
      >
        <span
          className={cn(
            "inline-block size-5 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-5" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}
