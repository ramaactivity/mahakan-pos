"use client";

import { useEffect, useState } from "react";
import {
  Pause,
  Pencil,
  Play,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Skeleton,
  toast,
} from "@/components/ui";
import {
  deletePromo,
  isOk,
  listPromos,
  updatePromo,
  type Promo,
  type PromoStatus,
  type PromoWithStats,
} from "@/features/promos";
import { PromoFormModal } from "./promos/PromoFormModal";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUS_FILTERS: Array<{ value: PromoStatus | "all"; label: string }> = [
  { value: "all", label: "Semua" },
  { value: "active", label: "Aktif" },
  { value: "draft", label: "Draft" },
  { value: "paused", label: "Pause" },
  { value: "archived", label: "Arsip" },
];

const STATUS_BADGE: Record<
  PromoStatus,
  { variant: "success" | "neutral" | "warning" | "info"; label: string }
> = {
  active: { variant: "success", label: "Aktif" },
  draft: { variant: "neutral", label: "Draft" },
  paused: { variant: "warning", label: "Pause" },
  archived: { variant: "neutral", label: "Arsip" },
};

const DAY_LABELS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

export function PromoSection() {
  const [items, setItems] = useState<PromoWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [statusFilter, setStatusFilter] = useState<PromoStatus | "all">("all");

  const [formOpen, setFormOpen] = useState(false);
  const [formInitial, setFormInitial] = useState<Promo | null>(null);

  useEffect(() => {
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    void (async () => {
      const res = await listPromos(statusFilter);
      if (cancelled) return;
      if (isOk(res)) setItems(res.data);
      else toast.error(res.error.message);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [statusFilter, refreshKey]);

  function openCreate() {
    setFormInitial(null);
    setFormOpen(true);
  }

  function openEdit(p: Promo) {
    setFormInitial(p);
    setFormOpen(true);
  }

  async function togglePause(p: Promo) {
    const next: PromoStatus = p.status === "active" ? "paused" : "active";
    const res = await updatePromo({
      id: p.id,
      name: p.name,
      description: p.description,
      discountType: p.discountType,
      discountValue: p.discountValue,
      maxDiscountAmount: p.maxDiscountAmount,
      scope: p.scope,
      scopeCategoryIds: p.scopeCategoryIds,
      minSubtotal: p.minSubtotal,
      applicableOrderTypes: p.applicableOrderTypes as Array<
        "dine_in" | "takeaway"
      > | null,
      applicablePaymentMethods: p.applicablePaymentMethods as Array<
        "cash" | "qris" | "card_bca" | "split"
      > | null,
      startDate: p.startDate,
      endDate: p.endDate,
      daysOfWeek: p.daysOfWeek,
      startTime: p.startTime,
      endTime: p.endTime,
      maxTotalUses: p.maxTotalUses,
      requiresApproval: p.requiresApproval,
      status: next,
    });
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(next === "paused" ? "Promo dipause" : "Promo diaktifkan");
    setRefreshKey((k) => k + 1);
  }

  async function handleDelete(p: Promo) {
    if (!confirm(`Arsipkan promo "${p.name}"?`)) return;
    const res = await deletePromo(p.id);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Promo diarsipkan");
    setRefreshKey((k) => k + 1);
  }

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-mahakan-green-900">
            <Sparkles className="size-6" aria-hidden /> Promo &amp; Campaign
          </h1>
          <p className="mt-1 text-sm text-neutral-600">
            Kelola diskon, kompensasi, dan campaign. Staff hanya bisa apply
            promo yang Anda setup di sini — tidak ada input manual di POS.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="size-4" aria-hidden /> Buat Promo
        </Button>
      </header>

      {/* Status filter chips */}
      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setStatusFilter(f.value)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              statusFilter === f.value
                ? "border-mahakan-green-700 bg-mahakan-green-100 text-mahakan-green-900"
                : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Sparkles className="mx-auto size-10 text-neutral-300" aria-hidden />
            <p className="mt-3 text-sm font-medium text-neutral-700">
              {statusFilter === "all"
                ? "Belum ada promo"
                : `Tidak ada promo ${STATUS_FILTERS.find((f) => f.value === statusFilter)?.label.toLowerCase()}`}
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              Buat promo pertama supaya staff bisa apply di POS.
            </p>
            <Button onClick={openCreate} className="mt-4">
              <Plus className="size-4" aria-hidden /> Buat Promo
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {items.map((p) => (
            <PromoCard
              key={p.id}
              promo={p}
              onEdit={() => openEdit(p)}
              onTogglePause={() => togglePause(p)}
              onDelete={() => handleDelete(p)}
            />
          ))}
        </div>
      )}

      <PromoFormModal
        open={formOpen}
        initial={formInitial}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          setRefreshKey((k) => k + 1);
        }}
      />
    </div>
  );
}

function PromoCard({
  promo,
  onEdit,
  onTogglePause,
  onDelete,
}: {
  promo: PromoWithStats;
  onEdit: () => void;
  onTogglePause: () => void;
  onDelete: () => void;
}) {
  const status = STATUS_BADGE[promo.status];
  const valueLabel =
    promo.discountType === "percent"
      ? `${promo.discountValue}%`
      : formatRupiah(promo.discountValue);
  const capLabel =
    promo.discountType === "percent" && promo.maxDiscountAmount
      ? ` · max -${formatRupiah(promo.maxDiscountAmount)}`
      : "";
  const scopeLabel =
    promo.scope === "whole_bill"
      ? "Whole bill"
      : `Kategori (${promo.scopeCategoryIds?.length ?? 0})`;
  const daysLabel =
    promo.daysOfWeek && promo.daysOfWeek.length > 0
      ? promo.daysOfWeek.map((d) => DAY_LABELS[d - 1]).join("/")
      : "Tiap hari";
  const timeLabel =
    promo.startTime && promo.endTime
      ? ` · ${promo.startTime}–${promo.endTime}`
      : "";
  const dateLabel =
    promo.startDate && promo.endDate
      ? `${promo.startDate} → ${promo.endDate}`
      : promo.startDate
        ? `Mulai ${promo.startDate}`
        : promo.endDate
          ? `Sampai ${promo.endDate}`
          : "Tanpa batas tanggal";
  const usageLabel =
    promo.maxTotalUses !== null
      ? `${promo.currentUses} / ${promo.maxTotalUses}`
      : `${promo.currentUses}`;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-semibold text-neutral-900">
              {promo.name}
            </h3>
            <Badge variant={status.variant}>{status.label}</Badge>
            {promo.requiresApproval ? (
              <Badge variant="info">Approval</Badge>
            ) : null}
          </div>
          {promo.description ? (
            <p className="mt-0.5 truncate text-xs text-neutral-500">
              {promo.description}
            </p>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-2xl font-bold text-mahakan-green-700">
            -{valueLabel}
          </span>
          <span className="text-xs text-neutral-500">{scopeLabel}{capLabel}</span>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-neutral-600">
          <div>
            <span className="text-neutral-400">Jadwal:</span> {daysLabel}
            {timeLabel}
          </div>
          <div>
            <span className="text-neutral-400">Periode:</span> {dateLabel}
          </div>
          <div>
            <span className="text-neutral-400">Pemakaian:</span> {usageLabel}
          </div>
          <div>
            <span className="text-neutral-400">Total diskon:</span>{" "}
            {formatRupiah(promo.totalDiscountGiven)}
          </div>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" variant="ghost" onClick={onEdit}>
            <Pencil className="size-3.5" aria-hidden /> Edit
          </Button>
          {promo.status === "active" || promo.status === "paused" ? (
            <Button size="sm" variant="ghost" onClick={onTogglePause}>
              {promo.status === "active" ? (
                <>
                  <Pause className="size-3.5" aria-hidden /> Pause
                </>
              ) : (
                <>
                  <Play className="size-3.5" aria-hidden /> Aktifkan
                </>
              )}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            onClick={onDelete}
            className="!text-danger-500 hover:!bg-danger-100/40"
          >
            <Trash2 className="size-3.5" aria-hidden /> Arsip
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
