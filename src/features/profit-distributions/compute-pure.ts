/**
 * Sesi AE-63c — Pure helper untuk hitung profit distribution.
 *
 * No DB / framework deps — testable isolation. Dipakai di
 * profit-distributions/actions.ts saat owner klik "Hitung Bulan Ini".
 *
 * Algorithm (per spec Sheets Mahakan):
 *
 *  Step 1: Allocate dari Net Profit
 *    bagiHasil     = netProfit × bagiHasilPct/100
 *    lossBricket   = netProfit × lossPct/100
 *    capex         = netProfit × capexPct/100
 *    retained      = netProfit × retainedPct/100
 *
 *  Step 2: Pool split dari bagiHasil
 *    investorPool  = bagiHasil × investorPoolPct/100
 *    pengelolaPool = bagiHasil × pengelolaPoolPct/100
 *
 *  Step 3: Per-holder distribution proporsional by modal disetor
 *    holder.dividen = pool × (holder.modal / total_modal_holder_type)
 *
 *  Step 4: Rounding residue ke retained (jangan over-distribute pool)
 *
 * Edge case:
 *  - netProfit <= 0 → no distribution (loss month — return zeroed result)
 *  - 0 active holder → pool sum 0, residue ke retained
 *  - total_modal_holder = 0 → equal split (defensive; biasanya tidak terjadi)
 */

export interface AllocPct {
  bagiHasil: number;
  loss: number;
  capex: number;
  retained: number;
}

export interface PoolSplit {
  investorPct: number;
  pengelolaPct: number;
}

export interface HolderInput {
  id: string;
  modalDisetor: number;
}

export interface ComputeDistributionInput {
  netProfit: number;
  allocPct: AllocPct;
  poolSplit: PoolSplit;
  investors: HolderInput[];
  pengelola: HolderInput[];
}

export interface HolderLine {
  id: string;
  modalDisetor: number;
  /** Share-pct dalam pool (0..100, 4-decimal precision). */
  sharePct: number;
  /** Amount Rupiah (floor rounded). */
  amount: number;
}

export interface ComputeDistributionResult {
  /** Original input snapshot. */
  netProfit: number;
  /** Bucket allocations (Rupiah, floor rounded). */
  bagiHasilAmount: number;
  lossAmount: number;
  capexAmount: number;
  retainedAmount: number;
  /** Pool amounts (Rupiah, floor rounded). */
  investorPoolAmount: number;
  pengelolaPoolAmount: number;
  /** Per-holder breakdown. */
  perInvestor: HolderLine[];
  perPengelola: HolderLine[];
  /** Rounding residue yang dimasukkan ke retained earnings (Rupiah).
   *  Sum of (pool - sum_of_lines) untuk investor + pengelola pool. */
  roundingResidue: number;
  /** Status: 'normal' kalau distribusi jalan, 'no_profit' kalau
   *  netProfit <= 0 (loss month, semua amount = 0). */
  status: "normal" | "no_profit";
}

/* Helper round floor untuk hindari over-distribute. Math.floor handle
 * negative dengan benar (kita selalu input positive). */
function floorRupiah(n: number): number {
  return Math.floor(n);
}

function sumModal(holders: HolderInput[]): number {
  return holders.reduce((s, h) => s + Math.max(0, h.modalDisetor), 0);
}

function buildPerHolderLines(
  holders: HolderInput[],
  poolAmount: number,
): { lines: HolderLine[]; residue: number } {
  const totalModal = sumModal(holders);

  if (poolAmount === 0 || holders.length === 0) {
    return {
      lines: holders.map((h) => ({
        id: h.id,
        modalDisetor: h.modalDisetor,
        sharePct: 0,
        amount: 0,
      })),
      residue: poolAmount,
    };
  }

  if (totalModal === 0) {
    /* Defensive: holders ada tapi semua modal 0 → equal split. */
    const equalShare = floorRupiah(poolAmount / holders.length);
    const lines = holders.map((h) => ({
      id: h.id,
      modalDisetor: h.modalDisetor,
      sharePct: Number((100 / holders.length).toFixed(4)),
      amount: equalShare,
    }));
    const residue = poolAmount - equalShare * holders.length;
    return { lines, residue };
  }

  let distributed = 0;
  const lines: HolderLine[] = holders.map((h) => {
    const modal = Math.max(0, h.modalDisetor);
    const pct = (modal / totalModal) * 100;
    const amount = floorRupiah((modal / totalModal) * poolAmount);
    distributed += amount;
    return {
      id: h.id,
      modalDisetor: h.modalDisetor,
      sharePct: Number(pct.toFixed(4)),
      amount,
    };
  });
  return { lines, residue: poolAmount - distributed };
}

export function computeDistribution(
  input: ComputeDistributionInput,
): ComputeDistributionResult {
  const { netProfit, allocPct, poolSplit, investors, pengelola } = input;

  if (!Number.isFinite(netProfit) || netProfit <= 0) {
    return {
      netProfit: Math.max(0, netProfit),
      bagiHasilAmount: 0,
      lossAmount: 0,
      capexAmount: 0,
      retainedAmount: 0,
      investorPoolAmount: 0,
      pengelolaPoolAmount: 0,
      perInvestor: investors.map((h) => ({
        id: h.id,
        modalDisetor: h.modalDisetor,
        sharePct: 0,
        amount: 0,
      })),
      perPengelola: pengelola.map((h) => ({
        id: h.id,
        modalDisetor: h.modalDisetor,
        sharePct: 0,
        amount: 0,
      })),
      roundingResidue: 0,
      status: "no_profit",
    };
  }

  /* Step 1: bucket allocation dari Net Profit. */
  const bagiHasilAmount = floorRupiah((netProfit * allocPct.bagiHasil) / 100);
  const lossAmount = floorRupiah((netProfit * allocPct.loss) / 100);
  const capexAmount = floorRupiah((netProfit * allocPct.capex) / 100);
  const retainedBase = floorRupiah((netProfit * allocPct.retained) / 100);

  /* Step 2: pool split dari bagiHasil. */
  const investorPoolAmount = floorRupiah(
    (bagiHasilAmount * poolSplit.investorPct) / 100,
  );
  const pengelolaPoolAmount = floorRupiah(
    (bagiHasilAmount * poolSplit.pengelolaPct) / 100,
  );
  /* Pool split residue dari rounding bagiHasil split — kembali ke retained. */
  const poolSplitResidue =
    bagiHasilAmount - investorPoolAmount - pengelolaPoolAmount;

  /* Step 3: per-holder breakdown. */
  const inv = buildPerHolderLines(investors, investorPoolAmount);
  const pen = buildPerHolderLines(pengelola, pengelolaPoolAmount);

  const totalResidue = poolSplitResidue + inv.residue + pen.residue;
  const retainedAmount = retainedBase + totalResidue;

  return {
    netProfit,
    bagiHasilAmount,
    lossAmount,
    capexAmount,
    retainedAmount,
    investorPoolAmount,
    pengelolaPoolAmount,
    perInvestor: inv.lines,
    perPengelola: pen.lines,
    roundingResidue: totalResidue,
    status: "normal",
  };
}
