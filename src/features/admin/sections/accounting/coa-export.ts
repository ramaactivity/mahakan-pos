import type { AccountListRow, AccountType } from "@/features/accounting/types";
import type { StyledCol, StyledSheet } from "@/lib/xlsx-styled";

/* Sesi AE-238 — unduhan Bagan Akun (Excel bertata rias + CSV). Dipisah dari
 * CoaView supaya susunan kolomnya bisa diuji/di-render di node. */

export const COA_TYPE_LABEL: Record<AccountType, string> = {
  asset: "Aset",
  liability: "Kewajiban",
  equity: "Ekuitas",
  revenue: "Pendapatan",
  cogs: "HPP",
  expense: "Beban",
};

const yesNo = (v: boolean) => (v ? "Ya" : "–");
const normal = (r: AccountListRow) => (r.normalBalance === "debit" ? "Debit" : "Kredit");

export function sortByCode(rows: AccountListRow[]): AccountListRow[] {
  return [...rows].sort((a, b) => a.code.localeCompare(b.code, "id", { numeric: true }));
}

/** `todayIso` = YYYY-MM-DD (WIB). */
export function buildCoaSheet(
  rows: AccountListRow[],
  filterLabel: string,
  todayIso: string,
): StyledSheet<AccountListRow> {
  const cols: Array<StyledCol<AccountListRow>> = [
    { header: "Kode", value: (r) => r.code, width: 9 },
    { header: "Nama Akun", value: (r) => r.name, width: 38, wrap: true },
    { header: "Tipe", value: (r) => COA_TYPE_LABEL[r.type], width: 13 },
    { header: "Saldo Normal", value: normal, width: 13 },
    { header: "Akun Induk", value: (r) => r.parentCode, width: 11 },
    { header: "Kontra", value: (r) => yesNo(r.isContra), width: 8 },
    { header: "Akun Sistem", value: (r) => yesNo(r.isSystem), width: 12 },
    { header: "Status", value: (r) => (r.isActive ? "Aktif" : "Nonaktif"), width: 10 },
    { header: "Catatan", value: (r) => r.notes, width: 56, wrap: true },
  ];
  const [y, m, d] = todayIso.split("-");
  const inactive = rows.filter((r) => !r.isActive).length;
  const perType = (Object.keys(COA_TYPE_LABEL) as AccountType[])
    .map((t) => `${COA_TYPE_LABEL[t]} ${rows.filter((r) => r.type === t).length}`)
    .join(" · ");
  return {
    name: "Bagan Akun",
    title: "Bagan Akun (Chart of Accounts)",
    subtitle: `Mahakan Coffee & Space · per ${d}/${m}/${y} · ${filterLabel}`,
    notes: [
      `${rows.length} akun — ${perType}`,
      ...(inactive > 0 ? [`${inactive} akun nonaktif ditandai kuning.`] : []),
      "Akun sistem wajib ada untuk auto-jurnal (POS, payroll, setoran, pembelian).",
    ],
    cols,
    rows,
    rowTone: (r) => (r.isActive ? null : "warning"),
  };
}

export function coaCsvRows(rows: AccountListRow[]) {
  return rows.map((r) => ({
    Kode: r.code,
    "Nama Akun": r.name,
    Tipe: COA_TYPE_LABEL[r.type],
    "Saldo Normal": normal(r),
    "Akun Induk": r.parentCode ?? "",
    Kontra: yesNo(r.isContra),
    "Akun Sistem": yesNo(r.isSystem),
    Status: r.isActive ? "Aktif" : "Nonaktif",
    Catatan: r.notes ?? "",
  }));
}
