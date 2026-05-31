"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Calendar,
  CheckCircle2,
  Clock,
  MessageSquare,
  PackageSearch,
  Pencil,
  Sparkles,
  Wallet,
} from "lucide-react";
import { Button, Input, Modal, toast } from "@/components/ui";
import {
  getLastClosedShiftAtOutlet,
  getStandardOpeningCash,
  isOk,
  openShift,
  updateStandardOpeningCash,
  type Shift,
} from "@/features/shifts";
import { formatIndonesianDateTime } from "@/lib/date";
import { formatRupiah } from "@/lib/format";
import type { Category, MenuItem } from "@/features/menu";
import type { Role } from "@/lib/auth/rbac";
import { cn } from "@/lib/utils";
import { MenuStatusCard } from "./MenuStatusCard";

interface OpenShiftModalProps {
  open: boolean;
  /** Kept for callsite compatibility; the action derives userId from session. */
  userId: string;
  /** Menu data lifted from PosShell — passed through to MenuStatusCard. */
  menuItems: MenuItem[];
  categories: Category[];
  role: Role;
  /** Display name kasir (greeting). Optional — falls back ke "Kasir". */
  cashierName?: string;
  /** Outlet name (greeting). Optional. */
  outletName?: string;
  onItemUpdated: (next: MenuItem) => void;
  onClose: () => void;
  onOpened: () => void;
}

type Step = "cash" | "stock";

const QUICK_AMOUNTS: Array<{ label: string; value: string }> = [
  { label: "Kosong", value: "0" },
  { label: "50rb", value: "50000" },
  { label: "100rb", value: "100000" },
  { label: "200rb", value: "200000" },
  { label: "500rb", value: "500000" },
];

/**
 * Sesi AE-2 redesign — 2-column fullscreen layout, mirroring CloseShiftModal
 * pattern (sesi AD-8). Staff feedback: popup lama "kecil dan ribet"; redesign
 * pakai full card 2 kolom dengan typography + hierarchy yang lebih jelas.
 *
 * Step 1 (cash): LEFT = greeting + handover message + checklist tip; RIGHT =
 *   hero amount display + quick amounts + dedicated 3×4 numpad.
 * Step 2 (stock): MenuStatusCard full width (kasir scan menu, mark sold-out
 *   sebelum mulai jualan).
 *
 * Prefetched handover message via getLastClosedShiftAtOutlet (single fetch
 * on modal open). Numpad pakai onPointerDown + touch-action: manipulation
 * supaya tap instant di tablet/iPhone Safari (sesi AE-2 numpad polish).
 */
export function OpenShiftModal({
  open,
  menuItems,
  categories,
  role,
  cashierName,
  outletName,
  onItemUpdated,
  onClose,
  onOpened,
}: OpenShiftModalProps) {
  const [step, setStep] = useState<Step>("cash");
  // Raw digit string (no separator) — formatted for display via formatRupiah.
  const [openingCash, setOpeningCash] = useState("200000");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [previousShift, setPreviousShift] = useState<Shift | null>(null);
  const [previousLoading, setPreviousLoading] = useState(true);
  /* Sesi AE-167 — kas awal standar harian (flat float Mahakan = 200rb). */
  const [standardCash, setStandardCash] = useState(200_000);
  const [editingStandard, setEditingStandard] = useState(false);
  const [standardDraft, setStandardDraft] = useState("");
  const [savingStandard, setSavingStandard] = useState(false);
  const isSupervisor = role === "owner" || role === "manager";

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setStep("cash");
    setOpeningCash(String(standardCash));
    setError(null);
    setSubmitting(false);
    setEditingStandard(false);
    setPreviousShift(null);
    setPreviousLoading(true);
    /* eslint-enable react-hooks/set-state-in-effect */

    let cancelled = false;
    void (async () => {
      /* Sesi AE-167 — prefill kas awal dengan STANDAR harian (200rb),
       * bukan carryover. Model Mahakan: float laci di-reset flat tiap hari.
       * Cegah salah ketik — staff cukup konfirmasi / tap "Pakai Standar". */
      const [stdRes, prevRes] = await Promise.all([
        getStandardOpeningCash(),
        getLastClosedShiftAtOutlet(),
      ]);
      if (cancelled) return;
      if (isOk(stdRes)) {
        setStandardCash(stdRes.data.standardOpeningCash);
        setOpeningCash(String(stdRes.data.standardOpeningCash));
      }
      if (isOk(prevRes)) setPreviousShift(prevRes.data);
      setPreviousLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // standardCash sengaja TIDAK di-deps: cuma initial prefill saat open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const parsed = useMemo(() => {
    const n = parseInt(openingCash || "0", 10);
    return Number.isFinite(n) ? n : 0;
  }, [openingCash]);

  async function onSubmitCash() {
    if (submitting) return;
    if (parsed < 0) {
      setError("Kas awal tidak boleh negatif");
      return;
    }
    setSubmitting(true);
    setError(null);

    const res = await openShift({ openingCash: parsed });
    if (!isOk(res)) {
      setError(res.error.message);
      setSubmitting(false);
      return;
    }
    toast.success(`Shift dibuka — kas awal ${formatRupiah(parsed)}`);
    setSubmitting(false);
    setStep("stock");
  }

  function handleSkipOrFinish() {
    onOpened();
  }

  // Numpad press helpers — kept here so they can rely on closure state w/o re-render.
  function appendDigit(d: string) {
    if (submitting) return;
    setOpeningCash((s) => {
      // Prevent leading zeros — "0" + "1" should become "1" not "01".
      if (s === "0" && d !== "0") return d;
      if (s.length >= 12) return s;
      return s + d;
    });
  }
  function backspace() {
    if (submitting) return;
    setOpeningCash((s) => (s.length <= 1 ? "0" : s.slice(0, -1)));
  }
  function clearAmount() {
    if (submitting) return;
    setOpeningCash("0");
  }
  function setQuickAmount(v: string) {
    if (submitting) return;
    setOpeningCash(v);
  }
  /* Sesi AE-167 — apakah nilai saat ini = standar (untuk badge konfirmasi). */
  const usingStandard = parsed === standardCash;
  /* Kas akhir shift sebelumnya — ditampilkan sebagai INFO/alternatif, bukan
   * default (model flat 200rb). */
  const carryoverValue =
    previousShift?.actualCash != null && previousShift.actualCash > 0
      ? previousShift.actualCash
      : null;
  const carryoverDiffersFromStandard =
    carryoverValue !== null && carryoverValue !== standardCash;

  function applyStandard() {
    if (submitting) return;
    setOpeningCash(String(standardCash));
  }

  async function saveStandard() {
    const amt = parseInt(standardDraft.replace(/\D/g, "") || "0", 10);
    if (!Number.isFinite(amt) || amt < 0) {
      toast.error("Nominal standar tidak valid");
      return;
    }
    setSavingStandard(true);
    const res = await updateStandardOpeningCash({ amount: amt });
    setSavingStandard(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    setStandardCash(res.data.standardOpeningCash);
    setOpeningCash(String(res.data.standardOpeningCash));
    setEditingStandard(false);
    toast.success(`Kas awal standar = ${formatRupiah(res.data.standardOpeningCash)}`);
  }

  const today = useMemo(() => {
    return new Intl.DateTimeFormat("id-ID", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Asia/Jakarta",
    }).format(new Date());
  }, []);

  const greeting = cashierName ? `Hai, ${cashierName}!` : "Hai, Kasir!";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Buka Shift"
      description={
        step === "cash"
          ? "Hitung kas di laci, lalu masukin di kolom kanan. Pesan dari shift sebelumnya bisa dibaca di kiri."
          : "Tandai item yang sudah habis sebelum mulai jualan. Skip kalau gak ada perubahan."
      }
      size="fullscreen"
      bodyPadding="none"
      footer={
        step === "cash" ? (
          <>
            <Button
              variant="ghost"
              onClick={onClose}
              disabled={submitting}
              size="lg"
            >
              Batal
            </Button>
            <Button
              onClick={onSubmitCash}
              loading={submitting}
              disabled={parsed < 0}
              size="lg"
              className="!h-12 min-w-[220px] touch:min-w-[280px] !text-base"
            >
              Buka Shift · {formatRupiah(parsed)}
            </Button>
          </>
        ) : (
          <Button
            onClick={handleSkipOrFinish}
            size="lg"
            className="!h-12 min-w-[220px] touch:min-w-[280px] !text-base"
          >
            <CheckCircle2 className="size-5" aria-hidden /> Selesai · Mulai
            Jualan
          </Button>
        )
      }
    >
      {step === "cash" ? (
        <div className="grid h-full min-h-0 grid-rows-1 divide-y divide-neutral-200 lg:grid-cols-[5fr_7fr] lg:divide-x lg:divide-y-0 touch:grid-cols-[5fr_7fr] touch:divide-x touch:divide-y-0">
          {/* ============ LEFT: Persiapan Shift ============ */}
          <div
            className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4 touch:p-3 lg:max-h-[calc(92vh-9rem)] lg:p-5 touch:max-h-none"
            style={{ overscrollBehavior: "contain" }}
          >
            <section className="rounded-xl border border-mahakan-green-700/30 bg-mahakan-green-50 p-4 touch:p-3">
              <h3 className="text-base font-semibold text-mahakan-green-900 touch:text-sm">
                {greeting}
              </h3>
              <p className="mt-1 text-xs text-neutral-700 touch:text-[11px]">
                Selamat bertugas. Sebelum mulai jualan, hitung uang di{" "}
                <span className="font-semibold">drawer aktif</span> shift ini
                aja (jangan gabung sama brankas / petty cash di laci).
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs touch:text-[11px]">
                <div className="flex items-center gap-1.5 text-neutral-700">
                  <Calendar className="size-3.5 text-mahakan-green-700" aria-hidden />
                  <span>{today}</span>
                </div>
                {outletName ? (
                  <div className="flex items-center gap-1.5 text-neutral-700">
                    <Clock className="size-3.5 text-mahakan-green-700" aria-hidden />
                    <span>{outletName}</span>
                  </div>
                ) : null}
              </dl>
            </section>

            <section>
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-600">
                Pesan dari shift sebelumnya
              </h4>
              {previousLoading ? (
                <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-xs text-neutral-500 touch:text-[11px]">
                  Memuat pesan…
                </div>
              ) : previousShift &&
                previousShift.handoverMessage &&
                previousShift.handoverMessage.length > 0 ? (
                <div className="rounded-lg border border-mahakan-green-700/30 bg-white p-4 shadow-sm touch:p-3">
                  <div className="flex items-start gap-2">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-mahakan-green-100">
                      <MessageSquare
                        className="size-4 text-mahakan-green-800"
                        aria-hidden
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="whitespace-pre-wrap text-sm text-neutral-900 touch:text-[13px]">
                        {previousShift.handoverMessage}
                      </p>
                      {previousShift.closedAt ? (
                        <p className="mt-2 text-[10px] uppercase tracking-wider text-neutral-500">
                          Ditutup{" "}
                          {formatIndonesianDateTime(previousShift.closedAt)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-4 text-center text-xs text-neutral-500 touch:p-3 touch:text-[11px]">
                  <MessageSquare
                    className="mx-auto mb-1 size-4 text-neutral-400"
                    aria-hidden
                  />
                  Tidak ada pesan handover.
                </div>
              )}
            </section>

            <section>
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-600">
                Checklist sebelum jualan
              </h4>
              <ul className="space-y-2 text-xs text-neutral-700 touch:text-[11px]">
                <ChecklistItem text="Hitung uang di drawer aktif (yang dipakai shift ini)" />
                <ChecklistItem text="Brankas / petty cash dipisah — jangan dijumlah" />
                <ChecklistItem text="Cek pesan dari shift sebelumnya di kiri" />
                <ChecklistItem text="Setelah Buka Shift, lanjut tandai menu yang habis" />
              </ul>
            </section>
          </div>

          {/* ============ RIGHT: Kas Awal Hero ============ */}
          <div
            className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4 touch:p-3 lg:max-h-[calc(92vh-9rem)] lg:p-5 touch:max-h-none"
            style={{ overscrollBehavior: "contain" }}
          >
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-neutral-900 touch:text-sm">
                  <span className="inline-flex items-center gap-2">
                    <Wallet
                      className="size-4 text-mahakan-green-800"
                      aria-hidden
                    />
                    Kas Awal Drawer Aktif
                  </span>
                </h3>
                <span className="text-[11px] text-neutral-500">
                  Drawer saja · bukan brankas
                </span>
              </div>

              <div
                className={cn(
                  "flex h-16 items-center justify-end rounded-xl border-2 px-5 font-mono text-3xl font-bold tabular-nums text-mahakan-green-900 transition-colors touch:h-14 touch:text-2xl",
                  parsed > 0
                    ? "border-mahakan-green-700 bg-mahakan-green-50"
                    : "border-neutral-200 bg-neutral-50",
                )}
              >
                {formatRupiah(parsed)}
              </div>

              {/* Sesi AE-167 — Kas Awal Standar (flat 200rb). Tombol 1-tap
                * prominent supaya staff nggak salah ketik. */}
              <div className="rounded-xl border-2 border-mahakan-green-700/40 bg-mahakan-green-50/60 p-3 touch:p-2.5">
                {editingStandard ? (
                  <div className="space-y-2">
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-mahakan-green-900">
                      Atur kas awal standar
                    </label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={
                          standardDraft === ""
                            ? ""
                            : Number(
                                standardDraft.replace(/\D/g, "") || "0",
                              ).toLocaleString("id-ID")
                        }
                        onChange={(e) =>
                          setStandardDraft(e.target.value.replace(/\D/g, ""))
                        }
                        placeholder="200.000"
                        className="text-right font-mono"
                      />
                      <Button
                        size="sm"
                        onClick={saveStandard}
                        loading={savingStandard}
                      >
                        Simpan
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditingStandard(false)}
                        disabled={savingStandard}
                      >
                        Batal
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        applyStandard();
                      }}
                      style={{ touchAction: "manipulation" }}
                      disabled={submitting}
                      className={cn(
                        "inline-flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-bold transition-all active:scale-[0.98] touch:py-2",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
                        "disabled:cursor-not-allowed disabled:opacity-50",
                        usingStandard
                          ? "bg-mahakan-green-700 text-white"
                          : "border-2 border-mahakan-green-700 bg-white text-mahakan-green-900 hover:bg-mahakan-green-100",
                      )}
                    >
                      {usingStandard ? (
                        <CheckCircle2 className="size-4" aria-hidden />
                      ) : (
                        <Sparkles className="size-4" aria-hidden />
                      )}
                      {usingStandard ? "Pakai Standar ✓" : "Pakai Standar"} ·{" "}
                      {formatRupiah(standardCash)}
                    </button>
                    {isSupervisor ? (
                      <button
                        type="button"
                        onClick={() => {
                          setStandardDraft(String(standardCash));
                          setEditingStandard(true);
                        }}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-mahakan-green-800 hover:bg-mahakan-green-100"
                        title="Atur kas awal standar (owner/manager)"
                      >
                        <Pencil className="size-3" aria-hidden /> Atur
                      </button>
                    ) : null}
                  </div>
                )}
                <p className="mt-1.5 text-[10px] text-neutral-600 touch:text-[9px]">
                  Standar harian Mahakan. Ubah angka di bawah cuma kalau isi
                  laci memang beda.
                </p>
              </div>

              {/* Carryover info (alternatif, bukan default) */}
              {carryoverDiffersFromStandard ? (
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    setQuickAmount(String(carryoverValue));
                  }}
                  style={{ touchAction: "manipulation" }}
                  disabled={submitting}
                  className="flex w-full items-center justify-between rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-[11px] text-neutral-600 hover:bg-neutral-50 touch:text-[10px]"
                >
                  <span>
                    Kas akhir shift kemarin:{" "}
                    <span className="font-mono font-semibold text-neutral-800">
                      {formatRupiah(carryoverValue ?? 0)}
                    </span>
                  </span>
                  <span className="font-semibold text-mahakan-green-700">
                    Pakai ini →
                  </span>
                </button>
              ) : null}

              {/* Quick amounts */}
              <div className="grid grid-cols-5 gap-1.5 touch:gap-2">
                {QUICK_AMOUNTS.map((q) => (
                  <button
                    key={q.value}
                    type="button"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      setQuickAmount(q.value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setQuickAmount(q.value);
                      }
                    }}
                    style={{ touchAction: "manipulation" }}
                    disabled={submitting}
                    className={cn(
                      "rounded-lg border-2 py-1.5 text-sm font-bold transition-all touch:py-1 touch:text-xs",
                      "hover:bg-mahakan-green-100 active:scale-95",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
                      "disabled:cursor-not-allowed disabled:opacity-50",
                      openingCash === q.value
                        ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
                        : "border-neutral-200 bg-white text-neutral-800",
                    )}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-600">
                  Numpad
                </h4>
              </div>
              <div className="grid grid-cols-3 gap-1.5 touch:gap-2">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                  <NumKey
                    key={d}
                    label={d}
                    onPress={() => appendDigit(d)}
                    disabled={submitting}
                  />
                ))}
                <NumKey
                  label="C"
                  onPress={clearAmount}
                  disabled={submitting}
                  variant="muted"
                />
                <NumKey
                  label="0"
                  onPress={() => appendDigit("0")}
                  disabled={submitting}
                />
                <NumKey
                  label="⌫"
                  onPress={backspace}
                  disabled={submitting}
                  variant="muted"
                />
              </div>
            </section>

            {error ? (
              <p
                role="alert"
                className="rounded-md bg-danger-100 p-2 text-sm font-medium text-danger-500"
              >
                {error}
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        // ============ Step 2: Cek Stok Menu (full width) ============
        // min-h-0 wajib di parent flex container — tanpa itu, child flex-1
        // overflow-y-auto ga punya constrained height (default min-height:
        // auto bikin grow ke content). overscrollBehavior contain prevent
        // scroll chaining ke background page (sesi AE-3 fix).
        <div className="flex h-full min-h-0 flex-col p-4 touch:p-3 lg:max-h-[calc(92vh-9rem)] lg:p-5 touch:max-h-none">
          <div className="mb-3 flex shrink-0 items-start gap-3 rounded-xl border border-mahakan-green-700/30 bg-mahakan-green-50 p-3 touch:p-2">
            <PackageSearch
              className="size-5 shrink-0 text-mahakan-green-800"
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-mahakan-green-900 touch:text-[13px]">
                Tandai menu yang habis sebelum mulai jualan
              </p>
              <p className="text-xs text-neutral-700 touch:text-[11px]">
                Tap item yang stoknya habis → otomatis di-hide dari menu
                customer. Bisa di-edit lagi kapan aja dari panel Shift.
              </p>
            </div>
          </div>
          <div
            className="min-h-0 flex-1 overflow-y-auto"
            style={{ overscrollBehavior: "contain" }}
          >
            <MenuStatusCard
              menuItems={menuItems}
              categories={categories}
              onItemUpdated={onItemUpdated}
            />
          </div>
        </div>
      )}
    </Modal>
  );
}

function ChecklistItem({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-2">
      <CheckCircle2
        className="mt-0.5 size-3.5 shrink-0 text-mahakan-green-700"
        aria-hidden
      />
      <span>{text}</span>
    </li>
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
