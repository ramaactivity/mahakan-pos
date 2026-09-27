/**
 * Sesi AE-234 — audit log export for humans (Excel) + CSV fallback.
 *
 * The first CSV dumped UTC ISO timestamps ("2026-06-03T14:59:14.367Z") and
 * raw event codes — owner could not read it. Everything here is WIB,
 * Indonesian labels, one column per fact the owner cross-checks against
 * CCTV (transaction no., total before/after, items, cash received/change).
 * One record type feeds both the styled workbook and the CSV so they never
 * disagree.
 */
import type { AuditLogRow } from "@/lib/audit";
import type { RowTone, StyledCol, StyledSheet } from "@/lib/xlsx-styled";
import type { ExportRow } from "./reports/report-export";

type Obj = Record<string, unknown>;

const asObj = (v: unknown): Obj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Event labels owners actually read. Unlisted events fall back to MODULE + ACTION. */
const EVENT_LABEL: Record<string, string> = {
  "auth.login.success": "Login",
  "auth.login.failed": "Login gagal",
  "auth.logout": "Logout",
  "transaction.open_bill.create": "Buka bill",
  "transaction.open_bill.edit": "Edit bill",
  "transaction.open_bill.close": "Tutup bill (bayar)",
  "transaction.open_bill.cancel": "Batal bill",
  "transaction.void": "Void transaksi",
  "transaction.refund": "Refund",
  "transaction.reprint": "Cetak ulang struk",
  "transaction.compliment.applied": "Compliment",
  "transaction.discount.applied": "Diskon",
  "transaction.correction.request": "Minta koreksi transaksi",
  "transaction.correction.cancel": "Batal koreksi transaksi",
  "shift.open": "Buka shift",
  "shift.close": "Tutup shift",
  "shift.opening_cash.correct": "Koreksi kas awal",
  "shift.rebalance.request": "Minta koreksi kas shift",
  "shift.rebalance.approve": "Setujui koreksi kas shift",
  "approval_code.generate": "Kode owner diminta",
  "approval_code.consume": "Kode owner dipakai",
  "approval_code.failed_attempt": "Kode owner salah",
  "attendance.mobile_clock_in": "Absen masuk",
  "attendance.mobile_clock_out": "Absen pulang",
  "attendance.mobile_rejected": "Absen ditolak",
  "attendance_mobile.pin_invalid": "PIN absen salah",
  "expense.create": "Catat pengeluaran",
  "expense.update": "Ubah pengeluaran",
  "expense.delete": "Hapus pengeluaran",
  "income.create": "Catat pemasukan",
  "cash_deposit.create": "Setoran tunai",
  "cash_deposit.verify": "Verifikasi setoran",
  "cash_deposit.reject": "Tolak setoran",
  "purchase_request.create": "Buat permintaan belanja",
  "purchase_request.cancel": "Batal permintaan belanja",
  "purchase.create": "Catat pembelian",
  "purchase.mark_paid": "Pembelian dilunasi",
  "menu.item.sold_out_toggle": "Menu habis/tersedia",
  "menu.item.update": "Ubah menu",
  "user.reset_pin": "Reset PIN user",
  "settings.update": "Ubah pengaturan",
};

const MODULE_LABEL: Record<string, string> = {
  auth: "Login",
  transaction: "Transaksi",
  shift: "Shift",
  approval_code: "Persetujuan",
  attendance: "Absensi",
  attendance_mobile: "Absensi",
  schedule: "Jadwal",
  inventory: "Inventori",
  purchase: "Pembelian",
  purchase_request: "Pembelian",
  market_list: "Pembelian",
  menu: "Menu",
  expense: "Kas",
  income: "Kas",
  cash_deposit: "Kas",
  nota_archive: "Arsip nota",
  operasional: "Operasional",
  payroll: "Payroll",
  employee: "Karyawan",
  user: "User",
  settings: "Pengaturan",
  journal: "Akuntansi",
  journal_entry: "Akuntansi",
  aggregator_settlement: "Settlement",
};

export function eventLabel(type: string): string {
  if (EVENT_LABEL[type]) return EVENT_LABEL[type]!;
  const rest = type.split(".").slice(1).join(" ").replace(/_/g, " ");
  return `${moduleLabel(type)}: ${rest}`;
}
export function moduleLabel(type: string): string {
  const mod = type.split(".")[0] ?? type;
  return MODULE_LABEL[mod] ?? mod.replace(/_/g, " ");
}

/** Items are logged as {name, qty}[] since AE-234; older rows have none. */
function itemsText(v: unknown): string {
  if (!Array.isArray(v)) return "";
  return v.map((i) => `${asObj(i).qty ?? "?"}× ${str(asObj(i).name)}`).join(", ");
}

const PAYMENT_LABEL: Record<string, string> = {
  cash: "Tunai",
  qris: "QRIS",
  split: "Split",
  card_bca: "Kartu BCA",
  card_bni: "Kartu BNI",
  card_bri: "Kartu BRI",
  card_mandiri: "Kartu Mandiri",
  card_other: "Kartu lain",
};

/** Keys already shown in their own column; everything else lands in "Detail lain". */
const HANDLED = new Set([
  "transactionNumber", "total", "paymentMethod", "cashReceived", "cashChange",
  "items", "removed", "added", "totalDelta", "itemCount", "billOpenedAt",
]);
function detailText(o: Obj): string {
  return Object.entries(o)
    .filter(([k, v]) => !HANDLED.has(k) && v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join("\n");
}

export interface AuditExportRecord {
  /** WIB calendar date encoded as UTC midnight — Excel shows it as-is. */
  date: Date;
  dateText: string;
  time: string;
  category: string;
  activity: string;
  eventType: string;
  actor: string;
  /** Sesi AE-235 — crew who did it on the POS; actor is the tablet login. */
  crew: string;
  role: string;
  approver: string;
  trxNo: string;
  customer: string;
  summary: string;
  totalBefore: number | null;
  totalAfter: number | null;
  delta: number | null;
  removed: string;
  added: string;
  itemsBefore: string;
  itemsAfter: string;
  payment: string;
  cashReceived: number | null;
  cashChange: number | null;
  minutesOpen: number | null;
  detail: string;
  tone: RowTone;
}

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  supervisor: "Supervisor",
  staff: "Staff",
};

function wibParts(d: Date | string) {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(new Date(d));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  return { y: +g("year"), m: +g("month"), d: +g("day"), time: `${g("hour")}:${g("minute")}:${g("second")}` };
}

export function toAuditRecord(r: AuditLogRow): AuditExportRecord {
  const p = asObj(r.payload);
  const ctx = asObj(p.context);
  const before = asObj(p.before);
  const after = asObj(p.after);
  const totalBefore = num(before.total);
  const totalAfter = num(after.total) ?? num(ctx.total);
  const delta = totalBefore !== null && totalAfter !== null ? totalAfter - totalBefore : null;
  const changes = (v: unknown) =>
    Array.isArray(v) ? v.map((c) => `${asObj(c).qty}× ${str(asObj(c).name)}`).join(", ") : "";
  const w = wibParts(r.createdAt);

  let tone: RowTone = null;
  if (
    (r.eventType === "transaction.open_bill.edit" && delta !== null && delta < 0) ||
    r.eventType === "transaction.open_bill.cancel" ||
    r.eventType === "transaction.void" ||
    r.eventType.startsWith("transaction.refund")
  ) tone = "danger";
  else if (
    r.eventType === "transaction.compliment.applied" ||
    r.eventType.startsWith("approval_code.") ||
    r.eventType === "auth.login.failed" ||
    r.eventType.startsWith("transaction.correction") ||
    r.eventType === "shift.opening_cash.correct"
  ) tone = "warning";

  const detail = [detailText(ctx), p.diff ? `perubahan: ${JSON.stringify(p.diff)}` : ""]
    .filter(Boolean)
    .join("\n");

  return {
    date: new Date(Date.UTC(w.y, w.m - 1, w.d)),
    dateText: `${String(w.d).padStart(2, "0")}/${String(w.m).padStart(2, "0")}/${w.y}`,
    time: w.time,
    category: moduleLabel(r.eventType),
    activity: eventLabel(r.eventType),
    eventType: r.eventType,
    actor: r.userName ?? "",
    crew: str(asObj(asObj(r.metadata).crew).name),
    role: ROLE_LABEL[r.userRole ?? ""] ?? r.userRole ?? "",
    approver: r.approverName ?? "",
    trxNo: str(ctx.transactionNumber),
    customer: str(after.customerName) || str(before.customerName),
    summary: str(p.summary),
    totalBefore,
    totalAfter,
    delta,
    removed: changes(ctx.removed),
    added: changes(ctx.added),
    itemsBefore: itemsText(before.items),
    itemsAfter: itemsText(after.items) || itemsText(ctx.items),
    payment: PAYMENT_LABEL[str(ctx.paymentMethod)] ?? str(ctx.paymentMethod),
    cashReceived: num(ctx.cashReceived),
    cashChange: num(ctx.cashChange),
    minutesOpen: num(ctx.minutesOpen) ?? num(ctx.minutesSinceOpened),
    detail,
    tone,
  };
}

export function toAuditRecords(rows: AuditLogRow[]): AuditExportRecord[] {
  return [...rows]
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map(toAuditRecord);
}

/** CSV: same facts, plain text dates (CSV cannot carry cell formats). */
export function auditRecordToCsvRow(x: AuditExportRecord): ExportRow {
  return {
    Tanggal: x.dateText,
    "Jam (WIB)": x.time,
    Kategori: x.category,
    Aktivitas: x.activity,
    Crew: x.crew,
    "Akun Tablet / Pelaku": x.actor,
    Peran: x.role,
    "Disetujui oleh": x.approver,
    "No. Transaksi": x.trxNo,
    Tamu: x.customer,
    Keterangan: x.summary,
    "Total Sebelum": x.totalBefore,
    "Total Sesudah": x.totalAfter,
    Selisih: x.delta,
    "Item Dihapus": x.removed,
    "Item Ditambah": x.added,
    "Item Sebelum": x.itemsBefore,
    "Item Sesudah": x.itemsAfter,
    "Metode Bayar": x.payment,
    "Uang Diterima": x.cashReceived,
    Kembalian: x.cashChange,
    "Detail lain": x.detail.replace(/\n/g, "; "),
    "Kode Event": x.eventType,
  };
}

const noCol: StyledCol<AuditExportRecord> = {
  header: "No",
  width: 6,
  fmt: "int",
  total: false,
  formula: (r, ctx) => `ROW()-${ctx.firstRow - 1}`,
};

const LOG_COLS: Array<StyledCol<AuditExportRecord>> = [
  noCol,
  { header: "Tanggal", value: (x) => x.date, fmt: "date", width: 12 },
  { header: "Jam (WIB)", value: (x) => x.time, width: 10 },
  { header: "Kategori", value: (x) => x.category, width: 13 },
  { header: "Aktivitas", value: (x) => x.activity, width: 22, wrap: true },
  { header: "Crew", value: (x) => x.crew || null, width: 12 },
  { header: "Akun Tablet / Pelaku", value: (x) => x.actor, width: 14 },
  { header: "Peran", value: (x) => x.role, width: 11 },
  { header: "Disetujui oleh", value: (x) => x.approver || null, width: 14 },
  { header: "No. Transaksi", value: (x) => x.trxNo || null, width: 20 },
  { header: "Tamu", value: (x) => x.customer || null, width: 14 },
  { header: "Keterangan", value: (x) => x.summary, width: 50, wrap: true },
  { header: "Total Sebelum", value: (x) => x.totalBefore, fmt: "money", width: 14, total: false },
  { header: "Total Sesudah", value: (x) => x.totalAfter, fmt: "money", width: 14, total: false },
  { header: "Selisih", value: (x) => x.delta, fmt: "money", width: 12, total: false },
  { header: "Item Dihapus", value: (x) => x.removed || null, width: 26, wrap: true },
  { header: "Item Ditambah", value: (x) => x.added || null, width: 26, wrap: true },
  { header: "Metode Bayar", value: (x) => x.payment || null, width: 12 },
  { header: "Uang Diterima", value: (x) => x.cashReceived, fmt: "money", width: 14, total: false },
  { header: "Kembalian", value: (x) => x.cashChange, fmt: "money", width: 12, total: false },
  { header: "Lama Bill Terbuka (mnt)", value: (x) => x.minutesOpen, fmt: "int", width: 13, total: false },
  { header: "Item Sebelum", value: (x) => x.itemsBefore || null, width: 30, wrap: true },
  { header: "Item Sesudah", value: (x) => x.itemsAfter || null, width: 30, wrap: true },
  { header: "Detail Lain", value: (x) => x.detail || null, width: 40, wrap: true },
];

const REDUCED_COLS: Array<StyledCol<AuditExportRecord>> = [
  noCol,
  { header: "Tanggal", value: (x) => x.date, fmt: "date", width: 12 },
  { header: "Jam (WIB)", value: (x) => x.time, width: 10 },
  { header: "Crew", value: (x) => x.crew || null, width: 12 },
  { header: "Akun Tablet", value: (x) => x.actor, width: 14 },
  { header: "No. Transaksi", value: (x) => x.trxNo, width: 20 },
  { header: "Tamu", value: (x) => x.customer || null, width: 14 },
  { header: "Total Sebelum", value: (x) => x.totalBefore, fmt: "money", width: 14, total: false },
  { header: "Total Sesudah", value: (x) => x.totalAfter, fmt: "money", width: 14, total: false },
  { header: "Selisih", value: (x) => x.delta, fmt: "money", width: 13 },
  { header: "Item Dihapus", value: (x) => x.removed || null, width: 28, wrap: true },
  { header: "Item Ditambah", value: (x) => x.added || null, width: 28, wrap: true },
  { header: "Keterangan", value: (x) => x.summary, width: 50, wrap: true },
];

interface ActorSummary {
  actor: string;
  role: string;
  total: number;
  login: number;
  create: number;
  edit: number;
  editDown: number;
  editDownRp: number;
  close: number;
  cancel: number;
  voids: number;
  compliment: number;
}

function summarizeByActor(recs: AuditExportRecord[]): ActorSummary[] {
  const map = new Map<string, ActorSummary>();
  for (const x of recs) {
    // Crew first (AE-235): the tablet login is often not who did it.
    const key = x.crew || x.actor || "(sistem)";
    const s = map.get(key) ?? {
      actor: key, role: x.role, total: 0, login: 0, create: 0, edit: 0, editDown: 0,
      editDownRp: 0, close: 0, cancel: 0, voids: 0, compliment: 0,
    };
    s.total += 1;
    if (x.eventType === "auth.login.success") s.login += 1;
    if (x.eventType === "transaction.open_bill.create") s.create += 1;
    if (x.eventType === "transaction.open_bill.edit") {
      s.edit += 1;
      if (x.delta !== null && x.delta < 0) {
        s.editDown += 1;
        s.editDownRp += -x.delta;
      }
    }
    if (x.eventType === "transaction.open_bill.close") s.close += 1;
    if (x.eventType === "transaction.open_bill.cancel") s.cancel += 1;
    if (x.eventType === "transaction.void") s.voids += 1;
    if (x.eventType === "transaction.compliment.applied") s.compliment += 1;
    map.set(key, s);
  }
  return [...map.values()].sort((a, b) => b.editDownRp - a.editDownRp || b.total - a.total);
}

const SUMMARY_COLS: Array<StyledCol<ActorSummary>> = [
  { header: "Crew / Pelaku", value: (s) => s.actor, width: 16 },
  { header: "Peran", value: (s) => s.role, width: 11 },
  { header: "Semua Aktivitas", value: (s) => s.total, fmt: "int", width: 12 },
  { header: "Login", value: (s) => s.login, fmt: "int", width: 9 },
  { header: "Buka Bill", value: (s) => s.create, fmt: "int", width: 10 },
  { header: "Edit Bill", value: (s) => s.edit, fmt: "int", width: 10 },
  { header: "Edit Turun", value: (s) => s.editDown, fmt: "int", width: 10 },
  { header: "Nilai Turun (Rp)", value: (s) => s.editDownRp, fmt: "money", width: 15 },
  { header: "Tutup Bill", value: (s) => s.close, fmt: "int", width: 10 },
  { header: "Batal Bill", value: (s) => s.cancel, fmt: "int", width: 10 },
  { header: "Void", value: (s) => s.voids, fmt: "int", width: 8 },
  { header: "Compliment", value: (s) => s.compliment, fmt: "int", width: 11 },
];

export function buildAuditStyledSheets(
  recs: AuditExportRecord[],
  period: { from: string; to: string; filter: string },
): Array<StyledSheet<never>> {
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  };
  const sub = `Mahakan Coffee & Space · periode ${fmt(period.from)} s/d ${fmt(period.to)} · ${period.filter} · jam dalam WIB`;
  const reduced = recs.filter(
    (x) => x.eventType === "transaction.open_bill.edit" && x.delta !== null && x.delta < 0,
  );
  const cancels = recs.filter((x) => x.eventType === "transaction.open_bill.cancel").length;
  const reducedRp = reduced.reduce((s, x) => s + -(x.delta ?? 0), 0);

  const sheets: Array<StyledSheet<never>> = [
    {
      name: "Ringkasan",
      title: "Ringkasan Audit Log per Crew",
      subtitle: sub,
      notes: [
        `Total catatan: ${recs.length.toLocaleString("id-ID")}`,
        `Edit bill yang menurunkan total: ${reduced.length} kali, Rp ${reducedRp.toLocaleString("id-ID")}`,
        `Batal bill: ${cancels} kali`,
        "Baris merah di lembar Audit Log = aktivitas yang mengurangi uang (edit turun, batal bill, void). Kuning = persetujuan, compliment, login gagal.",
      ],
      cols: SUMMARY_COLS,
      rows: summarizeByActor(recs),
      totalRow: true,
    } as StyledSheet<ActorSummary> as unknown as StyledSheet<never>,
    {
      name: "Audit Log",
      title: "Audit Log",
      subtitle: sub,
      cols: LOG_COLS,
      rows: recs,
      rowTone: (x) => x.tone,
    } as StyledSheet<AuditExportRecord> as unknown as StyledSheet<never>,
  ];
  if (reduced.length > 0) {
    sheets.push({
      name: "Bill Diedit Turun",
      title: "Edit Bill yang Menurunkan Total",
      subtitle: sub,
      notes: [
        "Cocokkan tiap baris dengan CCTV: berapa uang yang diserahkan tamu dan jam tamu membayar.",
        "Item dihapus/ditambah hanya tersedia untuk edit sejak 25/09/2026.",
      ],
      cols: REDUCED_COLS,
      rows: reduced,
      totalRow: true,
      rowTone: () => "danger",
    } as StyledSheet<AuditExportRecord> as unknown as StyledSheet<never>);
  }
  return sheets;
}
