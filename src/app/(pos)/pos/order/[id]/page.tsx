"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Banknote,
  CheckCircle2,
  CreditCard,
  Percent,
  Printer,
  QrCode,
  Search,
  ShoppingCart,
  X,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Spinner,
  toast,
} from "@/components/ui";
import { CartLineItem } from "@/features/pos/components/CartLineItem";
import { CategoryTabs } from "@/features/pos/components/CategoryTabs";
import { DiscountModal } from "@/features/pos/components/DiscountModal";
import { ApproverOverrideModal } from "@/features/pos/components/ApproverOverrideModal";
import { ItemModifierModal } from "@/features/pos/components/ItemModifierModal";
import { ItemNoteModal } from "@/features/pos/components/ItemNoteModal";
import { MenuTile } from "@/features/pos/components/MenuTile";
import { OpenPriceModal } from "@/features/pos/components/OpenPriceModal";
import { useCartStore } from "@/features/pos/cartStore";
import { useSession } from "@/features/auth/SessionProvider";
import {
  isOk,
  menuService,
  shiftService,
  transactionService,
} from "@/mocks/services";
import type {
  Category,
  MenuItem,
  PaymentMethod,
  Shift,
  Transaction,
} from "@/mocks/types";
import type { Discount } from "@/lib/money";
import { formatRupiah } from "@/lib/format";
import { formatIndonesianDateTime } from "@/lib/date";
import { cn } from "@/lib/utils";

type Step = "cart" | "paying" | "paid";

const QUICK_AMOUNTS = [50_000, 100_000, 200_000];

export default function ActiveOrderPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const draftId = params.id;
  const { session } = useSession();

  const draft = useCartStore((s) => s.drafts[draftId]);
  const subtotal = useCartStore((s) => s.getSubtotal(draftId));
  const discountAmount = useCartStore((s) => s.getDiscountAmount(draftId));
  const total = useCartStore((s) => s.getTotal(draftId));
  const addItem = useCartStore((s) => s.addItem);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const updateNote = useCartStore((s) => s.updateNote);
  const setDiscount = useCartStore((s) => s.setDiscount);
  const removeDraft = useCartStore((s) => s.removeDraft);

  const [step, setStep] = useState<Step>("cart");

  // Menu data (cart step only)
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [menuLoading, setMenuLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Modal state (cart step)
  const [variantItem, setVariantItem] = useState<MenuItem | null>(null);
  const [openPriceItem, setOpenPriceItem] = useState<MenuItem | null>(null);
  const [noteEditingId, setNoteEditingId] = useState<string | null>(null);
  const [discountModalOpen, setDiscountModalOpen] = useState(false);
  const [approverOpen, setApproverOpen] = useState(false);
  const [pendingDiscount, setPendingDiscount] = useState<{
    discount: Discount;
    reason: string;
  } | null>(null);

  // Payment state
  const [shift, setShift] = useState<Shift | null>(null);
  const [shiftLoading, setShiftLoading] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [cashInput, setCashInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  // Paid state
  const [completedTrx, setCompletedTrx] = useState<Transaction | null>(null);

  // Load menu + categories once
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [menuRes, catRes] = await Promise.all([
        menuService.listMenuItems({ activeOnly: true }),
        menuService.listCategories(),
      ]);
      if (cancelled) return;
      if (isOk(menuRes)) setMenuItems(menuRes.data.items);
      if (isOk(catRes)) setCategories(catRes.data.items);
      setMenuLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load shift once (needed for payment)
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    async function load() {
      const res = await shiftService.getActiveShift(session!.user.id);
      if (cancelled) return;
      if (isOk(res)) setShift(res.data);
      setShiftLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [session]);

  const categoryNameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of categories) m[c.id] = c.name;
    return m;
  }, [categories]);

  const itemCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const it of menuItems) {
      if (!it.isActive) continue;
      counts[it.categoryId] = (counts[it.categoryId] ?? 0) + 1;
    }
    return counts;
  }, [menuItems]);

  const filteredItems = useMemo(() => {
    const searchLower = searchQuery.toLowerCase().trim();
    return menuItems.filter((it) => {
      if (!it.isActive) return false;
      if (activeCategory !== "all" && it.categoryId !== activeCategory)
        return false;
      if (searchLower && !it.name.toLowerCase().includes(searchLower))
        return false;
      return true;
    });
  }, [menuItems, activeCategory, searchQuery]);

  if (!draft) {
    return (
      <div className="mx-auto max-w-md py-12 text-center">
        <p className="text-neutral-700">
          Draft order tidak ditemukan. Mungkin udah selesai atau direstart.
        </p>
        <Link
          href="/pos"
          className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-mahakan-green-700 hover:underline"
        >
          Kembali ke dashboard
        </Link>
      </div>
    );
  }

  if (!session) return null;

  // ========= Cart-step handlers =========

  function handleItemTap(item: MenuItem) {
    if (item.isSoldOut) return;
    if (item.priceType === "open") {
      setOpenPriceItem(item);
      return;
    }
    setVariantItem(item);
  }

  function handleDiscountSubmit(discount: Discount, reason: string) {
    if (!session) return;
    const role = session.user.role;
    if (role === "owner" || role === "manager") {
      setDiscount(draftId, discount, reason, session.user.id);
      toast.success("Diskon ditambahkan");
      return;
    }
    setPendingDiscount({ discount, reason });
    setApproverOpen(true);
  }

  function handleApproverVerified(result: { approverId: string; token: string }) {
    if (!pendingDiscount) return;
    setDiscount(
      draftId,
      pendingDiscount.discount,
      pendingDiscount.reason,
      result.approverId,
      result.token,
    );
    toast.success("Diskon ditambahkan (PIN-approved)");
    setPendingDiscount(null);
    setApproverOpen(false);
  }

  function handleClearDiscount() {
    setDiscount(draftId, null, null);
    toast.success("Diskon dihapus");
  }

  // ========= Payment-step handlers =========

  const cashReceived = parseInt(cashInput || "0", 10) || 0;
  const cashChange = Math.max(0, cashReceived - total);
  const cashSufficient = paymentMethod !== "cash" || cashReceived >= total;

  async function onProcessPayment() {
    if (submitting) return;
    if (!shift) {
      setPaymentError("Tidak ada shift aktif");
      return;
    }
    if (!cashSufficient) {
      setPaymentError("Uang yang diterima kurang dari total");
      return;
    }
    setSubmitting(true);
    setPaymentError(null);

    const res = await transactionService.createTransaction({
      clientRefId: `client-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      shiftId: shift.id,
      cashierId: session!.user.id,
      pagerNumber: draft!.pagerNumber,
      orderType: draft!.orderType,
      items: draft!.items.map((item) => ({
        menuItemId: item.menuItemId,
        variant: item.variant,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        modifiersPriceDelta: item.modifiersPriceDelta,
        subtotal: item.subtotal,
        note: item.note,
        openPriceNote: item.openPriceNote,
        modifiers: item.modifiers.map((m) => ({
          modifierSlug: m.modifierSlug,
          selectedValue: m.selectedValue,
          priceDelta: m.priceDelta,
        })),
      })),
      subtotal,
      discountType: draft!.discount?.type ?? null,
      discountValue: draft!.discount?.value ?? null,
      discountAmount,
      discountReason: draft!.discountReason,
      total,
      paymentMethod,
      cashReceived: paymentMethod === "cash" ? cashReceived : null,
      cashChange: paymentMethod === "cash" ? cashChange : null,
      discountApproverId: draft!.discountApproverId ?? undefined,
      discountApproverToken: draft!.discountApproverToken ?? undefined,
    });

    if (!isOk(res)) {
      setPaymentError(res.error.message);
      setSubmitting(false);
      return;
    }

    setCompletedTrx(res.data);
    removeDraft(draftId);
    setStep("paid");
    setSubmitting(false);
    toast.success(`Transaksi ${res.data.transactionNumber} berhasil`);
  }

  // ========= Paid-step handlers =========

  function onFinishOrder() {
    if (completedTrx) {
      void transactionService.markServed(completedTrx.id);
    }
    router.push("/pos");
  }

  // ========= Render =========

  const editingNoteItem = noteEditingId
    ? draft.items.find((i) => i.cartItemId === noteEditingId)
    : null;

  return (
    <div className="-mx-4 sm:-mx-6 -mt-4 sm:-mt-6 grid h-[calc(100vh-4rem)] grid-cols-1 lg:grid-cols-[1fr_400px]">
      {/* LEFT PANE — Menu (cart step) or Order summary (paying/paid) */}
      <section
        className={cn(
          "flex flex-col overflow-hidden border-b lg:border-b-0 lg:border-r border-neutral-200",
          step !== "cart" && "lg:col-span-1 lg:row-span-1",
        )}
      >
        {step === "cart" ? (
          <CartStepLeftPane
            draft={draft}
            menuLoading={menuLoading}
            filteredItems={filteredItems}
            categories={categories}
            itemCounts={itemCounts}
            activeCategory={activeCategory}
            setActiveCategory={setActiveCategory}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            onItemTap={handleItemTap}
          />
        ) : (
          <OrderSummaryPane
            draft={draft}
            subtotal={subtotal}
            discountAmount={discountAmount}
            total={total}
            step={step}
            onBackToCart={() => {
              setStep("cart");
              setPaymentError(null);
            }}
          />
        )}
      </section>

      {/* RIGHT PANE — Cart / Payment / Success */}
      <aside className="flex flex-col overflow-hidden bg-white">
        {step === "cart" ? (
          <CartStepRightPane
            draft={draft}
            subtotal={subtotal}
            discountAmount={discountAmount}
            total={total}
            onUpdateQty={(id, qty) => updateQuantity(draftId, id, qty)}
            onRemoveItem={(id) => removeItem(draftId, id)}
            onEditNote={(id) => setNoteEditingId(id)}
            onOpenDiscount={() => setDiscountModalOpen(true)}
            onProceedToPayment={() => {
              setCashInput("");
              setPaymentError(null);
              setStep("paying");
            }}
            onCancel={() => {
              if (draft.items.length === 0) {
                removeDraft(draftId);
                router.push("/pos");
                return;
              }
              const ok = window.confirm(
                "Batalkan order ini? Item-item akan hilang.",
              );
              if (ok) {
                removeDraft(draftId);
                router.push("/pos");
              }
            }}
          />
        ) : step === "paying" ? (
          <PaymentPane
            shift={shift}
            shiftLoading={shiftLoading}
            total={total}
            paymentMethod={paymentMethod}
            setPaymentMethod={setPaymentMethod}
            setCashInput={setCashInput}
            cashReceived={cashReceived}
            cashChange={cashChange}
            cashSufficient={cashSufficient}
            submitting={submitting}
            error={paymentError}
            onCancel={() => setStep("cart")}
            onSubmit={onProcessPayment}
          />
        ) : (
          <SuccessPane
            trx={completedTrx}
            onFinish={onFinishOrder}
          />
        )}
      </aside>

      {/* MODALS — only relevant during cart step but harmless if mounted */}
      <ItemModifierModal
        item={variantItem}
        categoryName={
          variantItem ? categoryNameById[variantItem.categoryId] ?? "" : ""
        }
        onClose={() => setVariantItem(null)}
        onAdd={(line) => {
          addItem(draftId, line);
          toast.success(`${line.name} ditambahkan`);
        }}
      />
      <OpenPriceModal
        item={openPriceItem}
        categoryName={
          openPriceItem
            ? categoryNameById[openPriceItem.categoryId] ?? ""
            : ""
        }
        onClose={() => setOpenPriceItem(null)}
        onAdd={(line) => {
          addItem(draftId, line);
          toast.success(`${line.name} ditambahkan`);
        }}
      />
      <ItemNoteModal
        open={editingNoteItem !== null}
        initialValue={editingNoteItem?.note ?? null}
        onClose={() => setNoteEditingId(null)}
        onSave={(note) => {
          if (noteEditingId) updateNote(draftId, noteEditingId, note);
        }}
      />
      <DiscountModal
        open={discountModalOpen}
        subtotal={subtotal}
        initialDiscount={draft.discount}
        initialReason={draft.discountReason}
        onClose={() => setDiscountModalOpen(false)}
        onApply={handleDiscountSubmit}
        onClear={handleClearDiscount}
      />
      <ApproverOverrideModal
        open={approverOpen}
        actionType="pos.discount.apply"
        title="Diskon Butuh Approval"
        description="Owner / Manager input PIN untuk authorize diskon ini."
        onClose={() => {
          setApproverOpen(false);
          setPendingDiscount(null);
        }}
        onVerified={handleApproverVerified}
      />
    </div>
  );
}

// ============================================================================
// Sub-components — kept in same file to avoid prop-drill explosion
// ============================================================================

interface CartStepLeftPaneProps {
  draft: NonNullable<ReturnType<typeof useCartStore.getState>["drafts"][string]>;
  menuLoading: boolean;
  filteredItems: MenuItem[];
  categories: Category[];
  itemCounts: Record<string, number>;
  activeCategory: string | "all";
  setActiveCategory: (id: string | "all") => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  onItemTap: (item: MenuItem) => void;
}

function CartStepLeftPane({
  draft,
  menuLoading,
  filteredItems,
  categories,
  itemCounts,
  activeCategory,
  setActiveCategory,
  searchQuery,
  setSearchQuery,
  onItemTap,
}: CartStepLeftPaneProps) {
  return (
    <>
      <header className="flex flex-col gap-3 border-b border-neutral-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/pos"
            className="inline-flex items-center gap-1 text-sm font-medium text-neutral-700 hover:text-neutral-900"
          >
            <ArrowLeft className="size-4" aria-hidden /> Dashboard
          </Link>
          <div className="flex items-center gap-2">
            <Badge variant="signature">
              Pager <span className="font-mono">{draft.pagerNumber}</span>
            </Badge>
            <Badge variant="neutral">
              {draft.orderType === "dine_in" ? "Dine-in" : "Takeaway"}
            </Badge>
          </div>
        </div>
        <Input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Cari menu…"
          leadingIcon={<Search className="size-4" aria-hidden />}
          trailingSlot={
            searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                aria-label="Hapus pencarian"
              >
                <X className="size-4" />
              </button>
            ) : undefined
          }
        />
        <CategoryTabs
          categories={categories}
          activeId={activeCategory}
          onChange={setActiveCategory}
          itemCounts={itemCounts}
        />
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {menuLoading ? (
          <div className="flex h-32 items-center justify-center">
            <Spinner className="size-6 text-mahakan-green-700" />
          </div>
        ) : filteredItems.length === 0 ? (
          <p className="py-8 text-center text-neutral-500">
            Tidak ada item yang cocok.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {filteredItems.map((item) => (
              <MenuTile
                key={item.id}
                item={item}
                onSelect={onItemTap}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

interface CartStepRightPaneProps {
  draft: NonNullable<ReturnType<typeof useCartStore.getState>["drafts"][string]>;
  subtotal: number;
  discountAmount: number;
  total: number;
  onUpdateQty: (cartItemId: string, qty: number) => void;
  onRemoveItem: (cartItemId: string) => void;
  onEditNote: (cartItemId: string) => void;
  onOpenDiscount: () => void;
  onProceedToPayment: () => void;
  onCancel: () => void;
}

function CartStepRightPane({
  draft,
  subtotal,
  discountAmount,
  total,
  onUpdateQty,
  onRemoveItem,
  onEditNote,
  onOpenDiscount,
  onProceedToPayment,
  onCancel,
}: CartStepRightPaneProps) {
  return (
    <>
      <header className="flex items-center justify-between border-b border-neutral-200 p-4">
        <h2 className="flex items-center gap-2 text-base font-semibold text-neutral-900">
          <ShoppingCart className="size-5" aria-hidden /> Order Aktif
        </h2>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
          aria-label="Batalkan order"
        >
          <X className="size-5" aria-hidden />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        {draft.items.length === 0 ? (
          <p className="py-12 text-center text-neutral-500">
            Belum ada item. Tap menu untuk tambah.
          </p>
        ) : (
          draft.items.map((item) => (
            <CartLineItem
              key={item.cartItemId}
              item={item}
              onQuantityChange={onUpdateQty}
              onRemove={onRemoveItem}
              onEditNote={onEditNote}
            />
          ))
        )}
      </div>

      <footer className="border-t border-neutral-200 bg-neutral-50 p-4 space-y-3">
        <Row label="Subtotal" value={formatRupiah(subtotal)} muted />
        {draft.discount ? (
          <Row
            label={`Diskon ${
              draft.discount.type === "percent"
                ? `(${draft.discount.value}%)`
                : ""
            } — ${draft.discountReason ?? ""}`}
            value={`- ${formatRupiah(discountAmount)}`}
            danger
          />
        ) : null}
        <div className="border-t border-neutral-200 pt-2">
          <Row label="TOTAL" value={formatRupiah(total)} bold />
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={onOpenDiscount}
            disabled={draft.items.length === 0}
            fullWidth
          >
            <Percent className="size-4" aria-hidden /> Diskon
          </Button>
          <Button
            size="lg"
            onClick={onProceedToPayment}
            disabled={draft.items.length === 0}
            fullWidth
          >
            Bayar
          </Button>
        </div>
      </footer>
    </>
  );
}

interface OrderSummaryPaneProps {
  draft: NonNullable<ReturnType<typeof useCartStore.getState>["drafts"][string]>;
  subtotal: number;
  discountAmount: number;
  total: number;
  step: Step;
  onBackToCart: () => void;
}

function OrderSummaryPane({
  draft,
  subtotal,
  discountAmount,
  total,
  step,
  onBackToCart,
}: OrderSummaryPaneProps) {
  return (
    <>
      <header className="flex items-center justify-between gap-3 border-b border-neutral-200 bg-white p-4">
        {step === "paying" ? (
          <button
            type="button"
            onClick={onBackToCart}
            className="inline-flex items-center gap-1 text-sm font-medium text-neutral-700 hover:text-neutral-900"
          >
            <ArrowLeft className="size-4" aria-hidden /> Kembali ke Cart
          </button>
        ) : (
          <Link
            href="/pos"
            className="inline-flex items-center gap-1 text-sm font-medium text-neutral-700 hover:text-neutral-900"
          >
            <ArrowLeft className="size-4" aria-hidden /> Dashboard
          </Link>
        )}
        <div className="flex items-center gap-2">
          <Badge variant="signature">
            Pager <span className="font-mono">{draft.pagerNumber}</span>
          </Badge>
          <Badge variant="neutral">
            {draft.orderType === "dine_in" ? "Dine-in" : "Takeaway"}
          </Badge>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        <h2 className="mb-3 text-base font-semibold text-neutral-900">
          Pesanan
        </h2>
        <div className="space-y-2">
          {draft.items.map((item) => (
            <div
              key={item.cartItemId}
              className="flex items-start justify-between gap-3 border-b border-neutral-200 pb-2 last:border-0"
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium text-neutral-900">
                  {item.quantity}× {item.name}
                  {item.variant ? (
                    <span className="text-neutral-500">
                      {" "}({item.variant === "hot" ? "Hot" : "Iced"})
                    </span>
                  ) : null}
                </p>
                {item.modifiers.length > 0 ? (
                  <p className="text-xs text-neutral-500">
                    {item.modifiers
                      .map((m) => m.selectedLabel ?? m.modifierSlug)
                      .join(" · ")}
                  </p>
                ) : null}
                {item.note ? (
                  <p className="text-xs italic text-neutral-600">
                    &ldquo;{item.note}&rdquo;
                  </p>
                ) : null}
                {item.openPriceNote ? (
                  <p className="text-xs italic text-neutral-700">
                    {item.openPriceNote}
                  </p>
                ) : null}
              </div>
              <span className="font-mono text-sm">
                {formatRupiah(item.subtotal)}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-6 space-y-1 border-t border-neutral-200 pt-3 text-sm">
          <Row label="Subtotal" value={formatRupiah(subtotal)} muted />
          {draft.discount ? (
            <Row
              label={`Diskon ${
                draft.discount.type === "percent"
                  ? `(${draft.discount.value}%)`
                  : ""
              }`}
              value={`- ${formatRupiah(discountAmount)}`}
              danger
            />
          ) : null}
          <div className="border-t border-neutral-200 pt-2">
            <Row label="TOTAL" value={formatRupiah(total)} bold />
          </div>
        </div>
      </div>
    </>
  );
}

interface PaymentPaneProps {
  shift: Shift | null;
  shiftLoading: boolean;
  total: number;
  paymentMethod: PaymentMethod;
  setPaymentMethod: (m: PaymentMethod) => void;
  setCashInput: (s: string | ((prev: string) => string)) => void;
  cashReceived: number;
  cashChange: number;
  cashSufficient: boolean;
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: () => void;
}

function PaymentPane({
  shift,
  shiftLoading,
  total,
  paymentMethod,
  setPaymentMethod,
  setCashInput,
  cashReceived,
  cashChange,
  cashSufficient,
  submitting,
  error,
  onCancel,
  onSubmit,
}: PaymentPaneProps) {
  if (shiftLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-8 text-mahakan-green-700" />
      </div>
    );
  }
  if (!shift) {
    return (
      <div className="p-4">
        <Card>
          <CardHeader>
            <CardTitle>Tidak Ada Shift Aktif</CardTitle>
            <CardDescription>
              Buka shift dulu sebelum proses pembayaran.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={onCancel}>Kembali</Button>
          </CardContent>
        </Card>
      </div>
    );
  }
  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <header className="border-b border-neutral-200 bg-white p-4">
        <h2 className="text-base font-semibold text-neutral-900">
          Pembayaran
        </h2>
        <p className="text-xs text-neutral-500">
          Total tagihan:{" "}
          <span className="font-mono font-bold">{formatRupiah(total)}</span>
        </p>
      </header>

      <div className="flex-1 space-y-4 p-4">
        <div className="grid grid-cols-3 gap-2">
          <MethodButton
            active={paymentMethod === "cash"}
            onClick={() => setPaymentMethod("cash")}
            label="Tunai"
            Icon={Banknote}
          />
          <MethodButton
            active={paymentMethod === "qris"}
            onClick={() => setPaymentMethod("qris")}
            label="QRIS"
            Icon={QrCode}
          />
          <MethodButton
            active={paymentMethod === "card_bca"}
            onClick={() => setPaymentMethod("card_bca")}
            label="Kartu BCA"
            Icon={CreditCard}
          />
        </div>

        {paymentMethod === "cash" ? (
          <>
            <div className="flex h-14 items-center justify-end rounded-md border border-neutral-300 bg-white px-4 font-mono text-2xl font-bold">
              {cashReceived > 0 ? formatRupiah(cashReceived) : "—"}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {QUICK_AMOUNTS.map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setCashInput(String(amt))}
                  className="rounded-md border border-neutral-300 bg-white py-2 text-sm font-medium hover:bg-neutral-100"
                >
                  {formatRupiah(amt).replace("Rp ", "")}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setCashInput(String(total))}
                className="rounded-md border border-mahakan-green-700 bg-mahakan-green-50 py-2 text-sm font-medium text-mahakan-green-900 hover:bg-mahakan-green-100"
              >
                Pas
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                <NumKey
                  key={d}
                  label={d}
                  onPress={() =>
                    setCashInput((s) => (typeof s === "string" ? s + d : d))
                  }
                />
              ))}
              <NumKey label="C" onPress={() => setCashInput("")} />
              <NumKey
                label="0"
                onPress={() =>
                  setCashInput((s) => (typeof s === "string" ? s + "0" : "0"))
                }
              />
              <NumKey
                label="⌫"
                onPress={() =>
                  setCashInput((s) =>
                    typeof s === "string" ? s.slice(0, -1) : "",
                  )
                }
              />
            </div>
            <div className="rounded-md bg-neutral-100 p-3 text-sm">
              <Row
                label="Kembalian"
                value={
                  cashReceived >= total
                    ? formatRupiah(cashChange)
                    : `Kurang ${formatRupiah(total - cashReceived)}`
                }
                bold
                danger={!cashSufficient}
              />
            </div>
          </>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>
                Konfirmasi {paymentMethod === "qris" ? "QRIS" : "Kartu BCA"}
              </CardTitle>
              <CardDescription>
                Customer scan QRIS / tap kartu di EDC. Setelah lunas di EDC,
                tap tombol bawah.
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {error ? (
          <p role="alert" className="text-sm font-medium text-danger-500">
            {error}
          </p>
        ) : null}
      </div>

      <footer className="border-t border-neutral-200 bg-neutral-50 p-4 space-y-2">
        <Button
          size="xl"
          onClick={onSubmit}
          loading={submitting}
          disabled={!cashSufficient}
          fullWidth
        >
          {paymentMethod === "cash"
            ? `Konfirmasi ${formatRupiah(total)}`
            : paymentMethod === "qris"
              ? "Sudah Lunas QRIS"
              : "Sudah Lunas Kartu"}
        </Button>
        <Button variant="ghost" onClick={onCancel} fullWidth disabled={submitting}>
          Kembali ke Cart
        </Button>
      </footer>
    </div>
  );
}

interface SuccessPaneProps {
  trx: Transaction | null;
  onFinish: () => void;
}

function SuccessPane({ trx, onFinish }: SuccessPaneProps) {
  if (!trx) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-8 text-mahakan-green-700" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="flex flex-col items-center gap-2 border-b border-neutral-200 bg-white p-4">
        <div className="flex size-12 items-center justify-center rounded-full bg-success-100">
          <CheckCircle2 className="size-7 text-success-500" aria-hidden />
        </div>
        <p className="text-base font-semibold text-neutral-900">
          Transaksi Berhasil
        </p>
        <p className="font-mono text-xs text-neutral-500">
          {trx.transactionNumber}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="rounded-md bg-neutral-50 p-4 font-mono text-xs leading-relaxed text-neutral-900">
          <div className="text-center">
            <p className="font-bold">Mahakan Coffee &amp; Space</p>
            <p>Puncak Rd KM 22, Cisarua</p>
            <p>0838-1977-5665</p>
          </div>
          <div className="my-2 border-t border-dashed border-neutral-300" />
          <div className="space-y-0.5">
            <Line
              left={trx.transactionNumber}
              right={trx.orderType === "dine_in" ? "Dine-in" : "Takeaway"}
            />
            <Line left="Pager" right={String(trx.pagerNumber)} />
            <Line left="Waktu" right={formatIndonesianDateTime(trx.createdAt)} />
          </div>
          <div className="my-2 border-t border-dashed border-neutral-300" />
          <div className="space-y-1">
            {trx.items.map((item) => (
              <div key={item.id}>
                <Line
                  left={`${item.quantity}× ${item.itemName}${
                    item.variant
                      ? ` (${item.variant === "hot" ? "Hot" : "Iced"})`
                      : ""
                  }`}
                  right={formatRupiah(item.subtotal)}
                />
                {item.modifiers.length > 0 ? (
                  <p className="pl-3 text-[10px] text-neutral-600">
                    {item.modifiers
                      .map((m) => m.selectedValue ?? m.modifierSlug)
                      .join(", ")}
                  </p>
                ) : null}
                {item.openPriceNote ? (
                  <p className="pl-3 text-[10px] italic text-neutral-700">
                    {item.openPriceNote}
                  </p>
                ) : null}
                {item.note ? (
                  <p className="pl-3 text-[10px] italic text-neutral-600">
                    &ldquo;{item.note}&rdquo;
                  </p>
                ) : null}
              </div>
            ))}
          </div>
          <div className="my-2 border-t border-dashed border-neutral-300" />
          <Line label="Subtotal" value={formatRupiah(trx.subtotal)} />
          {trx.discountAmount > 0 ? (
            <Line
              label={`Diskon ${
                trx.discountType === "percent" ? `${trx.discountValue}%` : ""
              }`}
              value={`- ${formatRupiah(trx.discountAmount)}`}
            />
          ) : null}
          <Line label="TOTAL" value={formatRupiah(trx.total)} bold />
          <div className="my-1 border-t border-dashed border-neutral-300" />
          <Line
            label="Bayar"
            value={
              trx.paymentMethod === "cash"
                ? `Tunai ${formatRupiah(trx.cashReceived ?? 0)}`
                : trx.paymentMethod === "qris"
                  ? "QRIS"
                  : "Kartu BCA"
            }
          />
          {trx.paymentMethod === "cash" ? (
            <Line label="Kembali" value={formatRupiah(trx.cashChange ?? 0)} />
          ) : null}
          <div className="mt-3 text-center">
            <p className="text-[10px]">Terima kasih, sampai jumpa!</p>
          </div>
        </div>
      </div>

      <footer className="border-t border-neutral-200 bg-neutral-50 p-4 space-y-2">
        <Button
          variant="outline"
          fullWidth
          onClick={() =>
            toast.info("Cetak ulang akan tersedia setelah M16 (printer)")
          }
        >
          <Printer className="size-4" aria-hidden /> Cetak Ulang
        </Button>
        <Button size="lg" fullWidth onClick={onFinish}>
          Selesai (Order Disiapkan)
        </Button>
      </footer>
    </div>
  );
}

// ============================================================================
// Tiny helpers
// ============================================================================

function MethodButton({
  active,
  onClick,
  label,
  Icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  Icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center gap-1 rounded-lg border py-4 text-sm font-medium transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
        active
          ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
          : "border-neutral-300 bg-white hover:bg-neutral-100",
      )}
    >
      <Icon className="size-5" aria-hidden />
      {label}
    </button>
  );
}

function NumKey({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <button
      type="button"
      onClick={onPress}
      className="rounded-md border border-neutral-200 bg-white py-3 font-mono text-lg font-medium hover:bg-neutral-100 active:scale-95"
    >
      {label}
    </button>
  );
}

function Row({
  label,
  value,
  muted,
  bold,
  danger,
}: {
  label: string;
  value: string;
  muted?: boolean;
  bold?: boolean;
  danger?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between text-sm",
        muted ? "text-neutral-500" : "text-neutral-900",
        danger ? "text-danger-500" : "",
        bold ? "text-base font-bold" : "",
      )}
    >
      <span className="truncate">{label}</span>
      <span className={cn("font-mono shrink-0 ml-2", bold ? "text-lg" : "")}>
        {value}
      </span>
    </div>
  );
}

function Line({
  left,
  right,
  label,
  value,
  bold,
}: {
  left?: string;
  right?: string;
  label?: string;
  value?: string;
  bold?: boolean;
}) {
  const l = left ?? label ?? "";
  const r = right ?? value ?? "";
  return (
    <div
      className={`flex items-start justify-between gap-2 ${
        bold ? "font-bold" : ""
      }`}
    >
      <span className="break-words flex-1 min-w-0">{l}</span>
      <span className="shrink-0">{r}</span>
    </div>
  );
}
