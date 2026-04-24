import { OUTLET_ID, mockShifts } from "../data";
import type { ApiResult, Paginated, Shift } from "../types";
import { delay, fail, genId, ok } from "./_helpers";
import { _internalAllTransactions } from "./transactionService";

let shifts: Shift[] = mockShifts.map((s) => ({ ...s }));

export async function getActiveShift(
  userId: string,
): Promise<ApiResult<Shift | null>> {
  await delay();
  const active = shifts.find(
    (s) => s.userId === userId && s.status === "open",
  );
  return ok(active ? { ...active } : null);
}

export async function openShift(
  userId: string,
  openingCash: number,
): Promise<ApiResult<Shift>> {
  await delay();

  const hasActive = shifts.some(
    (s) => s.userId === userId && s.status === "open",
  );
  if (hasActive) {
    return fail(
      "SHIFT_ALREADY_OPEN",
      "Kamu masih punya shift yang aktif. Tutup dulu.",
    );
  }
  if (openingCash < 0) {
    return fail("VALIDATION_ERROR", "Kas awal tidak boleh negatif");
  }

  const now = new Date().toISOString();
  const newShift: Shift = {
    id: genId("shift"),
    outletId: OUTLET_ID,
    userId,
    status: "open",
    openingCash,
    actualCash: null,
    variance: null,
    notes: null,
    openedAt: now,
    closedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  shifts = [...shifts, newShift];
  return ok({ ...newShift });
}

export interface CloseShiftInput {
  shiftId: string;
  userId: string;
  actualCash: number;
  notes: string | null;
}

export interface CloseShiftResult {
  shift: Shift;
  summary: {
    transactionCount: number;
    paid: {
      count: number;
      cash: number;
      qris: number;
      cardBca: number;
    };
    voided: { count: number; totalAmount: number };
    refunded: { count: number; totalAmount: number };
    expectedCash: number;
  };
}

export async function closeShift(
  input: CloseShiftInput,
): Promise<ApiResult<CloseShiftResult>> {
  await delay();

  const index = shifts.findIndex((s) => s.id === input.shiftId);
  if (index === -1) return fail("NOT_FOUND", "Shift tidak ditemukan");
  const current = shifts[index];

  if (current.userId !== input.userId) {
    return fail(
      "NOT_OWNER_OF_SHIFT",
      "Kamu tidak bisa tutup shift orang lain",
    );
  }
  if (current.status === "closed") {
    return fail("ALREADY_CLOSED", "Shift sudah tutup");
  }
  if (input.actualCash < 0) {
    return fail("VALIDATION_ERROR", "Kas aktual tidak boleh negatif");
  }

  // Aggregate transactions within this shift
  const shiftTrxs = _internalAllTransactions().filter(
    (t) => t.shiftId === input.shiftId,
  );

  const paid = shiftTrxs.filter((t) => t.status === "paid");
  const voided = shiftTrxs.filter((t) => t.status === "voided");
  const refunded = shiftTrxs.filter((t) => t.status === "refunded");

  const paidCash = paid
    .filter((t) => t.paymentMethod === "cash")
    .reduce((sum, t) => sum + t.total, 0);
  const paidQris = paid
    .filter((t) => t.paymentMethod === "qris")
    .reduce((sum, t) => sum + t.total, 0);
  const paidCard = paid
    .filter((t) => t.paymentMethod === "card_bca")
    .reduce((sum, t) => sum + t.total, 0);

  // Refunds reduce expected cash
  const refundedCash = refunded
    .filter((t) => t.paymentMethod === "cash")
    .reduce((sum, t) => sum + t.total, 0);

  const expectedCash = current.openingCash + paidCash - refundedCash;
  const variance = input.actualCash - expectedCash;

  const now = new Date().toISOString();
  shifts[index] = {
    ...current,
    status: "closed",
    actualCash: input.actualCash,
    variance,
    notes: input.notes,
    closedAt: now,
    updatedAt: now,
  };

  return ok({
    shift: { ...shifts[index] },
    summary: {
      transactionCount: shiftTrxs.length,
      paid: {
        count: paid.length,
        cash: paidCash,
        qris: paidQris,
        cardBca: paidCard,
      },
      voided: {
        count: voided.length,
        totalAmount: voided.reduce((sum, t) => sum + t.total, 0),
      },
      refunded: {
        count: refunded.length,
        totalAmount: refunded.reduce((sum, t) => sum + t.total, 0),
      },
      expectedCash,
    },
  });
}

export interface ListShiftOptions {
  userId?: string;
  from?: string;
  to?: string;
  status?: "open" | "closed";
  limit?: number;
}

export async function listShifts(
  options: ListShiftOptions = {},
): Promise<ApiResult<Paginated<Shift>>> {
  await delay();
  const { userId, from, to, status, limit = 50 } = options;
  const filtered = shifts.filter((s) => {
    if (userId && s.userId !== userId) return false;
    if (status && s.status !== status) return false;
    if (from && s.openedAt < from) return false;
    if (to && s.openedAt > to) return false;
    return true;
  });
  filtered.sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1));
  return ok({
    items: filtered.slice(0, limit),
    total: filtered.length,
    hasMore: filtered.length > limit,
  });
}

export async function getShift(id: string): Promise<ApiResult<Shift>> {
  await delay();
  const found = shifts.find((s) => s.id === id);
  if (!found) return fail("NOT_FOUND", "Shift tidak ditemukan");
  return ok({ ...found });
}

export function __resetShiftState(): void {
  shifts = mockShifts.map((s) => ({ ...s }));
}
