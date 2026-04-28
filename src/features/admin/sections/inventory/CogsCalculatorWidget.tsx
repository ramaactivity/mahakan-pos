"use client";

import { useEffect, useMemo, useState } from "react";
import { Calculator, Plus, Trash2 } from "lucide-react";
import { Button, Input, Modal } from "@/components/ui";
import {
  isOk,
  listAtomicIngredients,
  listPreparations,
  type Ingredient,
} from "@/features/inventory";
import { formatRupiah } from "@/lib/format";

interface CogsCalculatorWidgetProps {
  open: boolean;
  onClose: () => void;
}

interface LineDraft {
  key: string;
  ingredientId: string | null;
  qty: string;
}

function makeKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function CogsCalculatorWidget({
  open,
  onClose,
}: CogsCalculatorWidgetProps) {
  const [atomics, setAtomics] = useState<Ingredient[]>([]);
  const [preps, setPreps] = useState<Ingredient[]>([]);
  const [lines, setLines] = useState<LineDraft[]>([
    { key: makeKey(), ingredientId: null, qty: "" },
  ]);
  const [wasteFactorPct, setWasteFactorPct] = useState("30");
  const [markupPct, setMarkupPct] = useState("20");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function loadOpts() {
      setLoading(true);
      const [aRes, pRes] = await Promise.all([
        listAtomicIngredients({ activeOnly: true }),
        listPreparations({ activeOnly: true }),
      ]);
      if (cancelled) return;
      if (isOk(aRes)) setAtomics(aRes.data.items);
      if (isOk(pRes)) setPreps(pRes.data.items);
      setLoading(false);
    }
    void loadOpts();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Reset lines when opening (preserve waste/markup so user can iterate).
  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setLines([{ key: makeKey(), ingredientId: null, qty: "" }]);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open]);

  const ingredientById = useMemo(() => {
    const m = new Map<string, Ingredient>();
    for (const i of atomics) m.set(i.id, i);
    for (const i of preps) m.set(i.id, i);
    return m;
  }, [atomics, preps]);

  function addLine() {
    setLines((prev) => [
      ...prev,
      { key: makeKey(), ingredientId: null, qty: "" },
    ]);
  }

  function removeLine(key: string) {
    setLines((prev) =>
      prev.length > 1 ? prev.filter((l) => l.key !== key) : prev,
    );
  }

  function setLine(key: string, patch: Partial<LineDraft>) {
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    );
  }

  // ---- Live calculation ----
  const filledLines = lines
    .map((l) => {
      if (!l.ingredientId) return null;
      const q = parseInt(l.qty, 10);
      if (!Number.isFinite(q) || q <= 0) return null;
      const ing = ingredientById.get(l.ingredientId);
      if (!ing) return null;
      return { ing, qty: q, lineCost: q * ing.costPerUnit };
    })
    .filter(
      (x): x is { ing: Ingredient; qty: number; lineCost: number } =>
        x !== null,
    );

  const baseCost = filledLines.reduce((acc, l) => acc + l.lineCost, 0);
  const wasteNum = parseInt(wasteFactorPct, 10);
  const wasteAmount =
    Number.isFinite(wasteNum) && wasteNum > 0
      ? Math.round(baseCost * (wasteNum / 100))
      : 0;
  const totalCost = baseCost + wasteAmount;

  const markupNum = parseInt(markupPct, 10);
  const markupAmount =
    Number.isFinite(markupNum) && markupNum > 0
      ? Math.round(totalCost * (markupNum / 100))
      : 0;
  const suggestedSelling = totalCost + markupAmount;
  // Round suggested up to nearest 1000 for cafe-clean pricing.
  const suggestedSellingRounded =
    suggestedSelling > 0 ? Math.ceil(suggestedSelling / 1000) * 1000 : 0;
  const grabgoso =
    suggestedSellingRounded > 0
      ? Math.ceil((suggestedSellingRounded * 1.3) / 1000) * 1000
      : 0;

  const margin = suggestedSellingRounded - totalCost;
  const marginPct =
    suggestedSellingRounded > 0
      ? Math.round((margin / suggestedSellingRounded) * 100)
      : 0;
  const marginColor =
    marginPct >= 50
      ? "text-success-500"
      : marginPct >= 30
        ? "text-warning-500"
        : "text-danger-500";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="COGS Calculator"
      description="Sandbox eksplorasi cost menu baru — input bahan + qty + Q Factor + markup, dapat suggested SELLING + GRABGOSO + margin instant. Tidak nyimpan apa-apa."
      size="lg"
      footer={
        <Button variant="ghost" onClick={onClose}>
          Tutup
        </Button>
      }
    >
      <div className="space-y-4">
        {loading ? (
          <p className="py-3 text-center text-sm text-neutral-500">Memuat…</p>
        ) : atomics.length + preps.length === 0 ? (
          <p className="rounded-md bg-warning-100/40 p-3 text-sm text-warning-500">
            Belum ada bahan/preparation. Tambahkan dulu di tab Bahan atau
            Preparations.
          </p>
        ) : (
          <>
            {/* ---- Bahan lines ---- */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-neutral-900">Bahan</h3>
              {lines.map((line) => {
                const ing = line.ingredientId
                  ? ingredientById.get(line.ingredientId)
                  : null;
                const lineCost =
                  ing && Number.isFinite(parseInt(line.qty, 10))
                    ? parseInt(line.qty, 10) * ing.costPerUnit
                    : 0;
                return (
                  <div
                    key={line.key}
                    className="flex items-end gap-2 rounded-md bg-neutral-50 p-2"
                  >
                    <div className="flex-1 space-y-1">
                      <label className="block text-xs font-medium text-neutral-700">
                        Bahan
                      </label>
                      <select
                        value={line.ingredientId ?? ""}
                        onChange={(e) =>
                          setLine(line.key, {
                            ingredientId: e.target.value || null,
                          })
                        }
                        className="h-9 w-full rounded-md border border-neutral-300 bg-white px-2 text-sm"
                      >
                        <option value="">— pilih bahan —</option>
                        {atomics.length > 0 ? (
                          <optgroup label="Bahan Baku (atomic)">
                            {atomics.map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.name} ({i.unit})
                              </option>
                            ))}
                          </optgroup>
                        ) : null}
                        {preps.length > 0 ? (
                          <optgroup label="Preparations">
                            {preps.map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.name} ({i.unit})
                              </option>
                            ))}
                          </optgroup>
                        ) : null}
                      </select>
                    </div>
                    <div className="w-24">
                      <Input
                        label={`Qty${ing ? ` (${ing.unit})` : ""}`}
                        value={line.qty}
                        onChange={(e) =>
                          setLine(line.key, { qty: e.target.value })
                        }
                        type="text"
                        inputMode="numeric"
                        placeholder="35"
                      />
                    </div>
                    <div className="w-28 text-right">
                      <p className="text-xs text-neutral-500">Subtotal</p>
                      <p className="font-mono text-sm text-neutral-900">
                        {lineCost > 0 ? formatRupiah(lineCost) : "—"}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeLine(line.key)}
                      disabled={lines.length === 1}
                      aria-label="Hapus baris"
                      className="text-danger-500 hover:bg-danger-100 disabled:opacity-30"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                );
              })}
              <Button size="sm" variant="outline" onClick={addLine}>
                <Plus className="size-4" aria-hidden /> Tambah baris
              </Button>
            </div>

            {/* ---- Sliders / inputs ---- */}
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Input
                  label="Q Factor (%)"
                  value={wasteFactorPct}
                  onChange={(e) => setWasteFactorPct(e.target.value)}
                  type="text"
                  inputMode="numeric"
                  placeholder="30"
                />
                <p className="mt-1 text-xs text-neutral-500">
                  Buffer waste/spillage. Default 30% untuk menu, 10% prep.
                </p>
              </div>
              <div>
                <Input
                  label="Markup (%)"
                  value={markupPct}
                  onChange={(e) => setMarkupPct(e.target.value)}
                  type="text"
                  inputMode="numeric"
                  placeholder="20"
                />
                <p className="mt-1 text-xs text-neutral-500">
                  Margin target di atas TOTAL COST sebelum dibulatkan.
                </p>
              </div>
            </div>

            {/* ---- Summary ---- */}
            <div className="space-y-2 rounded-lg border border-mahakan-green-700/30 bg-mahakan-green-100/40 p-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-mahakan-green-900">
                <Calculator className="size-4" aria-hidden /> Hasil
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
                <div>
                  <p className="text-neutral-600">TOTAL bahan</p>
                  <p className="font-mono font-semibold">
                    {formatRupiah(baseCost)}
                  </p>
                </div>
                <div>
                  <p className="text-neutral-600">
                    Q Factor {Number.isFinite(wasteNum) ? wasteNum : 0}%
                  </p>
                  <p className="font-mono font-semibold">
                    {formatRupiah(wasteAmount)}
                  </p>
                </div>
                <div>
                  <p className="text-neutral-600">TOTAL COST</p>
                  <p className="font-mono font-semibold">
                    {formatRupiah(totalCost)}
                  </p>
                </div>
                <div>
                  <p className="text-neutral-600">
                    Markup {Number.isFinite(markupNum) ? markupNum : 0}%
                  </p>
                  <p className="font-mono font-semibold">
                    {formatRupiah(markupAmount)}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 border-t border-neutral-200/60 pt-2 text-xs md:grid-cols-3">
                <div>
                  <p className="text-neutral-600">Suggested SELLING</p>
                  <p className="font-mono text-base font-bold text-mahakan-green-900">
                    {formatRupiah(suggestedSellingRounded)}
                  </p>
                  <p className="text-[10px] text-neutral-500">
                    (rounded ke 1000 terdekat)
                  </p>
                </div>
                <div>
                  <p className="text-neutral-600">GRABGOSO 30%</p>
                  <p className="font-mono text-base font-bold text-neutral-700">
                    {formatRupiah(grabgoso)}
                  </p>
                </div>
                <div>
                  <p className="text-neutral-600">Margin</p>
                  <p
                    className={`font-mono text-base font-bold ${marginColor}`}
                  >
                    {formatRupiah(margin)} ({marginPct}%)
                  </p>
                </div>
              </div>
            </div>

            <p className="text-xs text-neutral-500">
              Tip: nilai cost preparation otomatis sudah pakai waste-nya
              sendiri (cascade engine). Q Factor di kalkulator ini cuma untuk
              menu-level waste (di atas waste yang sudah baked-in di
              preparation cost).
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
