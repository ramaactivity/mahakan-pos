"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Banknote,
  CheckCircle2,
  CreditCard,
  FileText,
  Gift,
  MoreHorizontal,
  Percent,
  Plus,
  QrCode,
  Search,
  ShoppingCart,
  Sparkles,
  X,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Skeleton,
  toast,
} from "@/components/ui";
import { ApproverOverrideModal } from "@/features/pos/components/ApproverOverrideModal";
import { CartLineItem } from "@/features/pos/components/CartLineItem";
import { CategoryTabs } from "@/features/pos/components/CategoryTabs";
import { CloseShiftModal } from "@/features/pos/components/CloseShiftModal";
import { ComplimentModal } from "@/features/pos/components/ComplimentModal";
import { PromoPickerModal } from "@/features/pos/components/PromoPickerModal";
import type { Promo } from "@/features/promos";
import { RedeemPointsModal } from "@/features/pos/components/RedeemPointsModal";
import { lookupCustomerByPhone } from "@/features/customers";
import { FavoritesBar } from "@/features/pos/components/FavoritesBar";
import { useFavorites } from "@/features/pos/components/useFavorites";
import { HistoryDetailModal } from "@/features/pos/components/HistoryDetailModal";
import { HistoryPanel } from "@/features/pos/components/HistoryPanel";
import { ItemModifierModal } from "@/features/pos/components/ItemModifierModal";
import { ItemNoteModal } from "@/features/pos/components/ItemNoteModal";
import {
  LAYOUT_GRID_CLASS,
  MenuLayoutSwitcher,
  useMenuLayout,
} from "@/features/pos/components/MenuLayoutSwitcher";
import { MenuListRow } from "@/features/pos/components/MenuListRow";
import {
  applyMenuSort,
  MenuSortSelect,
  useMenuSort,
} from "@/features/pos/components/MenuSortSelect";
import { MenuTile } from "@/features/pos/components/MenuTile";
import { NewOrderModal } from "@/features/pos/components/NewOrderModal";
import { OpenBillPanel } from "@/features/pos/components/OpenBillPanel";
import { OrderMetadataModal } from "@/features/pos/components/OrderMetadataModal";
import { PostActionPrintModal } from "@/features/pos/components/PostActionPrintModal";
import { OpenPriceModal } from "@/features/pos/components/OpenPriceModal";
import { OpenShiftModal } from "@/features/pos/components/OpenShiftModal";
import { OrderQueuePanel } from "@/features/pos/components/OrderQueuePanel";
import { PosLeftNav, type PosTab } from "@/features/pos/components/PosLeftNav";
import { PosSettingsPanel } from "@/features/pos/components/PosSettingsPanel";
import { PrintStationButtons } from "@/features/pos/components/PrintStationButtons";
import { ShiftPanel } from "@/features/pos/components/ShiftPanel";
import { buildLineItem, useCartStore } from "@/features/pos/cartStore";
import { useSession } from "@/features/auth/SessionProvider";
import { isOk } from "@/features/menu";
import {
  listCategories as listCategoriesAction,
  listMenuItems as listMenuItemsAction,
  listModifiers as listModifiersAction,
  type Category,
  type MenuItem,
  type Modifier,
} from "@/features/menu";
import {
  createTransaction,
  editOpenBill,
  listTransactions,
  markServed,
  saveAsOpenBill,
  type PaymentMethod,
  type TransactionWithItems,
} from "@/features/transactions";
import { getOwnOutlet } from "@/features/outlets";
import { getActiveShift, type Shift } from "@/features/shifts";
import { queuePendingTransaction } from "@/lib/offline/queue";
import { usePendingSync } from "@/lib/offline/usePendingSync";
import {
  outletToReceiptConfig,
  printTickets,
  type ReceiptConfig,
} from "@/lib/printer/print-transaction";
import type { Discount } from "@/lib/money";
import { formatRupiah } from "@/lib/format";
import { formatIndonesianDateTime, toJakartaDateOnly } from "@/lib/date";
import { cn } from "@/lib/utils";

type RightPanelState =
  | { kind: "idle" }
  | { kind: "cart"; draftId: string }
  | { kind: "paying"; draftId: string }
  | { kind: "paid"; trx: TransactionWithItems };

const QUICK_AMOUNTS = [50_000, 100_000, 200_000];

export function PosShell() {
  const { session, logout } = useSession();
  // Watch online status + pending offline queue; auto-sync when reconnected.
  usePendingSync();

  // ==================== Top-level state ====================

  const [tab, setTab] = useState<PosTab>("cashier");
  const [rightPanel, setRightPanel] = useState<RightPanelState>({ kind: "idle" });
  const [openBillsCount, setOpenBillsCount] = useState(0);
  const [printConfirm, setPrintConfirm] = useState<{
    trx: TransactionWithItems;
    title: string;
  } | null>(null);
  const [metadataModal, setMetadataModal] = useState<
    "pay" | "save_bill" | null
  >(null);

  // Cart store
  const draftsRecord = useCartStore((s) => s.drafts);
  const drafts = useMemo(
    () =>
      Object.values(draftsRecord).sort((a, b) =>
        a.createdAt < b.createdAt ? -1 : 1,
      ),
    [draftsRecord],
  );

  const activeDraftId =
    rightPanel.kind === "cart" || rightPanel.kind === "paying"
      ? rightPanel.draftId
      : null;
  const activeDraft = activeDraftId ? draftsRecord[activeDraftId] : null;

  const subtotal = useCartStore((s) =>
    activeDraftId ? s.getSubtotal(activeDraftId) : 0,
  );
  const discountAmount = useCartStore((s) =>
    activeDraftId ? s.getDiscountAmount(activeDraftId) : 0,
  );
  const total = useCartStore((s) =>
    activeDraftId ? s.getTotal(activeDraftId) : 0,
  );
  const addItem = useCartStore((s) => s.addItem);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const updateNote = useCartStore((s) => s.updateNote);
  const setDiscount = useCartStore((s) => s.setDiscount);
  const applyRedemption = useCartStore((s) => s.applyRedemption);
  const removeDraft = useCartStore((s) => s.removeDraft);
  const loadOpenBillIntoDraft = useCartStore((s) => s.loadOpenBillIntoDraft);
  const setBillNote = useCartStore((s) => s.setBillNote);
  const startDraft = useCartStore((s) => s.startDraft);
  const setPagerNumber = useCartStore((s) => s.setPagerNumber);

  // Shift
  const [shift, setShift] = useState<Shift | null>(null);
  const [shiftLoading, setShiftLoading] = useState(true);

  // Outlet receipt config — fetched once at mount; threaded to all print
  // call sites so footer/header/wifi edits at admin Settings take effect
  // without a tab reload.
  const [approvalModes, setApprovalModes] = useState<{
    voidMode: "pin" | "code";
    refundMode: "pin" | "code";
  }>({ voidMode: "pin", refundMode: "pin" });
  const [receiptConfig, setReceiptConfig] = useState<ReceiptConfig | null>(
    null,
  );

  // Menu
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [menuLoading, setMenuLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [layoutMode, setLayoutMode] = useMenuLayout();
  const [sortMode, setSortMode] = useMenuSort();
  const {
    favorites: favoriteIds,
    toggle: toggleFavorite,
    isFavorite,
    remove: removeFavorite,
  } = useFavorites();

  // Modals
  const [newOrderOpen, setNewOrderOpen] = useState(false);
  const [variantItem, setVariantItem] = useState<MenuItem | null>(null);
  const [openPriceItem, setOpenPriceItem] = useState<MenuItem | null>(null);
  // S1: cache item tapped from idle so we can dispatch it after draft created.
  const [pendingTapItem, setPendingTapItem] = useState<MenuItem | null>(null);
  // S2: pre-fetched modifiers grouped by category, to short-circuit modal
  // for fixed-price items that have no applicable modifiers.
  const [modifiersByCategory, setModifiersByCategory] = useState<
    Record<string, Modifier[]>
  >({});
  const [noteEditingId, setNoteEditingId] = useState<string | null>(null);
  const [promoPickerOpen, setPromoPickerOpen] = useState(false);
  const [complimentModalOpen, setComplimentModalOpen] = useState(false);
  const [redeemModalOpen, setRedeemModalOpen] = useState(false);
  const [redeemMember, setRedeemMember] = useState<{
    id: string;
    name: string;
    phone: string;
    totalPoints: number;
  } | null>(null);
  const [redeemLoading, setRedeemLoading] = useState(false);
  const [approverOpen, setApproverOpen] = useState(false);
  const [pendingDiscount, setPendingDiscount] = useState<{
    discount: Discount;
    reason: string;
    /** Sesi K — set when discount sourced from a master promo (vs redeem/compliment). */
    promoId: string | null;
  } | null>(null);
  const [openShiftOpen, setOpenShiftOpen] = useState(false);
  const [closeShiftOpen, setCloseShiftOpen] = useState(false);
  const [historyDetailId, setHistoryDetailId] = useState<string | null>(null);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  // Payment state
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [cashInput, setCashInput] = useState("");
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  // ==================== Effects ====================

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    async function loadShift() {
      const res = await getActiveShift();
      if (cancelled) return;
      if (isOk(res)) setShift(res.data);
      setShiftLoading(false);
    }
    void loadShift();
    return () => {
      cancelled = true;
    };
  }, [session]);

  // Open-bills count for left-nav badge — refetched on every mount + when
  // historyRefreshKey bumps (cart save, payment, void/refund). Keeps badge
  // accurate even when user has never opened the Bill Aktif tab.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    async function loadCount() {
      const today = toJakartaDateOnly(new Date());
      const res = await listTransactions({
        from: `${today}T00:00:00.000Z`,
        to: `${today}T23:59:59.999Z`,
        status: "open",
        limit: 100,
      });
      if (cancelled) return;
      if (isOk(res)) setOpenBillsCount(res.data.items.length);
    }
    void loadCount();
    return () => {
      cancelled = true;
    };
  }, [session, historyRefreshKey]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    async function loadOutlet() {
      const res = await getOwnOutlet();
      if (cancelled) return;
      if (res.success === true) {
        setReceiptConfig(outletToReceiptConfig(res.data));
        const approval = res.data.settings?.approval;
        setApprovalModes({
          voidMode: approval?.voidMode === "code" ? "code" : "pin",
          refundMode: approval?.refundMode === "code" ? "code" : "pin",
        });
      }
    }
    void loadOutlet();
    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [menuRes, catRes, modRes] = await Promise.all([
        listMenuItemsAction({ activeOnly: true }),
        listCategoriesAction(),
        listModifiersAction(),
      ]);
      if (cancelled) return;
      if (isOk(menuRes)) setMenuItems(menuRes.data.items);
      if (isOk(catRes)) setCategories(catRes.data.items);
      if (isOk(modRes)) {
        // Build categoryId → applicable modifiers map.
        // appliesToCategories=null/empty = global (applies to ALL); otherwise
        // only included categoryIds. Mahakan currently has no global mods.
        const map: Record<string, Modifier[]> = {};
        const all = modRes.data.items;
        if (isOk(catRes)) {
          for (const c of catRes.data.items) {
            map[c.id] = all.filter(
              (m) =>
                !m.appliesToCategories ||
                m.appliesToCategories.length === 0 ||
                m.appliesToCategories.includes(c.id),
            );
          }
        }
        setModifiersByCategory(map);
      }
      setMenuLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // ==================== Derived ====================

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
    const filtered = menuItems.filter((it) => {
      if (!it.isActive) return false;
      if (activeCategory !== "all" && it.categoryId !== activeCategory)
        return false;
      if (searchLower && !it.name.toLowerCase().includes(searchLower))
        return false;
      return true;
    });
    return applyMenuSort(filtered, sortMode);
  }, [menuItems, activeCategory, searchQuery, sortMode]);

  const menuItemsById = useMemo(() => {
    const m: Record<string, MenuItem> = {};
    for (const it of menuItems) m[it.id] = it;
    return m;
  }, [menuItems]);

  const editingNoteItem = noteEditingId
    ? activeDraft?.items.find((i) => i.cartItemId === noteEditingId)
    : null;

  const cashReceived = parseInt(cashInput || "0", 10) || 0;
  const cashChange = Math.max(0, cashReceived - total);
  const cashSufficient = paymentMethod !== "cash" || cashReceived >= total;

  if (!session) return null;

  // ==================== Handlers ====================

  function openDraft(draftId: string) {
    setRightPanel({ kind: "cart", draftId });
    setTab("cashier");
  }

  /** Dispatch an item tap into the right modal (or direct add via S2). */
  function dispatchItem(draftId: string, item: MenuItem) {
    if (item.priceType === "open") {
      setOpenPriceItem(item);
      return;
    }
    // S2: skip modifier modal for fixed-price items that have no applicable
    // modifiers (Bites/Sweets/Ricebowl/IceCream). Direct add — single tap.
    const mods = modifiersByCategory[item.categoryId] ?? [];
    if (item.priceType === "fixed" && mods.length === 0) {
      const categoryName = categoryNameById[item.categoryId] ?? "";
      addItem(
        draftId,
        buildLineItem({
          menuItemId: item.id,
          name: item.name,
          categoryId: item.categoryId,
          categoryName,
          variant: null,
          unitPrice: item.priceFixed ?? 0,
          quantity: 1,
          modifiers: [],
          note: null,
          openPriceNote: null,
        }),
      );
      toast.success(`${item.name} ditambahkan`);
      return;
    }
    setVariantItem(item);
  }

  function handleItemTap(item: MenuItem) {
    if (item.isSoldOut) return;
    if (!shift) {
      toast.error("Buka shift dulu sebelum mulai order");
      setTab("shifts");
      return;
    }
    if (rightPanel.kind === "idle") {
      // C-2 #4 cashier flow reorder: items first, metadata at Bayar.
      // Auto-create a fresh draft (no pager, dine-in default, no name)
      // and dispatch the tapped item immediately so kasir lands in cart.
      const draftId = startDraft(null, "dine_in", null, null);
      setRightPanel({ kind: "cart", draftId });
      setTab("cashier");
      dispatchItem(draftId, item);
      return;
    }
    if (rightPanel.kind !== "cart") {
      toast.info("Selesaikan pembayaran dulu sebelum tambah item baru");
      return;
    }
    dispatchItem(rightPanel.draftId, item);
  }

  function handleNewOrderCreated(draftId: string) {
    setNewOrderOpen(false);
    setRightPanel({ kind: "cart", draftId });
    setTab("cashier");
    // S1: dispatch any cached tap so user lands in cart with item already
    // queued (for fixed/open) or modifier modal already open (for variant).
    if (pendingTapItem) {
      const item = pendingTapItem;
      setPendingTapItem(null);
      dispatchItem(draftId, item);
    }
  }

  function handlePromoPick(promo: Promo, computedDiscount: number) {
    if (!activeDraftId || !session) return;
    // Build discount object from the computed savings — store as fixed
    // amount snapshot so the existing money math + receipt formatting
    // continues to work unchanged.
    const discount: Discount = { type: "fixed", value: computedDiscount };
    const reason = `Promo: ${promo.name}`;
    if (promo.requiresApproval) {
      setPendingDiscount({ discount, reason, promoId: promo.id });
      setApproverOpen(true);
      return;
    }
    setDiscount(
      activeDraftId,
      discount,
      reason,
      session.user.id,
      undefined,
      promo.id,
    );
    toast.success(`Promo "${promo.name}" diaplikasikan`);
  }

  async function handleOpenRedeem() {
    if (!activeDraft) return;
    if (!activeDraft.customerPhone) {
      toast.error("Input nomor HP member dulu di Order Baru");
      return;
    }
    if (subtotal <= 0) {
      toast.error("Tambah item ke cart dulu");
      return;
    }
    setRedeemLoading(true);
    const res = await lookupCustomerByPhone(activeDraft.customerPhone);
    setRedeemLoading(false);
    if (!res.success) {
      toast.error(res.error.message);
      return;
    }
    if (!res.data) {
      toast.error(
        "Member tidak ditemukan. Pastikan nomor HP terdaftar (auto saat sale pertama).",
      );
      return;
    }
    if (res.data.totalPoints <= 0) {
      toast.info("Saldo poin member 0 — belum ada yang bisa ditukar");
      return;
    }
    setRedeemMember({
      id: res.data.id,
      name: res.data.name,
      phone: res.data.phone,
      totalPoints: res.data.totalPoints,
    });
    setRedeemModalOpen(true);
  }

  function handleApplyRedemption(points: number) {
    if (!activeDraft) return;
    applyRedemption(activeDraft.id, points);
    setRedeemModalOpen(false);
    if (points > 0) {
      toast.success(`-${points} poin diaplikasikan`);
    } else {
      toast.info("Tukar poin dihapus");
    }
  }

  function handleComplimentSubmit(reason: string) {
    if (!activeDraftId || !session) return;
    // Compliment = 100% gratis seluruh transaksi. Stored as fixed-discount
    // with full subtotal. ALWAYS requires PIN approver regardless of role
    // (Owner self-approves with own PIN). Reason already prefixed
    // "Compliment: " by ComplimentModal so the audit logger can branch.
    setComplimentModalOpen(false);
    setPendingDiscount({
      discount: { type: "fixed", value: subtotal },
      reason,
      promoId: null, // compliment is ad-hoc, not a master promo
    });
    setApproverOpen(true);
  }

  function handleApproverVerified(result: { approverId: string; token: string }) {
    if (!pendingDiscount || !activeDraftId) return;
    const isCompliment = pendingDiscount.reason.startsWith("Compliment:");
    setDiscount(
      activeDraftId,
      pendingDiscount.discount,
      pendingDiscount.reason,
      result.approverId,
      result.token,
      pendingDiscount.promoId,
    );
    toast.success(
      isCompliment
        ? "Compliment ditambahkan (PIN-approved)"
        : "Diskon ditambahkan (PIN-approved)",
    );
    setPendingDiscount(null);
    setApproverOpen(false);
  }

  function handleClearDiscount() {
    if (!activeDraftId) return;
    setDiscount(activeDraftId, null, null);
    toast.success("Diskon dihapus");
  }

  function handleCancelOrder() {
    if (!activeDraftId || !activeDraft) return;
    if (activeDraft.items.length === 0) {
      removeDraft(activeDraftId);
      setRightPanel({ kind: "idle" });
      return;
    }
    if (window.confirm("Batalkan order ini? Item-item akan hilang.")) {
      removeDraft(activeDraftId);
      setRightPanel({ kind: "idle" });
    }
  }

  function handleProceedToPayment() {
    if (!activeDraft || activeDraft.items.length === 0) return;
    // C-2 #4: gate behind metadata modal — pager + name optional but
    // surfaced before payment so kasir always has a chance to fill them.
    setMetadataModal("pay");
  }

  function continueToPayment() {
    if (!activeDraft || activeDraft.items.length === 0) return;
    setCashInput("");
    setPaymentMethod("cash");
    setPaymentError(null);
    setRightPanel({ kind: "paying", draftId: activeDraft.id });
  }

  async function handleSaveAsOpenBill() {
    if (!activeDraft || !shift || !session) return;
    if (activeDraft.items.length === 0) return;
    // C-2 #4: for CREATE path, require customerName before commit so
    // kasir can find the bill in Bill Aktif. EDIT path skips the modal
    // since metadata was set when the bill was first created.
    if (
      !activeDraft.editingBillId &&
      (!activeDraft.customerName || activeDraft.customerName.length === 0)
    ) {
      setMetadataModal("save_bill");
      return;
    }
    await commitSaveAsOpenBill();
  }

  async function commitSaveAsOpenBill() {
    if (!activeDraft || !shift || !session) return;
    if (activeDraft.items.length === 0) return;
    setPaymentSubmitting(true);
    setPaymentError(null);

    const itemsPayload = activeDraft.items.map((item) => ({
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
    }));

    if (activeDraft.editingBillId) {
      // EDIT path — replace items on existing open bill.
      const res = await editOpenBill({
        transactionId: activeDraft.editingBillId,
        customerName: activeDraft.customerName,
        customerPhone: activeDraft.customerPhone,
        note: activeDraft.billNote,
        items: itemsPayload,
        subtotal,
        discountType: activeDraft.discount?.type ?? null,
        discountValue: activeDraft.discount?.value ?? null,
        discountAmount,
        discountReason: activeDraft.discountReason,
        total,
        discountApproverToken:
          activeDraft.discountApproverToken ?? undefined,
        promoId: activeDraft.promoId,
      });
      setPaymentSubmitting(false);
      if (!res.success) {
        setPaymentError(res.error.message);
        toast.error(res.error.message);
        return;
      }
      toast.success(`Open bill ${res.data.transactionNumber} di-update.`);
      removeDraft(activeDraft.id);
      setRightPanel({ kind: "idle" });
      setHistoryRefreshKey((k) => k + 1);
      setPrintConfirm({ trx: res.data, title: "Bill di-update" });
      return;
    }

    // CREATE path — fresh open bill.
    const payload = {
      clientRefId: crypto.randomUUID(),
      shiftId: shift.id,
      cashierId: session.user.id,
      pagerNumber: activeDraft.pagerNumber,
      orderType: activeDraft.orderType,
      customerName: activeDraft.customerName,
      customerPhone: activeDraft.customerPhone,
      note: activeDraft.billNote,
      items: itemsPayload,
      subtotal,
      discountType: activeDraft.discount?.type ?? null,
      discountValue: activeDraft.discount?.value ?? null,
      discountAmount,
      discountReason: activeDraft.discountReason,
      total,
      discountApproverToken: activeDraft.discountApproverToken ?? undefined,
      promoId: activeDraft.promoId,
    };
    const res = await saveAsOpenBill(payload);
    setPaymentSubmitting(false);
    if (!res.success) {
      setPaymentError(res.error.message);
      toast.error(res.error.message);
      return;
    }
    toast.success(
      `Open bill ${res.data.transactionNumber} disimpan. Customer bayar nanti via tab Bill Aktif.`,
    );
    removeDraft(activeDraft.id);
    setRightPanel({ kind: "idle" });
    setHistoryRefreshKey((k) => k + 1);
    setPrintConfirm({ trx: res.data, title: "Bill disimpan" });
  }

  async function handleProcessPayment() {
    if (paymentSubmitting || !activeDraft || !shift) return;
    if (!cashSufficient) {
      setPaymentError("Uang yang diterima kurang dari total");
      return;
    }
    setPaymentSubmitting(true);
    setPaymentError(null);

    const payload = {
      clientRefId: crypto.randomUUID(),
      shiftId: shift.id,
      cashierId: session!.user.id,
      pagerNumber: activeDraft.pagerNumber,
      orderType: activeDraft.orderType,
      customerName: activeDraft.customerName,
      customerPhone: activeDraft.customerPhone,
      note: activeDraft.billNote,
      items: activeDraft.items.map((item) => ({
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
      discountType: activeDraft.discount?.type ?? null,
      discountValue: activeDraft.discount?.value ?? null,
      discountAmount,
      discountReason: activeDraft.discountReason,
      total,
      paymentMethod,
      cashReceived: paymentMethod === "cash" ? cashReceived : null,
      cashChange: paymentMethod === "cash" ? cashChange : null,
      discountApproverToken: activeDraft.discountApproverToken ?? undefined,
      loyaltyPointsRedeemed: activeDraft.loyaltyPointsRedeemed,
      promoId: activeDraft.promoId,
    };

    // Offline path: queue locally, drop the draft, show offline-paid screen.
    // Server will process it via clientRefId idempotency once back online.
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      try {
        await queuePendingTransaction(payload);
        removeDraft(activeDraft.id);
        toast.info("Offline — transaksi tersimpan lokal, ter-sync nanti");
        setRightPanel({ kind: "idle" });
        setPaymentSubmitting(false);
        return;
      } catch (e) {
        const message = e instanceof Error ? e.message : "Gagal queue offline";
        setPaymentError(message);
        setPaymentSubmitting(false);
        return;
      }
    }

    try {
      const res = await createTransaction(payload);
      if (!isOk(res)) {
        setPaymentError(res.error.message);
        setPaymentSubmitting(false);
        return;
      }
      removeDraft(activeDraft.id);
      setRightPanel({ kind: "paid", trx: res.data });
      setPaymentSubmitting(false);
      toast.success(`Transaksi ${res.data.transactionNumber} berhasil`);

      // Best-effort: print ONLY customer receipt automatically. Kitchen + bar
      // tickets are printed manually via the Pesanan queue tab — kasir tears
      // the customer struk for hand-off, then triggers prep tickets when ready
      // to call the order out to staff. Pass receiptConfig so outlet-level
      // edits (header/footer/wifi) appear on the printed struk. Skip silently
      // if outlet config not yet loaded — kasir can reprint via Riwayat later.
      if (receiptConfig) {
        void printTickets(
          res.data,
          session!.user.name,
          ["customer"],
          receiptConfig,
        );
      }
    } catch (e) {
      // Network error mid-flight: queue and surface as offline-paid.
      try {
        await queuePendingTransaction(payload);
        removeDraft(activeDraft.id);
        toast.info("Koneksi terputus — transaksi tersimpan, ter-sync nanti");
        setRightPanel({ kind: "idle" });
      } catch {
        setPaymentError(
          e instanceof Error ? e.message : "Gagal proses transaksi",
        );
      }
      setPaymentSubmitting(false);
    }
  }

  function handleFinishOrder() {
    if (rightPanel.kind === "paid") {
      void markServed(rightPanel.trx.id);
    }
    setRightPanel({ kind: "idle" });
    setHistoryRefreshKey((k) => k + 1);
  }

  async function handleLogout() {
    await logout("/pin");
  }

  // ==================== Render ====================

  return (
    <div className="flex h-[calc(100vh-4rem)] w-full max-w-full overflow-hidden bg-neutral-50">
      <PosLeftNav
        activeTab={tab}
        onTabChange={setTab}
        onLogout={handleLogout}
        cashierBadge={drafts.length}
        openBillsBadge={openBillsCount}
      />

      {/* MIDDLE COLUMN — content per tab. min-w-0 prevents flex child from
       * overflowing parent (causes horizontal swaying di tablet). */}
      <main className="flex-1 min-w-0 overflow-hidden">
        {tab === "cashier" ? (
          <CashierMiddle
            menuLoading={menuLoading}
            filteredItems={filteredItems}
            categories={categories}
            itemCounts={itemCounts}
            activeCategory={activeCategory}
            setActiveCategory={setActiveCategory}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            onItemTap={handleItemTap}
            session={session.user}
            layoutMode={layoutMode}
            setLayoutMode={setLayoutMode}
            sortMode={sortMode}
            setSortMode={setSortMode}
            favoriteIds={favoriteIds}
            menuItemsById={menuItemsById}
            isFavorite={isFavorite}
            onToggleFavorite={toggleFavorite}
            onUnpinFavorite={removeFavorite}
          />
        ) : tab === "open_bills" ? (
          <OpenBillPanel
            cashierName={session.user.name}
            receiptConfig={receiptConfig}
            refreshKey={historyRefreshKey}
            onOpenSettings={() => setTab("settings")}
            onEditBill={(trx) => {
              const id = loadOpenBillIntoDraft(trx);
              setTab("cashier");
              setRightPanel({ kind: "cart", draftId: id });
            }}
            onCountChange={setOpenBillsCount}
            onBillPaid={(trx) =>
              setPrintConfirm({ trx, title: "Pembayaran sukses" })
            }
          />
        ) : tab === "queue" ? (
          <OrderQueuePanel
            cashierName={session.user.name}
            receiptConfig={receiptConfig}
            refreshKey={historyRefreshKey}
            onOpenSettings={() => setTab("settings")}
          />
        ) : tab === "history" ? (
          <HistoryPanel
            refreshKey={historyRefreshKey}
            onSelectTransaction={(id) => setHistoryDetailId(id)}
          />
        ) : tab === "shifts" ? (
          <ShiftPanel
            shift={shift}
            loading={shiftLoading}
            onRequestOpenShift={() => setOpenShiftOpen(true)}
            onRequestCloseShift={() => setCloseShiftOpen(true)}
          />
        ) : (
          <PosSettingsPanel
            shift={shift}
            menuItems={menuItems}
            categories={categories}
            onMenuItemUpdated={(next) =>
              setMenuItems((items) =>
                items.map((it) => (it.id === next.id ? next : it)),
              )
            }
          />
        )}
      </main>

      {/* RIGHT COLUMN — order panel. Width adaptif: tablet kecil (~10")
       * pakai 320px supaya middle column dapat ruang lebih untuk grid menu;
       * desktop tetap 400px. */}
      <aside className="flex w-[320px] shrink-0 flex-col overflow-hidden border-l border-neutral-200 bg-white sm:w-[360px] lg:w-[400px]">
        {rightPanel.kind === "idle" ? (
          <IdlePanel
            drafts={drafts}
            shiftActive={shift !== null}
            onNewOrder={() => setNewOrderOpen(true)}
            onSelectDraft={openDraft}
            userName={session.user.name}
            userRole={session.user.role}
          />
        ) : rightPanel.kind === "cart" && activeDraft ? (
          <CartPanel
            draft={activeDraft}
            subtotal={subtotal}
            discountAmount={discountAmount}
            total={total}
            onUpdateQty={(id, qty) =>
              updateQuantity(activeDraft.id, id, qty)
            }
            onRemoveItem={(id) => removeItem(activeDraft.id, id)}
            onEditNote={(id) => setNoteEditingId(id)}
            onOpenDiscount={() => setPromoPickerOpen(true)}
            onOpenCompliment={() => setComplimentModalOpen(true)}
            onOpenRedeem={handleOpenRedeem}
            redeemLoading={redeemLoading}
            onSaveAsOpenBill={handleSaveAsOpenBill}
            onProceedToPayment={handleProceedToPayment}
            onCancel={handleCancelOrder}
            onSwitchDraft={() => setRightPanel({ kind: "idle" })}
            onSetBillNote={(note) => setBillNote(activeDraft.id, note)}
          />
        ) : rightPanel.kind === "paying" && activeDraft ? (
          <PayingPanel
            draft={activeDraft}
            total={total}
            paymentMethod={paymentMethod}
            setPaymentMethod={setPaymentMethod}
            setCashInput={setCashInput}
            cashReceived={cashReceived}
            cashChange={cashChange}
            cashSufficient={cashSufficient}
            submitting={paymentSubmitting}
            error={paymentError}
            onCancel={() =>
              setRightPanel({ kind: "cart", draftId: activeDraft.id })
            }
            onSubmit={handleProcessPayment}
          />
        ) : rightPanel.kind === "paid" ? (
          <PaidPanel
            trx={rightPanel.trx}
            cashierName={session!.user.name ?? "Kasir"}
            receiptConfig={receiptConfig}
            onFinish={handleFinishOrder}
            onOpenSettings={() => setTab("settings")}
          />
        ) : null}
      </aside>

      {/* MODALS */}
      <NewOrderModal
        open={newOrderOpen}
        onClose={() => {
          setNewOrderOpen(false);
          // S1: drop cached tap if user cancels — avoid stale dispatch next round.
          setPendingTapItem(null);
        }}
        onCreated={handleNewOrderCreated}
      />
      <ItemModifierModal
        item={variantItem}
        categoryName={
          variantItem ? categoryNameById[variantItem.categoryId] ?? "" : ""
        }
        onClose={() => setVariantItem(null)}
        onAdd={(line) => {
          if (!activeDraftId) return;
          addItem(activeDraftId, line);
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
          if (!activeDraftId) return;
          addItem(activeDraftId, line);
          toast.success(`${line.name} ditambahkan`);
        }}
      />
      <ItemNoteModal
        open={editingNoteItem !== null && editingNoteItem !== undefined}
        initialValue={editingNoteItem?.note ?? null}
        onClose={() => setNoteEditingId(null)}
        onSave={(note) => {
          if (noteEditingId && activeDraftId)
            updateNote(activeDraftId, noteEditingId, note);
        }}
      />
      <PromoPickerModal
        open={promoPickerOpen}
        subtotal={subtotal}
        cartLines={activeDraft?.items ?? []}
        orderType={activeDraft?.orderType ?? "dine_in"}
        paymentMethod={paymentMethod}
        appliedPromoId={activeDraft?.promoId ?? null}
        onClose={() => setPromoPickerOpen(false)}
        onPick={handlePromoPick}
        onClear={handleClearDiscount}
      />
      <RedeemPointsModal
        open={redeemModalOpen && redeemMember !== null}
        memberName={redeemMember?.name ?? null}
        balance={redeemMember?.totalPoints ?? 0}
        eligibleSubtotal={subtotal}
        onClose={() => setRedeemModalOpen(false)}
        onSubmit={handleApplyRedemption}
      />

      <ComplimentModal
        open={complimentModalOpen}
        subtotal={subtotal}
        onClose={() => setComplimentModalOpen(false)}
        onSubmit={handleComplimentSubmit}
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
      <OpenShiftModal
        open={openShiftOpen}
        userId={session.user.id}
        menuItems={menuItems}
        categories={categories}
        role={session.user.role}
        onItemUpdated={(next) =>
          setMenuItems((items) =>
            items.map((it) => (it.id === next.id ? next : it)),
          )
        }
        onClose={() => setOpenShiftOpen(false)}
        onOpened={async () => {
          setOpenShiftOpen(false);
          const res = await getActiveShift();
          if (isOk(res)) setShift(res.data);
        }}
      />
      {shift ? (
        <CloseShiftModal
          open={closeShiftOpen}
          shift={shift}
          userId={session.user.id}
          onClose={() => setCloseShiftOpen(false)}
          onClosed={async () => {
            setCloseShiftOpen(false);
            const res = await getActiveShift();
            if (isOk(res)) setShift(res.data);
          }}
        />
      ) : null}
      <HistoryDetailModal
        open={historyDetailId !== null}
        trxId={historyDetailId}
        viewerRole={session.user.role}
        viewerUserId={session.user.id}
        receiptConfig={receiptConfig}
        approvalModes={approvalModes}
        onClose={() => setHistoryDetailId(null)}
        onChanged={() => setHistoryRefreshKey((k) => k + 1)}
        onOpenSettings={() => setTab("settings")}
      />

      <PostActionPrintModal
        open={printConfirm !== null}
        trx={printConfirm?.trx ?? null}
        cashierName={session.user.name ?? "Kasir"}
        receiptConfig={receiptConfig}
        title={printConfirm?.title ?? "Cetak struk?"}
        onClose={() => setPrintConfirm(null)}
        onOpenSettings={() => setTab("settings")}
      />

      {activeDraft && metadataModal !== null ? (
        <OrderMetadataModal
          open
          mode={metadataModal}
          initialPager={activeDraft.pagerNumber}
          initialCustomerName={activeDraft.customerName}
          initialCustomerPhone={activeDraft.customerPhone}
          onClose={() => setMetadataModal(null)}
          onSubmit={(values) => {
            const mode = metadataModal;
            setMetadataModal(null);
            // Persist the metadata into the draft, then continue the
            // gated flow (payment screen or commit-open-bill).
            const draftId = activeDraft.id;
            setPagerNumber(draftId, values.pagerNumber);
            useCartStore.setState((s) => {
              const d = s.drafts[draftId];
              if (!d) return s;
              return {
                drafts: {
                  ...s.drafts,
                  [draftId]: {
                    ...d,
                    customerName: values.customerName,
                    customerPhone: values.customerPhone,
                  },
                },
              };
            });
            if (mode === "pay") {
              continueToPayment();
            } else {
              void commitSaveAsOpenBill();
            }
          }}
        />
      ) : null}
    </div>
  );
}

// ============================================================================
// Sub-panels
// ============================================================================

interface CashierMiddleProps {
  menuLoading: boolean;
  filteredItems: MenuItem[];
  categories: Category[];
  itemCounts: Record<string, number>;
  activeCategory: string | "all";
  setActiveCategory: (id: string | "all") => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  onItemTap: (item: MenuItem) => void;
  session: { name: string; role: string };
  layoutMode: ReturnType<typeof useMenuLayout>[0];
  setLayoutMode: ReturnType<typeof useMenuLayout>[1];
  sortMode: ReturnType<typeof useMenuSort>[0];
  setSortMode: ReturnType<typeof useMenuSort>[1];
  favoriteIds: string[];
  menuItemsById: Record<string, MenuItem>;
  isFavorite: (id: string) => boolean;
  onToggleFavorite: (id: string) => void;
  onUnpinFavorite: (id: string) => void;
}

function CashierMiddle({
  menuLoading,
  filteredItems,
  categories,
  itemCounts,
  activeCategory,
  setActiveCategory,
  searchQuery,
  setSearchQuery,
  onItemTap,
  layoutMode,
  setLayoutMode,
  sortMode,
  setSortMode,
  favoriteIds,
  menuItemsById,
  isFavorite,
  onToggleFavorite,
  onUnpinFavorite,
}: CashierMiddleProps) {
  const gridClass = LAYOUT_GRID_CLASS[layoutMode];
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <FavoritesBar
        favoriteIds={favoriteIds}
        itemsById={menuItemsById}
        onSelect={onItemTap}
        onUnpin={onUnpinFavorite}
      />
      <header className="flex flex-col gap-3 border-b border-neutral-200 bg-white p-4">
        <div className="flex items-center gap-3">
          <div className="flex-1">
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
          </div>
          <MenuSortSelect
            mode={sortMode}
            onChange={setSortMode}
            className="w-44 shrink-0"
          />
          <MenuLayoutSwitcher mode={layoutMode} onChange={setLayoutMode} />
        </div>
        <CategoryTabs
          categories={categories}
          activeId={activeCategory}
          onChange={setActiveCategory}
          itemCounts={itemCounts}
        />
      </header>
      <div className="flex-1 overflow-y-auto p-4">
        {menuLoading ? (
          <div
            className={gridClass}
            role="status"
            aria-label="Memuat menu"
          >
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton
                key={i}
                className={layoutMode === "list" ? "h-16 w-full" : "h-28 w-full"}
              />
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          <p className="py-8 text-center text-neutral-500">
            Tidak ada item yang cocok.
          </p>
        ) : (
          <div className={gridClass}>
            {filteredItems.map((item) =>
              layoutMode === "list" ? (
                <MenuListRow
                  key={item.id}
                  item={item}
                  onSelect={onItemTap}
                  isFavorite={isFavorite(item.id)}
                  onToggleFavorite={onToggleFavorite}
                />
              ) : (
                <MenuTile
                  key={item.id}
                  item={item}
                  onSelect={onItemTap}
                  isFavorite={isFavorite(item.id)}
                  onToggleFavorite={onToggleFavorite}
                />
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface IdlePanelProps {
  drafts: ReturnType<typeof useCartStore.getState>["drafts"][string][];
  shiftActive: boolean;
  onNewOrder: () => void;
  onSelectDraft: (draftId: string) => void;
  userName: string;
  userRole: string;
}

function IdlePanel({
  drafts,
  shiftActive,
  onNewOrder,
  onSelectDraft,
  userName,
  userRole,
}: IdlePanelProps) {
  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-neutral-200 p-4">
        <h2 className="text-base font-semibold text-neutral-900">
          Selamat bekerja, {userName}
        </h2>
        <p className="text-xs text-neutral-500 capitalize">{userRole}</p>
      </header>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <Button
          size="xl"
          fullWidth
          onClick={onNewOrder}
          disabled={!shiftActive}
        >
          <Plus className="size-5" aria-hidden /> Order Baru
        </Button>
        {!shiftActive ? (
          <p className="text-center text-xs text-neutral-500">
            Buka shift di tab &ldquo;Shift&rdquo; sebelum mulai transaksi.
          </p>
        ) : null}
        {drafts.length > 0 ? (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Draft Order ({drafts.length})
            </h3>
            {drafts.map((draft) => (
              <button
                key={draft.id}
                type="button"
                onClick={() => onSelectDraft(draft.id)}
                className="flex w-full items-center justify-between rounded-lg border border-neutral-200 bg-white p-3 text-left transition-all hover:border-mahakan-green-700 hover:shadow-sm"
              >
                <div>
                  <p className="font-mono text-sm font-bold text-neutral-900">
                    {draft.pagerNumber !== null
                      ? `Pager ${draft.pagerNumber}`
                      : draft.customerName ?? "Order baru"}
                  </p>
                  <p className="text-xs text-neutral-500">
                    {draft.orderType === "dine_in" ? "Dine-in" : "Takeaway"} ·{" "}
                    {draft.items.length} item
                  </p>
                </div>
                <span className="font-mono text-sm font-medium text-mahakan-green-700">
                  {formatRupiah(
                    draft.items.reduce((s, i) => s + i.subtotal, 0),
                  )}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface CartPanelPropsExtra {
  onOpenCompliment: () => void;
  onSaveAsOpenBill: () => void;
  onOpenRedeem: () => void;
  redeemLoading: boolean;
}

interface CartPanelProps extends CartPanelPropsExtra {
  draft: NonNullable<
    ReturnType<typeof useCartStore.getState>["drafts"][string]
  >;
  subtotal: number;
  discountAmount: number;
  total: number;
  onUpdateQty: (cartItemId: string, qty: number) => void;
  onRemoveItem: (cartItemId: string) => void;
  onEditNote: (cartItemId: string) => void;
  onOpenDiscount: () => void;
  // onOpenCompliment defined in CartPanelPropsExtra
  onProceedToPayment: () => void;
  onCancel: () => void;
  onSwitchDraft: () => void;
  onSetBillNote: (note: string | null) => void;
}

function CartPanel(props: CartPanelProps) {
  return <CartPanelImpl {...props} />;
}

function CartPanelImpl({
  draft,
  subtotal,
  discountAmount,
  total,
  onUpdateQty,
  onRemoveItem,
  onEditNote,
  onOpenDiscount,
  onOpenCompliment,
  onOpenRedeem,
  redeemLoading,
  onSaveAsOpenBill,
  onProceedToPayment,
  onCancel,
  onSwitchDraft,
  onSetBillNote,
}: CartPanelProps) {
  const [billNoteOpen, setBillNoteOpen] = useState(
    Boolean(draft.billNote && draft.billNote.length > 0),
  );
  // Secondary actions (Diskon, Compliment, Tukar Poin, Simpan Open Bill,
  // Catatan Bill) collapsed into a single "Lainnya" group untuk hemat
  // vertical space di tablet kecil — Galih field-test laporan footer
  // menelan list keranjang.
  const [moreOpen, setMoreOpen] = useState(false);
  return (
    <>
      <header className="flex items-center justify-between border-b border-neutral-200 p-4">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={onSwitchDraft}
            aria-label="Daftar draft"
            className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
          >
            <ArrowLeft className="size-4" aria-hidden />
          </button>
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-semibold text-neutral-900">
              <ShoppingCart className="size-5 shrink-0" aria-hidden />
              <span className="truncate">Order Aktif</span>
            </h2>
            {draft.customerName || draft.customerPhone ? (
              <p className="ml-7 truncate text-xs font-medium text-neutral-700">
                {draft.customerName ?? draft.customerPhone}
                {draft.customerPhone ? (
                  <span className="ml-1 text-neutral-500">
                    · {draft.customerPhone}
                  </span>
                ) : null}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {draft.pagerNumber !== null ? (
            <Badge variant="signature">
              P<span className="font-mono">{draft.pagerNumber}</span>
            </Badge>
          ) : null}
          <Badge variant="neutral">
            {draft.orderType === "dine_in" ? "DI" : "TA"}
          </Badge>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
            aria-label="Batalkan order"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {draft.items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
            <ShoppingCart
              className="size-10 text-neutral-300"
              aria-hidden
            />
            <p className="text-sm font-medium text-neutral-700">
              Belum ada item
            </p>
            <p className="text-xs text-neutral-500">
              Tap item di kolom tengah untuk menambah.
            </p>
          </div>
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

      <footer className="space-y-2 border-t border-neutral-200 bg-neutral-50 p-3">
        {/* TOTAL row — paling penting, selalu visible */}
        <div className="space-y-1">
          <Row label="Subtotal" value={formatRupiah(subtotal)} muted compact />
          {draft.discount ? (
            <Row
              label={
                draft.loyaltyPointsRedeemed && draft.loyaltyPointsRedeemed > 0
                  ? `Tukar Poin (-${draft.loyaltyPointsRedeemed})`
                  : `Diskon ${
                      draft.discount.type === "percent"
                        ? `(${draft.discount.value}%)`
                        : ""
                    }`
              }
              value={`- ${formatRupiah(discountAmount)}`}
              danger
              compact
            />
          ) : null}
          {draft.billNote ? (
            <p className="px-1 text-[11px] italic text-neutral-600 line-clamp-1">
              📝 {draft.billNote}
            </p>
          ) : null}
          <div className="flex items-center justify-between rounded-md bg-white px-3 py-2">
            <span className="text-sm font-bold text-neutral-900">TOTAL</span>
            <span className="font-mono text-lg font-bold text-mahakan-green-900">
              {formatRupiah(total)}
            </span>
          </div>
        </div>

        {/* Aksi lainnya — collapsed by default untuk hemat space */}
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          className="flex w-full items-center justify-between rounded-md border border-neutral-200 bg-white px-3 py-2 text-xs font-medium text-neutral-700 hover:border-neutral-300"
        >
          <span className="flex items-center gap-1.5">
            <MoreHorizontal className="size-4" aria-hidden />
            Aksi Lain
            {(draft.billNote ||
              draft.discount ||
              (draft.loyaltyPointsRedeemed ?? 0) > 0) ? (
              <span className="ml-1 size-1.5 rounded-full bg-mahakan-green-700" />
            ) : null}
          </span>
          <span className="text-neutral-400">
            {moreOpen ? "Tutup" : "Buka"}
          </span>
        </button>
        {moreOpen ? (
          <div className="space-y-2 rounded-md border border-neutral-200 bg-white p-2">
            {/* Catatan bill */}
            <div>
              <button
                type="button"
                onClick={() => setBillNoteOpen((v) => !v)}
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-neutral-600 hover:bg-neutral-50"
              >
                <span className="flex items-center gap-2">
                  <FileText className="size-3.5" aria-hidden />
                  {draft.billNote && draft.billNote.length > 0
                    ? "Edit Catatan Bill"
                    : "Tambah Catatan Bill"}
                </span>
                <span className="text-neutral-400">
                  {billNoteOpen ? "▲" : "▼"}
                </span>
              </button>
              {billNoteOpen ? (
                <textarea
                  value={draft.billNote ?? ""}
                  onChange={(e) => onSetBillNote(e.target.value)}
                  maxLength={200}
                  rows={2}
                  placeholder="Misal: pesanan tanpa gula, antar ke meja 5..."
                  className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-xs text-neutral-900 placeholder:text-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
                />
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={onOpenDiscount}
                disabled={draft.items.length === 0}
              >
                <Percent className="size-3.5" aria-hidden /> Diskon
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onOpenCompliment}
                disabled={draft.items.length === 0}
                className="!border-warning-500/40 !text-warning-500 hover:!bg-warning-100/50"
              >
                <Gift className="size-3.5" aria-hidden /> Compliment
              </Button>
            </div>
            {draft.customerPhone ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onOpenRedeem}
                disabled={draft.items.length === 0 || redeemLoading}
                fullWidth
                className="!border-amber-300/60 !text-amber-700 hover:!bg-amber-100/40"
              >
                <Sparkles className="size-3.5" aria-hidden />
                {redeemLoading
                  ? "Memuat saldo..."
                  : draft.loyaltyPointsRedeemed && draft.loyaltyPointsRedeemed > 0
                    ? `Poin: ${draft.loyaltyPointsRedeemed} pt`
                    : "Tukar Poin Member"}
              </Button>
            ) : null}
            {!draft.editingBillId ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onSaveAsOpenBill}
                disabled={draft.items.length === 0}
                fullWidth
              >
                <FileText className="size-3.5" aria-hidden /> Simpan sebagai Open Bill
              </Button>
            ) : null}
          </div>
        ) : null}

        {/* Primary action — always visible, big touch target */}
        {draft.editingBillId ? (
          <Button
            size="lg"
            onClick={onSaveAsOpenBill}
            disabled={draft.items.length === 0}
            fullWidth
          >
            <FileText className="size-4" aria-hidden /> Update Bill
          </Button>
        ) : (
          <Button
            size="lg"
            onClick={onProceedToPayment}
            disabled={draft.items.length === 0}
            fullWidth
          >
            Bayar · {formatRupiah(total)}
          </Button>
        )}
      </footer>
    </>
  );
}

interface PayingPanelProps {
  draft: NonNullable<
    ReturnType<typeof useCartStore.getState>["drafts"][string]
  >;
  total: number;
  paymentMethod: PaymentMethod;
  setPaymentMethod: (m: PaymentMethod) => void;
  setCashInput: React.Dispatch<React.SetStateAction<string>>;
  cashReceived: number;
  cashChange: number;
  cashSufficient: boolean;
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: () => void;
}

function PayingPanel({
  draft,
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
}: PayingPanelProps) {
  return (
    <>
      <header className="flex items-center justify-between border-b border-neutral-200 p-4">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1 text-sm font-medium text-neutral-700 hover:text-neutral-900"
          disabled={submitting}
        >
          <ArrowLeft className="size-4" aria-hidden /> Cart
        </button>
        {draft.pagerNumber !== null ? (
          <Badge variant="signature">
            Pager <span className="font-mono">{draft.pagerNumber}</span>
          </Badge>
        ) : null}
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <div className="rounded-md bg-mahakan-green-50 p-3 text-center">
          <p className="text-xs text-mahakan-green-900">Total Tagihan</p>
          <p className="font-mono text-2xl font-bold text-mahakan-green-900">
            {formatRupiah(total)}
          </p>
        </div>

        <div
          className="grid grid-cols-3 gap-2"
          role="radiogroup"
          aria-label="Metode pembayaran"
        >
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
            label="Kartu"
            Icon={CreditCard}
          />
        </div>

        {paymentMethod === "cash" ? (
          <>
            <div className="flex h-12 items-center justify-end rounded-md border border-neutral-300 bg-white px-3 font-mono text-xl font-bold">
              {cashReceived > 0 ? formatRupiah(cashReceived) : "—"}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {QUICK_AMOUNTS.map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setCashInput(String(amt))}
                  className="rounded-md border border-neutral-300 bg-white py-1.5 text-xs font-medium hover:bg-neutral-100"
                >
                  {formatRupiah(amt).replace("Rp ", "")}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setCashInput(String(total))}
                className="rounded-md border border-mahakan-green-700 bg-mahakan-green-50 py-1.5 text-xs font-medium text-mahakan-green-900 hover:bg-mahakan-green-100"
              >
                Pas
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                <NumKey
                  key={d}
                  label={d}
                  onPress={() => setCashInput((s) => s + d)}
                />
              ))}
              <NumKey label="C" onPress={() => setCashInput("")} />
              <NumKey label="0" onPress={() => setCashInput((s) => s + "0")} />
              <NumKey
                label="⌫"
                onPress={() => setCashInput((s) => s.slice(0, -1))}
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
              <CardTitle className="text-sm">
                Konfirmasi {paymentMethod === "qris" ? "QRIS" : "Kartu BCA"}
              </CardTitle>
              <CardDescription className="text-xs">
                Customer scan QRIS / tap kartu di EDC. Tap tombol di bawah
                setelah lunas.
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

      <footer className="border-t border-neutral-200 p-4 space-y-2 bg-white">
        {submitting ? (
          <p
            className="text-center text-xs text-neutral-600"
            aria-live="polite"
          >
            Memvalidasi stok &amp; mencatat transaksi…
          </p>
        ) : null}
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
      </footer>
    </>
  );
}

interface PaidPanelProps {
  trx: TransactionWithItems;
  cashierName: string;
  receiptConfig: ReceiptConfig | null;
  onFinish: () => void;
  onOpenSettings: () => void;
}

function PaidPanel({
  trx,
  cashierName,
  receiptConfig,
  onFinish,
  onOpenSettings,
}: PaidPanelProps) {
  return (
    <>
      <header className="flex flex-col items-center gap-2 border-b border-neutral-200 p-4">
        <div className="flex size-10 items-center justify-center rounded-full bg-success-100">
          <CheckCircle2 className="size-6 text-success-500" aria-hidden />
        </div>
        <p className="text-sm font-semibold text-neutral-900">
          Transaksi Berhasil
        </p>
        <p className="font-mono text-xs text-neutral-500">
          {trx.transactionNumber}
        </p>
      </header>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="rounded-md bg-neutral-50 p-3 font-mono text-[10px] leading-relaxed text-neutral-900">
          <div className="text-center">
            <p className="font-bold">Mahakan Coffee &amp; Space</p>
            <p>Puncak Rd KM 22, Cisarua</p>
            <p>0838-1977-5665</p>
          </div>
          <div className="my-2 border-t border-dashed border-neutral-300" />
          <Line
            left={trx.transactionNumber}
            right={trx.orderType === "dine_in" ? "Dine-in" : "Takeaway"}
          />
          {trx.pagerNumber !== null ? (
            <Line left="Pager" right={String(trx.pagerNumber)} />
          ) : null}
          {trx.customerName ? (
            <Line left="Nama" right={trx.customerName} />
          ) : null}
          <Line left="Waktu" right={formatIndonesianDateTime(trx.createdAt)} />
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
                  <p className="pl-3 text-[9px] text-neutral-600">
                    {item.modifiers
                      .map((m) => m.selectedValue ?? m.modifierSlug)
                      .join(", ")}
                  </p>
                ) : null}
                {item.openPriceNote ? (
                  <p className="pl-3 text-[9px] italic text-neutral-700">
                    {item.openPriceNote}
                  </p>
                ) : null}
                {item.note ? (
                  <p className="pl-3 text-[9px] italic text-neutral-600">
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
            <p className="text-[9px]">Terima kasih, sampai jumpa!</p>
          </div>
        </div>
      </div>

      <footer className="space-y-3 border-t border-neutral-200 p-4">
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Cetak Tiket
          </p>
          <PrintStationButtons
            trx={trx}
            cashierName={cashierName}
            receiptConfig={receiptConfig}
            onOpenSettings={onOpenSettings}
            size="sm"
          />
          <p className="text-[11px] text-neutral-500">
            Struk customer otomatis tercetak. Cetak Dapur / Bar saat siap call
            order.
          </p>
        </div>
        <Button size="lg" fullWidth onClick={onFinish}>
          Selesai (Order Disiapkan)
        </Button>
      </footer>
    </>
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
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center gap-1 rounded-lg border py-3 text-xs font-medium transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
        active
          ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
          : "border-neutral-300 bg-white hover:bg-neutral-100",
      )}
    >
      <Icon className="size-4" aria-hidden />
      {label}
    </button>
  );
}

function NumKey({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <button
      type="button"
      onClick={onPress}
      className="rounded-md border border-neutral-200 bg-white py-2 font-mono text-base font-medium hover:bg-neutral-100 active:scale-95"
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
  compact,
}: {
  label: string;
  value: string;
  muted?: boolean;
  bold?: boolean;
  danger?: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between",
        compact ? "text-xs" : "text-sm",
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

