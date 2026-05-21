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

/* ============================================================================
 * Sesi AE-80 — Waterfall V2 (Ledger / Mutasi Dinamis)
 * ============================================================================
 *
 * Perbedaan dari V1:
 *   - bagi_hasil di-derive dari (net − loss − capex) × payout_ratio,
 *     BUKAN dari net × bagiHasilPct langsung.
 *   - payout_ratio MANUAL per distribution (default 10%, editable).
 *   - retained = sisa otomatis (net − loss − capex − bagi_hasil), bukan
 *     bucket dengan rate sendiri.
 *   - investor_pool/pengelola_pool: pengelola_pool serap RESIDUE rounding
 *     per-investor (bukan ke retained seperti V1).
 *   - share_pct sum < 100 → sisa (100 − sum) di-treat sebagai "company
 *     share" → masuk pengelola_pool.
 *
 * Pengelola model: multiple pengelola (5 orang) di-split proportional by
 * modal_disetor di dalam pengelola_pool, sama pattern V1. Setelah split,
 * residue dari per-investor allocation ditambahkan ke pengelola_pool
 * SEBELUM di-split ke 5 pengelola.
 *
 * Rounding strategy: Math.round (bukan floor) — sesuai spec user. Sisa
 * "uang yang ke-mana" tidak boleh hilang; selalu masuk pengelola_pool
 * (sebagai residue absorber level investor) atau dari retained (sisa
 * otomatis = net − semua bucket).
 *
 * Invariants (di-test):
 *   1. loss + capex + bagi_hasil + retained = net (exact)
 *   2. investor_pool + pengelola_pool = bagi_hasil (exact, residue
 *      ditarik dari pengelola_pool)
 *   3. Σ per_investor amount = investor_pool_final (after residue moved
 *      to pengelola)
 *   4. Σ per_pengelola amount = pengelola_pool_final (after residue
 *      absorbed)
 * ============================================================================ */

export interface InvestorV2Input {
  id: string;
  /** Share % dari investor.share_pct (0..100, 4-decimal). Server WAJIB
   *  validate SUM(active) = 100 sebelum compute. Investor inactive/exited
   *  TIDAK boleh ikut. */
  sharePct: number;
}

export interface PengelolaV2Input {
  id: string;
  modalDisetor: number;
}

export interface ComputeDistributionV2Input {
  netProfit: number;
  /** Loss rate % dari net (default 3.00). */
  lossRate: number;
  /** Capex rate % dari net (default 0.70). */
  capexRate: number;
  /** Payout ratio % dari dasar bagi hasil (default 10.00, manual editable). */
  payoutRatio: number;
  /** Investor pool % dari bagi_hasil (default 35.00). Pengelola pool =
   *  100 − investorPoolPct. */
  investorPoolPct: number;
  investors: InvestorV2Input[];
  pengelola: PengelolaV2Input[];
}

export interface ComputeDistributionV2Result {
  model: "v2";
  netProfit: number;
  /** Bucket allocations (Rupiah, rounded). */
  lossAmount: number;
  capexAmount: number;
  dasarBagiHasil: number;
  bagiHasilAmount: number;
  retainedAmount: number;
  /** Pool amounts (Rupiah). pengelolaPoolAmount sudah include residue
   *  per-investor + residue pool-split + treasury share kalau ada. */
  investorPoolAmount: number;
  pengelolaPoolAmount: number;
  perInvestor: HolderLine[];
  perPengelola: HolderLine[];
  /** Rounding residue per-investor yang dipindah ke pengelola_pool. */
  investorResidue: number;
  /** Treasury share % (100 − sum active investor share). Diabsorbsi ke
   *  pengelola_pool. */
  treasurySharePct: number;
  status: "normal" | "no_profit";
}

/**
 * Round-to-nearest helper (matches spec "round" bukan floor).
 * Math.round bias 0.5 ke atas, sesuai konvensi akuntansi umum.
 */
function roundRupiah(n: number): number {
  return Math.round(n);
}

export function computeDistributionV2(
  input: ComputeDistributionV2Input,
): ComputeDistributionV2Result {
  const {
    netProfit,
    lossRate,
    capexRate,
    payoutRatio,
    investorPoolPct,
    investors,
    pengelola,
  } = input;

  /* Empty holder defaults. */
  const emptyInvestorLines: HolderLine[] = investors.map((h) => ({
    id: h.id,
    modalDisetor: 0,
    sharePct: h.sharePct,
    amount: 0,
  }));
  const emptyPengelolaLines: HolderLine[] = pengelola.map((h) => ({
    id: h.id,
    modalDisetor: h.modalDisetor,
    sharePct: 0,
    amount: 0,
  }));

  /* Guard 1: netProfit ≤ 0 → loss month, no distribution. */
  if (!Number.isFinite(netProfit) || netProfit <= 0) {
    return {
      model: "v2",
      netProfit: Math.max(0, netProfit),
      lossAmount: 0,
      capexAmount: 0,
      dasarBagiHasil: 0,
      bagiHasilAmount: 0,
      retainedAmount: 0,
      investorPoolAmount: 0,
      pengelolaPoolAmount: 0,
      perInvestor: emptyInvestorLines,
      perPengelola: emptyPengelolaLines,
      investorResidue: 0,
      treasurySharePct: 0,
      status: "no_profit",
    };
  }

  /* Step 1: loss + capex sebagai reserve dari net (rate × net, rounded). */
  const lossAmount = roundRupiah((netProfit * lossRate) / 100);
  const capexAmount = roundRupiah((netProfit * capexRate) / 100);

  /* Step 2: dasar bagi hasil = net − loss − capex. */
  const dasarBagiHasil = netProfit - lossAmount - capexAmount;

  /* Guard 2: kalau loss+capex >= net (mis. lossRate+capexRate >= 100,
   * atau net kecil), dasar ≤ 0 → no distribution. */
  if (dasarBagiHasil <= 0) {
    return {
      model: "v2",
      netProfit,
      lossAmount,
      capexAmount,
      dasarBagiHasil: Math.max(0, dasarBagiHasil),
      bagiHasilAmount: 0,
      retainedAmount: netProfit - lossAmount - capexAmount, // bisa negatif kalau loss>net
      investorPoolAmount: 0,
      pengelolaPoolAmount: 0,
      perInvestor: emptyInvestorLines,
      perPengelola: emptyPengelolaLines,
      investorResidue: 0,
      treasurySharePct: 0,
      status: "no_profit",
    };
  }

  /* Step 3: bagi_hasil = dasar × payoutRatio (rounded). */
  const bagiHasilAmount = roundRupiah((dasarBagiHasil * payoutRatio) / 100);

  /* Step 4: retained = sisa otomatis. INVARIANT: net = loss+capex+bagi+retained. */
  const retainedAmount = netProfit - lossAmount - capexAmount - bagiHasilAmount;

  /* Step 5: pool split. pengelola_pool = bagi − investor_pool (serap
   * rounding pool-split otomatis). */
  let investorPoolAmount = roundRupiah(
    (bagiHasilAmount * investorPoolPct) / 100,
  );
  let pengelolaPoolAmount = bagiHasilAmount - investorPoolAmount;

  /* Step 6: treasury share — kalau SUM active investor share_pct < 100,
   * sisa% dianggap "company hold". Mengurangi pool yang dialokasikan ke
   * investor; kompensasi ke pengelola_pool. */
  const totalInvestorShare = investors.reduce(
    (s, i) => s + Math.max(0, i.sharePct),
    0,
  );
  const treasurySharePct = Math.max(0, 100 - totalInvestorShare);

  /* Kalau ada treasury share, alokasi treasury % dari investor_pool
   * dipindah ke pengelola_pool sebelum per-holder split. */
  if (treasurySharePct > 0 && totalInvestorShare < 100) {
    const treasuryAmount = roundRupiah(
      (investorPoolAmount * treasurySharePct) / 100,
    );
    investorPoolAmount -= treasuryAmount;
    pengelolaPoolAmount += treasuryAmount;
  }

  /* Step 7: per-investor allocation. Pakai sharePct yang ada (server
   * validate SUM=100 sebelum compute, kecuali ada treasury hold).
   * Kalau totalInvestorShare > 0, normalize ke 100 untuk hitung amount
   * per-investor (relative share di antara active investors). */
  const perInvestor: HolderLine[] = [];
  let investorDistributed = 0;
  if (totalInvestorShare > 0 && investorPoolAmount > 0) {
    for (const inv of investors) {
      /* Normalized share: kalau active sum=100, langsung pakai share/100.
       * Kalau sum<100 (treasury hold), share/sum supaya proportional
       * distribusi pool yang sudah dikurangi treasury. */
      const normalizedShare = inv.sharePct / totalInvestorShare;
      const amount = roundRupiah(investorPoolAmount * normalizedShare);
      perInvestor.push({
        id: inv.id,
        modalDisetor: 0,
        sharePct: inv.sharePct,
        amount,
      });
      investorDistributed += amount;
    }
  } else {
    for (const inv of investors) {
      perInvestor.push({
        id: inv.id,
        modalDisetor: 0,
        sharePct: inv.sharePct,
        amount: 0,
      });
    }
  }

  /* Step 8: investor residue → ke pengelola_pool. Residue bisa + atau −
   * (Math.round bias 0.5 ke atas bisa over-distribute).
   *
   * After absorbing residue, update investorPoolAmount field SUPAYA
   * invariant I3 (Σ perInvestor = investorPoolAmount) HOLDS. Tanpa
   * update ini, ada drift kalau per-holder rounding over-distribute
   * (mis. 2 investor × 50.5% × pool produces sum > pool). */
  const investorResidue = investorPoolAmount - investorDistributed;
  pengelolaPoolAmount += investorResidue;
  investorPoolAmount = investorDistributed;

  /* Step 9: per-pengelola allocation, proporsional by modalDisetor (sama
   * pattern V1). Residue final di pengelola pool serap di pengelola row
   * terakhir (sort by modal desc → first/biggest absorb). */
  const totalPengelolaModal = pengelola.reduce(
    (s, p) => s + Math.max(0, p.modalDisetor),
    0,
  );
  const perPengelola: HolderLine[] = [];
  let pengelolaDistributed = 0;

  if (pengelolaPoolAmount > 0 && pengelola.length > 0) {
    if (totalPengelolaModal > 0) {
      /* Sort by modal desc — biggest absorb residue (akan diset di akhir). */
      const sortedPengelola = [...pengelola].sort(
        (a, b) => b.modalDisetor - a.modalDisetor,
      );
      for (let i = 0; i < sortedPengelola.length; i++) {
        const p = sortedPengelola[i];
        const modal = Math.max(0, p.modalDisetor);
        const pct = (modal / totalPengelolaModal) * 100;
        const amount =
          i < sortedPengelola.length - 1
            ? roundRupiah((modal / totalPengelolaModal) * pengelolaPoolAmount)
            : pengelolaPoolAmount - pengelolaDistributed; // last absorb
        perPengelola.push({
          id: p.id,
          modalDisetor: p.modalDisetor,
          sharePct: Number(pct.toFixed(4)),
          amount,
        });
        pengelolaDistributed += amount;
      }
    } else {
      /* Defensive: pengelola ada tapi modal=0 → equal split. */
      const equalShare = Math.floor(pengelolaPoolAmount / pengelola.length);
      const equalPct = Number((100 / pengelola.length).toFixed(4));
      for (let i = 0; i < pengelola.length; i++) {
        const p = pengelola[i];
        const amount =
          i < pengelola.length - 1
            ? equalShare
            : pengelolaPoolAmount - equalShare * (pengelola.length - 1);
        perPengelola.push({
          id: p.id,
          modalDisetor: p.modalDisetor,
          sharePct: equalPct,
          amount,
        });
      }
    }
  } else {
    for (const p of pengelola) {
      perPengelola.push({
        id: p.id,
        modalDisetor: p.modalDisetor,
        sharePct: 0,
        amount: 0,
      });
    }
  }

  return {
    model: "v2",
    netProfit,
    lossAmount,
    capexAmount,
    dasarBagiHasil,
    bagiHasilAmount,
    retainedAmount,
    investorPoolAmount,
    pengelolaPoolAmount,
    perInvestor,
    perPengelola,
    investorResidue,
    treasurySharePct,
    status: "normal",
  };
}
