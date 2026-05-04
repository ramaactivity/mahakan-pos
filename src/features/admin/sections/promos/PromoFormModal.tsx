"use client";

import { useEffect, useState } from "react";
import {
  Button,
  DatePicker,
  Input,
  Modal,
  Select,
  TimePicker,
  toast,
} from "@/components/ui";
import {
  createPromo,
  isOk,
  updatePromo,
  type CreatePromoInput,
  type Promo,
  type PromoDiscountType,
  type PromoScope,
  type PromoStatus,
} from "@/features/promos";
import { listCategories, type Category } from "@/features/menu";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

interface PromoFormModalProps {
  open: boolean;
  initial: Promo | null;
  onClose: () => void;
  onSaved: () => void;
}

type Tab = "dasar" | "aturan" | "jadwal";

const DAY_LABELS: Array<{ id: number; label: string }> = [
  { id: 1, label: "Sen" },
  { id: 2, label: "Sel" },
  { id: 3, label: "Rab" },
  { id: 4, label: "Kam" },
  { id: 5, label: "Jum" },
  { id: 6, label: "Sab" },
  { id: 7, label: "Min" },
];

export function PromoFormModal({
  open,
  initial,
  onClose,
  onSaved,
}: PromoFormModalProps) {
  const [tab, setTab] = useState<Tab>("dasar");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);

  // Dasar
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [discountType, setDiscountType] = useState<PromoDiscountType>("percent");
  const [discountValue, setDiscountValue] = useState("");
  const [maxDiscountAmount, setMaxDiscountAmount] = useState("");
  const [status, setStatus] = useState<PromoStatus>("draft");

  // Aturan
  const [scope, setScope] = useState<PromoScope>("whole_bill");
  const [scopeCategoryIds, setScopeCategoryIds] = useState<string[]>([]);
  const [minSubtotal, setMinSubtotal] = useState("");
  const [orderTypes, setOrderTypes] = useState<Array<"dine_in" | "takeaway">>([]);
  const [paymentMethods, setPaymentMethods] = useState<
    Array<
      | "cash"
      | "qris"
      | "card_bca"
      | "card_bni"
      | "card_mandiri"
      | "card_bri"
      | "card_other"
      | "split"
    >
  >([]);
  const [requiresApproval, setRequiresApproval] = useState(false);

  // Jadwal
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([]);
  const [startTime, setStartTime] = useState<string>("");
  const [endTime, setEndTime] = useState<string>("");
  const [maxTotalUses, setMaxTotalUses] = useState("");

  // Load categories for category-scope picker.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await listCategories();
        if (cancelled) return;
        if (isOk(res)) setCategories(res.data.items);
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : "Gagal load kategori";
          toast.error(msg);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Reset form when modal opens or `initial` changes.
  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setTab("dasar");
    setError(null);
    setSubmitting(false);
    if (initial) {
      setName(initial.name);
      setDescription(initial.description ?? "");
      setDiscountType(initial.discountType);
      setDiscountValue(String(initial.discountValue));
      setMaxDiscountAmount(
        initial.maxDiscountAmount !== null
          ? String(initial.maxDiscountAmount)
          : "",
      );
      setStatus(initial.status);
      setScope(initial.scope);
      setScopeCategoryIds(initial.scopeCategoryIds ?? []);
      setMinSubtotal(
        initial.minSubtotal !== null ? String(initial.minSubtotal) : "",
      );
      setOrderTypes(
        (initial.applicableOrderTypes ?? []) as Array<"dine_in" | "takeaway">,
      );
      setPaymentMethods(
        (initial.applicablePaymentMethods ?? []) as Array<
          | "cash"
          | "qris"
          | "card_bca"
          | "card_bni"
          | "card_mandiri"
          | "card_bri"
          | "card_other"
          | "split"
        >,
      );
      setRequiresApproval(initial.requiresApproval);
      setStartDate(initial.startDate ?? "");
      setEndDate(initial.endDate ?? "");
      setDaysOfWeek(initial.daysOfWeek ?? []);
      setStartTime(initial.startTime ?? "");
      setEndTime(initial.endTime ?? "");
      setMaxTotalUses(
        initial.maxTotalUses !== null ? String(initial.maxTotalUses) : "",
      );
    } else {
      setName("");
      setDescription("");
      setDiscountType("percent");
      setDiscountValue("");
      setMaxDiscountAmount("");
      setStatus("draft");
      setScope("whole_bill");
      setScopeCategoryIds([]);
      setMinSubtotal("");
      setOrderTypes([]);
      setPaymentMethods([]);
      setRequiresApproval(false);
      setStartDate("");
      setEndDate("");
      setDaysOfWeek([]);
      setStartTime("");
      setEndTime("");
      setMaxTotalUses("");
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, initial]);

  function buildInput(): CreatePromoInput | null {
    setError(null);
    if (name.trim().length === 0) {
      setError("Nama promo wajib diisi");
      setTab("dasar");
      return null;
    }
    const dvNum = parseInt(discountValue, 10);
    if (!Number.isFinite(dvNum) || dvNum < 1) {
      setError("Value diskon harus angka > 0");
      setTab("dasar");
      return null;
    }
    if (discountType === "percent" && (dvNum < 1 || dvNum > 100)) {
      setError("Persentase harus 1–100");
      setTab("dasar");
      return null;
    }
    if (scope === "category" && scopeCategoryIds.length === 0) {
      setError("Pilih minimal 1 kategori");
      setTab("aturan");
      return null;
    }

    return {
      name: name.trim(),
      description: description.trim() || null,
      discountType,
      discountValue: dvNum,
      maxDiscountAmount:
        maxDiscountAmount.trim() === "" || discountType === "fixed"
          ? null
          : parseInt(maxDiscountAmount, 10),
      scope,
      scopeCategoryIds: scope === "category" ? scopeCategoryIds : null,
      minSubtotal:
        minSubtotal.trim() === "" ? null : parseInt(minSubtotal, 10),
      applicableOrderTypes: orderTypes.length > 0 ? orderTypes : null,
      applicablePaymentMethods:
        paymentMethods.length > 0 ? paymentMethods : null,
      startDate: startDate || null,
      endDate: endDate || null,
      daysOfWeek: daysOfWeek.length > 0 ? daysOfWeek : null,
      startTime: startTime || null,
      endTime: endTime || null,
      maxTotalUses:
        maxTotalUses.trim() === "" ? null : parseInt(maxTotalUses, 10),
      requiresApproval,
      status,
    };
  }

  async function handleSubmit() {
    const input = buildInput();
    if (!input) return;
    setSubmitting(true);
    const res = initial
      ? await updatePromo({ ...input, id: initial.id })
      : await createPromo(input);
    setSubmitting(false);
    if (!isOk(res)) {
      setError(res.error.message);
      return;
    }
    toast.success(initial ? "Promo diupdate" : "Promo dibuat");
    onSaved();
  }

  function toggleDay(d: number) {
    setDaysOfWeek((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort(),
    );
  }

  function toggleOrderType(t: "dine_in" | "takeaway") {
    setOrderTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  }

  function togglePaymentMethod(
    m:
      | "cash"
      | "qris"
      | "card_bca"
      | "card_bni"
      | "card_mandiri"
      | "card_bri"
      | "card_other"
      | "split",
  ) {
    setPaymentMethods((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m],
    );
  }

  function toggleCategoryId(id: string) {
    setScopeCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? "Edit Promo" : "Buat Promo Baru"}
      description="Setup promo yang nanti staff bisa apply di POS."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button onClick={handleSubmit} loading={submitting}>
            {initial ? "Simpan Perubahan" : "Buat Promo"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Tabs */}
        <div className="flex gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-1">
          {(
            [
              { id: "dasar", label: "1. Dasar" },
              { id: "aturan", label: "2. Aturan" },
              { id: "jadwal", label: "3. Jadwal" },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                tab === t.id
                  ? "bg-white text-mahakan-green-900 shadow-sm"
                  : "text-neutral-600 hover:bg-white/50",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab: Dasar */}
        {tab === "dasar" ? (
          <div className="space-y-3">
            <Input
              label="Nama Promo"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 120))}
              placeholder="Mis. Diskon Weekend 10%"
              required
            />
            <Input
              label="Deskripsi (opsional)"
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, 500))}
              placeholder="Ditampilkan di POS sebagai keterangan"
            />
            <div className="grid grid-cols-2 gap-3">
              <Select
                label="Tipe Diskon"
                value={discountType}
                onValueChange={(v) => setDiscountType(v as PromoDiscountType)}
                options={[
                  { value: "percent", label: "Persentase (%)" },
                  { value: "fixed", label: "Nominal Rupiah" },
                ]}
              />
              <Input
                label={
                  discountType === "percent"
                    ? "Persentase (1–100)"
                    : "Nominal (Rp)"
                }
                type="text"
                inputMode="numeric"
                value={discountValue}
                onChange={(e) =>
                  setDiscountValue(e.target.value.replace(/\D/g, ""))
                }
                hint={
                  discountType === "fixed" && discountValue
                    ? `Preview: ${formatRupiah(parseInt(discountValue, 10) || 0)}`
                    : undefined
                }
              />
            </div>
            {discountType === "percent" ? (
              <Input
                label="Cap Maksimum Diskon (opsional)"
                type="text"
                inputMode="numeric"
                value={maxDiscountAmount}
                onChange={(e) =>
                  setMaxDiscountAmount(e.target.value.replace(/\D/g, ""))
                }
                hint={
                  maxDiscountAmount
                    ? `Maks ${formatRupiah(parseInt(maxDiscountAmount, 10) || 0)} meski persentasenya hitung lebih`
                    : "Kosong = tidak ada cap"
                }
              />
            ) : null}
            <Select
              label="Status"
              value={status}
              onValueChange={(v) => setStatus(v as PromoStatus)}
              options={[
                { value: "draft", label: "Draft (belum tampil di POS)" },
                { value: "active", label: "Aktif (tampil di POS)" },
                { value: "paused", label: "Pause (sembunyi sementara)" },
                { value: "archived", label: "Arsip" },
              ]}
            />
          </div>
        ) : null}

        {/* Tab: Aturan */}
        {tab === "aturan" ? (
          <div className="space-y-3">
            <Select
              label="Scope Diskon"
              value={scope}
              onValueChange={(v) => setScope(v as PromoScope)}
              options={[
                { value: "whole_bill", label: "Whole Bill (seluruh subtotal)" },
                { value: "category", label: "Kategori tertentu" },
              ]}
            />
            {scope === "category" ? (
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-neutral-900">
                  Pilih Kategori
                </p>
                <div className="flex flex-wrap gap-2">
                  {categories.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleCategoryId(c.id)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                        scopeCategoryIds.includes(c.id)
                          ? "border-mahakan-green-700 bg-mahakan-green-100 text-mahakan-green-900"
                          : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50",
                      )}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
                {scopeCategoryIds.length === 0 ? (
                  <p className="text-xs text-warning-500">
                    Pilih minimal 1 kategori
                  </p>
                ) : null}
              </div>
            ) : null}

            <Input
              label="Min Belanja (opsional)"
              type="text"
              inputMode="numeric"
              value={minSubtotal}
              onChange={(e) =>
                setMinSubtotal(e.target.value.replace(/\D/g, ""))
              }
              hint={
                minSubtotal
                  ? `Bill minimum ${formatRupiah(parseInt(minSubtotal, 10) || 0)} agar promo berlaku`
                  : "Kosong = tidak ada minimum"
              }
            />

            <ChipGroup
              label="Berlaku untuk Order Type"
              options={[
                { value: "dine_in", label: "Dine-in" },
                { value: "takeaway", label: "Takeaway" },
              ]}
              selected={orderTypes}
              onToggle={(v) => toggleOrderType(v as "dine_in" | "takeaway")}
              hint="Kosong = berlaku untuk semua"
            />

            <ChipGroup
              label="Berlaku untuk Pembayaran"
              options={[
                { value: "cash", label: "Tunai" },
                { value: "qris", label: "QRIS" },
                { value: "card_bca", label: "Kartu BCA" },
                { value: "card_bni", label: "Kartu BNI" },
                { value: "card_mandiri", label: "Kartu Mandiri" },
                { value: "card_bri", label: "Kartu BRI" },
                { value: "card_other", label: "Kartu Lainnya" },
                { value: "split", label: "Split" },
              ]}
              selected={paymentMethods}
              onToggle={(v) =>
                togglePaymentMethod(
                  v as
                    | "cash"
                    | "qris"
                    | "card_bca"
                    | "card_bni"
                    | "card_mandiri"
                    | "card_bri"
                    | "card_other"
                    | "split",
                )
              }
              hint="Kosong = berlaku untuk semua"
            />

            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-neutral-200 p-3 hover:bg-neutral-50">
              <input
                type="checkbox"
                checked={requiresApproval}
                onChange={(e) => setRequiresApproval(e.target.checked)}
                className="mt-0.5 size-4 accent-mahakan-green-700"
              />
              <span>
                <span className="block text-sm font-medium text-neutral-900">
                  Butuh persetujuan Owner / Manager
                </span>
                <span className="text-xs text-neutral-500">
                  Saat staff apply promo ini di POS, akan minta PIN
                  Owner/Manager dulu. Cocok untuk diskon besar / kompensasi.
                </span>
              </span>
            </label>
          </div>
        ) : null}

        {/* Tab: Jadwal */}
        {tab === "jadwal" ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <DatePicker
                label="Tanggal Mulai (opsional)"
                value={startDate || null}
                onChange={(v) => setStartDate(v ?? "")}
                placeholder="Mulai berlaku"
              />
              <DatePicker
                label="Tanggal Akhir (opsional)"
                value={endDate || null}
                onChange={(v) => setEndDate(v ?? "")}
                placeholder="Tanggal kadaluarsa"
                minDate={startDate || undefined}
              />
            </div>

            <div className="space-y-1.5">
              <p className="text-sm font-medium text-neutral-900">
                Hari Berlaku
              </p>
              <div className="flex flex-wrap gap-2">
                {DAY_LABELS.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => toggleDay(d.id)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      daysOfWeek.includes(d.id)
                        ? "border-mahakan-green-700 bg-mahakan-green-100 text-mahakan-green-900"
                        : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50",
                    )}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-neutral-500">
                {daysOfWeek.length === 0
                  ? "Kosong = berlaku tiap hari"
                  : `Berlaku ${daysOfWeek.length} hari per minggu`}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <TimePicker
                label="Jam Mulai (opsional)"
                value={startTime || null}
                onChange={(v) => setStartTime(v ?? "")}
                placeholder="HH:MM"
              />
              <TimePicker
                label="Jam Akhir (opsional)"
                value={endTime || null}
                onChange={(v) => setEndTime(v ?? "")}
                placeholder="HH:MM"
              />
            </div>
            <p className="text-xs text-neutral-500">
              Jam kosong = berlaku 24 jam pada hari yang dipilih.
            </p>

            <Input
              label="Limit Total Pemakaian (opsional)"
              type="text"
              inputMode="numeric"
              value={maxTotalUses}
              onChange={(e) =>
                setMaxTotalUses(e.target.value.replace(/\D/g, ""))
              }
              hint={
                maxTotalUses
                  ? `Promo otomatis berhenti setelah dipakai ${maxTotalUses}×`
                  : "Kosong = tidak terbatas"
              }
            />
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm font-medium text-danger-500">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

interface ChipGroupProps<T extends string> {
  label: string;
  options: Array<{ value: T; label: string }>;
  selected: T[];
  onToggle: (v: T) => void;
  hint?: string;
}

function ChipGroup<T extends string>({
  label,
  options,
  selected,
  onToggle,
  hint,
}: ChipGroupProps<T>) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium text-neutral-900">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onToggle(o.value)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              selected.includes(o.value)
                ? "border-mahakan-green-700 bg-mahakan-green-100 text-mahakan-green-900"
                : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      {hint ? <p className="text-xs text-neutral-500">{hint}</p> : null}
    </div>
  );
}
