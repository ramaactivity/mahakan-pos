"use client";

import { recordCartActivity } from "./actions";
import type { CartActivityEvent, CartActivityLine } from "./types";

/**
 * Sesi AE-237 — antrian jejak keranjang di perangkat. Dikirim 2 detik
 * setelah kejadian terakhir; gagal/offline → tetap di localStorage dan ikut
 * terkirim pada kejadian berikutnya atau saat POS dibuka lagi. Tidak pernah
 * melempar error ke kasir.
 */
const KEY = "mahakan.cartActivityQueue";
const MAX_QUEUE = 500;

/** Draft yang punya jejak — hanya draft ini yang perlu event "commit". */
const tracked = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

function read(): CartActivityEvent[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as CartActivityEvent[];
  } catch {
    return [];
  }
}
function write(q: CartActivityEvent[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(q.slice(-MAX_QUEUE)));
  } catch {
    // storage blocked — event lost, never block the cashier
  }
}

export async function flushCartActivity(): Promise<void> {
  if (flushing) return;
  const q = read();
  if (q.length === 0) return;
  flushing = true;
  try {
    const batch = q.slice(0, 100);
    const res = await recordCartActivity(batch);
    if (res.saved === batch.length) write(read().slice(batch.length));
  } catch {
    // offline / server error: keep queue, retry later
  } finally {
    flushing = false;
  }
}

function push(e: CartActivityEvent) {
  write([...read(), e]);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flushCartActivity(), 2000);
}

interface DraftLike {
  id: string;
  editingBillId: string | null;
  customerName: string | null;
  pagerNumber: number | null;
  items: Array<{ name: string; variant: string | null; quantity: number; subtotal: number; cartItemId: string }>;
}

const label = (d: DraftLike) =>
  [d.customerName, d.pagerNumber !== null ? `Pager ${d.pagerNumber}` : null].filter(Boolean).join(" / ") || "tanpa nama";
const lineName = (i: DraftLike["items"][number]) => (i.variant ? `${i.name} (${i.variant})` : i.name);
const lines = (d: DraftLike): CartActivityLine[] =>
  d.items.map((i) => ({ name: lineName(i), qty: i.quantity, subtotal: i.subtotal }));

/** Item dihapus atau qty-nya dikurangi. Call BEFORE mutating the cart. */
export function logCartReduce(
  d: DraftLike,
  cartItemId: string,
  newQty: number,
  totalBefore: number,
  shiftId: string | null,
) {
  if (d.editingBillId) return;
  const item = d.items.find((i) => i.cartItemId === cartItemId);
  if (!item || newQty >= item.quantity) return;
  const removedQty = item.quantity - Math.max(0, newQty);
  const removedValue = Math.round((item.subtotal / item.quantity) * removedQty);
  tracked.add(d.id);
  push({
    kind: "item_remove",
    draftId: d.id,
    label: label(d),
    shiftId,
    at: new Date().toISOString(),
    line: { name: lineName(item), qty: removedQty, subtotal: removedValue },
    totalBefore,
    totalAfter: Math.max(0, totalBefore - removedValue),
  });
}

/** Keranjang berisi item dibatalkan tanpa disimpan/dibayar. */
export function logCartDiscard(d: DraftLike, totalBefore: number, shiftId: string | null) {
  if (d.editingBillId || d.items.length === 0) return;
  tracked.delete(d.id);
  push({
    kind: "discard",
    draftId: d.id,
    label: label(d),
    shiftId,
    at: new Date().toISOString(),
    items: lines(d),
    totalBefore,
  });
}

/** Draft berjejak berhasil jadi transaksi — tautkan jejaknya ke bill. */
export function logCartCommit(
  d: DraftLike,
  shiftId: string | null,
  ref: { transactionId?: string | null; clientRefId?: string | null },
) {
  if (!tracked.has(d.id)) return;
  tracked.delete(d.id);
  push({
    kind: "commit",
    draftId: d.id,
    label: label(d),
    shiftId,
    at: new Date().toISOString(),
    transactionId: ref.transactionId ?? null,
    clientRefId: ref.clientRefId ?? null,
  });
}
