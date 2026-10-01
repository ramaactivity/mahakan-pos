/**
 * Sesi AE-237 — jejak keranjang SEBELUM bill disimpan/dibayar.
 *
 * Sampai sesi ini, item yang dimasukkan kasir lalu dihapus (atau keranjang
 * yang dibatalkan) sebelum disimpan tidak meninggalkan jejak apa pun: kasir
 * bisa menyebut total ke tamu, menerima uang, lalu membuang keranjang.
 * Hanya keranjang BARU yang dicatat — edit open bill sudah tercatat lewat
 * diff saat disimpan (AE-234), dan membatalkan edit tidak mengubah bill.
 */

export interface CartActivityLine {
  name: string;
  qty: number;
  subtotal: number;
}

export type CartActivityEvent =
  | {
      kind: "item_remove";
      draftId: string;
      label: string;
      shiftId: string | null;
      at: string;
      /** Baris yang hilang/berkurang: qty = jumlah yang dikurangi. */
      line: CartActivityLine;
      totalBefore: number;
      totalAfter: number;
    }
  | {
      kind: "discard";
      draftId: string;
      label: string;
      shiftId: string | null;
      at: string;
      items: CartActivityLine[];
      totalBefore: number;
    }
  | {
      /** Keranjang yang punya jejak di atas akhirnya jadi transaksi. */
      kind: "commit";
      draftId: string;
      label: string;
      shiftId: string | null;
      at: string;
      transactionId: string | null;
      clientRefId: string | null;
    };

const rp = (n: number) => `Rp${n.toLocaleString("id-ID")}`;

export function cartEventSummary(e: CartActivityEvent): string {
  switch (e.kind) {
    case "item_remove":
      return `Keranjang ${e.label}: hapus ${e.line.qty}× ${e.line.name} (${rp(e.line.subtotal)}) sebelum disimpan — total ${rp(e.totalBefore)} → ${rp(e.totalAfter)}`;
    case "discard":
      return `Keranjang ${e.label} DIBATALKAN sebelum disimpan/dibayar — ${e.items.map((i) => `${i.qty}× ${i.name}`).join(", ")} (total ${rp(e.totalBefore)})`;
    case "commit":
      return `Keranjang ${e.label} disimpan/dibayar jadi transaksi`;
  }
}
