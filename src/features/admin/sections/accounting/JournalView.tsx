"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ExternalLink,
  Filter,
  Info,
  Loader2,
  CalendarDays,
  Paperclip,
  Pencil,
  Plus,
  RotateCcw,
  Scale,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import {
  Badge,
  Button,
  DatePicker,
  DateRangePicker,
  Input,
  Modal,
  Select,
  Skeleton,
  toast,
} from "@/components/ui";
import {
  deleteDraftJournalEntry,
  fetchAdjustmentCounts,
  fetchJournalEntries,
  reverseJournalEntry,
  updateJournalEntryDate,
} from "@/features/accounting/actions";
import { adjustmentKindLabel } from "@/features/accounting/adjusting-pure";
import type {
  JournalEntryStatus,
  JournalEntryWithLines,
} from "@/features/accounting/types";
import {
  getOwnOutlet,
  isOk as outletIsOk,
  updateFeatures,
} from "@/features/outlets";
import { hasPermission, type Role } from "@/lib/auth/rbac";
import { formatRupiah } from "@/lib/money";
import { addDaysJakarta, monthStartJakarta, todayJakarta } from "@/lib/tz";
import { cn } from "@/lib/utils";
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

const SOURCE_TYPE_OPTIONS = [
  { value: "all", label: "Semua sumber" },
  { value: "manual", label: "Manual" },
  /* Sesi AE-211 — jurnal penyesuaian punya sumbernya sendiri supaya owner
   * bisa memisahkan koreksi akhir bulan dari jurnal manual biasa. */
  { value: "adjusting", label: "Jurnal Penyesuaian" },
  { value: "opening_balance", label: "Jurnal Pembukaan" },
  { value: "pos_sale", label: "POS Sale" },
  /* Sesi AE-193 — ringkasan penjualan harian. */
  { value: "pos_daily_sales", label: "POS Sale (harian)" },
  { value: "pos_daily_compliment", label: "POS Compliment (harian)" },
  { value: "pos_refund", label: "POS Refund" },
  { value: "pos_compliment", label: "POS Compliment" },
  { value: "purchase_create", label: "Purchase Create" },
  { value: "purchase_pay", label: "Purchase Pay (TOP)" },
  { value: "purchase_cancel", label: "Purchase Cancel" },
  { value: "payroll_paid", label: "Payroll Paid" },
  { value: "expense_create", label: "Expense" },
  { value: "income_create", label: "Income" },
  { value: "cash_deposit_verified", label: "Cash Deposit Verified" },
  { value: "aggregator_settlement", label: "Aggregator Settlement" },
  { value: "shift_variance", label: "Shift Variance" },
  { value: "opname_adjustment", label: "Opname Adjustment" },
  { value: "period_close", label: "Period Close" },
  { value: "period_reopen", label: "Period Reopen" },
];

const STATUS_FILTER_OPTIONS: Array<{ value: "all" | JournalEntryStatus; label: string }> = [
  { value: "all", label: "Semua" },
  { value: "posted", label: "Posted" },
  { value: "draft", label: "Draft" },
  { value: "reversed", label: "Reversed" },
];

export function JournalView({ viewerRole }: { viewerRole: Role }) {
  const [rows, setRows] = useState<JournalEntryWithLines[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  /* Sesi AE-63 phase4 — edit-in-place untuk draft entry. */
  const [editEntry, setEditEntry] = useState<JournalEntryWithLines | null>(
    null,
  );
  /* Sesi AE-211 — Jurnal Penyesuaian. `adjustTarget` = jurnal yang sedang
   * disesuaikan; null + `adjustOpen` = penyesuaian berdiri sendiri (mis.
   * penyusutan bulanan) yang tidak menunjuk jurnal manapun. */
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustTarget, setAdjustTarget] =
    useState<JournalEntryWithLines | null>(null);
  /* Berapa penyesuaian yang sudah menempel per entry — supaya jurnal yang
   * sudah dikoreksi tidak dikoreksi dua kali tanpa sadar. */
  const [adjustmentCounts, setAdjustmentCounts] = useState<
    Record<string, number>
  >({});

  // Filters
  /* Sesi AE-72 — Search query untuk filter client-side (deskripsi /
   * entry number). Lighter dari debounce-server karena rows max 100. */
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [filterSourceType, setFilterSourceType] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<"all" | JournalEntryStatus>(
    "all",
  );
  const [filterRange, setFilterRange] = useState<{
    from: string | null;
    to: string | null;
  }>({ from: null, to: null });

  const canDraft = hasPermission(viewerRole, "accounting.journal.draft");
  const canPost = hasPermission(viewerRole, "accounting.journal.post");
  const canReverse = hasPermission(viewerRole, "accounting.journal.reverse");
  /* Penyesuaian membuat entry baru — haknya sama dengan membuat jurnal
   * (draft untuk manager, posting untuk owner). */
  const canAdjust = hasPermission(viewerRole, "accounting.journal.draft");
  /* Sesi AE-185 — ubah tanggal memakai hak posting jurnal (owner). */
  const canEditDate = hasPermission(viewerRole, "accounting.journal.post");

  const [reverseTarget, setReverseTarget] =
    useState<JournalEntryWithLines | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [dateTarget, setDateTarget] = useState<JournalEntryWithLines | null>(
    null,
  );
  const [newDate, setNewDate] = useState("");
  const [dateReason, setDateReason] = useState("");
  const [busy, setBusy] = useState(false);

  // Sesi AE-62c — auto-journal flag awareness untuk empty state CTA
  const queryClient = useQueryClient();
  const outletQuery = useQuery({
    queryKey: ["admin", "outlet", "own"],
    queryFn: async () => {
      const res = await getOwnOutlet();
      if (!outletIsOk(res)) throw new Error(res.error.message);
      return res.data;
    },
  });
  const autoJournalEnabled =
    outletQuery.data?.settings?.features?.accounting_auto_journal === true;
  const [activating, setActivating] = useState(false);

  async function handleEnableAutoJournal() {
    setActivating(true);
    try {
      const res = await updateFeatures({ accounting_auto_journal: true });
      if (!outletIsOk(res)) {
        toast.error(res.error.message);
        return;
      }
      toast.success("Auto-Journal aktif. Coba buat 1 transaksi POS untuk test.");
      void queryClient.invalidateQueries({ queryKey: ["admin", "outlet"] });
    } finally {
      setActivating(false);
    }
  }

  async function load() {
    setLoading(true);
    try {
      const res = await fetchJournalEntries({
        limit: 100,
        sourceType: filterSourceType === "all" ? undefined : filterSourceType,
        status: filterStatus === "all" ? undefined : filterStatus,
        fromDate: filterRange.from ?? undefined,
        toDate: filterRange.to ?? undefined,
      });
      if (res.ok) {
        setRows(res.data);
        /* Sesi AE-211 — tautan penyesuaian tersimpan di metadata (bukan
         * kolom), jadi hitungannya diambil sekali untuk seluruh halaman. */
        const countRes = await fetchAdjustmentCounts(res.data.map((e) => e.id));
        setAdjustmentCounts(countRes.ok ? countRes.data : {});
      } else toast.error(res.error.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [filterSourceType, filterStatus, filterRange.from, filterRange.to]);

  const hasActiveFilter =
    searchQuery.trim().length > 0 ||
    filterSourceType !== "all" ||
    filterStatus !== "all" ||
    filterRange.from !== null ||
    filterRange.to !== null;

  function clearFilters() {
    setSearchQuery("");
    setFilterSourceType("all");
    setFilterStatus("all");
    setFilterRange({ from: null, to: null });
  }

  /* Sesi AE-72 — Quick date filter helpers (preset chips).
   *
   * Sesi AE-191 — batas rentang WAJIB kalender WIB. Versi lama memakai
   * `toISOString()` (UTC) atas Date waktu-lokal, dua-duanya meleset:
   *   - `to` = hari ini UTC → antara 00:00–06:59 WIB masih tanggal kemarin,
   *     jadi jurnal yang baru dibuat hari itu TIDAK MUNCUL sama sekali;
   *   - "Bulan ini" → `new Date(y, m, 1)` = tengah malam lokal = 17:00 UTC
   *     tanggal 31 bulan sebelumnya, jadi `from` mundur satu hari. */
  function setQuickDateRange(days: number) {
    const today = todayJakarta();
    setFilterRange({ from: addDaysJakarta(today, -(days - 1)), to: today });
  }
  function setThisMonth() {
    const today = todayJakarta();
    setFilterRange({ from: monthStartJakarta(today), to: today });
  }

  /* Sesi AE-72 — Client-side search filter (deskripsi / entry number). */
  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (e) =>
        e.entryNumber.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q),
    );
  }, [rows, searchQuery]);

  /* Sesi AE-185 — reverse pindah dari prompt() ke modal: alasan wajib itu
   * jejak audit, jadi layak diberi ruang + peringatan yang jelas soal apa
   * yang akan terjadi. prompt() juga tidak bisa dipakai di tablet POS. */
  async function onReverseSubmit() {
    if (!reverseTarget || busy) return;
    const alasan = reverseReason.trim();
    if (alasan.length < 10) {
      toast.error("Alasan minimal 10 karakter");
      return;
    }
    setBusy(true);
    const res = await reverseJournalEntry(reverseTarget.id, alasan);
    setBusy(false);
    if (res.ok) {
      toast.success(
        `${reverseTarget.entryNumber} di-reverse oleh ${res.data.reverseEntryNumber}`,
      );
      setReverseTarget(null);
      setReverseReason("");
      void load();
    } else {
      toast.error(res.error.message);
    }
  }

  /* Sesi AE-185 — koreksi tanggal tanpa reverse. */
  async function onDateSubmit() {
    if (!dateTarget || busy) return;
    const alasan = dateReason.trim();
    if (!newDate) {
      toast.error("Pilih tanggal barunya dulu");
      return;
    }
    if (alasan.length < 5) {
      toast.error("Alasan minimal 5 karakter");
      return;
    }
    setBusy(true);
    const res = await updateJournalEntryDate({
      entryId: dateTarget.id,
      newDate,
      reason: alasan,
    });
    setBusy(false);
    if (res.ok) {
      toast.success(
        res.data.renumbered
          ? `Tanggal diubah — nomor jurnal jadi ${res.data.entryNumber} (dulu ${res.data.previousEntryNumber})`
          : `Tanggal ${res.data.entryNumber} diubah ke ${newDate}`,
      );
      setDateTarget(null);
      setDateReason("");
      void load();
    } else {
      toast.error(res.error.message);
    }
  }

  /* Sesi AE-63 phase4 — staff finance: "kita buat jurnal manual ada
   * kesalahan pencatatan ada fitur untuk edit/hapus". Posted entries
   * harus reverse (audit). Draft entries boleh di-hapus langsung. */
  async function onDeleteDraft(entry: JournalEntryWithLines) {
    if (
      !confirm(
        `Hapus draft ${entry.entryNumber}?\n\n` +
          `${entry.description}\n\n` +
          `Aksi ini tidak bisa di-undo. Lines + header akan ke-hapus permanen.`,
      )
    ) {
      return;
    }
    const res = await deleteDraftJournalEntry(entry.id);
    if (res.ok) {
      toast.success(`Draft ${entry.entryNumber} ter-hapus`);
      void load();
    } else {
      toast.error(res.error.message);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-neutral-700">
          Daftar entri jurnal (max 100). Auto-jurnal aktif kalau Owner toggle
          flag di Settings.
        </p>
        <div className="flex flex-wrap gap-2">
          {/* Sesi AE-211 — penyesuaian akhir bulan yang tidak menunjuk jurnal
              tertentu (penyusutan, akrual, dibayar di muka) dimulai dari sini.
              Untuk mengoreksi nilai satu jurnal, pakai tombol timbangan di
              baris jurnalnya. */}
          {canAdjust ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setAdjustTarget(null);
                setAdjustOpen(true);
              }}
            >
              <Scale className="size-4" /> Jurnal Penyesuaian
            </Button>
          ) : null}
          {canDraft || canPost ? (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> Buat Entry Manual
            </Button>
          ) : null}
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-md border border-neutral-200 bg-neutral-50/50 p-3">
        <div className="mb-2 flex items-center gap-2">
          <Filter className="size-4 text-neutral-500" />
          <span className="text-xs font-medium uppercase text-neutral-500">
            Filter
          </span>
          {hasActiveFilter ? (
            <button
              type="button"
              onClick={clearFilters}
              className="ml-auto inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-100"
            >
              <X className="size-3" /> Reset
            </button>
          ) : null}
        </div>

        {/* Sesi AE-72 — Search input untuk filter cepat deskripsi/entry number */}
        <div className="mb-2">
          <Input
            placeholder="🔍 Cari deskripsi / nomor entry (JE-...) ..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <Select
            label="Sumber"
            options={SOURCE_TYPE_OPTIONS}
            value={filterSourceType}
            onValueChange={setFilterSourceType}
            size="sm"
          />
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-700">
              Status
            </label>
            <div className="flex flex-wrap gap-1">
              {STATUS_FILTER_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setFilterStatus(opt.value)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                    filterStatus === opt.value
                      ? "bg-mahakan-green-700 text-white"
                      : "bg-white text-neutral-700 hover:bg-neutral-100 border border-neutral-200",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <DateRangePicker
            label="Rentang Tanggal"
            value={filterRange}
            onChange={(r) => setFilterRange({ from: r.from, to: r.to })}
          />
        </div>

        {/* Sesi AE-72 — Quick date filter chips */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-neutral-500">Cepat:</span>
          {[
            { label: "Hari Ini", action: () => setQuickDateRange(1) },
            { label: "7 Hari", action: () => setQuickDateRange(7) },
            { label: "30 Hari", action: () => setQuickDateRange(30) },
            { label: "Bulan Ini", action: setThisMonth },
          ].map((q) => (
            <button
              key={q.label}
              type="button"
              onClick={q.action}
              className="rounded-md border border-neutral-300 bg-white px-2 py-0.5 text-[11px] font-medium text-neutral-700 hover:border-mahakan-green-500 hover:bg-mahakan-green-50 hover:text-mahakan-green-900"
            >
              {q.label}
            </button>
          ))}
        </div>

        {hasActiveFilter ? (
          <p className="mt-2 text-xs text-neutral-500">
            Menampilkan {filteredRows.length} dari {rows.length} entri dengan
            filter aktif
          </p>
        ) : null}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        autoJournalEnabled ? (
          // Flag ON tapi 0 entri — informational
          <div className="rounded-md border border-dashed border-mahakan-green-300 bg-mahakan-green-50/30 p-10 text-center">
            <CheckCircle2
              className="mx-auto size-10 text-mahakan-green-700"
              aria-hidden
            />
            <h3 className="mt-3 text-sm font-medium text-mahakan-green-900">
              Auto-Journal AKTIF — belum ada entri
            </h3>
            <p className="mt-1 text-xs text-neutral-600">
              Sistem siap. Buat 1 transaksi POS / pembelian / setoran tunai →
              jurnal otomatis ter-post di sini. Atau buat manual via tombol di
              atas.
            </p>
            <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-neutral-500">
              <Info className="size-3" /> Cutover &ldquo;Jurnal
              Pembukaan&rdquo; saldo per 31 Mei 2026 di-post via tombol di tab
              Periode.
            </p>
          </div>
        ) : (
          // Flag OFF — actionable empty state
          <div className="rounded-lg border-2 border-warning-500/50 bg-warning-50/30 p-8">
            <div className="mx-auto max-w-2xl">
              <div className="flex items-start gap-3">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-warning-100">
                  <Zap className="size-6 text-warning-700" aria-hidden />
                </div>
                <div className="flex-1">
                  <h3 className="text-base font-bold text-warning-900">
                    Auto-Journal NONAKTIF
                  </h3>
                  <p className="mt-1 text-sm text-neutral-700">
                    Saat ini transaksi POS / pembelian / payroll / setoran TIDAK
                    auto-post ke jurnal. Itu sebabnya tab ini kosong walau
                    transaksi sudah jalan di POS.
                  </p>
                  <p className="mt-2 text-xs text-neutral-600">
                    Klik tombol di kanan untuk aktifkan. Aman dicoba — jurnal
                    yang gagal akan di-track via audit log{" "}
                    <code className="rounded bg-neutral-100 px-1">
                      journal.posting_failed
                    </code>{" "}
                    (tidak fail transaksi POS-nya).
                  </p>
                </div>
                <Button
                  onClick={handleEnableAutoJournal}
                  disabled={activating}
                  className="shrink-0"
                >
                  {activating ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Zap className="size-4" aria-hidden />
                  )}{" "}
                  Aktifkan
                </Button>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <div className="rounded-md border border-neutral-200 bg-white p-3 text-xs text-neutral-600">
                  <div className="font-semibold text-neutral-900">
                    Yang akan auto-jurnal:
                  </div>
                  <ul className="mt-1 space-y-0.5 list-disc pl-4">
                    <li>POS sale + refund + compliment</li>
                    <li>Pembelian (create / pay / cancel)</li>
                    <li>Payroll (mark paid)</li>
                    <li>Expense + income</li>
                    <li>Setoran tunai + aggregator settlement</li>
                    <li>Shift variance + opname adjustment</li>
                  </ul>
                </div>
                <div className="rounded-md border border-neutral-200 bg-white p-3 text-xs text-neutral-600">
                  <div className="font-semibold text-neutral-900">
                    Setelah aktif:
                  </div>
                  <ul className="mt-1 space-y-0.5 list-disc pl-4">
                    <li>Saldo Akun otomatis terupdate per transaksi</li>
                    <li>P&L + Trial Balance live</li>
                    <li>Period akuntansi auto-create kalau belum ada</li>
                    <li>Bisa toggle balik OFF kapan saja di Settings</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )
      ) : (
        <RowList
          rows={filteredRows}
          adjustmentCounts={adjustmentCounts}
          canAdjust={canAdjust}
          onAdjust={(e) => {
            setAdjustTarget(e);
            setAdjustOpen(true);
          }}
          canReverse={canReverse}
          canDeleteDraft={canDraft}
          canEditDraft={canDraft}
          canEditDate={canEditDate}
          onReverse={(e) => {
            setReverseTarget(e);
            setReverseReason("");
          }}
          onEditDate={(e) => {
            setDateTarget(e);
            setNewDate(String(e.entryDate));
            setDateReason("");
          }}
          onDeleteDraft={onDeleteDraft}
          onEditDraft={setEditEntry}
        />
      )}

      {/* Sesi AE-185 — ubah tanggal jurnal tanpa reverse. */}
      <Modal
        open={dateTarget !== null}
        onClose={() => setDateTarget(null)}
        title="Ubah Tanggal Jurnal"
        description={
          dateTarget
            ? `${dateTarget.entryNumber} · ${dateTarget.description}`
            : ""
        }
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setDateTarget(null)}
              disabled={busy}
            >
              Batal
            </Button>
            <Button onClick={onDateSubmit} loading={busy}>
              Simpan Tanggal
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-xs text-neutral-600">
            Tanggal sekarang:{" "}
            <span className="font-mono font-medium">
              {dateTarget ? String(dateTarget.entryDate) : ""}
            </span>
          </p>
          <DatePicker
            label="Tanggal baru"
            value={newDate}
            onChange={(v) => setNewDate(v ?? "")}
          />
          <Input
            label="Alasan perubahan"
            value={dateReason}
            onChange={(e) => setDateReason(e.target.value)}
            placeholder="mis. salah ketik, seharusnya tanggal transaksi"
            hint="Minimal 5 karakter — tersimpan di Audit Log."
          />
          {/* Peringatan pindah bulan: nomor jurnal ikut diterbitkan ulang. */}
          {dateTarget &&
          newDate &&
          String(dateTarget.entryDate).slice(0, 7) !== newDate.slice(0, 7) ? (
            <p className="rounded-md bg-warning-100/50 p-2 text-xs text-warning-700">
              Pindah bulan: nomor jurnal akan diterbitkan ulang mengikuti
              periode baru (nomor lama disimpan di riwayat). Laporan bulan asal
              dan bulan tujuan sama-sama berubah.
            </p>
          ) : null}
          {dateTarget && dateTarget.sourceType !== "manual" ? (
            <p className="rounded-md bg-neutral-100 p-2 text-xs text-neutral-600">
              Jurnal ini dibuat otomatis dari{" "}
              <span className="font-mono">{dateTarget.sourceType}</span>.
              Mengubah tanggalnya membuat jurnal tidak lagi sejalan dengan
              tanggal transaksi sumbernya — pastikan itu memang yang diinginkan.
            </p>
          ) : null}
          <p className="rounded-md bg-mahakan-green-100/40 p-2 text-xs text-mahakan-green-900">
            Saldo akun tidak berubah — hanya periodenya yang bergeser. Tidak
            ada entry baru yang dibuat, jadi tidak perlu reverse.
          </p>
        </div>
      </Modal>

      {/* Sesi AE-185 — reverse: dulu pakai prompt() bawaan browser. */}
      <Modal
        open={reverseTarget !== null}
        onClose={() => setReverseTarget(null)}
        title="Reverse Jurnal"
        description={
          reverseTarget
            ? `${reverseTarget.entryNumber} · ${reverseTarget.description}`
            : ""
        }
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setReverseTarget(null)}
              disabled={busy}
            >
              Batal
            </Button>
            <Button
              variant="destructive"
              onClick={onReverseSubmit}
              loading={busy}
            >
              Reverse
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            label="Alasan reverse"
            value={reverseReason}
            onChange={(e) => setReverseReason(e.target.value)}
            placeholder="mis. dobel input, nominalnya keliru"
            hint="Minimal 10 karakter — tersimpan di Audit Log."
          />
          <p className="rounded-md bg-warning-100/50 p-2 text-xs text-warning-700">
            Sistem membuat entry lawan bertanggal sama, lalu keduanya ditandai
            <em> reversed</em> sehingga saling meniadakan (saldo jadi nol).
            Entry aslinya tetap tersimpan sebagai jejak audit.
          </p>
          <p className="text-xs text-neutral-600">
            Kalau yang salah cuma tanggalnya, tidak perlu reverse — pakai
            tombol kalender untuk mengoreksi tanggal langsung.
          </p>
        </div>
      </Modal>

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

      {adjustOpen ? (
        <JournalEntryModal
          open={adjustOpen}
          mode="adjusting"
          adjustTarget={adjustTarget}
          onClose={() => {
            setAdjustOpen(false);
            setAdjustTarget(null);
          }}
          onSaved={() => {
            setAdjustOpen(false);
            setAdjustTarget(null);
            void load();
          }}
          isOwner={viewerRole === "owner"}
        />
      ) : null}

      {editEntry ? (
        <JournalEntryModal
          open={editEntry != null}
          editEntry={editEntry}
          onClose={() => setEditEntry(null)}
          onSaved={() => {
            setEditEntry(null);
            void load();
          }}
          isOwner={viewerRole === "owner"}
        />
      ) : null}
    </div>
  );
}

/** Sesi AE-211 — bentuk metadata jurnal penyesuaian (lihat postAdjustingJournal). */
type AdjustingMeta = {
  kind?: string;
  reason?: string;
  adjustsEntryNumber?: string | null;
  adjustsEntryDate?: string | null;
};

function readAdjustingMeta(entry: JournalEntryWithLines): AdjustingMeta | null {
  if (entry.sourceType !== "adjusting") return null;
  const meta = entry.metadata as { adjusting?: AdjustingMeta } | null;
  return meta?.adjusting ?? null;
}

function RowList({
  rows,
  adjustmentCounts,
  canAdjust,
  onAdjust,
  canReverse,
  canDeleteDraft,
  canEditDraft,
  canEditDate,
  onReverse,
  onEditDate,
  onDeleteDraft,
  onEditDraft,
}: {
  rows: JournalEntryWithLines[];
  adjustmentCounts: Record<string, number>;
  canAdjust: boolean;
  onAdjust: (e: JournalEntryWithLines) => void;
  canReverse: boolean;
  canDeleteDraft: boolean;
  canEditDraft: boolean;
  canEditDate: boolean;
  onReverse: (e: JournalEntryWithLines) => void;
  onEditDate: (e: JournalEntryWithLines) => void;
  onDeleteDraft: (e: JournalEntryWithLines) => void;
  onEditDraft: (e: JournalEntryWithLines) => void;
}) {
  return (
    <div className="space-y-2">
      {rows.map((entry) => {
        const totalDebit = entry.lines.reduce(
          (s, l) => s + Number(l.debit),
          0,
        );
        const adjustingMeta = readAdjustingMeta(entry);
        const adjustedByCount = adjustmentCounts[entry.id] ?? 0;
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
              {/* Sesi AE-211 — dua arah penandaan: entry ini SEBUAH
                  penyesuaian, atau entry ini SUDAH pernah disesuaikan. */}
              {adjustingMeta ? (
                <Badge variant="info" className="shrink-0">
                  Penyesuaian
                </Badge>
              ) : null}
              {adjustedByCount > 0 ? (
                <Badge variant="warning" className="shrink-0">
                  Disesuaikan {adjustedByCount}×
                </Badge>
              ) : null}
              <span className="font-mono text-sm font-medium text-neutral-900">
                {formatRupiah(totalDebit)}
              </span>
              {/* Sesi AE-206 — penanda entry punya lampiran bukti. Ikonnya
                  di baris ringkasan supaya kelihatan tanpa perlu dibuka. */}
              {entry.receiptImageUrl ? (
                <Paperclip
                  className="size-3.5 shrink-0 text-mahakan-green-700"
                  aria-label="Ada bukti transaksi"
                />
              ) : null}
              {/* Sesi AE-185 — koreksi tanggal tanpa perlu reverse. Tersedia
                  untuk draft & posted; entry yang sudah di-reverse tidak. */}
              {canEditDate && entry.status !== "reversed" ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    onEditDate(entry);
                  }}
                  className="inline-flex items-center gap-1 rounded p-1 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-mahakan-green-700"
                  aria-label={`Ubah tanggal ${entry.entryNumber}`}
                  title="Ubah tanggal jurnal (tanpa reverse)"
                >
                  <CalendarDays className="size-3.5" />
                </button>
              ) : null}
              {/* Sesi AE-211 — Sesuaikan: bikin jurnal baru berisi selisih,
                  entry ini tetap berlaku. Bedanya dengan Reverse di
                  sebelahnya (meniadakan) dijelaskan di dalam modalnya. */}
              {canAdjust && entry.status === "posted" ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    onAdjust(entry);
                  }}
                  className="inline-flex items-center gap-1 rounded p-1 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-mahakan-green-700"
                  aria-label={`Sesuaikan ${entry.entryNumber}`}
                  title="Jurnal penyesuaian (koreksi nilai tanpa membatalkan)"
                >
                  <Scale className="size-3.5" />
                </button>
              ) : null}
              {canReverse && entry.status === "posted" ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    onReverse(entry);
                  }}
                  className="inline-flex items-center gap-1 rounded p-1 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-danger-500"
                  aria-label={`Reverse ${entry.entryNumber}`}
                  title="Reverse entry (posted)"
                >
                  <RotateCcw className="size-3.5" />
                </button>
              ) : null}
              {/* Sesi AE-63 phase4 — edit draft entry (only draft+manual). */}
              {canEditDraft &&
              entry.status === "draft" &&
              entry.sourceType === "manual" ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    onEditDraft(entry);
                  }}
                  className="inline-flex items-center gap-1 rounded p-1 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-mahakan-green-700"
                  aria-label={`Edit draft ${entry.entryNumber}`}
                  title="Edit draft"
                >
                  <Pencil className="size-3.5" />
                </button>
              ) : null}
              {/* Sesi AE-63 phase4 — delete draft entry (only draft+manual). */}
              {canDeleteDraft &&
              entry.status === "draft" &&
              entry.sourceType === "manual" ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    onDeleteDraft(entry);
                  }}
                  className="inline-flex items-center gap-1 rounded p-1 text-xs text-neutral-500 hover:bg-danger-50 hover:text-danger-500"
                  aria-label={`Hapus draft ${entry.entryNumber}`}
                  title="Hapus draft"
                >
                  <Trash2 className="size-3.5" />
                </button>
              ) : null}
            </summary>
            <div className="border-t border-neutral-100 bg-neutral-50/50 px-3 py-2">
              {adjustingMeta ? (
                <div className="mb-2 rounded-md border border-mahakan-green-500/30 bg-mahakan-green-50/60 px-2 py-1.5 text-[11px] leading-relaxed text-neutral-700">
                  <span className="font-semibold text-mahakan-green-900">
                    {adjustmentKindLabel(adjustingMeta.kind ?? "")}
                  </span>
                  {adjustingMeta.adjustsEntryNumber ? (
                    <>
                      {" "}
                      atas{" "}
                      <span className="font-mono">
                        {adjustingMeta.adjustsEntryNumber}
                      </span>
                      {adjustingMeta.adjustsEntryDate
                        ? ` (${adjustingMeta.adjustsEntryDate})`
                        : ""}
                      {" — jurnal itu TETAP berlaku, ini hanya selisihnya."}
                    </>
                  ) : (
                    " — penyesuaian akhir periode, tidak menunjuk jurnal tertentu."
                  )}
                  {adjustingMeta.reason ? (
                    <div className="mt-0.5 text-neutral-600">
                      Alasan: {adjustingMeta.reason}
                    </div>
                  ) : null}
                </div>
              ) : null}
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
              {/* Sesi AE-206 — buka bukti transaksi yang dilampirkan saat
                  entry dibuat (file di Google Drive, buka di tab baru). */}
              {entry.receiptImageUrl ? (
                <div className="mt-2 flex items-center justify-between gap-2 border-t border-neutral-200 pt-2">
                  <span className="inline-flex items-center gap-1.5 text-xs text-neutral-600">
                    <Paperclip className="size-3.5" aria-hidden /> Bukti
                    transaksi
                  </span>
                  <a
                    href={entry.receiptImageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-neutral-700 hover:border-mahakan-green-700 hover:text-mahakan-green-900"
                  >
                    <ExternalLink className="size-3.5" aria-hidden /> Lihat
                    bukti
                  </a>
                </div>
              ) : null}
            </div>
          </details>
        );
      })}
    </div>
  );
}
