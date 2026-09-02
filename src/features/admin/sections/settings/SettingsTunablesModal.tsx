"use client";

import { useEffect, useState } from "react";
import {
  Button,
  DatePicker,
  Input,
  Modal,
  Select,
  toast,
} from "@/components/ui";
import {
  isOk,
  updateApproval,
  updateAttendanceSettings,
  updateFeatures,
  updateReceiptSettings,
  updateThresholds,
  type Outlet,
} from "@/features/outlets";
import {
  DEFAULT_SHIFT_GATE_THRESHOLDS,
  parseShiftGateThresholds,
  updateShiftDayGate,
} from "@/features/shifts";
import { updateComplimentPin } from "@/features/approval-codes/compliment-pin";
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
/* Sesi AE-229 — tiga mode persetujuan void/refund. "pin_or_code" adalah
 * jawaban atas keluhan owner: antrean berhenti menunggu Owner membaca email,
 * dan kalau kodenya baru datang besok, void-nya ditolak karena shift-nya sudah
 * ditutup sehingga penjualan salah itu tidak pernah terkoreksi. */
const APPROVAL_MODE_OPTIONS = [
  { value: "pin_or_code", label: "PIN manager ATAU kode Owner (disarankan)" },
  { value: "pin", label: "PIN manager saja" },
  { value: "code", label: "Kode Owner lewat email saja" },
];

function normalizeApprovalMode(v: string | undefined): string {
  return v === "code" || v === "pin_or_code" ? v : "pin";
}

export function SettingsTunablesModal({ open, outlet, onClose, onSaved }: Props) {
  // Resolve initial recipient list — prefer notifyEmails array; fall back
  // to legacy single notifyEmail. Empty array = use first Owner default.
  const initialEmails = (() => {
    const arr = outlet.settings?.approval?.notifyEmails ?? null;
    if (arr && arr.length > 0) return arr.slice(0, 10);
    const legacy = outlet.settings?.approval?.notifyEmail;
    if (legacy && legacy.includes("@")) return [legacy];
    return [];
  })();

  // Phase 4 (sesi AB) — default GPS = Mahakan Coffee & Space (Cisarua).
  // Owner bisa override per outlet via UI di bawah.
  const DEFAULT_GPS = { lat: -6.6753234, lng: 106.9298715, radiusMeters: 50 };
  const existingGps = outlet.settings?.attendance?.gpsCenter;

  const initial = {
    footerText: outlet.settings?.receipt?.footerText ?? "Terima kasih, sampai jumpa!",
    showQrRating: outlet.settings?.receipt?.showQrRating ?? false,
    variance: outlet.settings?.thresholds?.shiftVarianceAlert ?? 10_000,
    /* Sesi AE-217 — ambang rem anti-lupa-tutup-shift. */
    gate: parseShiftGateThresholds(outlet.settings?.shift?.dayGate),
    showHpp: outlet.settings?.features?.showHppToStaff ?? false,
    accountingAutoJournal:
      outlet.settings?.features?.accounting_auto_journal ?? false,
    // Sesi AE-173 — ON (default) = stok dikurangi saat jual (perpetual);
    // OFF = mode periodic (stok hanya dari Opname).
    deductStockOnSale: outlet.settings?.features?.perpetualStockSales !== false,
    // Sesi AE-173 — ON (default) = pembelian menambah stok/WAC; OFF = pembelian
    // hanya catatan pengeluaran (stok hanya dari Opname).
    addStockOnPurchase:
      outlet.settings?.features?.perpetualStockPurchases !== false,
    /* Sesi AE-193 — tanggal mulai jurnal penjualan harian. "" = belum aktif. */
    dailyJournalSince: outlet.settings?.features?.dailyJournalSince ?? "",
    defaultMarkupPct: outlet.settings?.features?.defaultMarkupPct ?? 250,
    lateGraceMinutes: outlet.settings?.attendance?.lateGraceMinutes ?? 5,
    gpsLat: existingGps?.lat ?? DEFAULT_GPS.lat,
    gpsLng: existingGps?.lng ?? DEFAULT_GPS.lng,
    gpsRadius: existingGps?.radiusMeters ?? DEFAULT_GPS.radiusMeters,
    voidMode: normalizeApprovalMode(outlet.settings?.approval?.voidMode),
    refundMode: normalizeApprovalMode(outlet.settings?.approval?.refundMode),
    notifyEmails: initialEmails,
  } as const;
  const [footer, setFooter] = useState(initial.footerText);
  const [showQr, setShowQr] = useState(initial.showQrRating);
  const [variance, setVariance] = useState(String(initial.variance));
  const [gateRemindAt, setGateRemindAt] = useState(initial.gate.remindAt);
  const [gateSoftAt, setGateSoftAt] = useState(initial.gate.softLockAt);
  const [gateHardAt, setGateHardAt] = useState(initial.gate.hardLockAt);
  const [gateMaxSnoozes, setGateMaxSnoozes] = useState(
    String(initial.gate.maxSnoozes),
  );
  const [gateSnoozeMinutes, setGateSnoozeMinutes] = useState(
    String(initial.gate.snoozeMinutes),
  );
  const [showHpp, setShowHpp] = useState(initial.showHpp);
  const [accountingAutoJournal, setAccountingAutoJournal] = useState(
    initial.accountingAutoJournal,
  );
  const [deductStockOnSale, setDeductStockOnSale] = useState(
    initial.deductStockOnSale,
  );
  const [addStockOnPurchase, setAddStockOnPurchase] = useState(
    initial.addStockOnPurchase,
  );
  const [defaultMarkupPct, setDefaultMarkupPct] = useState(
    String(initial.defaultMarkupPct),
  );
  const [dailyJournalSince, setDailyJournalSince] = useState(
    initial.dailyJournalSince,
  );
  const [lateGraceMinutes, setLateGraceMinutes] = useState(
    String(initial.lateGraceMinutes),
  );
  const [gpsLat, setGpsLat] = useState(String(initial.gpsLat));
  const [gpsLng, setGpsLng] = useState(String(initial.gpsLng));
  const [gpsRadius, setGpsRadius] = useState(String(initial.gpsRadius));
  /* Sesi AE-229 — tiga mode, bukan lagi saklar on/off. */
  const [voidApprovalMode, setVoidApprovalMode] = useState<string>(
    initial.voidMode,
  );
  const [refundApprovalMode, setRefundApprovalMode] = useState<string>(
    initial.refundMode,
  );
  const [notifyEmails, setNotifyEmails] = useState<string[]>(initial.notifyEmails);
  const [pendingEmail, setPendingEmail] = useState("");
  /* Sesi AE-221 — PIN statis compliment. Kosong = tidak diubah; yang
   * tersimpan adalah hash, jadi tidak pernah bisa ditampilkan kembali. */
  const [complimentPin, setComplimentPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setFooter(initial.footerText);
    setShowQr(initial.showQrRating);
    setVariance(String(initial.variance));
    setGateRemindAt(initial.gate.remindAt);
    setGateSoftAt(initial.gate.softLockAt);
    setGateHardAt(initial.gate.hardLockAt);
    setGateMaxSnoozes(String(initial.gate.maxSnoozes));
    setGateSnoozeMinutes(String(initial.gate.snoozeMinutes));
    setShowHpp(initial.showHpp);
    setAccountingAutoJournal(initial.accountingAutoJournal);
    setDeductStockOnSale(initial.deductStockOnSale);
    setAddStockOnPurchase(initial.addStockOnPurchase);
    setDefaultMarkupPct(String(initial.defaultMarkupPct));
    setDailyJournalSince(initial.dailyJournalSince);
    setLateGraceMinutes(String(initial.lateGraceMinutes));
    setGpsLat(String(initial.gpsLat));
    setGpsLng(String(initial.gpsLng));
    setGpsRadius(String(initial.gpsRadius));
    setNotifyEmails(initial.notifyEmails);
    setPendingEmail("");
    setComplimentPin("");
    setError(null);
    setSubmitting(false);
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, outlet]);

  function addEmail() {
    const trimmed = pendingEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("Format email tidak valid");
      return;
    }
    if (notifyEmails.includes(trimmed)) {
      setError("Email sudah ada di daftar");
      return;
    }
    if (notifyEmails.length >= 10) {
      setError("Maksimal 10 email tujuan");
      return;
    }
    setNotifyEmails((prev) => [...prev, trimmed]);
    setPendingEmail("");
    setError(null);
  }

  function removeEmail(idx: number) {
    setNotifyEmails((prev) => prev.filter((_, i) => i !== idx));
  }

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
    if (accountingAutoJournal !== initial.accountingAutoJournal) {
      const r3a = await updateFeatures({
        accounting_auto_journal: accountingAutoJournal,
      });
      if (!isOk(r3a)) {
        setError(r3a.error.message);
        setSubmitting(false);
        return;
      }
      last = r3a.data;
    }
    if (deductStockOnSale !== initial.deductStockOnSale) {
      const r3s = await updateFeatures({
        perpetualStockSales: deductStockOnSale,
      });
      if (!isOk(r3s)) {
        setError(r3s.error.message);
        setSubmitting(false);
        return;
      }
      last = r3s.data;
    }
    if (addStockOnPurchase !== initial.addStockOnPurchase) {
      const r3p = await updateFeatures({
        perpetualStockPurchases: addStockOnPurchase,
      });
      if (!isOk(r3p)) {
        setError(r3p.error.message);
        setSubmitting(false);
        return;
      }
      last = r3p.data;
    }
    if (dailyJournalSince !== initial.dailyJournalSince) {
      const rDaily = await updateFeatures({
        dailyJournalSince: dailyJournalSince === "" ? null : dailyJournalSince,
      });
      if (!isOk(rDaily)) {
        setError(rDaily.error.message);
        setSubmitting(false);
        return;
      }
      last = rDaily.data;
    }
    const parsedMarkup = parseInt(defaultMarkupPct, 10);
    if (
      Number.isFinite(parsedMarkup) &&
      parsedMarkup !== initial.defaultMarkupPct
    ) {
      if (parsedMarkup < 0 || parsedMarkup > 500) {
        setError("Markup % harus 0-500");
        setSubmitting(false);
        return;
      }
      const r3b = await updateFeatures({ defaultMarkupPct: parsedMarkup });
      if (!isOk(r3b)) {
        setError(r3b.error.message);
        setSubmitting(false);
        return;
      }
      last = r3b.data;
    }

    // Phase 4 — attendance settings (lateGraceMinutes + GPS center)
    const parsedGrace = parseInt(lateGraceMinutes, 10);
    const parsedLat = parseFloat(gpsLat);
    const parsedLng = parseFloat(gpsLng);
    const parsedRadius = parseInt(gpsRadius, 10);
    const attendanceChanged =
      parsedGrace !== initial.lateGraceMinutes ||
      parsedLat !== initial.gpsLat ||
      parsedLng !== initial.gpsLng ||
      parsedRadius !== initial.gpsRadius;
    if (attendanceChanged) {
      if (
        !Number.isFinite(parsedGrace) ||
        parsedGrace < 0 ||
        parsedGrace > 60
      ) {
        setError("Late grace minutes harus 0-60");
        setSubmitting(false);
        return;
      }
      if (
        !Number.isFinite(parsedLat) ||
        !Number.isFinite(parsedLng) ||
        !Number.isFinite(parsedRadius)
      ) {
        setError("GPS coords / radius tidak valid");
        setSubmitting(false);
        return;
      }
      const r3c = await updateAttendanceSettings({
        lateGraceMinutes: parsedGrace,
        gpsCenter: {
          lat: parsedLat,
          lng: parsedLng,
          radiusMeters: parsedRadius,
        },
      });
      if (!isOk(r3c)) {
        setError(r3c.error.message);
        setSubmitting(false);
        return;
      }
      last = r3c.data;
    }

    const wantVoidMode = voidApprovalMode as "pin" | "code" | "pin_or_code";
    const wantRefundMode = refundApprovalMode as
      | "pin"
      | "code"
      | "pin_or_code";
    const emailsChanged =
      notifyEmails.length !== initial.notifyEmails.length ||
      notifyEmails.some((e, i) => e !== initial.notifyEmails[i]);
    if (
      wantVoidMode !== initial.voidMode ||
      wantRefundMode !== initial.refundMode ||
      emailsChanged
    ) {
      const r4 = await updateApproval({
        voidMode: wantVoidMode,
        refundMode: wantRefundMode,
        // Always send the array (even empty — treats as "use Owner default").
        // Drop legacy single notifyEmail by sending empty string (server
        // ignores undefined at the merge layer).
        notifyEmails,
        notifyEmail: "",
      });
      if (!isOk(r4)) {
        setError(r4.error.message);
        setSubmitting(false);
        return;
      }
      last = r4.data;
    }

    /* Sesi AE-217 — rem shift. Disimpan lewat action-nya sendiri supaya
     * validasi jam + jejak audit ikut jalan; server menolak format ngawur
     * dengan berisik, bukan diam-diam jatuh ke default. */
    const gateChanged =
      gateRemindAt !== initial.gate.remindAt ||
      gateSoftAt !== initial.gate.softLockAt ||
      gateHardAt !== initial.gate.hardLockAt ||
      Number(gateMaxSnoozes) !== initial.gate.maxSnoozes ||
      Number(gateSnoozeMinutes) !== initial.gate.snoozeMinutes;
    if (gateChanged) {
      const r5 = await updateShiftDayGate({
        remindAt: gateRemindAt,
        softLockAt: gateSoftAt,
        hardLockAt: gateHardAt,
        maxSnoozes: Number(gateMaxSnoozes),
        snoozeMinutes: Number(gateSnoozeMinutes),
      });
      if (!isOk(r5)) {
        setError(r5.error.message);
        setSubmitting(false);
        return;
      }
      /* updateShiftDayGate mengembalikan ambangnya, bukan baris outlet —
       * kalau tidak ada perubahan lain, tutup saja supaya parent memuat
       * ulang outlet dari sumbernya. */
      if (!last) {
        setSubmitting(false);
        toast.success("Settings tersimpan");
        onClose();
        return;
      }
    }

    /* Sesi AE-221 — PIN compliment disimpan lewat action-nya sendiri (hash
     * bcrypt + jejak audit). Dibiarkan kosong = PIN lama tetap berlaku. */
    if (complimentPin.trim()) {
      const rPin = await updateComplimentPin({ pin: complimentPin.trim() });
      if (!isOk(rPin)) {
        setError(rPin.error.message);
        setSubmitting(false);
        return;
      }
      setComplimentPin("");
      if (!last) {
        setSubmitting(false);
        toast.success("PIN compliment tersimpan");
        onClose();
        return;
      }
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
      size="3xl"
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

        {/* Sesi AE-217 — rem anti-lupa-tutup-shift. Ambangnya di settings,
          * bukan di kode, supaya owner bisa melonggarkan saat ada acara
          * sampai dini hari tanpa perlu deploy. */}
        <section>
          <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-mahakan-green-900">
            Rem Tutup Shift
          </h3>
          <p className="mb-3 text-xs leading-relaxed text-neutral-600">
            Kalau shift belum ditutup padahal hari sudah ganti, POS kasir
            diingatkan lalu dikunci sampai shift lama diselesaikan. Kosongkan
            jarak antara jam popup dan jam kunci kalau ingin langsung keras.
            Default: {DEFAULT_SHIFT_GATE_THRESHOLDS.remindAt} /{" "}
            {DEFAULT_SHIFT_GATE_THRESHOLDS.softLockAt} /{" "}
            {DEFAULT_SHIFT_GATE_THRESHOLDS.hardLockAt}.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Input
              label="Jam pengingat"
              type="text"
              inputMode="numeric"
              placeholder="23:30"
              value={gateRemindAt}
              onChange={(e) => setGateRemindAt(e.target.value)}
              hint="Toast halus, POS tetap jalan."
            />
            <Input
              label="Jam popup"
              type="text"
              inputMode="numeric"
              placeholder="00:00"
              value={gateSoftAt}
              onChange={(e) => setGateSoftAt(e.target.value)}
              hint="Menutupi layar, masih bisa ditunda."
            />
            <Input
              label="Jam kunci"
              type="text"
              inputMode="numeric"
              placeholder="01:00"
              value={gateHardAt}
              onChange={(e) => setGateHardAt(e.target.value)}
              hint="POS terkunci total."
            />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Input
              label="Jatah tunda (kali)"
              type="text"
              inputMode="numeric"
              value={gateMaxSnoozes}
              onChange={(e) =>
                setGateMaxSnoozes(e.target.value.replace(/[^\d]/g, ""))
              }
              hint="0 = tidak boleh menunda sama sekali."
            />
            <Input
              label="Lama satu tunda (menit)"
              type="text"
              inputMode="numeric"
              value={gateSnoozeMinutes}
              onChange={(e) =>
                setGateSnoozeMinutes(e.target.value.replace(/[^\d]/g, ""))
              }
              hint="1–120 menit."
            />
          </div>
        </section>

        {/* Sesi AE-221 — PIN statis compliment (menggantikan kode 6 digit). */}
        <section>
          <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-mahakan-green-900">
            PIN Compliment
          </h3>
          <p className="mb-3 text-xs leading-relaxed text-neutral-600">
            PIN yang diketik kasir untuk menggratiskan tagihan 100%. Karena
            dipegang bersama, jejaknya menunjukkan siapa yang{" "}
            <em>menjalankan</em>, bukan siapa yang menyetujui — ganti PIN-nya
            kalau ada staff yang keluar. Kosongkan kolom ini kalau tidak ingin
            mengubah; PIN lama tidak bisa ditampilkan lagi.
          </p>
          <Input
            label="PIN baru (4-6 digit)"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            value={complimentPin}
            onChange={(e) =>
              setComplimentPin(e.target.value.replace(/[^\d]/g, "").slice(0, 6))
            }
            placeholder="Biarkan kosong = tidak diubah"
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
          <ToggleRow
            label="Auto-Journal Akuntansi"
            hint={
              accountingAutoJournal
                ? "Aktif — POS sale, refund, payroll, setoran tunai, settlement aggregator, dan opname akan auto-journal ke buku besar. Pastikan sudah test 1 dummy trx + verify entry sebelum aktifkan permanent."
                : "Off — buku besar akuntansi belum ter-isi. Aktifkan setelah test sample transaction + verify journal entry benar di tab Akuntansi → Jurnal."
            }
            checked={accountingAutoJournal}
            onChange={setAccountingAutoJournal}
          />
          <ToggleRow
            label="Kurangi stok otomatis saat penjualan"
            hint={
              deductStockOnSale
                ? "Aktif (perpetual) — setiap penjualan mengurangi stok bahan otomatis dari resep."
                : "OFF (periodic) — penjualan TIDAK mengurangi stok. Stok hanya bergerak dari Opname. HPP menu diisi manual. Bisa dinyalakan lagi kapan saja."
            }
            checked={deductStockOnSale}
            onChange={setDeductStockOnSale}
          />
          <ToggleRow
            label="Tambah stok otomatis saat pembelian"
            hint={
              addStockOnPurchase
                ? "Aktif (perpetual) — setiap pembelian menambah stok bahan + update harga rata-rata (WAC)."
                : "OFF (periodic) — pembelian TIDAK menambah stok, hanya tercatat sebagai pengeluaran. Stok hanya dari Opname. Bisa dinyalakan lagi kapan saja."
            }
            checked={addStockOnPurchase}
            onChange={setAddStockOnPurchase}
          />
          <DatePicker
            label="Jurnal penjualan digabung per hari — mulai tanggal"
            value={dailyJournalSince === "" ? null : dailyJournalSince}
            onChange={(v) => setDailyJournalSince(v ?? "")}
            hint={
              dailyJournalSince === ""
                ? "Kosong = tiap transaksi POS punya jurnal sendiri (perilaku lama)."
                : `Sejak ${dailyJournalSince}, penjualan dirangkum jadi SATU jurnal per hari saat shift ditutup — jauh lebih ringan. Transaksi sebelum tanggal ini tidak diubah. Kosongkan untuk kembali ke jurnal per transaksi.`
            }
          />
          <Input
            label="Default Markup % (BOM-based pricing)"
            type="text"
            inputMode="numeric"
            value={defaultMarkupPct}
            onChange={(e) =>
              setDefaultMarkupPct(e.target.value.replace(/[^\d]/g, ""))
            }
            hint={
              "Markup% dipakai oleh BOM auto-suggest harga di Menu form. " +
              "Contoh: COGS Rp 5.000 × markup 250% → suggested Rp 17.500. Range 0-500%, default 250%."
            }
          />
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-mahakan-green-900">
            Absensi Mobile (Phase 4)
          </h3>
          <p className="mb-2 text-xs text-neutral-500">
            Karyawan absensi via{" "}
            <code className="rounded bg-neutral-100 px-1 font-mono text-[11px]">
              /absenkaryawan
            </code>
            . Wajib selfie (kamera depan) + GPS dalam radius dari kedai. Owner
            set PIN per karyawan via tab Karyawan.
          </p>
          <div className="space-y-3">
            <Input
              label="Late Grace Menit"
              type="text"
              inputMode="numeric"
              value={lateGraceMinutes}
              onChange={(e) =>
                setLateGraceMinutes(e.target.value.replace(/[^\d]/g, ""))
              }
              hint="Range 0-60. Clock-in dalam grace dari schedule start tidak di-flag late."
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="GPS Latitude"
                type="text"
                inputMode="decimal"
                value={gpsLat}
                onChange={(e) => setGpsLat(e.target.value)}
                hint="Mahakan default: -6.6753234"
              />
              <Input
                label="GPS Longitude"
                type="text"
                inputMode="decimal"
                value={gpsLng}
                onChange={(e) => setGpsLng(e.target.value)}
                hint="Mahakan default: 106.9298715"
              />
            </div>
            <Input
              label="Radius Meter"
              type="text"
              inputMode="numeric"
              value={gpsRadius}
              onChange={(e) =>
                setGpsRadius(e.target.value.replace(/[^\d]/g, ""))
              }
              hint="Range 10-500m. Karyawan di luar radius = absen ditolak. Default 50m."
            />
            <p className="rounded-md bg-info-100 p-2 text-[11px] text-info-500">
              💡 Cara dapat lat/lng dari Google Maps: buka maps.google.com →
              cari kedai → right-click pin → klik koordinat untuk copy.
            </p>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-mahakan-green-900">
            Approval Void / Refund
          </h3>
          <p className="mb-2 text-xs text-neutral-500">
            <strong>PIN manager</strong>: Owner/Manager yang sedang bertugas
            memasukkan PIN langsung di tablet — selesai saat itu juga.{" "}
            <strong>Kode Owner</strong>: kode 6 digit sekali pakai dikirim ke
            email Owner. <strong>Keduanya</strong>: kasir memakai PIN manager
            kalau ada yang bertugas, dan masih bisa minta kode Owner kalau
            tidak ada.
          </p>
          <div className="rounded-md border border-warning-500/40 bg-warning-100/40 px-3 py-2 text-[11px] leading-relaxed text-neutral-700">
            <strong className="text-warning-500">Penting soal waktu.</strong>{" "}
            Void/refund hanya bisa diterapkan selama shift transaksinya{" "}
            <em>masih terbuka</em>. Kalau persetujuan baru datang setelah shift
            ditutup, sistem menolaknya dan penjualan itu tidak terkoreksi —
            koreksinya harus lewat Riwayat → Koreksi Transaksi. Karena itu mode
            yang mengandalkan email saja berisiko kalau Owner tidak sempat
            membalas hari itu juga.
          </div>
          <div className="mt-2 space-y-2">
            <Select
              label="Siapa yang menyetujui VOID"
              options={APPROVAL_MODE_OPTIONS}
              value={voidApprovalMode}
              onValueChange={setVoidApprovalMode}
              size="sm"
            />
            <Select
              label="Siapa yang menyetujui REFUND"
              options={APPROVAL_MODE_OPTIONS}
              value={refundApprovalMode}
              onValueChange={setRefundApprovalMode}
              size="sm"
            />
            <div>
              <label className="block text-xs font-medium text-neutral-700">
                Email Tujuan Approval (max 10)
              </label>
              <p className="mt-0.5 text-[11px] text-neutral-500">
                Kode dikirim ke SEMUA email di daftar — siapa pun yang baca
                duluan bisa forward via WA. Default kalau kosong: email Owner
                pertama yang aktif.
              </p>
              {notifyEmails.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {notifyEmails.map((e, idx) => (
                    <span
                      key={`${e}-${idx}`}
                      className="inline-flex items-center gap-1 rounded-md border border-mahakan-green-200 bg-mahakan-green-50/40 px-2 py-1 text-xs text-mahakan-green-900"
                    >
                      <span className="font-mono">{e}</span>
                      <button
                        type="button"
                        onClick={() => removeEmail(idx)}
                        aria-label={`Hapus ${e}`}
                        className="ml-0.5 size-4 rounded text-neutral-500 hover:bg-mahakan-green-100 hover:text-danger-500"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="mt-2 flex gap-2">
                <input
                  type="email"
                  value={pendingEmail}
                  onChange={(ev) => setPendingEmail(ev.target.value)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter") {
                      ev.preventDefault();
                      addEmail();
                    }
                  }}
                  placeholder="email@gmail.com"
                  disabled={notifyEmails.length >= 10}
                  className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-mahakan-green-700 focus:outline-none focus:ring-2 focus:ring-mahakan-green-700/20 disabled:bg-neutral-100"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={addEmail}
                  disabled={
                    notifyEmails.length >= 10 || pendingEmail.trim().length === 0
                  }
                >
                  Tambah
                </Button>
              </div>
              {notifyEmails.length >= 10 ? (
                <p className="mt-1 text-[11px] text-warning-500">
                  Maksimal 10 email. Hapus salah satu untuk tambah baru.
                </p>
              ) : null}
            </div>
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
