"use client";

import { useEffect, useMemo, useState } from "react";
import { Calculator, Coffee, Plus, Trash2 } from "lucide-react";
import {
  Button,
  Combobox,
  Input,
  Modal,
  toast,
  type ComboboxGroup,
} from "@/components/ui";
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
  /** Phase 7.3 — kalau di-set, button "Save as Menu Item" muncul saat ada
   * suggested price. Click handler should navigate parent ke Menu section.
   * Calculator akan menulis prefill payload ke sessionStorage sebelum invoke. */
  onSaveAsMenu?: () => void;
}

/** sessionStorage key untuk hand-off prefill dari calculator → MenuSection. */
export const COGS_PREFILL_KEY = "mahakan.cogs-prefill.v1";

export interface CogsPrefillPayload {
  /** Suggested selling price (rounded), in rupiah. */
  suggestedPrice: number;
  /** Total COGS for reference (display only). */
  cogs: number;
  /** Markup% used (display only). */
  markupPct: number;
  /** Source description for the hint banner di MenuItemFormModal. */
  source: string;
  /** Captured at — for staleness detection (older than 30min ignored). */
  capturedAt: number;
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
  onSaveAsMenu,
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

  const ingredientGroups: ComboboxGroup[] = useMemo(() => {
    const groups: ComboboxGroup[] = [];
    if (atomics.length > 0) {
      groups.push({
        label: "Bahan Baku",
        options: atomics.map((i) => ({
          value: i.id,
          label: i.name,
          hint: i.unit,
          keywords: [i.unit],
        })),
      });
    }
    if (preps.length > 0) {
      groups.push({
        label: "Preparations",
        options: preps.map((i) => ({
          value: i.id,
          label: i.name,
          hint: i.unit,
          keywords: [i.unit, "prep"],
        })),
      });
    }
    return groups;
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

  function handleSaveAsMenu() {
    if (!onSaveAsMenu) return;
    if (suggestedSellingRounded <= 0) {
      toast.warning("Belum ada hasil — pilih bahan + qty dulu");
      return;
    }
    const payload: CogsPrefillPayload = {
      suggestedPrice: suggestedSellingRounded,
      cogs: totalCost,
      markupPct: Number.isFinite(markupNum) ? markupNum : 0,
      source: `COGS Calculator (${filledLines.length} bahan, waste ${
        Number.isFinite(wasteNum) ? wasteNum : 0
      }%, markup ${Number.isFinite(markupNum) ? markupNum : 0}%)`,
      capturedAt: Date.now(),
    };
    try {
      sessionStorage.setItem(COGS_PREFILL_KEY, JSON.stringify(payload));
    } catch {
      // sessionStorage may be blocked — fail soft, owner can still type manually
    }
    toast.info("Buka tab Menu, klik Tambah Menu — harga sudah ter-prefill");
    onSaveAsMenu();
  }

  const canSaveAsMenu =
    typeof onSaveAsMenu === "function" && suggestedSellingRounded > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="COGS Calculator"
      description="Sandbox eksplorasi cost menu baru — tidak menyimpan apa-apa."
      size="3xl"
      footer={
        <>
          {canSaveAsMenu ? (
            <Button onClick={handleSaveAsMenu}>
              <Coffee className="size-4" aria-hidden /> Save as Menu Item
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Tutup
          </Button>
        </>
      }
    >
      {loading ? (
        <p className="py-8 text-center text-sm text-neutral-500">Memuat…</p>
      ) : atomics.length + preps.length === 0 ? (
        <p className="rounded-md bg-warning-100/40 p-3 text-sm text-warning-500">
          Belum ada bahan/preparation. Tambahkan dulu di tab Bahan atau
          Preparations.
        </p>
      ) : (
        <div className="space-y-6">
          {/* ---- Bahan section ---- */}
          <section>
            <header className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-neutral-900">
                  Bahan
                </h3>
                <p className="text-xs text-neutral-500">
                  Pilih bahan dan masukkan qty. Subtotal dihitung otomatis.
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={addLine}>
                <Plus className="size-4" aria-hidden /> Tambah baris
              </Button>
            </header>

            <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
              {/* Header row — hidden on mobile for cleanliness */}
              <div className="hidden grid-cols-[1fr_8rem_8rem_2.5rem] items-center gap-3 border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-xs font-medium uppercase tracking-wide text-neutral-500 md:grid">
                <span>Bahan</span>
                <span>Qty</span>
                <span className="text-right">Subtotal</span>
                <span />
              </div>
              <ul className="divide-y divide-neutral-200">
                {lines.map((line) => {
                  const ing = line.ingredientId
                    ? ingredientById.get(line.ingredientId)
                    : null;
                  const lineCost =
                    ing && Number.isFinite(parseInt(line.qty, 10))
                      ? parseInt(line.qty, 10) * ing.costPerUnit
                      : 0;
                  return (
                    <li
                      key={line.key}
                      className="grid grid-cols-1 gap-2 px-3 py-2.5 md:grid-cols-[1fr_8rem_8rem_2.5rem] md:items-center md:gap-3"
                    >
                      <div className="md:hidden">
                        <p className="mb-1 text-xs font-medium text-neutral-700">
                          Bahan
                        </p>
                      </div>
                      <Combobox
                        ariaLabel="Pilih bahan"
                        groups={ingredientGroups}
                        value={line.ingredientId}
                        onChange={(v) =>
                          setLine(line.key, { ingredientId: v })
                        }
                        placeholder="— pilih bahan —"
                        searchPlaceholder="Cari bahan…"
                        size="sm"
                        hideLabel
                      />
                      <div className="grid grid-cols-[1fr_8rem_2.5rem] items-center gap-2 md:contents">
                        <div className="md:hidden">
                          <p className="text-xs font-medium text-neutral-700">
                            Qty {ing ? `(${ing.unit})` : ""}
                          </p>
                        </div>
                        <Input
                          aria-label="Qty"
                          value={line.qty}
                          onChange={(e) =>
                            setLine(line.key, { qty: e.target.value })
                          }
                          type="text"
                          inputMode="numeric"
                          placeholder="35"
                          className="h-9"
                        />
                        <div className="text-right">
                          <p className="text-[10px] uppercase tracking-wide text-neutral-500 md:hidden">
                            Subtotal
                          </p>
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
                          className="!size-9 !min-h-9 !p-0 text-danger-500 hover:bg-danger-100 disabled:opacity-30"
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>

          {/* ---- Tunables ---- */}
          <section className="grid gap-4 md:grid-cols-2">
            <div>
              <Input
                label="Q Factor (%)"
                value={wasteFactorPct}
                onChange={(e) => setWasteFactorPct(e.target.value)}
                type="text"
                inputMode="numeric"
                placeholder="30"
                hint="Buffer waste/spillage. Default 30% untuk menu, 10% prep."
              />
            </div>
            <div>
              <Input
                label="Markup (%)"
                value={markupPct}
                onChange={(e) => setMarkupPct(e.target.value)}
                type="text"
                inputMode="numeric"
                placeholder="20"
                hint="Margin target di atas TOTAL COST sebelum dibulatkan."
              />
            </div>
          </section>

          {/* ---- Summary ---- */}
          <section className="rounded-lg border border-mahakan-green-700/30 bg-mahakan-green-100/40 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-mahakan-green-900">
              <Calculator className="size-4" aria-hidden /> Hasil
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
              <div>
                <dt className="text-xs text-neutral-600">TOTAL bahan</dt>
                <dd className="font-mono font-semibold text-neutral-900">
                  {formatRupiah(baseCost)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-neutral-600">
                  Q Factor {Number.isFinite(wasteNum) ? wasteNum : 0}%
                </dt>
                <dd className="font-mono font-semibold text-neutral-900">
                  {formatRupiah(wasteAmount)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-neutral-600">TOTAL COST</dt>
                <dd className="font-mono font-semibold text-neutral-900">
                  {formatRupiah(totalCost)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-neutral-600">
                  Markup {Number.isFinite(markupNum) ? markupNum : 0}%
                </dt>
                <dd className="font-mono font-semibold text-neutral-900">
                  {formatRupiah(markupAmount)}
                </dd>
              </div>
            </dl>
            <div className="mt-3 grid grid-cols-1 gap-3 border-t border-mahakan-green-700/20 pt-3 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-neutral-600">Suggested SELLING</dt>
                <dd className="font-mono text-base font-bold text-mahakan-green-900">
                  {formatRupiah(suggestedSellingRounded)}
                </dd>
                <p className="mt-0.5 text-[10px] text-neutral-500">
                  rounded ke 1.000 terdekat
                </p>
              </div>
              <div>
                <dt className="text-xs text-neutral-600">GRABGOSO 30%</dt>
                <dd className="font-mono text-base font-bold text-neutral-700">
                  {formatRupiah(grabgoso)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-neutral-600">Margin</dt>
                <dd className={`font-mono text-base font-bold ${marginColor}`}>
                  {formatRupiah(margin)} ({marginPct}%)
                </dd>
              </div>
            </div>
          </section>

          <p className="text-xs text-neutral-500">
            Tip: nilai cost preparation otomatis sudah pakai waste-nya sendiri
            (cascade engine). Q Factor di kalkulator ini cuma untuk menu-level
            waste (di atas waste yang sudah baked-in di preparation cost).
          </p>
        </div>
      )}
    </Modal>
  );
}
