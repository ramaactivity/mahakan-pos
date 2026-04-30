import { z } from "zod";

const moneySchema = z.number().int().nonnegative();

const itemModifierSchema = z.object({
  modifierSlug: z.string().min(1),
  selectedValue: z.string().nullable(),
  priceDelta: moneySchema,
});

const itemSchema = z.object({
  menuItemId: z.uuid(),
  variant: z.enum(["hot", "iced"]).nullable(),
  quantity: z.number().int().min(1).max(99),
  unitPrice: moneySchema,
  modifiersPriceDelta: moneySchema,
  subtotal: moneySchema,
  note: z.string().max(200).nullable(),
  openPriceNote: z.string().max(200).nullable(),
  modifiers: z.array(itemModifierSchema).max(10),
});

export const createTransactionSchema = z.object({
  clientRefId: z.uuid().optional(),
  shiftId: z.uuid(),
  cashierId: z.uuid(),
  pagerNumber: z.number().int().min(1).max(99).nullable(),
  orderType: z.enum(["dine_in", "takeaway"]),
  customerName: z
    .string()
    .trim()
    .max(60)
    .nullish()
    .transform((s) => (s && s.length > 0 ? s : null)),
  customerPhone: z
    .string()
    .trim()
    .max(30)
    .nullish()
    .transform((s) => (s && s.length > 0 ? s : null)),
  note: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((s) => (s && s.length > 0 ? s : null)),
  items: z.array(itemSchema).min(1).max(50),
  subtotal: moneySchema,
  discountType: z.enum(["percent", "fixed"]).nullable(),
  discountValue: moneySchema.nullable(),
  discountAmount: moneySchema,
  discountReason: z.string().max(120).nullable(),
  total: moneySchema,
  paymentMethod: z.enum(["cash", "qris", "card_bca"]),
  cashReceived: moneySchema.nullable(),
  cashChange: moneySchema.nullable(),
  discountApproverToken: z.string().optional(),
  loyaltyPointsRedeemed: z
    .number()
    .int()
    .min(0)
    .max(99_999)
    .nullish()
    .transform((n) => (typeof n === "number" && n > 0 ? n : null)),
});

export const voidTransactionSchema = z.object({
  transactionId: z.uuid(),
  reason: z.string().trim().min(3).max(200),
  /** Legacy "pin" mode — PIN-derived JWT from /api/v1/auth/verify-approver. */
  approverToken: z.string().optional(),
  /** New "code" mode — 6-digit Owner-issued code (B-2). Server picks the
   * mode based on outlet.settings.approval.voidMode. */
  approvalCode: z
    .string()
    .trim()
    .regex(/^\d{6}$/)
    .optional(),
});

export const refundTransactionSchema = z.object({
  transactionId: z.uuid(),
  reason: z.string().trim().min(3).max(200),
  approverToken: z.string().optional(),
  approvalCode: z
    .string()
    .trim()
    .regex(/^\d{6}$/)
    .optional(),
});

export const refundTransactionPartialSchema = z.object({
  transactionId: z.uuid(),
  items: z
    .array(
      z.object({
        transactionItemId: z.uuid(),
        quantity: z.number().int().min(1).max(99),
      }),
    )
    .min(1)
    .max(50),
  reason: z.string().trim().min(3).max(200),
  approverToken: z.string().optional(),
  approvalCode: z
    .string()
    .trim()
    .regex(/^\d{6}$/)
    .optional(),
});

export const addSplitPaymentSchema = z
  .object({
    transactionId: z.uuid(),
    amount: moneySchema,
    paymentMethod: z.enum(["cash", "qris", "card_bca"]),
    cashReceived: moneySchema.nullable(),
    cashChange: moneySchema.nullable(),
    splitKind: z.enum(["nominal", "per_menu"]),
    items: z
      .array(
        z.object({
          transactionItemId: z.uuid(),
          quantity: z.number().int().min(1).max(99),
        }),
      )
      .max(50)
      .optional(),
  })
  .refine(
    (v) =>
      v.paymentMethod === "cash"
        ? v.cashReceived !== null
        : v.cashReceived === null && v.cashChange === null,
    {
      message:
        "cashReceived wajib untuk cash, harus null untuk non-cash",
      path: ["cashReceived"],
    },
  )
  .refine(
    (v) =>
      v.splitKind === "per_menu"
        ? Array.isArray(v.items) && v.items.length > 0
        : v.items === undefined || v.items.length === 0,
    {
      message: "items wajib + non-empty untuk per_menu, harus kosong untuk nominal",
      path: ["items"],
    },
  );

export const editOpenBillSchema = z.object({
  transactionId: z.uuid(),
  customerName: z
    .string()
    .trim()
    .max(60)
    .nullish()
    .transform((s) => (s && s.length > 0 ? s : null)),
  customerPhone: z
    .string()
    .trim()
    .max(30)
    .nullish()
    .transform((s) => (s && s.length > 0 ? s : null)),
  note: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((s) => (s && s.length > 0 ? s : null)),
  items: z.array(itemSchema).min(1).max(50),
  subtotal: moneySchema,
  discountType: z.enum(["percent", "fixed"]).nullable(),
  discountValue: moneySchema.nullable(),
  discountAmount: moneySchema,
  discountReason: z.string().max(120).nullable(),
  total: moneySchema,
  /** For Staff-initiated discount on edit: token from /api/v1/auth/verify-approver. */
  discountApproverToken: z.string().optional(),
});
