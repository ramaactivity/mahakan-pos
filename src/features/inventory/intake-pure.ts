/**
 * Sesi AE-192 — Modul "Masuk Bahan": pure helpers.
 *
 * Tujuan modul: menjawab pertanyaan owner "bahan baku masuk tanggal berapa
 * saja, dan apakah pembelian/pembayarannya SUDAH dicatat di sistem atau
 * belum?". Karena itu satuan barisnya adalah **penerimaan barang** (GR /
 * pembelian instan), bukan pergerakan stok — di mode periodic pergerakan stok
 * memang tidak menambah stok (skippedStockUpdate=true), jadi tab "Pergerakan"
 * tidak bisa dipakai untuk verifikasi input.
 *
 * Semua fungsi di sini bebas DB/React supaya bisa diuji langsung.
 */

export type IntakePaymentStatus = "pending_payment" | "paid" | "cancelled";

export interface IntakeLine {
  /** ID baris sumber (goods_receipt_items.id atau purchase_items.id). */
  id: string;
  /** 'gr' = lewat Goods Receipt, 'direct' = pembelian instan tanpa GR. */
  source: "gr" | "direct";
  /** Tanggal barang MASUK (WIB, YYYY-MM-DD). GR → received_date. */
  receiptDate: string;
  purchaseId: string;
  /** Tanggal nota/belanja (WIB, YYYY-MM-DD). */
  purchaseDate: string;
  invoiceNo: string | null;
  supplierName: string | null;
  ingredientId: string;
  ingredientName: string;
  unit: string;
  qty: number;
  unitCost: number;
  totalCost: number;
  paymentMethod: string;
  paymentStatus: IntakePaymentStatus;
  dueDate: string | null;
  paidAt: string | null;
  /** Kapan baris ini DIINPUT ke sistem (ISO instant). */
  enteredAt: string;
  enteredByName: string | null;
  hasReceiptPhoto: boolean;
}

/** PO sudah dibuat tapi barangnya belum (atau baru sebagian) diterima. */
export interface PendingOrder {
  purchaseId: string;
  purchaseDate: string;
  supplierName: string | null;
  invoiceNo: string | null;
  totalAmount: number;
  receiptStatus: "ordered" | "partial";
  itemCount: number;
  receivedItemCount: number;
}

export interface IntakeResult {
  lines: IntakeLine[];
  pendingOrders: PendingOrder[];
  /** true kalau hasil kena batas baris — UI minta user mempersempit filter. */
  truncated: boolean;
}

/**
 * Ambang "telat input": nota dianggap terlambat masuk sistem kalau jarak
 * tanggal terima → tanggal input lebih dari ini. 3 hari dipilih karena staff
 * belanja harian; lebih dari itu berarti nota menumpuk dulu (data prod
 * Jun–Jul 2026: rata-rata jeda 7 hari, maksimum 43 hari).
 */
export const LATE_ENTRY_DAYS = 3;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD menurut kalender WIB untuk instant ISO. */
export function jakartaDayOf(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  return new Date(t + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Selisih hari kalender WIB antara tanggal terima dan saat diinput. */
export function entryLagDays(line: IntakeLine): number {
  const entered = jakartaDayOf(line.enteredAt);
  if (!entered) return 0;
  const a = new Date(`${line.receiptDate}T00:00:00Z`).getTime();
  const b = new Date(`${entered}T00:00:00Z`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / MS_PER_DAY);
}

export function isLateEntry(line: IntakeLine): boolean {
  return entryLagDays(line) > LATE_ENTRY_DAYS;
}

/** Hutang yang sudah lewat jatuh tempo per `todayIso`. */
export function isOverdue(line: IntakeLine, todayIso: string): boolean {
  return (
    line.paymentStatus === "pending_payment" &&
    line.dueDate !== null &&
    line.dueDate < todayIso
  );
}

export interface DayGroup {
  date: string;
  lines: IntakeLine[];
  totalCost: number;
  /** Jumlah nota/pembelian unik pada tanggal itu. */
  noteCount: number;
  ingredientCount: number;
  supplierNames: string[];
  /** Jeda input terlama di antara baris hari itu (hari). */
  maxLagDays: number;
  unpaidCost: number;
}

/** Group per tanggal MASUK barang, terbaru dulu. */
export function groupIntakeByDate(lines: IntakeLine[]): DayGroup[] {
  const buckets = new Map<string, IntakeLine[]>();
  for (const line of lines) {
    const list = buckets.get(line.receiptDate);
    if (list) list.push(line);
    else buckets.set(line.receiptDate, [line]);
  }

  const groups: DayGroup[] = [];
  for (const [date, groupLines] of buckets) {
    const purchases = new Set<string>();
    const ingredientIds = new Set<string>();
    const suppliers = new Set<string>();
    let totalCost = 0;
    let unpaidCost = 0;
    let maxLagDays = 0;
    for (const line of groupLines) {
      purchases.add(line.purchaseId);
      ingredientIds.add(line.ingredientId);
      suppliers.add(line.supplierName ?? "Tanpa supplier");
      totalCost += line.totalCost;
      if (line.paymentStatus === "pending_payment")
        unpaidCost += line.totalCost;
      const lag = entryLagDays(line);
      if (lag > maxLagDays) maxLagDays = lag;
    }
    groupLines.sort((a, b) => a.ingredientName.localeCompare(b.ingredientName));
    groups.push({
      date,
      lines: groupLines,
      totalCost,
      noteCount: purchases.size,
      ingredientCount: ingredientIds.size,
      supplierNames: Array.from(suppliers).sort(),
      maxLagDays,
      unpaidCost,
    });
  }

  groups.sort((a, b) => b.date.localeCompare(a.date));
  return groups;
}

export interface IngredientGroup {
  ingredientId: string;
  ingredientName: string;
  unit: string;
  lines: IntakeLine[];
  totalQty: number;
  totalCost: number;
  /** Tanggal masuk terakhir — untuk melihat bahan yang lama tak dibeli. */
  lastDate: string;
  firstDate: string;
}

/** Group per bahan, dengan tanggal masuk terakhir paling atas. */
export function groupIntakeByIngredient(lines: IntakeLine[]): IngredientGroup[] {
  const buckets = new Map<string, IngredientGroup>();
  for (const line of lines) {
    let group = buckets.get(line.ingredientId);
    if (!group) {
      group = {
        ingredientId: line.ingredientId,
        ingredientName: line.ingredientName,
        unit: line.unit,
        lines: [],
        totalQty: 0,
        totalCost: 0,
        lastDate: line.receiptDate,
        firstDate: line.receiptDate,
      };
      buckets.set(line.ingredientId, group);
    }
    group.lines.push(line);
    group.totalQty += line.qty;
    group.totalCost += line.totalCost;
    if (line.receiptDate > group.lastDate) group.lastDate = line.receiptDate;
    if (line.receiptDate < group.firstDate) group.firstDate = line.receiptDate;
  }

  const groups = Array.from(buckets.values());
  for (const group of groups) {
    group.lines.sort((a, b) => b.receiptDate.localeCompare(a.receiptDate));
  }
  groups.sort(
    (a, b) =>
      b.lastDate.localeCompare(a.lastDate) ||
      a.ingredientName.localeCompare(b.ingredientName),
  );
  return groups;
}

/**
 * Tanggal dalam rentang yang SAMA SEKALI tidak punya catatan masuk bahan.
 * Ini inti fitur "cek sudah dimasukkan atau belum": hari kosong = kandidat
 * nota yang belum diinput (atau memang libur belanja).
 *
 * Rentang di-cap 400 hari supaya tidak pernah membangkitkan array raksasa
 * kalau filter tanggal diisi ngawur.
 */
export function findMissingDays(
  fromIso: string,
  toIso: string,
  datesWithData: Iterable<string>,
): string[] {
  if (!fromIso || !toIso || fromIso > toIso) return [];
  const present = new Set(datesWithData);
  const out: string[] = [];
  const start = new Date(`${fromIso}T00:00:00Z`).getTime();
  const end = new Date(`${toIso}T00:00:00Z`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return [];
  for (let t = start, guard = 0; t <= end && guard < 400; t += MS_PER_DAY) {
    const iso = new Date(t).toISOString().slice(0, 10);
    if (!present.has(iso)) out.push(iso);
    guard += 1;
  }
  return out;
}

export interface IntakeSummary {
  lineCount: number;
  noteCount: number;
  ingredientCount: number;
  totalCost: number;
  /** Nilai nota yang belum lunas (hutang). */
  unpaidCost: number;
  unpaidNoteCount: number;
  overdueNoteCount: number;
  /** Nota yang jeda inputnya melebihi LATE_ENTRY_DAYS. */
  lateNoteCount: number;
  daysWithData: number;
}

export function summarizeIntake(
  lines: IntakeLine[],
  todayIso: string,
): IntakeSummary {
  const notes = new Map<string, IntakeLine>();
  const ingredientIds = new Set<string>();
  const days = new Set<string>();
  let totalCost = 0;
  for (const line of lines) {
    ingredientIds.add(line.ingredientId);
    days.add(line.receiptDate);
    totalCost += line.totalCost;
    // Satu purchase bisa punya banyak baris; ambil baris pertama sebagai
    // wakil header (status bayar & jatuh tempo sama untuk semua barisnya).
    if (!notes.has(line.purchaseId)) notes.set(line.purchaseId, line);
  }

  let unpaidCost = 0;
  let unpaidNoteCount = 0;
  let overdueNoteCount = 0;
  let lateNoteCount = 0;
  const unpaidTotals = new Map<string, number>();
  for (const line of lines) {
    if (line.paymentStatus === "pending_payment") {
      unpaidTotals.set(
        line.purchaseId,
        (unpaidTotals.get(line.purchaseId) ?? 0) + line.totalCost,
      );
    }
  }
  for (const [, amount] of unpaidTotals) unpaidCost += amount;
  unpaidNoteCount = unpaidTotals.size;
  for (const [, note] of notes) {
    if (isOverdue(note, todayIso)) overdueNoteCount += 1;
    if (isLateEntry(note)) lateNoteCount += 1;
  }

  return {
    lineCount: lines.length,
    noteCount: notes.size,
    ingredientCount: ingredientIds.size,
    totalCost,
    unpaidCost,
    unpaidNoteCount,
    overdueNoteCount,
    lateNoteCount,
    daysWithData: days.size,
  };
}
