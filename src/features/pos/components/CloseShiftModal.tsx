"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  ChevronDown,
  Copy,
  CreditCard,
  Loader2,
  MessageSquare,
  Printer,
  Receipt,
  RefreshCw,
  Wallet,
} from "lucide-react";
import { Badge, Button, Input, Modal, Spinner, toast } from "@/components/ui";
import {
  isOk,
  closeShift,
  fetchShiftCashPreview,
  type CloseShiftResult,
  type Shift,
} from "@/features/shifts";
import { daysBetweenIso } from "@/features/shifts/day-gate-pure";
import { toJakartaDateOnly } from "@/lib/date";
import {
  buildShiftCloseSummaryText,
  normalizePhoneForWa,
} from "@/features/shifts/close-summary-text";
import {
  getTransaction,
  listTransactions,
  type TransactionWithItems,
} from "@/features/transactions";
import { getDailyCashSummary } from "@/features/cash";
import { listLowStockIngredients } from "@/features/purchase-requests/actions";
import type { LowStockIngredient } from "@/features/purchase-requests/types";
import { getOwnOutlet } from "@/features/outlets";
import { formatRupiah, parseRupiah } from "@/lib/format";
import {
  printShiftClose,
  printTickets,
  type ReceiptConfig,
} from "@/lib/printer/print-transaction";
import { buildShiftCloseReceiptData } from "@/features/shifts/close-receipt-data";
import { cn } from "@/lib/utils";
import { BelanjaSubmissionModal } from "./BelanjaSubmissionModal";
import { CloseOpenBillModal } from "./CloseOpenBillModal";
import { CorrectOpeningCashModal } from "./CorrectOpeningCashModal";
import { useCrewPicker } from "@/features/crew/CrewPicker";
import { DeferBillDialog, type DeferBillTarget } from "./DeferBillDialog";

/* Sesi AE-62t — variance threshold default 10k kalau prop tidak di-pass
 * dari parent. Owner bisa override via Pengaturan → Threshold (path
 * settings.thresholds.shiftVarianceAlert). PosShell pass nilai live. */
const DEFAULT_VARIANCE_THRESHOLD = 10_000;

interface SummaryPreview {
  paid: { count: number; cash: number; qris: number; cardBca: number };
  voided: { count: number; totalAmount: number };
  refunded: { count: number; totalAmount: number };
  expectedCash: number;
  /** Sesi AE-49 — pisah cash vs non-cash. Cuma cash yang affect Kas Harusnya. */
  petty: {
    // cash-only (affect drawer)
    expenseCash: number;
    expenseCashCount: number;
    incomeCash: number;
    incomeCashCount: number;
    // non-cash (display only)
    expenseNonCash: number;
    expenseNonCashCount: number;
    incomeNonCash: number;
    incomeNonCashCount: number;
  };
}

// Sesi AE-62n — tambah "qris" sebagai primary verification channel.
// Order: 3 channel utama (kas/qris/edc) di kiri tabs, aggregator di kanan.
type ActiveField =
  "kas" | "qris" | "edc" | "gofood" | "grabfood" | "shopeefood";

interface FieldConfig {
  key: ActiveField;
  label: string;
  short: string;
  icon: typeof CreditCard;
}

const FIELDS: FieldConfig[] = [
  { key: "kas", label: "Kas Aktual", short: "Kas", icon: Wallet },
  { key: "qris", label: "QRIS (HP/App)", short: "QRIS", icon: CreditCard },
  { key: "edc", label: "EDC (BCA)", short: "EDC", icon: CreditCard },
  { key: "gofood", label: "GoFood", short: "GoFood", icon: Banknote },
  { key: "grabfood", label: "GrabFood", short: "Grab", icon: Banknote },
  { key: "shopeefood", label: "ShopeeFood", short: "Shopee", icon: Banknote },
];

const HANDOVER_TEMPLATES: Array<{ label: string; text: string }> = [
  { label: "Stok bahan habis", text: "Stok bahan habis: " },
  { label: "Alat error", text: "Alat / mesin perlu dicek: " },
  { label: "Customer hutang", text: "Customer hutang: " },
  { label: "Tidak ada catatan", text: "Tidak ada catatan khusus." },
];

interface CloseShiftModalProps {
  open: boolean;
  shift: Shift;
  userId: string;
  cashierName: string;
  receiptConfig: ReceiptConfig | null;
  /** Sesi AE-62t — owner-tunable variance alert threshold dari
   * outlet.settings.thresholds.shiftVarianceAlert. Fallback 10k kalau
   * undefined (sebelumnya hardcoded 10k di sini, sekarang live dari
   * Pengaturan Owner). */
  varianceThreshold?: number;
  onClose: () => void;
  onClosed: () => void;
  onOpenSettings: () => void;
}

/**
 * Sesi AE-4 redesign — fix scroll trap (min-h-0 + overscrollBehavior),
 * unified active-field numpad supaya satu numpad serve Kas Aktual + 4
 * settlement channel (no more dual-numpad context switch yang error-prone
 * malam hari), inline Print Struk + Bayar tombol per open bill (kasir ga
 * perlu keluar modal Tutup Shift untuk handle bill belum lunas), handover
 * quick-pick chips supaya pesan shift berikut tidak butuh ngetik panjang.
 *
 * Layout 2-col fullscreen (mirror CloseOpenBillModal + PaymentModal AD-7
 * pattern):
 *   LEFT 5fr (~558px tablet 1340 landscape): Summary + Variance live +
 *     Setor ke Owner + Catatan + Pesan handover.
 *   RIGHT 7fr (~782px): Field tab bar (5 tabs) + hero display of active +
 *     quick-amounts row + shared 3×4 numpad. Single numpad for all 5
 *     amounts.
 *   Open bills view: full-width list dengan inline tombol Cetak Struk +
 *     Bayar. Block submit until all paid / voided.
 */
export function CloseShiftModal({
  open,
  shift,
  cashierName,
  receiptConfig,
  varianceThreshold,
  onClose,
  onClosed,
  onOpenSettings,
}: CloseShiftModalProps) {
  const pickCrew = useCrewPicker();
  const VARIANCE_THRESHOLD = varianceThreshold ?? DEFAULT_VARIANCE_THRESHOLD;
  const [summary, setSummary] = useState<SummaryPreview | null>(null);
  const [openBills, setOpenBills] = useState<
    Array<{
      id: string;
      transactionNumber: string;
      pagerNumber: number | null;
      total: number;
      customerName: string | null;
    }>
  >([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [deferredCount, setDeferredCount] = useState(0);
  const [deferringBill, setDeferringBill] = useState<DeferBillTarget | null>(null);
  const [loading, setLoading] = useState(true);
  /* Sesi AE-167 — koreksi kas awal in-place. Override lokal supaya preview
   * (Kas Harusnya + variance) langsung update tanpa refetch prop dari parent. */
  const [openingOverride, setOpeningOverride] = useState<number | null>(null);
  const [correctOpen, setCorrectOpen] = useState(false);
  const effectiveOpening = openingOverride ?? shift.openingCash;
  /* Reset override saat modal dibuka / ganti shift (BUKAN saat refreshKey). */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpeningOverride(null);
  }, [open, shift.id]);

  // 6 amount fields — raw digit strings (no separator).
  // Sesi AE-62n — tambah `qris` untuk kasir verify manual dari HP/app.
  const [actualCash, setActualCash] = useState("");
  const [qris, setQris] = useState("");
  const [edc, setEdc] = useState("");
  const [gofood, setGofood] = useState("");
  const [grabfood, setGrabfood] = useState("");
  const [shopeefood, setShopeefood] = useState("");
  const [activeField, setActiveField] = useState<ActiveField>("kas");

  const [notes, setNotes] = useState("");
  const [handoverMessage, setHandoverMessage] = useState("");

  const [depositOpen, setDepositOpen] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositBank, setDepositBank] = useState("");
  const [depositNotes, setDepositNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sesi AE-4 — inline open-bill actions
  const [printingBillId, setPrintingBillId] = useState<string | null>(null);
  const [paymentBill, setPaymentBill] = useState<TransactionWithItems | null>(
    null,
  );
  const [loadingPaymentForId, setLoadingPaymentForId] = useState<string | null>(
    null,
  );

  const [belanjaOpen, setBelanjaOpen] = useState(false);
  const [lowStock, setLowStock] = useState<LowStockIngredient[]>([]);
  const [ownerPhone, setOwnerPhone] = useState<string | null>(null);

  /* Audit POS E2E 2026-06-12 — step Ringkasan Tutup Shift setelah close
   * sukses: kasir bisa kirim WA owner / salin sebelum lanjut popup belanja.
   * Sebelumnya tidak ada jejak ringkasan sama sekali (cuma toast). */
  /* Sesi AE-223 — nominal setoran yang dipakai struk closing. Disimpan saat
   * submit karena field-nya bisa saja dikosongkan setelah shift tertutup. */
  const [closedDeposit, setClosedDeposit] = useState<{
    amount: number | null;
    destination: string | null;
  }>({ amount: null, destination: null });
  const [printingClose, setPrintingClose] = useState(false);
  /* Sesi AE-223b — hasil cetak terakhir ditampilkan MENETAP di layar
   * Ringkasan. Sebelumnya cuma toast: kalau kasir sedang menghitung uang dan
   * tidak melihat layar, kegagalan cetak lewat begitu saja tanpa jejak. */
  const [printCloseStatus, setPrintCloseStatus] = useState<{
    kind: "ok" | "fail";
    message: string;
  } | null>(null);
  const [closedResult, setClosedResult] = useState<CloseShiftResult | null>(
    null,
  );
  const [belanjaShown, setBelanjaShown] = useState(false);

  // Sesi AE-4 — gunakan shift.id (bukan shift object) supaya parent re-render
  // ga trigger refetch loop yang bikin "breathing" loading spinner.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    setActualCash("");
    setNotes("");
    setQris("");
    setEdc("");
    setGofood("");
    setGrabfood("");
    setShopeefood("");
    setActiveField("kas");
    setHandoverMessage("");
    setDepositOpen(false);
    setDepositAmount("");
    setDepositBank("");
    setDepositNotes("");
    setError(null);
    setSubmitting(false);
    setClosedResult(null);
    setBelanjaShown(false);
    /* eslint-enable react-hooks/set-state-in-effect */

    async function load() {
      /* Sesi AE-228 — angka kas datang dari SERVER (`fetchShiftCashPreview`),
       * fungsi yang sama persis dipakai `closeShift` saat menyimpan.
       *
       * Sebelumnya layar ini menghitung sendiri dari daftar transaksi dengan
       * menyaring `paymentMethod === "cash"` / `"qris"` / `"card_bca"`.
       * Transaksi SPLIT BILL menyimpan literal "split" di kolom itu — tidak
       * cocok saringan mana pun — jadi seluruh nilainya lenyap dari Kas
       * Harusnya, prefill QRIS, dan prefill EDC, tanpa satu pun error. Server
       * sudah menghitungnya, jadi kasir melihat angka yang berbeda dari yang
       * tersimpan.
       *
       * Daftar transaksi tetap diambil untuk open bill + jumlah per status
       * (bukan untuk menghitung uang). */
      const [trxRes, cashRes, cashStateRes] = await Promise.all([
        listTransactions({ shiftId: shift.id, limit: 1000 }),
        getDailyCashSummary(),
        fetchShiftCashPreview(shift.id),
      ]);
      if (cancelled) return;
      if (!isOk(trxRes)) {
        setLoading(false);
        return;
      }
      const items = trxRes.data.items;
      // Sesi AE-241 — approved "bayar belakangan" bills carry over; they don't block.
      setDeferredCount(items.filter((t) => t.status === "open" && t.deferredAt).length);
      const open = items
        .filter((t) => t.status === "open" && !t.deferredAt)
        .map((t) => ({
          id: t.id,
          transactionNumber: t.transactionNumber,
          pagerNumber: t.pagerNumber,
          total: t.total,
          customerName: t.customerName ?? null,
        }));
      setOpenBills(open);
      // Sesi AE-62g — include partially_refunded di paid bucket supaya UI
      // preview match server formula (server pakai status in paid/partially_refunded).
      // Sebelumnya: kalau ada partial refund, UI tampil "Pas" tapi server
      // calculate variance ≠ 0 → kasir bingung, journal hook fire palsu.
      const paid = items.filter(
        (t) => t.status === "paid" || t.status === "partially_refunded",
      );
      const voided = items.filter((t) => t.status === "voided");
      const refunded = items.filter((t) => t.status === "refunded");

      const cashState = isOk(cashStateRes) ? cashStateRes.data : null;
      const cashSummary = isOk(cashRes) ? cashRes.data : null;

      /* Semua angka uang dari server. Kalau panggilannya gagal, sisa
       * hitungan lama TIDAK dipakai sebagai cadangan — angka cadangan yang
       * salah diam-diam justru itu masalah aslinya. */
      const paidCash = cashState?.summary.paidCash ?? 0;
      const paidQris = cashState?.summary.paidQris ?? 0;
      const paidCardBca = cashState?.summary.paidCard ?? 0;
      /* Sesi AE-49 — petty cash rentang shift (server), bukan ringkasan
       * harian: shift yang melewati tengah malam beda rentangnya. */
      const pettyExpenseCash = cashState?.summary.pettyExpenseCash ?? 0;
      const pettyIncomeCash = cashState?.summary.pettyIncomeCash ?? 0;

      /* Sesi AE-165 — prefill Reported QRIS/EDC dari POS (auto + boleh
       * override). Nilai QRIS/EDC sudah tercatat di POS, jadi kasir tidak
       * perlu input ulang — cukup cek/koreksi kalau total mesin/app berbeda.
       * (Konsisten dgn summary preview; settlement harian di Online &
       * Cashless pakai agregasi server yang split-aware.) */
      setQris(String(paidQris));
      setEdc(String(paidCardBca));

      setSummary({
        paid: {
          count: paid.length,
          cash: paidCash,
          qris: paidQris,
          cardBca: paidCardBca,
        },
        voided: {
          count: voided.length,
          totalAmount: voided.reduce((s, t) => s + t.total, 0),
        },
        refunded: {
          count: refunded.length,
          totalAmount: refunded.reduce((s, t) => s + t.total, 0),
        },
        /* Sesi AE-228 — Kas Harusnya apa adanya dari server.
         *
         * `effectiveOpening` (koreksi kas awal yang baru disetujui dan belum
         * terbaca server) tetap dihormati: kalau kasir mengoreksinya di layar
         * ini, selisihnya ditambahkan ke hasil server. */
        expectedCash:
          (cashState?.expectedCash ?? 0) +
          (effectiveOpening - (cashState?.openingCash ?? effectiveOpening)),
        petty: {
          expenseCash: pettyExpenseCash,
          expenseCashCount: cashSummary?.expenses.cashCount ?? 0,
          incomeCash: pettyIncomeCash,
          incomeCashCount: cashSummary?.income.manual.cashCount ?? 0,
          expenseNonCash: cashSummary?.expenses.nonCash ?? 0,
          expenseNonCashCount: cashSummary?.expenses.nonCashCount ?? 0,
          incomeNonCash: cashSummary?.income.manual.nonCash ?? 0,
          incomeNonCashCount: cashSummary?.income.manual.nonCashCount ?? 0,
        },
      });
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
    // shift.id stable across parent re-renders — prevent re-fetch loop.
    // effectiveOpening: re-run kalau kas awal dikoreksi in-place (AE-167).
  }, [open, shift.id, effectiveOpening, refreshKey]);

  const parsedCash = useMemo(() => {
    try {
      return parseRupiah(actualCash || "0");
    } catch {
      return 0;
    }
  }, [actualCash]);

  const variance = summary ? parsedCash - summary.expectedCash : 0;
  const varianceFlag = Math.abs(variance) > VARIANCE_THRESHOLD ? "warn" : "ok";

  const parsedDepositPreview = useMemo(() => {
    try {
      return depositAmount.trim().length > 0 ? parseRupiah(depositAmount) : 0;
    } catch {
      return 0;
    }
  }, [depositAmount]);

  // Active field state plumbing
  const fieldValues: Record<ActiveField, string> = {
    kas: actualCash,
    qris,
    edc,
    gofood,
    grabfood,
    shopeefood,
  };
  const fieldSetters: Record<ActiveField, (v: string) => void> = {
    kas: setActualCash,
    qris: setQris,
    edc: setEdc,
    gofood: setGofood,
    grabfood: setGrabfood,
    shopeefood: setShopeefood,
  };
  const activeValueRaw = fieldValues[activeField];
  const activeValueParsed = (() => {
    try {
      return parseRupiah(activeValueRaw || "0");
    } catch {
      return 0;
    }
  })();

  function setActiveValue(next: string) {
    fieldSetters[activeField](next);
  }
  function appendDigit(d: string) {
    if (submitting) return;
    if (activeValueRaw.length >= 12) return;
    setActiveValue(activeValueRaw + d);
  }
  function backspace() {
    if (submitting) return;
    setActiveValue(activeValueRaw.slice(0, -1));
  }
  function clearActive() {
    if (submitting) return;
    setActiveValue("");
  }

  // Quick amounts depend on active field. Kas → 50k/100k/200k/500k + Pas
  // (= expectedCash). Settlement fields → 50k/100k/200k/500k + "POS"
  // (match POS-recorded value).
  const quickAmounts = [50_000, 100_000, 200_000, 500_000];
  const matchValue = (() => {
    if (!summary) return null;
    if (activeField === "kas") return summary.expectedCash;
    if (activeField === "qris") return summary.paid.qris;
    if (activeField === "edc") return summary.paid.cardBca;
    return null; // GoFood/GrabFood/ShopeeFood — no POS-recorded match
  })();
  const matchLabel = activeField === "kas" ? "Pas" : "POS";

  // Sesi AE-62n — per-channel parsed values + variance untuk balance
  // verification panel. Cash variance includes refund + petty cash impact
  // (via summary.expectedCash). QRIS + EDC variance = fisik - POS Actual.
  const parsedQris = (() => {
    try {
      return qris.trim().length > 0 ? parseRupiah(qris) : 0;
    } catch {
      return 0;
    }
  })();
  const parsedEdc = (() => {
    try {
      return edc.trim().length > 0 ? parseRupiah(edc) : 0;
    } catch {
      return 0;
    }
  })();
  const qrisVariance = summary ? parsedQris - summary.paid.qris : 0;
  const edcVariance = summary ? parsedEdc - summary.paid.cardBca : 0;
  // Total |variance| across 3 channels — pakai untuk warning banner.
  const totalVarianceAbs =
    Math.abs(variance) + Math.abs(qrisVariance) + Math.abs(edcVariance);

  /* Sesi AE-217 — berapa hari kalender WIB yang dilewati shift ini. Dipakai
   * hanya untuk peringatan + catatan wajib, BUKAN untuk mengunci apa pun,
   * jadi menghitungnya dari jam tablet di sini masih aman. */
  const crossDays = daysBetweenIso(
    toJakartaDateOnly(shift.openedAt),
    toJakartaDateOnly(new Date()),
  );

  async function onSubmit() {
    if (submitting || !summary) return;
    if (parsedCash < 0) {
      setError("Kas aktual tidak boleh negatif");
      return;
    }
    /* Sesi AE-217 — shift yang melewati pergantian hari menutup kas DUA hari
     * atau lebih sekaligus, jadi selisihnya hampir pasti besar dan tidak bisa
     * ditelusuri lagi enam bulan kemudian. Catatan diwajibkan supaya yang
     * tersimpan adalah keterangan, bukan misteri. */
    if (crossDays >= 1 && notes.trim().length < 3) {
      setError(
        "Shift ini melewati pergantian hari — tulis dulu catatan kenapa baru ditutup sekarang.",
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    const crew = pickCrew ? await pickCrew("Tutup shift & hitung laci") : undefined;
    if (crew === null) {
      setSubmitting(false);
      return;
    }

    const tryParse = (s: string): number | null => {
      const trimmed = s.trim();
      if (trimmed.length === 0) return null;
      try {
        const n = parseRupiah(trimmed);
        return n >= 0 ? n : null;
      } catch {
        return null;
      }
    };

    const parsedDeposit = tryParse(depositAmount);
    const res = await closeShift({
      crewId: crew?.id,
      shiftId: shift.id,
      actualCash: parsedCash,
      notes: notes.trim() || null,
      handoverMessage: handoverMessage.trim() || null,
      // Sesi AE-62n — kirim qrisSettlement kasir input. Server fallback
      // ke paidQris kalau null untuk backward compat.
      qrisSettlement: tryParse(qris),
      edcSettlement: tryParse(edc),
      gofoodSettlement: tryParse(gofood),
      grabfoodSettlement: tryParse(grabfood),
      shopeefoodSettlement: tryParse(shopeefood),
      depositAmount: parsedDeposit,
      depositBankDestination: depositBank.trim() || null,
      depositNotes: depositNotes.trim() || null,
    });
    if (!isOk(res)) {
      setError(res.error.message);
      setSubmitting(false);
      return;
    }

    if (variance < 0) {
      toast.warning(`Selisih minus ${formatRupiah(Math.abs(variance))}`);
    } else if (variance > 0) {
      toast.info(`Selisih plus ${formatRupiah(variance)}`);
    } else {
      toast.success("Shift ditutup, kas pas!");
    }
    if (res.data.summary.depositId) {
      toast.info(
        `Setoran ${formatRupiah(parsedDeposit ?? 0)} pending verifikasi owner`,
      );
    } else if (res.data.summary.depositError) {
      // Sesi AE-62h — auto-deposit gagal (e.g. period overlap), surface ke
      // kasir supaya tahu setoran BELUM tercatat dan harus input manual via
      // Setoran Tunai di backoffice. Sebelumnya silent fail.
      toast.warning(
        `Setoran BELUM tercatat: ${res.data.summary.depositError.message}. Owner perlu input manual di Setoran Tunai.`,
      );
    }

    const [lowStockRes, outletRes] = await Promise.all([
      listLowStockIngredients(),
      getOwnOutlet(),
    ]);
    const lowStockItems =
      lowStockRes.success && lowStockRes.data.length > 0
        ? lowStockRes.data
        : [];
    setLowStock(lowStockItems);
    setOwnerPhone(outletRes.success ? outletRes.data.phone : null);
    /* Audit POS E2E 2026-06-12 — tampilkan step Ringkasan dulu (WA/salin),
     * popup belanja menyusul dari tombol Lanjut. */
    setClosedResult(res.data);
    setClosedDeposit({
      amount: parsedDeposit,
      destination: depositBank.trim() || null,
    });
    setSubmitting(false);

    /* Sesi AE-223 — cetak struk closing otomatis. Best-effort dan SESUDAH
     * shift benar-benar tertutup: printer yang mati atau belum di-pair tidak
     * boleh menahan atau menggagalkan penutupan shift. Kalau gagal, kasir
     * dikasih tahu dan bisa ulang lewat tombol Cetak Closing. */
    void doPrintClose(res.data, {
      amount: parsedDeposit,
      destination: depositBank.trim() || null,
    });
  }

  /* Satu jalur cetak untuk otomatis maupun tombol, supaya lembar cetak-ulang
   * tidak pernah beda isi dari lembar pertama. */
  async function doPrintClose(
    result: CloseShiftResult,
    deposit: { amount: number | null; destination: string | null },
    reprint = false,
  ) {
    if (printingClose) return;
    setPrintingClose(true);
    try {
      const outcome = await printShiftClose(
        buildShiftCloseReceiptData({
          shift: result.shift,
          summary: result.summary,
          cashierName,
          outletName: receiptConfig?.outletName ?? "Mahakan",
          outletAddress: receiptConfig?.outletAddress ?? null,
          depositAmount: deposit.amount,
          depositDestination: deposit.destination,
          reprint,
        }),
      );
      if (outcome.ok) {
        setPrintCloseStatus({
          kind: "ok",
          message: reprint
            ? "Struk closing dicetak ulang."
            : "Struk closing tercetak.",
        });
        if (reprint) toast.success("Struk closing dicetak");
        return;
      }
      /* Printer belum di-pair bukan kesalahan kasir dan bukan kegagalan tutup
       * shift — jadi peringatan, bukan error merah. */
      const message =
        outcome.reason === "not_paired"
          ? "Struk closing BELUM tercetak — printer belum di-pair. Buka Settings → Thermal Printer, lalu tekan Cetak Closing."
          : `Struk closing BELUM tercetak: ${outcome.message}`;
      setPrintCloseStatus({ kind: "fail", message });
      if (outcome.reason === "not_paired") {
        toast.info("Struk closing belum tercetak — printer belum di-pair.");
      } else {
        toast.warning(`Gagal cetak struk closing: ${outcome.message}`);
      }
    } finally {
      setPrintingClose(false);
    }
  }

  /* Selesai dari step Ringkasan: kalau ada stok menipis dan belum lewat
   * popup belanja → buka dulu; selain itu tutup modal. */
  function handleSummaryDone() {
    if (lowStock.length > 0 && !belanjaShown) {
      setBelanjaShown(true);
      setBelanjaOpen(true);
      return;
    }
    onClosed();
  }

  function handleBelanjaClose() {
    setBelanjaOpen(false);
    onClosed();
  }

  async function handlePrintBill(billId: string) {
    if (printingBillId !== null) return;
    if (!receiptConfig) {
      toast.error("Outlet config belum dimuat — tunggu sebentar.");
      return;
    }
    setPrintingBillId(billId);
    try {
      const trxRes = await getTransaction(billId);
      if (!isOk(trxRes) || !trxRes.data) {
        toast.error("Gagal load detail bill");
        return;
      }
      const outcome = await printTickets(
        trxRes.data,
        cashierName,
        ["customer"],
        receiptConfig,
      );
      if (outcome.ok) {
        toast.success(`Struk ${trxRes.data.transactionNumber} dicetak`);
      } else if (outcome.reason === "not_paired") {
        toast.error("Printer belum di-pair", {
          description: "Pasangkan printer di Pengaturan untuk auto-print.",
          action: { label: "Buka", onClick: onOpenSettings },
        });
      } else {
        toast.error(outcome.message);
      }
    } finally {
      setPrintingBillId(null);
    }
  }

  async function handleStartPayment(billId: string) {
    if (loadingPaymentForId !== null) return;
    setLoadingPaymentForId(billId);
    try {
      const trxRes = await getTransaction(billId);
      if (!isOk(trxRes) || !trxRes.data) {
        toast.error("Gagal load detail bill");
        return;
      }
      setPaymentBill(trxRes.data);
    } finally {
      setLoadingPaymentForId(null);
    }
  }

  function handlePaymentClosed() {
    setPaymentBill(null);
    setRefreshKey((k) => k + 1);
  }

  const blockedByOpenBills = openBills.length > 0;
  const submitDisabled =
    loading || actualCash.trim().length === 0 || blockedByOpenBills;

  return (
    <>
      <Modal
        open={open}
        onClose={closedResult ? handleSummaryDone : onClose}
        title="Tutup Shift"
        description={
          closedResult
            ? "Shift berhasil ditutup — kirim ringkasan ke owner atau salin."
            : blockedByOpenBills
              ? `${openBills.length} bill belum dibayar — selesaikan dulu sebelum tutup.`
              : "Hitung kas fisik di laci, bandingkan dengan Kas Harusnya. Settlement channel diisi seperlunya."
        }
        size="fullscreen"
        bodyPadding="none"
        disableEscClose={submitting}
        footer={
          closedResult ? (
            /* Sesi AE-223b — Cetak Closing WAJIB di footer sticky. Waktu ada
             * di badan modal yang bisa di-scroll, tombolnya jatuh di bawah
             * lipatan layar tablet: kasir lapor "tidak ada tombol print". */
            <div className="flex w-full items-center justify-between gap-3">
              <Button
                variant="outline"
                size="xl"
                className="!h-12"
                onClick={() =>
                  void doPrintClose(closedResult, closedDeposit, true)
                }
                loading={printingClose}
              >
                <Printer className="size-4" /> Cetak Closing
              </Button>
              <Button
                onClick={handleSummaryDone}
                size="xl"
                className="!h-12 min-w-[200px] !text-base"
              >
                {lowStock.length > 0 && !belanjaShown
                  ? "Lanjut — Cek Belanja"
                  : "Selesai"}
              </Button>
            </div>
          ) : blockedByOpenBills ? (
            <div className="flex w-full items-center justify-between gap-3">
              <Button variant="ghost" onClick={onClose} disabled={loading}>
                Tutup
              </Button>
              <Button
                variant="outline"
                size="lg"
                onClick={() => setRefreshKey((k) => k + 1)}
                disabled={loading}
              >
                <RefreshCw className="size-4" /> Cek Ulang
              </Button>
            </div>
          ) : (
            <div className="flex w-full items-center justify-between gap-3">
              <Button variant="ghost" onClick={onClose} disabled={submitting}>
                Batal
              </Button>
              <Button
                onClick={onSubmit}
                loading={submitting}
                disabled={submitDisabled}
                size="xl"
                className="!h-12 min-w-[200px] touch:min-w-[260px] !text-base"
              >
                {submitting ? "Memproses…" : "Tutup Shift"}
              </Button>
            </div>
          )
        }
      >
        {closedResult ? (
          <ClosedSummaryView
            text={buildShiftCloseSummaryText({
              shift: closedResult.shift,
              summary: closedResult.summary,
              cashierName,
            })}
            ownerPhone={ownerPhone}
            printStatus={printCloseStatus}
          />
        ) : loading ? (
          <div className="flex h-full items-center justify-center">
            <Spinner className="size-6 text-mahakan-green-700" />
          </div>
        ) : blockedByOpenBills ? (
          <BlockedByOpenBillsView
            bills={openBills}
            printingBillId={printingBillId}
            loadingPaymentForId={loadingPaymentForId}
            onPrint={handlePrintBill}
            onStartPayment={handleStartPayment}
            onDefer={(b) => setDeferringBill(b)}
            deferredCount={deferredCount}
          />
        ) : !summary ? (
          <p className="p-5 text-sm text-danger-500">Gagal load summary</p>
        ) : (
          <div className="grid h-full min-h-0 grid-rows-1 divide-y divide-neutral-200 lg:grid-cols-[5fr_7fr] lg:divide-x lg:divide-y-0 touch:grid-cols-[5fr_7fr] touch:divide-x touch:divide-y-0">
            {/* ============================================================ */}
            {/* LEFT — Summary + Setor + Catatan + Handover                 */}
            {/* ============================================================ */}
            <aside
              className="flex min-h-0 flex-col gap-3 overflow-y-auto bg-neutral-50 p-4 touch:p-3 lg:max-h-[calc(92vh-9rem)] touch:max-h-none"
              style={{ overscrollBehavior: "contain" }}
            >
              <SummarySection
                summary={summary}
              />
              {/* Sesi AE-62n — 3-channel balance verification panel.
                  Owner request: kasir input fisik per channel supaya keliatan
                  selisih kalau ada salah pencet metode pembayaran. */}
              <BalanceVerificationPanel
                cashPos={summary.expectedCash}
                cashCounted={parsedCash}
                cashVariance={variance}
                qrisPos={summary.paid.qris}
                qrisCounted={parsedQris}
                qrisVariance={qrisVariance}
                qrisInputEmpty={qris.trim().length === 0}
                edcPos={summary.paid.cardBca}
                edcCounted={parsedEdc}
                edcVariance={edcVariance}
                edcInputEmpty={edc.trim().length === 0}
                totalVarianceAbs={totalVarianceAbs}
                varianceThreshold={VARIANCE_THRESHOLD}
                onActivateField={setActiveField}
              />
              <VarianceIndicator
                parsedCash={parsedCash}
                variance={variance}
                varianceFlag={varianceFlag}
                varianceThreshold={VARIANCE_THRESHOLD}
              />
              {(summary.petty.expenseCashCount > 0 ||
                summary.petty.incomeCashCount > 0 ||
                summary.petty.expenseNonCashCount > 0 ||
                summary.petty.incomeNonCashCount > 0) && (
                <PettyCashSection petty={summary.petty} />
              )}
              <DepositSection
                open={depositOpen}
                amount={depositAmount}
                bank={depositBank}
                notes={depositNotes}
                preview={parsedDepositPreview}
                kasAktual={parsedCash}
                submitting={submitting}
                onToggle={() => setDepositOpen((v) => !v)}
                onChangeAmount={setDepositAmount}
                onChangeBank={setDepositBank}
                onChangeNotes={setDepositNotes}
              />
              {crossDays >= 1 ? (
                <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900">
                  <p className="font-semibold">
                    Shift ini dibuka{" "}
                    {crossDays === 1 ? "kemarin" : `${crossDays} hari lalu`}.
                  </p>
                  <p className="mt-1">
                    Angka &ldquo;Kas Harusnya&rdquo; di bawah mencakup{" "}
                    {crossDays + 1} hari sekaligus, jadi selisih yang besar itu
                    wajar. Hitung laci apa adanya dan tulis keterangannya di
                    catatan — jangan disesuaikan supaya pas.
                  </p>
                </div>
              ) : null}
              <NotesAndHandoverSection
                notes={notes}
                handoverMessage={handoverMessage}
                onChangeNotes={setNotes}
                onChangeHandover={setHandoverMessage}
                submitting={submitting}
              />
            </aside>

            {/* ============================================================ */}
            {/* RIGHT — Field Tab Bar + Hero Display + Numpad               */}
            {/* ============================================================ */}
            <div
              className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4 touch:gap-3 touch:p-3 lg:max-h-[calc(92vh-9rem)] touch:max-h-none"
              style={{ overscrollBehavior: "contain" }}
            >
              {/* Field selector tab bar */}
              <FieldTabBar
                fields={FIELDS}
                values={fieldValues}
                activeField={activeField}
                onSelect={setActiveField}
                disabled={submitting}
              />

              {/* Hero display + quick amounts + numpad for active field */}
              <ActiveFieldPanel
                activeField={activeField}
                activeLabel={
                  FIELDS.find((f) => f.key === activeField)?.label ??
                  "Kas Aktual"
                }
                rawValue={activeValueRaw}
                parsedValue={activeValueParsed}
                quickAmounts={quickAmounts}
                matchValue={matchValue}
                matchLabel={matchLabel}
                summary={summary}
                variance={variance}
                varianceFlag={varianceFlag}
                submitting={submitting}
                onSetValue={setActiveValue}
                onAppendDigit={appendDigit}
                onBackspace={backspace}
                onClear={clearActive}
              />

              {error ? (
                <p
                  role="alert"
                  className="rounded-md border border-danger-300 bg-danger-100 px-3 py-2 text-sm font-medium text-danger-700"
                >
                  {error}
                </p>
              ) : null}
            </div>
          </div>
        )}
      </Modal>

      {/* Sesi AE-241 — stacked: bayar belakangan for an unpaid bill */}
      <DeferBillDialog
        bill={deferringBill}
        onClose={() => setDeferringBill(null)}
        onDeferred={() => {
          setDeferringBill(null);
          setRefreshKey((k) => k + 1);
        }}
      />

      {/* Stacked: payment for selected open bill */}
      <CloseOpenBillModal
        open={paymentBill !== null}
        bill={paymentBill}
        cashierName={cashierName}
        receiptConfig={receiptConfig}
        onClose={() => setPaymentBill(null)}
        onClosed={handlePaymentClosed}
        onOpenSettings={onOpenSettings}
      />

      <BelanjaSubmissionModal
        open={belanjaOpen}
        lowStock={lowStock}
        shiftId={shift.id}
        ownerPhone={ownerPhone}
        onClose={handleBelanjaClose}
      />
      {/* Sesi AE-167 — koreksi kas awal in-place (shift masih buka). */}
      <CorrectOpeningCashModal
        open={correctOpen}
        shiftId={shift.id}
        currentOpeningCash={effectiveOpening}
        shiftClosed={false}
        onClose={() => setCorrectOpen(false)}
        onCorrected={(updated) => setOpeningOverride(updated.openingCash)}
      />
    </>
  );
}

// ============================================================
// Subcomponents — kept inside same file karena tightly coupled
// ============================================================

function SummarySection({
  summary,
}: {
  summary: SummaryPreview;
  /* Sesi AE-167 — kas awal efektif (setelah koreksi in-place) + handler. */
}) {
  /* Sesi AE-49 — display full formula breakdown supaya owner & kasir
   * paham angka Kas Harusnya dari mana. Petty cash TERMASUK di formula
   * (sebelumnya display-only di section terpisah → confusing). */
  const refundedCashApprox = summary.refunded.totalAmount; // approx; exact split di server
  /* Sesi AE-224 — shift yang masih membawa petty cash dari sebelum fiturnya
   * dicabut. Untuk shift baru selalu false: tidak ada lagi jalan membuat
   * catatan kas ber-asal POS. */
  const hasPettyCash =
    summary.petty.expenseCashCount > 0 || summary.petty.incomeCashCount > 0;
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4 touch:p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-600">
        Ringkasan Shift
      </h3>
      <div className="space-y-1.5 text-sm">
        <SummaryRow
          label={`Penjualan Tunai (${summary.paid.count} trx)`}
          value={`+ ${formatRupiah(summary.paid.cash)}`}
        />
        <SummaryRow
          label="QRIS"
          value={formatRupiah(summary.paid.qris)}
          muted
        />
        <SummaryRow
          label="Kartu BCA"
          value={formatRupiah(summary.paid.cardBca)}
          muted
        />
        {summary.voided.count > 0 ? (
          <SummaryRow
            label={`Void (${summary.voided.count} trx)`}
            value={formatRupiah(summary.voided.totalAmount)}
            muted
          />
        ) : null}
        {summary.refunded.count > 0 ? (
          <SummaryRow
            label={`Refund Tunai (${summary.refunded.count} trx)`}
            value={`- ${formatRupiah(refundedCashApprox)}`}
          />
        ) : null}
        {/* Sesi AE-49 — petty cash cash-only di breakdown ringkasan. */}
        {summary.petty.expenseCashCount > 0 ? (
          <SummaryRow
            label={`Petty Pengeluaran Cash (${summary.petty.expenseCashCount}×)`}
            value={`- ${formatRupiah(summary.petty.expenseCash)}`}
          />
        ) : null}
        {summary.petty.incomeCashCount > 0 ? (
          <SummaryRow
            label={`Petty Pemasukan Cash (${summary.petty.incomeCashCount}×)`}
            value={`+ ${formatRupiah(summary.petty.incomeCash)}`}
          />
        ) : null}
        <div className="my-2 border-t border-dashed border-neutral-200" />
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-bold text-neutral-900">
            Kas Harusnya
          </span>
          <span className="font-mono text-xl font-bold text-mahakan-green-900 touch:text-lg">
            {formatRupiah(summary.expectedCash)}
          </span>
        </div>
        {/* Sesi AE-224 — petty cash dicabut dari POS. Rumusnya hanya menyebut
          * petty kalau shift INI memang masih punya sisanya (shift yang sudah
          * berjalan sebelum pencabutan). Menyebut suku yang selalu nol cuma
          * membuat kasir mengira ada yang belum diisi. */}
        <p className="mt-1 text-[10px] text-neutral-500">
          {hasPettyCash
            ? "Formula: Penjualan Tunai − Refund Tunai − Petty Pengeluaran Cash + Petty Pemasukan Cash"
            : "Formula: Penjualan Tunai − Refund Tunai"}
        </p>
      </div>
    </section>
  );
}

/* Sesi AE-62n — 3-channel balance verification panel.
 *
 * Owner request: kasir sering salah pencet metode pembayaran (QRIS jadi
 * Cash, dst). Saat tutup shift, kasir wajib input fisik per channel
 * untuk verifikasi balance. Sistem auto-compare dengan POS amount,
 * highlight selisih per channel.
 *
 * Per-channel display: POS Actual (readonly) + Fisik Kasir (input
 * trigger ke active field di numpad kanan) + Selisih (color-coded).
 *
 * Cash row pakai expectedCash (sudah include refund + petty cash).
 * QRIS + EDC pakai paid amount directly (refund QRIS/EDC via app/mesin,
 * tidak affect closing balance).
 *
 * Cara pakai: tap salah satu row → activeField = channel itu → numpad
 * di kanan ready untuk input. Display selisih live update saat ketik.
 */
function BalanceVerificationPanel(props: {
  cashPos: number;
  cashCounted: number;
  cashVariance: number;
  qrisPos: number;
  qrisCounted: number;
  qrisVariance: number;
  qrisInputEmpty: boolean;
  edcPos: number;
  edcCounted: number;
  edcVariance: number;
  edcInputEmpty: boolean;
  totalVarianceAbs: number;
  /** Sesi AE-62t — live threshold dari outlet settings. */
  varianceThreshold: number;
  onActivateField: (field: ActiveField) => void;
}) {
  const VARIANCE_THRESHOLD = props.varianceThreshold;
  const rows: Array<{
    key: ActiveField;
    label: string;
    sublabel: string;
    pos: number;
    counted: number;
    variance: number;
    inputEmpty: boolean;
  }> = [
    {
      key: "kas",
      label: "Kas Fisik",
      sublabel: "Hitung uang di laci",
      pos: props.cashPos,
      counted: props.cashCounted,
      variance: props.cashVariance,
      inputEmpty: false, // cash always parsed (default 0)
    },
    {
      key: "qris",
      label: "QRIS",
      sublabel: "Cek HP / app QRIS",
      pos: props.qrisPos,
      counted: props.qrisCounted,
      variance: props.qrisVariance,
      inputEmpty: props.qrisInputEmpty,
    },
    {
      key: "edc",
      label: "EDC (BCA)",
      sublabel: "Cek mesin EDC",
      pos: props.edcPos,
      counted: props.edcCounted,
      variance: props.edcVariance,
      inputEmpty: props.edcInputEmpty,
    },
  ];

  return (
    <section className="rounded-xl border-2 border-mahakan-green-700/30 bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-mahakan-green-900">
            Verifikasi Balance per Channel
          </h3>
          <p className="text-[11px] text-neutral-500">
            Tap baris untuk input — bandingkan fisik dengan POS Actual.
          </p>
        </div>
        {props.totalVarianceAbs > 0 ? (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-warning-100 px-2 py-0.5 text-[11px] font-semibold text-warning-700"
            title="Total selisih absolut Cash+QRIS+EDC"
          >
            <AlertTriangle className="size-3" /> Total selisih{" "}
            {formatRupiah(props.totalVarianceAbs)}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-success-100 px-2 py-0.5 text-[11px] font-semibold text-success-500">
            <CheckCircle2 className="size-3" /> Semua pas
          </span>
        )}
      </div>
      <div className="space-y-1.5">
        {rows.map((r) => {
          const variancePositive = r.variance > 0;
          const variancePerfect = r.variance === 0 && !r.inputEmpty;
          const varianceWarn = Math.abs(r.variance) > VARIANCE_THRESHOLD;
          return (
            <button
              key={r.key}
              type="button"
              onClick={() => props.onActivateField(r.key)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-neutral-50",
                r.inputEmpty
                  ? "border-warning-300 bg-warning-50"
                  : variancePerfect
                    ? "border-success-300 bg-success-50"
                    : varianceWarn
                      ? "border-danger-300 bg-danger-50"
                      : "border-neutral-200 bg-white",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-neutral-900">
                  {r.label}
                </p>
                <p className="text-[10px] text-neutral-500">{r.sublabel}</p>
              </div>
              <div className="text-right text-xs">
                <p className="text-[10px] uppercase tracking-wider text-neutral-500">
                  POS
                </p>
                <p className="font-mono font-medium text-neutral-900">
                  {formatRupiah(r.pos)}
                </p>
              </div>
              <div className="text-right text-xs">
                <p className="text-[10px] uppercase tracking-wider text-neutral-500">
                  Fisik
                </p>
                <p
                  className={cn(
                    "font-mono font-medium",
                    r.inputEmpty
                      ? "italic text-warning-700"
                      : "text-neutral-900",
                  )}
                >
                  {r.inputEmpty ? "kosong" : formatRupiah(r.counted)}
                </p>
              </div>
              <div className="text-right text-xs">
                <p className="text-[10px] uppercase tracking-wider text-neutral-500">
                  Selisih
                </p>
                <p
                  className={cn(
                    "font-mono font-bold",
                    r.inputEmpty
                      ? "text-neutral-400"
                      : variancePerfect
                        ? "text-success-500"
                        : varianceWarn
                          ? "text-danger-500"
                          : "text-warning-700",
                  )}
                >
                  {r.inputEmpty
                    ? "—"
                    : `${variancePositive ? "+" : ""}${formatRupiah(r.variance)}`}
                </p>
              </div>
            </button>
          );
        })}
      </div>
      {props.totalVarianceAbs > VARIANCE_THRESHOLD ? (
        <p className="mt-2 rounded-md bg-warning-100/60 p-2 text-[11px] text-warning-700">
          ⚠ Ada selisih lebih dari {formatRupiah(VARIANCE_THRESHOLD)} — recheck
          atau jelaskan di Catatan. Owner bisa setujui as-is (akan tercatat di
          audit log).
        </p>
      ) : null}
    </section>
  );
}

function VarianceIndicator({
  parsedCash,
  variance,
  varianceFlag,
  varianceThreshold,
}: {
  parsedCash: number;
  variance: number;
  varianceFlag: "warn" | "ok";
  /** Sesi AE-62t — live threshold (untuk display text). */
  varianceThreshold: number;
}) {
  const VARIANCE_THRESHOLD = varianceThreshold;
  return (
    <>
      <section
        className={cn(
          "flex items-center gap-2 rounded-xl border-2 p-3 text-sm",
          parsedCash <= 0
            ? "border-neutral-200 bg-neutral-100 text-neutral-600"
            : variance === 0
              ? "border-success-500 bg-success-100 text-success-500"
              : varianceFlag === "warn"
                ? "border-danger-500 bg-danger-100 text-danger-500"
                : "border-warning-500 bg-warning-100 text-warning-500",
        )}
      >
        {parsedCash <= 0 ? (
          <span className="flex w-full items-center justify-between">
            <span>Selisih</span>
            <span className="font-mono italic">Isi kas aktual dulu</span>
          </span>
        ) : (
          <>
            {variance === 0 ? (
              <CheckCircle2 className="size-5" />
            ) : (
              <AlertTriangle className="size-5" />
            )}
            <span className="flex flex-1 items-baseline justify-between">
              <span className="font-semibold">
                {variance === 0
                  ? "Pas, kas seimbang"
                  : variance > 0
                    ? "Selisih plus"
                    : "Selisih minus"}
              </span>
              <span className="font-mono text-base font-bold">
                {variance >= 0 ? "+" : ""}
                {formatRupiah(variance)}
              </span>
            </span>
          </>
        )}
      </section>

      {varianceFlag === "warn" && parsedCash > 0 ? (
        <p className="text-[11px] text-danger-500">
          ⚠ Selisih lebih dari {formatRupiah(VARIANCE_THRESHOLD)}. Recheck
          jumlah cash drawer atau catat alasan di bawah.
        </p>
      ) : null}
    </>
  );
}

function PettyCashSection({ petty }: { petty: SummaryPreview["petty"] }) {
  /* Sesi AE-49 — pisah display cash vs non-cash. Cash AFFECT Kas Harusnya
   * (sudah dihitung di formula expectedCash di SummarySection). Non-cash
   * (transfer/other) info-only — tidak affect drawer fisik. */
  const hasCash = petty.expenseCashCount > 0 || petty.incomeCashCount > 0;
  const hasNonCash =
    petty.expenseNonCashCount > 0 || petty.incomeNonCashCount > 0;

  if (!hasCash && !hasNonCash) return null;

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-3">
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-600">
        Petty Cash Hari Ini
      </h3>

      {hasCash ? (
        <div className="rounded-md border border-mahakan-green-700/20 bg-mahakan-green-50/40 p-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-mahakan-green-900">
            Cash (affect Kas Harusnya)
          </p>
          {petty.incomeCashCount > 0 ? (
            <SummaryRow
              label={`Pemasukan tunai (${petty.incomeCashCount}×)`}
              value={`+ ${formatRupiah(petty.incomeCash)}`}
            />
          ) : null}
          {petty.expenseCashCount > 0 ? (
            <SummaryRow
              label={`Pengeluaran tunai (${petty.expenseCashCount}×)`}
              value={`- ${formatRupiah(petty.expenseCash)}`}
            />
          ) : null}
          <p className="mt-1 text-[11px] font-medium text-mahakan-green-900">
            ✓ Sudah dikurangi/ditambah ke Kas Harusnya di atas
          </p>
        </div>
      ) : null}

      {hasNonCash ? (
        <div className="mt-2 rounded-md border border-neutral-200 bg-neutral-50 p-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
            Non-cash (info — tidak affect kas laci)
          </p>
          {petty.incomeNonCashCount > 0 ? (
            <SummaryRow
              label={`Pemasukan transfer/other (${petty.incomeNonCashCount}×)`}
              value={`+ ${formatRupiah(petty.incomeNonCash)}`}
            />
          ) : null}
          {petty.expenseNonCashCount > 0 ? (
            <SummaryRow
              label={`Pengeluaran transfer/other (${petty.expenseNonCashCount}×)`}
              value={`- ${formatRupiah(petty.expenseNonCash)}`}
            />
          ) : null}
          <p className="mt-1 text-[11px] text-neutral-500">
            Untuk audit. Affect bank/aggregator, bukan laci kasir.
          </p>
        </div>
      ) : null}
    </section>
  );
}

function DepositSection({
  open,
  amount,
  bank,
  notes,
  preview,
  kasAktual,
  submitting,
  onToggle,
  onChangeAmount,
  onChangeBank,
  onChangeNotes,
}: {
  open: boolean;
  amount: string;
  bank: string;
  notes: string;
  preview: number;
  kasAktual: number;
  submitting: boolean;
  onToggle: () => void;
  onChangeAmount: (v: string) => void;
  onChangeBank: (v: string) => void;
  onChangeNotes: (v: string) => void;
}) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between p-3 text-left transition-colors hover:bg-neutral-50"
      >
        <div className="flex items-baseline gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-600">
            Setor ke Owner
          </h3>
          <span className="text-[11px] text-neutral-600">
            {preview > 0 ? formatRupiah(preview) : "(opsional)"}
          </span>
        </div>
        <ChevronDown
          className={cn(
            "size-4 text-neutral-600 transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {open ? (
        <div className="space-y-2 border-t border-neutral-200 p-3">
          <p className="text-[11px] text-neutral-600">
            Auto-buat entri <strong>Setoran Tunai pending</strong> untuk
            diverifikasi owner di tab Keuangan.
          </p>
          <RupiahCardInput
            label="Jumlah Setor"
            value={amount}
            onChange={onChangeAmount}
            disabled={submitting}
          />
          {preview > 0 ? (
            <>
              <Input
                label="Tujuan Setoran"
                type="text"
                value={bank}
                onChange={(e) => onChangeBank(e.target.value)}
                placeholder="Owner Tunai / BCA Owner / dll"
                disabled={submitting}
              />
              <Input
                label="Catatan (opsional)"
                type="text"
                value={notes}
                onChange={(e) => onChangeNotes(e.target.value)}
                placeholder="Sisa di drawer Rp 200rb, dll"
                disabled={submitting}
              />
              {kasAktual > 0 && preview > kasAktual ? (
                <p className="text-xs font-medium text-warning-500">
                  ⚠ Setoran lebih besar dari kas aktual.
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function NotesAndHandoverSection({
  notes,
  handoverMessage,
  onChangeNotes,
  onChangeHandover,
  submitting,
}: {
  notes: string;
  handoverMessage: string;
  onChangeNotes: (v: string) => void;
  onChangeHandover: (v: string) => void;
  submitting: boolean;
}) {
  function applyTemplate(t: string) {
    if (handoverMessage.trim().length === 0) {
      onChangeHandover(t);
      return;
    }
    // Append on new line, preserve existing.
    onChangeHandover(`${handoverMessage.trim()}\n${t}`.slice(0, 500));
  }

  const remaining = 500 - handoverMessage.length;

  return (
    <section className="space-y-3 rounded-xl border border-neutral-200 bg-white p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-600">
        Catatan
      </h3>
      <Input
        label="Catatan tutup shift (opsional)"
        type="text"
        value={notes}
        onChange={(e) => onChangeNotes(e.target.value)}
        placeholder="Misal: kembalian kurang pas"
        disabled={submitting}
      />
      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="flex items-center gap-1.5 text-sm font-medium text-neutral-900">
            <MessageSquare
              className="size-3.5 text-mahakan-green-700"
              aria-hidden
            />
            Pesan untuk Shift Berikutnya
          </label>
          <span
            className={cn(
              "text-[10px]",
              remaining < 50 ? "text-warning-500" : "text-neutral-500",
            )}
          >
            {remaining} char tersisa
          </span>
        </div>
        <p className="mb-1.5 text-[11px] text-neutral-600">
          Tap chip di bawah untuk kasih template, atau ketik bebas.
        </p>
        <div className="mb-2 flex flex-wrap gap-1">
          {HANDOVER_TEMPLATES.map((t) => (
            <button
              key={t.label}
              type="button"
              onClick={() => applyTemplate(t.text)}
              disabled={submitting}
              className={cn(
                "rounded-full border border-mahakan-green-700/40 bg-mahakan-green-50 px-2.5 py-1 text-[11px] font-medium text-mahakan-green-900 transition-colors",
                "hover:bg-mahakan-green-100 active:scale-95",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              + {t.label}
            </button>
          ))}
        </div>
        <textarea
          value={handoverMessage}
          onChange={(e) => onChangeHandover(e.target.value.slice(0, 500))}
          maxLength={500}
          rows={3}
          placeholder="Misal: kopi house blend habis, supplier pesan besok pagi"
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700 touch:text-[13px]"
          disabled={submitting}
        />
        <p className="mt-1 text-[11px] text-neutral-600">
          Tampil saat kasir buka shift berikutnya di outlet ini.
        </p>
      </div>
    </section>
  );
}

function FieldTabBar({
  fields,
  values,
  activeField,
  onSelect,
  disabled,
}: {
  fields: FieldConfig[];
  values: Record<ActiveField, string>;
  activeField: ActiveField;
  onSelect: (k: ActiveField) => void;
  disabled: boolean;
}) {
  return (
    <div className="grid grid-cols-5 gap-1.5 rounded-xl bg-neutral-100 p-1.5 touch:gap-1 touch:p-1">
      {fields.map((f) => {
        const raw = values[f.key];
        const parsed = (() => {
          try {
            return parseRupiah(raw || "0");
          } catch {
            return 0;
          }
        })();
        const isActive = activeField === f.key;
        const Icon = f.icon;
        return (
          <button
            key={f.key}
            type="button"
            onPointerDown={(e) => {
              if (disabled) return;
              e.preventDefault();
              onSelect(f.key);
            }}
            onKeyDown={(e) => {
              if (disabled) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(f.key);
              }
            }}
            disabled={disabled}
            style={{ touchAction: "manipulation" }}
            className={cn(
              "flex flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-2 text-center transition-all touch:py-1.5",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
              "disabled:cursor-not-allowed disabled:opacity-50",
              isActive
                ? "bg-mahakan-green-700 text-white shadow-sm"
                : parsed > 0
                  ? "bg-white text-neutral-900 hover:bg-mahakan-green-50"
                  : "bg-white text-neutral-600 hover:bg-mahakan-green-50",
            )}
          >
            <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide touch:text-[10px]">
              <Icon className="size-3" aria-hidden />
              {f.short}
            </span>
            <span
              className={cn(
                "font-mono text-xs font-bold tabular-nums touch:text-[11px]",
                isActive
                  ? "text-white"
                  : parsed > 0
                    ? "text-mahakan-green-900"
                    : "text-neutral-400",
              )}
            >
              {parsed > 0 ? formatRupiah(parsed).replace("Rp ", "") : "—"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ActiveFieldPanel({
  activeField,
  activeLabel,
  rawValue,
  parsedValue,
  quickAmounts,
  matchValue,
  matchLabel,
  summary,
  variance,
  varianceFlag,
  submitting,
  onSetValue,
  onAppendDigit,
  onBackspace,
  onClear,
}: {
  activeField: ActiveField;
  activeLabel: string;
  rawValue: string;
  parsedValue: number;
  quickAmounts: number[];
  matchValue: number | null;
  matchLabel: string;
  summary: SummaryPreview;
  variance: number;
  varianceFlag: "warn" | "ok";
  submitting: boolean;
  onSetValue: (v: string) => void;
  onAppendDigit: (d: string) => void;
  onBackspace: () => void;
  onClear: () => void;
}) {
  const isKas = activeField === "kas";
  const isEdc = activeField === "edc";
  const posRecorded = isEdc ? summary.paid.cardBca : null;

  const heroBorder = (() => {
    if (parsedValue === 0) return "border-neutral-200 bg-neutral-50";
    if (isKas) {
      if (variance === 0) return "border-success-500 bg-success-100";
      if (varianceFlag === "warn") return "border-danger-500 bg-danger-100";
      return "border-warning-500 bg-warning-100";
    }
    return "border-mahakan-green-700 bg-mahakan-green-50";
  })();

  return (
    <section className="rounded-xl border-2 border-mahakan-green-700/30 bg-white p-4 touch:p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-mahakan-green-900">
          {activeLabel}
        </h3>
        {posRecorded !== null && posRecorded > 0 ? (
          <span className="text-[11px] text-neutral-600">
            POS catat: {formatRupiah(posRecorded)}
          </span>
        ) : isKas ? (
          <span className="text-[10px] text-neutral-500 normal-case tracking-normal">
            (hitung manual di laci)
          </span>
        ) : null}
      </div>

      {/* Hero amount display */}
      <div
        className={cn(
          "mb-3 flex h-14 items-center justify-end rounded-xl border-2 px-4 transition-colors touch:h-12",
          submitting && "opacity-60",
          heroBorder,
        )}
      >
        {parsedValue > 0 ? (
          <span className="font-mono text-3xl font-bold tabular-nums text-neutral-900 touch:text-2xl">
            {formatRupiah(parsedValue)}
          </span>
        ) : (
          <span className="font-mono text-base text-neutral-400 touch:text-sm">
            Tap angka untuk input
          </span>
        )}
      </div>

      {/* Quick amounts row */}
      <div className="mb-2 grid grid-cols-5 gap-1.5 touch:gap-1">
        {quickAmounts.map((amt) => (
          <button
            key={amt}
            type="button"
            onPointerDown={(e) => {
              if (submitting) return;
              e.preventDefault();
              onSetValue(String(amt));
            }}
            onKeyDown={(e) => {
              if (submitting) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSetValue(String(amt));
              }
            }}
            disabled={submitting}
            style={{ touchAction: "manipulation" }}
            className={cn(
              "rounded-lg border border-neutral-300 bg-white py-1.5 text-xs font-medium transition-colors touch:py-1",
              "hover:bg-neutral-100 active:scale-95",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {formatRupiah(amt).replace("Rp ", "")}
          </button>
        ))}
        <button
          type="button"
          onPointerDown={(e) => {
            if (submitting || matchValue === null) return;
            e.preventDefault();
            onSetValue(String(matchValue));
          }}
          onKeyDown={(e) => {
            if (submitting || matchValue === null) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSetValue(String(matchValue));
            }
          }}
          disabled={submitting || matchValue === null}
          style={{ touchAction: "manipulation" }}
          className={cn(
            "rounded-lg border-2 py-1.5 text-xs font-bold transition-colors touch:py-1",
            "hover:bg-mahakan-green-100 active:scale-95",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
            "disabled:cursor-not-allowed disabled:opacity-50",
            matchValue !== null
              ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
              : "border-neutral-200 bg-neutral-50 text-neutral-400",
          )}
          title={
            matchValue !== null
              ? `${matchLabel}: ${formatRupiah(matchValue)}`
              : "Tidak ada nilai POS untuk channel ini"
          }
        >
          {matchLabel}
        </button>
      </div>

      {/* Numpad 3x4 */}
      <div className="grid grid-cols-3 gap-1.5 touch:gap-1">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <NumKey
            key={d}
            label={d}
            onPress={() => onAppendDigit(d)}
            disabled={submitting}
          />
        ))}
        <NumKey
          label="C"
          onPress={onClear}
          disabled={submitting}
          variant="muted"
        />
        <NumKey
          label="0"
          onPress={() => onAppendDigit("0")}
          disabled={submitting}
        />
        <NumKey
          label="⌫"
          onPress={onBackspace}
          disabled={submitting}
          variant="muted"
        />
      </div>

      <p className="mt-2 text-[11px] text-neutral-600">
        Pilih kolom di tab atas untuk pindah input.{" "}
        {rawValue.length > 0 ? `${rawValue.length} digit.` : ""}
      </p>
    </section>
  );
}

function BlockedByOpenBillsView({
  bills,
  printingBillId,
  loadingPaymentForId,
  onPrint,
  onStartPayment,
  onDefer,
  deferredCount,
}: {
  onDefer: (bill: DeferBillTarget) => void;
  deferredCount: number;
  bills: Array<{
    id: string;
    transactionNumber: string;
    pagerNumber: number | null;
    total: number;
    customerName: string | null;
  }>;
  printingBillId: string | null;
  loadingPaymentForId: string | null;
  onPrint: (id: string) => void;
  onStartPayment: (id: string) => void;
}) {
  return (
    <div
      className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-5 touch:p-4 lg:max-h-[calc(92vh-9rem)] touch:max-h-none"
      style={{ overscrollBehavior: "contain" }}
    >
      <div className="rounded-xl border border-warning-300 bg-warning-100 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle
            className="mt-0.5 size-5 text-warning-500"
            aria-hidden
          />
          <div className="space-y-1">
            <p className="text-sm font-bold text-warning-500">
              {bills.length} bill belum dibayar
            </p>
            <p className="text-xs text-neutral-700">
              Selesaikan bill dulu sebelum tutup shift. Tap{" "}
              <strong>Bayar</strong> untuk lanjut payment di sini, atau{" "}
              <strong>Cetak Struk</strong> untuk kasih reminder ke customer.
            </p>
            {deferredCount > 0 ? (
              <p className="text-xs text-neutral-600">
                {deferredCount} bill bayar belakangan dibawa ke shift berikutnya (tidak menghalangi tutup shift).
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <ul className="space-y-2">
        {bills.map((b) => {
          const isPrinting = printingBillId === b.id;
          const isLoadingPayment = loadingPaymentForId === b.id;
          return (
            <li
              key={b.id}
              className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between touch:p-2"
            >
              <div className="flex flex-1 flex-col gap-0.5 min-w-0">
                <span className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
                  <Receipt className="size-4 text-neutral-600" aria-hidden />
                  {b.transactionNumber}
                  {b.pagerNumber !== null ? (
                    <Badge variant="neutral">Pager {b.pagerNumber}</Badge>
                  ) : null}
                </span>
                <span className="text-[11px] text-neutral-600">
                  {b.customerName?.trim() ? `${b.customerName.trim()} · ` : ""}
                  <span className="font-mono font-semibold text-neutral-900">
                    {formatRupiah(b.total)}
                  </span>
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onPrint(b.id)}
                  disabled={isPrinting}
                  className="!h-9 touch:!h-10"
                >
                  {isPrinting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Printer className="size-4" aria-hidden />
                  )}
                  Cetak Struk
                </Button>
                <Button
                  size="sm"
                  onClick={() => onStartPayment(b.id)}
                  disabled={isLoadingPayment}
                  className="!h-9 touch:!h-10"
                >
                  {isLoadingPayment ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  Bayar
                </Button>
              </div>
              <button
                type="button"
                onClick={() => onDefer(b)}
                className="text-left text-[11px] text-neutral-500 underline-offset-2 hover:underline sm:basis-full"
              >
                Tamu sudah pergi & tidak bisa ditagih hari ini?
              </button>
            </li>
          );
        })}
      </ul>

      <p className="text-xs italic text-neutral-600">
        Sudah selesai semua? Tap <strong>Cek Ulang</strong> di footer untuk
        refresh status.
      </p>
    </div>
  );
}

// ============================================================
// Atoms
// ============================================================

function SummaryRow({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between text-sm",
        muted ? "text-neutral-600" : "text-neutral-900",
      )}
    >
      <span>{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

/**
 * Compact rupiah-input card untuk Setor section. Display-only — no native
 * keyboard. Tap card → user pakai numpad utama dari right column?
 * Actually no, deposit is on LEFT and tidak share numpad. Pakai
 * controlled input pakai inputMode=numeric untuk simplicity (jarang dipakai).
 */
function RupiahCardInput({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const parsed = (() => {
    try {
      return value.trim().length > 0 ? parseRupiah(value) : 0;
    } catch {
      return 0;
    }
  })();
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-neutral-900">
        {label}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-500">
          Rp
        </span>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
          placeholder="0"
          disabled={disabled}
          className={cn(
            "h-11 w-full rounded-md border border-neutral-300 bg-white pl-9 pr-3 text-right font-mono text-base tabular-nums text-neutral-900 transition-colors touch:h-10",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700/40 focus-visible:border-mahakan-green-700",
            "disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-500",
          )}
        />
      </div>
      {parsed > 0 ? (
        <p className="text-[11px] text-neutral-600">
          Preview: {formatRupiah(parsed)}
        </p>
      ) : null}
    </div>
  );
}

function NumKey({
  label,
  onPress,
  disabled,
  variant,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: "muted";
}) {
  // Sesi AE-2 — onPointerDown bukan onClick. iOS Safari + tablet tap
  // onClick fire setelah pointerup + ~200ms delay. onPointerDown = instant.
  return (
    <button
      type="button"
      onPointerDown={(e) => {
        if (disabled) return;
        e.preventDefault();
        onPress();
      }}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPress();
        }
      }}
      disabled={disabled}
      style={{ touchAction: "manipulation" }}
      className={cn(
        "flex h-12 items-center justify-center rounded-lg border font-mono text-xl font-semibold transition-colors touch:h-11 touch:text-lg",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
        "active:scale-95 active:shadow-inner",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variant === "muted"
          ? "border-neutral-200 bg-neutral-50 text-neutral-600 hover:bg-neutral-100"
          : "border-neutral-200 bg-white text-neutral-900 hover:bg-neutral-50",
      )}
    >
      {label}
    </button>
  );
}

/* ============================================================================
 * Audit POS E2E 2026-06-12 — Step Ringkasan Tutup Shift.
 * Tampil setelah closeShift sukses: teks laporan siap kirim WA owner / salin.
 * ========================================================================== */
function ClosedSummaryView({
  text,
  ownerPhone,
  printStatus,
}: {
  text: string;
  ownerPhone: string | null;
  printStatus: { kind: "ok" | "fail"; message: string } | null;
}) {
  return (
    <div
      className="mx-auto flex h-full w-full max-w-2xl flex-col gap-4 overflow-y-auto p-5 touch:p-4"
      style={{ overscrollBehavior: "contain" }}
    >
      <div className="flex items-center gap-2 rounded-md border border-mahakan-green-200 bg-mahakan-green-50 p-3 text-sm font-medium text-mahakan-green-900">
        <CheckCircle2 className="size-5 shrink-0" />
        Shift berhasil ditutup. Ringkasan di bawah siap dikirim ke owner.
      </div>
      {/* Sesi AE-223b — hasil cetak ditampilkan menetap, bukan toast: kalau
       * printer bermasalah, kasir harus tetap melihatnya walau baru menoleh
       * ke layar semenit kemudian. */}
      {printStatus ? (
        <div
          className={cn(
            "flex items-start gap-2 rounded-md border p-3 text-sm font-medium",
            printStatus.kind === "ok"
              ? "border-neutral-200 bg-neutral-50 text-neutral-700"
              : "border-warning-500/40 bg-warning-500/10 text-neutral-900",
          )}
        >
          {printStatus.kind === "ok" ? (
            <Printer className="size-5 shrink-0" />
          ) : (
            <AlertTriangle className="size-5 shrink-0 text-warning-500" />
          )}
          <span>{printStatus.message}</span>
        </div>
      ) : null}
      <pre className="whitespace-pre-wrap rounded-md border border-neutral-200 bg-white p-4 font-mono text-xs leading-relaxed text-neutral-800">
        {text}
      </pre>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="lg"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              toast.success("Ringkasan disalin");
            } catch {
              toast.error(
                "Gagal menyalin — blok teks di atas lalu salin manual",
              );
            }
          }}
        >
          <Copy className="size-4" /> Salin Ringkasan
        </Button>
        <Button
          size="lg"
          disabled={!ownerPhone}
          title={
            ownerPhone
              ? undefined
              : "No. WA owner belum diisi — set di Pengaturan outlet"
          }
          onClick={() => {
            if (!ownerPhone) return;
            window.open(
              `https://wa.me/${normalizePhoneForWa(ownerPhone)}?text=${encodeURIComponent(text)}`,
              "_blank",
              "noopener,noreferrer",
            );
          }}
        >
          <MessageSquare className="size-4" /> Kirim WA Owner
        </Button>
      </div>
      {!ownerPhone ? (
        <p className="text-xs text-neutral-500">
          Tombol WA nonaktif karena nomor owner belum diisi di Pengaturan
          outlet. Pakai Salin Ringkasan lalu kirim manual.
        </p>
      ) : null}
    </div>
  );
}
