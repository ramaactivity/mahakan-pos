"use client";

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  Banknote,
  ChevronDown,
  FileText,
  Gift,
  MoreHorizontal,
  Percent,
  Plus,
  Search,
  ShoppingCart,
  Sparkles,
  X,
} from "lucide-react";
import {
  Badge,
  Button,
  Input,
  Skeleton,
  Spinner,
  toast,
} from "@/components/ui";
/* Sesi AE-63 phase2 P2.2 — Cashier-tab essentials eager (most-used).
 * Modal + panel non-cashier di-lazy supaya initial parse bundle POS ringan.
 * Tablet Galaxy A7 Lite CPU slow saat parse 22 modal × ~5-15KB each.
 *
 * Eager: cashier-tab UI (menu grid, cart, layout switcher).
 * Lazy: 15 modal (rarely open) + 7 panel (non-default tab).
 * Suspense fallback=null saat modal close (no UI shift); spinner saat
 * panel switch (one-time chunk fetch). */
import { CartLineItem } from "@/features/pos/components/CartLineItem";
import { CategoryTabs } from "@/features/pos/components/CategoryTabs";
import type { Promo } from "@/features/promos";
import { lookupCustomerByPhone } from "@/features/customers";
import { FavoritesBar } from "@/features/pos/components/FavoritesBar";
import { useFavorites } from "@/features/pos/components/useFavorites";
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
import { PosPanelSkeleton } from "@/features/pos/components/PanelSkeleton";
import { PosDashboardView } from "@/features/pos/components/PosDashboardView";
import { PosLeftNav, type PosTab } from "@/features/pos/components/PosLeftNav";

/* ─── Lazy: 15 modals (open hanya saat user action) ─── */
const ApproverOverrideModal = lazy(() =>
  import("@/features/pos/components/ApproverOverrideModal").then((m) => ({
    default: m.ApproverOverrideModal,
  })),
);
const CloseShiftModal = lazy(() =>
  import("@/features/pos/components/CloseShiftModal").then((m) => ({
    default: m.CloseShiftModal,
  })),
);
/* Sesi AE-151 — reuse modal sama yang dipakai OpenBillPanel "Bayar Sekarang",
 * dipasang di shell supaya bisa di-trigger setelah Update Bill + Bayar. */
const CloseOpenBillModal = lazy(() =>
  import("@/features/pos/components/CloseOpenBillModal").then((m) => ({
    default: m.CloseOpenBillModal,
  })),
);
const ComplimentModal = lazy(() =>
  import("@/features/pos/components/ComplimentModal").then((m) => ({
    default: m.ComplimentModal,
  })),
);
const PaymentModal = lazy(() =>
  import("@/features/pos/components/PaymentModal").then((m) => ({
    default: m.PaymentModal,
  })),
);
/* Sesi AE-155 — Split metode payment builder untuk direct sale. */
const SplitMethodBuilderModal = lazy(() =>
  import("@/features/pos/components/SplitMethodBuilderModal").then((m) => ({
    default: m.SplitMethodBuilderModal,
  })),
);
const PromoPickerModal = lazy(() =>
  import("@/features/pos/components/PromoPickerModal").then((m) => ({
    default: m.PromoPickerModal,
  })),
);
const RedeemPointsModal = lazy(() =>
  import("@/features/pos/components/RedeemPointsModal").then((m) => ({
    default: m.RedeemPointsModal,
  })),
);
const HistoryDetailModal = lazy(() =>
  import("@/features/pos/components/HistoryDetailModal").then((m) => ({
    default: m.HistoryDetailModal,
  })),
);
const ItemModifierModal = lazy(() =>
  import("@/features/pos/components/ItemModifierModal").then((m) => ({
    default: m.ItemModifierModal,
  })),
);
const ItemNoteModal = lazy(() =>
  import("@/features/pos/components/ItemNoteModal").then((m) => ({
    default: m.ItemNoteModal,
  })),
);
const NewOrderModal = lazy(() =>
  import("@/features/pos/components/NewOrderModal").then((m) => ({
    default: m.NewOrderModal,
  })),
);
const OrderMetadataModal = lazy(() =>
  import("@/features/pos/components/OrderMetadataModal").then((m) => ({
    default: m.OrderMetadataModal,
  })),
);
const PostActionPrintModal = lazy(() =>
  import("@/features/pos/components/PostActionPrintModal").then((m) => ({
    default: m.PostActionPrintModal,
  })),
);
const TransactionSuccessModal = lazy(() =>
  import("@/features/pos/components/TransactionSuccessModal").then((m) => ({
    default: m.TransactionSuccessModal,
  })),
);
const OpenPriceModal = lazy(() =>
  import("@/features/pos/components/OpenPriceModal").then((m) => ({
    default: m.OpenPriceModal,
  })),
);
const OpenShiftModal = lazy(() =>
  import("@/features/pos/components/OpenShiftModal").then((m) => ({
    default: m.OpenShiftModal,
  })),
);

/* ─── Lazy: 7 panels (non-default tab) ─── */
const HistoryPanel = lazy(() =>
  import("@/features/pos/components/HistoryPanel").then((m) => ({
    default: m.HistoryPanel,
  })),
);
const OpenBillPanel = lazy(() =>
  import("@/features/pos/components/OpenBillPanel").then((m) => ({
    default: m.OpenBillPanel,
  })),
);
const OrderQueuePanel = lazy(() =>
  import("@/features/pos/components/OrderQueuePanel").then((m) => ({
    default: m.OrderQueuePanel,
  })),
);
const PettyCashPanel = lazy(() =>
  import("@/features/pos/components/PettyCashPanel").then((m) => ({
    default: m.PettyCashPanel,
  })),
);
const KasOwnerPanel = lazy(() =>
  import("@/features/pos/components/KasOwnerPanel").then((m) => ({
    default: m.KasOwnerPanel,
  })),
);
const GoodsReceivePanel = lazy(() =>
  import("@/features/pos/components/GoodsReceivePanel").then((m) => ({
    default: m.GoodsReceivePanel,
  })),
);
const PosSettingsPanel = lazy(() =>
  import("@/features/pos/components/PosSettingsPanel").then((m) => ({
    default: m.PosSettingsPanel,
  })),
);
const ShiftPanel = lazy(() =>
  import("@/features/pos/components/ShiftPanel").then((m) => ({
    default: m.ShiftPanel,
  })),
);

/* Suspense fallback untuk panel switch (one-time fetch chunk). Sesi AE-171 —
 * pakai skeleton panel (bukan spinner) supaya pindah tab kerasa mulus + rapi
 * di device apa pun. */
function PanelFallback() {
  return <PosPanelSkeleton />;
}
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
import {
  getActiveShift,
  getShiftDayGate,
  resolveGateDecision,
  type Shift,
  type ShiftDayGateState,
} from "@/features/shifts";
import { ShiftDayGateScreen } from "./components/ShiftDayGateScreen";
import { EmergencyCloseShiftModal } from "./components/EmergencyCloseShiftModal";
import { useOnlineStatus } from "@/lib/useOnlineStatus";
import { queuePendingTransaction } from "@/lib/offline/queue";
import { usePendingSync } from "@/lib/offline/usePendingSync";
import {
  outletToReceiptConfig,
  printTickets,
  type ReceiptConfig,
} from "@/lib/printer/print-transaction";
import { getPrinterClient } from "@/lib/printer/bluetooth";
import type { Discount } from "@/lib/money";
import { formatRupiah } from "@/lib/format";
import {
  combineJakartaDateAndTime,
  jakartaDowKey,
} from "@/lib/date";
import { cn } from "@/lib/utils";

type RightPanelState =
  | { kind: "idle" }
  | { kind: "cart"; draftId: string }
  | { kind: "paying"; draftId: string }
  | { kind: "paid"; trx: TransactionWithItems };


/**
 * Phase 2.2 — short alert tone via Web Audio API for shift-close warnings.
 * Single 800Hz beep, ~0.4s with exponential decay so it cuts through cafe
 * noise tanpa terdengar nge-glitch. Silent failover kalau AudioContext
 * blocked (browser autoplay policy belum unlock — biasanya unlock setelah
 * first user gesture, yang sudah pasti terjadi sebelum kasir aktif).
 */
function playShiftAlertTone(): void {
  if (typeof window === "undefined") return;
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 800;
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
    osc.onended = () => {
      void ctx.close().catch(() => {});
    };
  } catch {
    // Browser blocked AudioContext (e.g., autoplay policy) — toast still
    // surfaces the warning.
  }
}

/* Sesi AE-218 — satu kalimat yang sama di SEMUA jalur yang butuh shift.
 * Sebelumnya tiap jalur berhenti tanpa suara, jadi tombol-tombolnya terasa
 * mati begitu shift ditutup. Kasir tidak perlu menebak; katakan langkahnya. */
const NO_SHIFT_HINT =
  'Belum ada shift terbuka. Buka shift dulu di tab "Shift" — pesanan ini tetap tersimpan.';

export function PosShell() {
  const { session, logout } = useSession();
  // Watch online status + pending offline queue; auto-sync when reconnected.
  usePendingSync();

  // ==================== Top-level state ====================

  const [tab, setTab] = useState<PosTab>("cashier");
  const [rightPanel, setRightPanel] = useState<RightPanelState>({ kind: "idle" });
  /* Sesi AE-172 — di HP (<sm) kolom cart jadi drawer overlay supaya kolom menu
   * dapat lebar penuh; state ini inert di tablet/desktop (kelas max-sm: only). */
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [openBillsCount, setOpenBillsCount] = useState(0);
  // Phase 2.2 (sesi AB) — derived from outlet.operationalHours[today].closeTime
  // when the outlet config loads; null if outlet operates 24h or hari ini tutup.
  const [expectedCloseTime, setExpectedCloseTime] = useState<Date | null>(null);
  // Track which warning toasts already fired this shift (deduplication so the
  // 30s poll doesn't spam). Reset whenever shift opens/closes or the user
  // logs out — it's session-only state.
  const firedShiftWarningsRef = useRef<Set<"30min" | "15min">>(new Set());
  const [printConfirm, setPrintConfirm] = useState<{
    trx: TransactionWithItems;
    title: string;
  } | null>(null);
  const [metadataModal, setMetadataModal] = useState<
    "pay" | "save_bill" | null
  >(null);
  /* Sesi AE-151 — Bill to pay setelah "Update & Bayar" sukses. State
   * triggers CloseOpenBillModal mount. Setelah modal closed (sukses /
   * batal), reset ke null. Pattern mirror printConfirm. */
  const [billToCloseAfterUpdate, setBillToCloseAfterUpdate] =
    useState<TransactionWithItems | null>(null);

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
  // Sesi AE-172 — jumlah item di keranjang aktif, buat badge FAB drawer HP.
  const mobileCartCount =
    activeDraft?.items.reduce((n, it) => n + it.quantity, 0) ?? 0;
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
    voidMode: "pin" | "code" | "pin_or_code";
    refundMode: "pin" | "code" | "pin_or_code";
  }>({ voidMode: "pin", refundMode: "pin" });
  const [receiptConfig, setReceiptConfig] = useState<ReceiptConfig | null>(
    null,
  );
  /* Sesi AE-62t — variance alert threshold dari outlet settings (Pengaturan
   * → Threshold). Default 10k kalau outlet belum loaded atau setting null.
   * Threaded ke CloseShiftModal supaya peringatan kasir live update saat
   * owner ubah di Pengaturan. */
  const [varianceThreshold, setVarianceThreshold] = useState<number>(10_000);

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
  /* Sesi AE-217 — rem anti-lupa-tutup-shift. Seluruh keputusan mengunci
   * dihitung SERVER (getShiftDayGate) supaya jam tablet yang salah — atau
   * sengaja diubah — tidak bisa melewati gerbang. */
  const [gate, setGate] = useState<ShiftDayGateState | null>(null);
  const [gateSnoozeCount, setGateSnoozeCount] = useState(0);
  const [gateSnoozeUntil, setGateSnoozeUntil] = useState(0);
  const [gateBillsOpen, setGateBillsOpen] = useState(false);
  const [gateEmergencyOpen, setGateEmergencyOpen] = useState(false);
  /** Shift yang terakhir kali sudah dapat toast pengingat, supaya tidak spam. */
  const gateRemindedRef = useRef<string | null>(null);
  /** Identitas shift yang sedang dipegang layar, dibaca oleh poll gerbang. */
  const shiftIdRef = useRef<string | null>(null);
  const online = useOnlineStatus();
  const [historyDetailId, setHistoryDetailId] = useState<string | null>(null);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  // Payment state
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [cashInput, setCashInput] = useState("");
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  /* Sesi AE-155 — Split metode builder open + caching split rows untuk pass
   * ke createTransaction. */
  const [splitBuilderOpen, setSplitBuilderOpen] = useState(false);
  // Synchronous double-tap guard. React state updates are async, so two taps
  // within one commit window both observe paymentSubmitting=false and fire
  // duplicate transactions. Ref updates synchronously and gates re-entry.
  const paymentInFlightRef = useRef(false);
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

  /* ====================================================================
   * Sesi AE-217 — REM ANTI-LUPA-TUTUP-SHIFT
   *
   * Mahakan memakai SATU shift bersama per outlet, jadi shift yang lupa
   * ditutup TIDAK memunculkan error apa pun keesokan harinya: staff yang
   * login besok diam-diam menempel ke shift kemarin dan terus berjualan di
   * sana. Gerbang ini yang menghentikannya.
   *
   * Semua ambang dihitung di server; klien hanya menggambar. Kegagalan
   * jaringan sengaja MEMPERTAHANKAN keadaan terakhir yang terverifikasi —
   * POS tidak boleh dikunci (atau dibuka) berdasarkan tebakan.
   * ================================================================== */
  const refreshGate = useCallback(async () => {
    try {
      const res = await getShiftDayGate();
      if (!isOk(res)) return;
      setGate(res.data);

      /* Sesi AE-218 — samakan juga identitas shift yang dipegang layar ini.
       *
       * Sebelumnya `shift` HANYA diambil sekali saat POS dibuka. Kalau shift
       * ditutup dari tempat lain — laptop owner, Back Office, tablet kedua,
       * atau gerbang di sesi lain — tablet ini tetap memegang id shift yang
       * sudah mati, lalu setiap pembayaran ditolak server "Shift sudah
       * ditutup" tanpa kasir tahu sebabnya dan tanpa jalan keluar. Poll 60
       * detik ini sekarang menyembuhkannya sendiri. */
      const serverShiftId = res.data.shift?.id ?? null;
      if (serverShiftId !== shiftIdRef.current) {
        const full = await getActiveShift();
        if (isOk(full)) setShift(full.data);
      }
    } catch {
      /* Offline / server tidak terjangkau — pertahankan keadaan terakhir. */
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    /* Satu-satunya cara mengetahui keadaan gerbang adalah bertanya ke server,
     * jadi pengambilan pertama memang harus terjadi di sini. Disalin ke dalam
     * effect hanya untuk memuaskan lint justru akan menggandakan logikanya. */
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshGate();
    const id = window.setInterval(() => void refreshGate(), 60_000);
    function onVisible() {
      if (document.visibilityState === "visible") void refreshGate();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [session, refreshGate]);

  /* Sesi AE-218 — shift menghilang di bawah kaki kasir.
   *
   * Kejadian 25 Agustus: sesudah gerbang memaksa menutup shift kemarin, POS
   * kembali dengan panel pembayaran yang MASIH terbuka dari sebelumnya. Kasir
   * menekan "Sudah Lunas" dan tidak terjadi apa-apa — `handleProcessPayment`
   * diam-diam berhenti karena tidak ada shift, sementara pesan merah "Shift
   * sudah ditutup" dari percobaan sebelumnya masih menempel di layar. Dari
   * kursi kasir itu terbaca sebagai aplikasi yang rusak, dan satu penjualan
   * Rp 96.000 hilang.
   *
   * Sekarang layar mundur sendiri ke keranjang (isi pesanan TIDAK dibuang),
   * pesan basi dibersihkan, dan kasir diberi tahu langkah berikutnya. */
  useEffect(() => {
    const prev = shiftIdRef.current;
    const next = shift?.id ?? null;
    shiftIdRef.current = next;
    if (!prev || next) return;
    setPaymentError(null);
    setRightPanel((cur) =>
      cur.kind === "paying" ? { kind: "cart", draftId: cur.draftId } : cur,
    );
    toast.warning(
      "Shift sudah ditutup. Buka shift baru dulu sebelum menerima pembayaran — pesanan di keranjang tetap tersimpan.",
    );
  }, [shift?.id]);

  /* Tingkat "remind" tidak menutupi layar — cukup satu toast per shift
   * supaya poll 60 detik tidak berubah jadi alarm yang diabaikan orang. */
  useEffect(() => {
    if (!gate || gate.level !== "remind" || !gate.shift) return;
    const key = `${gate.shift.id}:${gate.reason}`;
    if (gateRemindedRef.current === key) return;
    gateRemindedRef.current = key;
    toast.warning(
      gate.daysStale >= 1
        ? "Shift kemarin masih terbuka. Tutup begitu tamu terakhir selesai."
        : `Sebentar lagi ganti hari — jangan lupa tutup shift sebelum ${gate.thresholds.softLockAt} WIB.`,
    );
  }, [gate]);

  // Sesi Z #3: pre-warm Bluetooth printer connection so the first print
  // after sit-idle doesn't pay the 1-3s reconnect cost in front of the
  // customer. Triggers on mount + whenever the tab becomes visible
  // again (BLE typically drops while backgrounded). Silent — failures
  // logged only; the actual print path still does its own connect retry.
  useEffect(() => {
    if (!session) return;
    const client = getPrinterClient();
    void client.prewarm();
    function onVisibility() {
      if (document.visibilityState === "visible") {
        void client.prewarm();
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [session]);

  // Open-bills count for left-nav badge — refetched on every mount + when
  // historyRefreshKey bumps (cart save, payment, void/refund). Keeps badge
  // accurate even when user has never opened the Bill Aktif tab.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    async function loadCount() {
      // Sesi AE-29 — open bills tidak butuh date filter sama sekali.
      // Status="open" sudah cukup; cross-day bills (kemarin masih
      // outstanding) juga harus terhitung. Sebelumnya pakai filter
      // today UTC yang miss bill di window 00:00-06:59 WIB.
      const res = await listTransactions({
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
          /* Sesi AE-229 — tiga mode; nilai tak dikenal jatuh ke "pin"
           * (perilaku paling lama, tidak pernah memblok kasir). */
          voidMode:
            approval?.voidMode === "code"
              ? "code"
              : approval?.voidMode === "pin_or_code"
                ? "pin_or_code"
                : "pin",
          refundMode:
            approval?.refundMode === "code"
              ? "code"
              : approval?.refundMode === "pin_or_code"
                ? "pin_or_code"
                : "pin",
        });
        // Sesi AE-62t — pull live varianceThreshold dari outlet settings.
        const thr = res.data.settings?.thresholds?.shiftVarianceAlert;
        if (typeof thr === "number" && thr >= 0) {
          setVarianceThreshold(thr);
        }
        // Phase 2.2 — derive expected shift close from outlet operational
        // hours (today's closeTime in WIB). Null kalau hari ini tutup atau
        // closeTime tidak diset.
        const today = jakartaDowKey(new Date());
        const todayHours = res.data.operationalHours?.[today];
        if (todayHours?.isOpen && todayHours.closeTime) {
          setExpectedCloseTime(
            combineJakartaDateAndTime(new Date(), todayHours.closeTime),
          );
        } else {
          setExpectedCloseTime(null);
        }
      }
    }
    void loadOutlet();
    return () => {
      cancelled = true;
    };
  }, [session]);

  // Phase 2.2 — toast warnings 30 + 15 minutes before expectedCloseTime kalau
  // masih ada open bills. Polling tiap 30s di shell yang aktif. Dedupe via ref
  // set — tidak fire ulang per shift session. Reset state saat shift baru
  // dibuka (different shift.id). Sound: short Web Audio beep, opt-out
  // gracefully kalau browser block AudioContext.
  useEffect(() => {
    if (!session || !shift || !expectedCloseTime) return;
    if (shift.status !== "open") return;

    const checkAtMs = (offsetMin: number) =>
      expectedCloseTime.getTime() - offsetMin * 60_000;
    const tick = () => {
      const now = Date.now();
      // 1-minute hysteresis window so we never miss the boundary regardless
      // of when the interval fires within the minute.
      const inWindow = (target: number) =>
        now >= target && now <= target + 60_000;

      if (
        openBillsCount > 0 &&
        inWindow(checkAtMs(30)) &&
        !firedShiftWarningsRef.current.has("30min")
      ) {
        firedShiftWarningsRef.current.add("30min");
        toast.warning(
          `30 menit lagi tutup shift — masih ${openBillsCount} bill terbuka. Kejar pembayaran sebelum kasir tutup.`,
        );
        playShiftAlertTone();
      }
      if (
        openBillsCount > 0 &&
        inWindow(checkAtMs(15)) &&
        !firedShiftWarningsRef.current.has("15min")
      ) {
        firedShiftWarningsRef.current.add("15min");
        toast.warning(
          `15 menit lagi tutup shift — ${openBillsCount} bill belum dibayar. Segera selesaikan!`,
        );
        playShiftAlertTone();
      }
    };

    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [session, shift, expectedCloseTime, openBillsCount]);

  // Reset fired warnings when the shift identity changes (open new shift,
  // close current shift) so a fresh shift gets fresh warnings.
  useEffect(() => {
    firedShiftWarningsRef.current = new Set();
    /* Sesi AE-217 — jatah tunda gerbang ikut disegarkan: shift baru berhak
     * atas penundaannya sendiri, dan sisa error tutup yang lama tidak boleh
     * menempel di layar shift berikutnya. */
    /* eslint-disable react-hooks/set-state-in-effect */
    setGateSnoozeCount(0);
    setGateSnoozeUntil(0);
    setGateBillsOpen(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [shift?.id]);

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

  /* Sesi AE-195 — compliment sekarang disetujui lewat KODE OWNER, bukan PIN
   * approver. ComplimentModal yang mengurus PIN-nya; di sini tinggal
   * menerapkan diskonnya. Owner tanpa PIN → null, server mengizinkan karena
   * dialah yang berwenang menyetujui. */
  function handleComplimentApproved(reason: string, pin: string | null) {
    if (!activeDraftId || !session) return;
    setComplimentModalOpen(false);
    setDiscount(
      activeDraftId,
      { type: "fixed", value: subtotal },
      reason,
      undefined,
      undefined,
      null, // compliment ad-hoc, bukan promo master
      pin,
    );
    toast.success(
      pin ? "Compliment diterapkan" : "Compliment diterapkan (Owner)",
    );
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
    if (!activeDraft || !session) return;
    if (!shift) {
      toast.error(NO_SHIFT_HINT);
      return;
    }
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

  /**
   * Sesi AE-151 — Staff feedback: setelah Update Bill (edit open bill),
   * customer kadang langsung mau bayar. Tombol Update + Bayar bikin
   * flow 1-tap: editOpenBill + open CloseOpenBillModal. Tanpa fitur ini
   * staff harus klik Update Bill → tutup cart → tab Bill Aktif → cari
   * bill → klik Bayar Sekarang (~5 detik vs 1 detik).
   *
   * Hanya tersedia untuk EDIT path (editingBillId set). CREATE path
   * sudah punya "Bayar" langsung di kasir (tanpa save open bill dulu).
   */
  async function handleUpdateBillAndPay() {
    if (!activeDraft || !session) return;
    if (!shift) {
      toast.error(NO_SHIFT_HINT);
      return;
    }
    if (activeDraft.items.length === 0) return;
    if (!activeDraft.editingBillId) return;
    await commitSaveAsOpenBill({ proceedToPay: true });
  }

  async function commitSaveAsOpenBill(opts?: { proceedToPay?: boolean }) {
    if (paymentInFlightRef.current) return;
    if (!activeDraft || !session) return;
    if (!shift) {
      toast.error(NO_SHIFT_HINT);
      return;
    }
    if (activeDraft.items.length === 0) return;
    paymentInFlightRef.current = true;
    setPaymentSubmitting(true);
    setPaymentError(null);

    try {
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
          complimentPin:
            activeDraft.complimentPin ?? undefined,
          promoId: activeDraft.promoId,
        });
        if (!res.success) {
          setPaymentError(res.error.message);
          toast.error(res.error.message);
          return;
        }
        toast.success(`Open bill ${res.data.transactionNumber} di-update.`);
        removeDraft(activeDraft.id);
        setRightPanel({ kind: "idle" });
        setHistoryRefreshKey((k) => k + 1);
        /* Sesi AE-151 — proceedToPay path: skip printConfirm + langsung
         * trigger CloseOpenBillModal (yang sudah handle print + cleanup
         * sendiri setelah payment sukses). printConfirm di-skip biar
         * staff tidak ada modal nge-popup berlapis. */
        if (opts?.proceedToPay) {
          setBillToCloseAfterUpdate(res.data);
        } else {
          setPrintConfirm({ trx: res.data, title: "Bill di-update" });
        }
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
        complimentPin:
          activeDraft.complimentPin ?? undefined,
        promoId: activeDraft.promoId,
      };
      const res = await saveAsOpenBill(payload);
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
    } finally {
      paymentInFlightRef.current = false;
      setPaymentSubmitting(false);
    }
  }

  /**
   * Sesi AE-155 — Process direct sale dengan split metode payment.
   * Dipanggil dari SplitMethodBuilderModal onConfirm. Sama dengan
   * handleProcessPayment tapi pakai paymentMethod="split" + splits payload.
   * Server validate sum=total. Kalau sukses: success state same as cash.
   */
  async function handleProcessSplitPayment(
    splits: import("@/features/transactions").CreateTransactionSplitInput[],
  ) {
    if (paymentInFlightRef.current) return;
    if (!activeDraft) return;
    if (!shift) {
      setPaymentError(NO_SHIFT_HINT);
      return;
    }
    paymentInFlightRef.current = true;
    setPaymentSubmitting(true);
    setPaymentError(null);

    try {
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
        paymentMethod: "split" as PaymentMethod,
        cashReceived: null,
        cashChange: null,
        discountApproverToken: activeDraft.discountApproverToken ?? undefined,
        complimentPin:
          activeDraft.complimentPin ?? undefined,
        loyaltyPointsRedeemed: activeDraft.loyaltyPointsRedeemed,
        promoId: activeDraft.promoId,
        splits,
      };

      const res = await createTransaction(payload);
      if (!isOk(res)) {
        setPaymentError(res.error.message);
        return;
      }
      removeDraft(activeDraft.id);
      setHistoryRefreshKey((k) => k + 1);
      setSplitBuilderOpen(false);
      setRightPanel({ kind: "paid", trx: res.data });
    } finally {
      paymentInFlightRef.current = false;
      setPaymentSubmitting(false);
    }
  }

  async function handleProcessPayment() {
    if (paymentInFlightRef.current) return;
    if (!activeDraft) return;
    /* Sesi AE-218 — dulu baris ini ikut `!shift` dan berhenti TANPA SUARA.
     * Tombol bayar jadi tombol mati: ditekan berkali-kali, tidak ada reaksi,
     * tidak ada penjelasan. Katakan apa yang harus dilakukan. */
    if (!shift) {
      setPaymentError(NO_SHIFT_HINT);
      return;
    }
    if (!cashSufficient) {
      setPaymentError("Uang yang diterima kurang dari total");
      return;
    }
    paymentInFlightRef.current = true;
    setPaymentSubmitting(true);
    setPaymentError(null);

    try {
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
        complimentPin:
          activeDraft.complimentPin ?? undefined,
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
        } catch (e) {
          const message =
            e instanceof Error ? e.message : "Gagal queue offline";
          setPaymentError(message);
        }
        return;
      }

      try {
        const res = await createTransaction(payload);
        if (!isOk(res)) {
          setPaymentError(res.error.message);
          return;
        }
        removeDraft(activeDraft.id);
        // Sesi AE-28 — CRITICAL FIX: bump historyRefreshKey langsung
        // setelah createTransaction sukses. Tanpa bump, Pesanan +
        // Riwayat panel pakai cached data (stale sampai 30s tick),
        // sehingga owner test "bayar cash → cek tab Pesanan" lihat
        // kosong. Sebelumnya hanya handleFinishOrder yang bump (saat
        // user klik Selesai), tapi user kadang langsung tab-switch.
        setHistoryRefreshKey((k) => k + 1);
        setRightPanel({ kind: "paid", trx: res.data });
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
      }
    } finally {
      paymentInFlightRef.current = false;
      setPaymentSubmitting(false);
    }
  }

  function handleFinishOrder() {
    if (rightPanel.kind === "paid") {
      void markServed(rightPanel.trx.id);
    }
    setRightPanel({ kind: "idle" });
    setHistoryRefreshKey((k) => k + 1);
    setMobileCartOpen(false); // sesi AE-172 — tutup drawer HP setelah transaksi
  }

  async function handleLogout() {
    await logout("/pin");
  }

  // ==================== Render ====================

  /* Sesi AE-217 — keputusan mengunci. Tingkat "hard" datang dari server, jadi
   * menekan tunda berkali-kali atau memuat ulang halaman tidak menggesernya. */
  const gateDecision = gate
    ? resolveGateDecision({
        level: gate.level,
        snoozeCount: gateSnoozeCount,
        snoozeUntilMs: gateSnoozeUntil,
        nowMs: Date.now(),
        maxSnoozes: gate.thresholds.maxSnoozes,
      })
    : { blocking: false, canSnooze: false };

  /* Gerbang dirender MENGGANTI seluruh POS, bukan sebagai lapisan di atasnya.
   * Kalau kasir + keranjang tetap ter-mount, satu tombol yang lolos dari
   * lapisan sudah cukup untuk memasukkan penjualan hari ini ke shift kemarin
   * — persis kerusakan yang sedang dicegah. */
  /* Satu pengecualian yang disengaja: jangan merebut layar di tengah
   * pembayaran. `paymentSubmitting` itu panggilan jaringan yang sedang
   * berjalan — durasinya terbatas, jadi menundanya tidak membuka celah. Panel
   * "paying" yang masih terbuka hanya ditunggu pada tingkat soft (yang memang
   * bisa ditunda); pada tingkat hard layar tetap direbut supaya panel yang
   * dibiarkan menganga tidak jadi lubang untuk melewati kunci. */
  const gateDeferredForPayment =
    paymentSubmitting ||
    (gate?.level === "soft" && rightPanel.kind === "paying");

  if (gate && gateDecision.blocking && !gateDeferredForPayment) {
    return (
      <div
        data-pos-kiosk
        className="flex h-[calc(100dvh-4rem)] w-full max-w-full overflow-hidden bg-neutral-900 touch:h-[calc(100dvh-3.5rem)]"
      >
        {gateBillsOpen ? (
          <div className="flex h-full w-full flex-col bg-neutral-50">
            <div className="flex items-center gap-3 border-b border-neutral-200 bg-white px-4 py-2.5">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setGateBillsOpen(false)}
              >
                <ArrowLeft className="size-4" aria-hidden /> Kembali
              </Button>
              <p className="min-w-0 text-sm font-semibold text-neutral-900">
                Bayar atau batalkan bill ini dulu, baru shift bisa ditutup
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <Suspense fallback={<PanelFallback />}>
                <OpenBillPanel
                  cashierName={session.user.name}
                  receiptConfig={receiptConfig}
                  refreshKey={historyRefreshKey}
                  onOpenSettings={() =>
                    toast.info("Pengaturan tidak bisa dibuka selagi shift terkunci.")
                  }
                  /* Edit isi bill butuh keranjang, dan keranjang sengaja tidak
                   * ter-mount di sini. Bayar + batalkan sudah cukup sebagai
                   * jalan keluar; keduanya ada di panel ini. */
                  onEditBill={() =>
                    toast.info(
                      "Selagi shift terkunci, bill hanya bisa dibayar atau dibatalkan.",
                    )
                  }
                  onCountChange={(n) => {
                    setOpenBillsCount(n);
                    if (n === 0) {
                      setGateBillsOpen(false);
                      void refreshGate();
                    }
                  }}
                  onBillPaid={() => {
                    setHistoryRefreshKey((k) => k + 1);
                    void refreshGate();
                  }}
                />
              </Suspense>
            </div>
          </div>
        ) : (
          <ShiftDayGateScreen
            state={gate}
            canSnooze={gateDecision.canSnooze}
            snoozeRemaining={Math.max(
              0,
              gate.thresholds.maxSnoozes - gateSnoozeCount,
            )}
            closeError={
              online
                ? null
                : "Tablet sedang offline. Menutup shift butuh koneksi — sambungkan WiFi dulu, layar ini lanjut sendiri setelah tersambung."
            }
            onRequestCloseShift={() => setCloseShiftOpen(true)}
            onOpenBills={() => setGateBillsOpen(true)}
            onSnooze={() => {
              setGateSnoozeCount((n) => n + 1);
              setGateSnoozeUntil(
                Date.now() + gate.thresholds.snoozeMinutes * 60_000,
              );
            }}
            onEmergency={() => setGateEmergencyOpen(true)}
            onLogout={handleLogout}
          />
        )}

        {shift ? (
          <Suspense fallback={null}>
            <CloseShiftModal
              open={closeShiftOpen}
              shift={shift}
              userId={session.user.id}
              cashierName={session.user.name ?? "Kasir"}
              receiptConfig={receiptConfig}
              varianceThreshold={varianceThreshold}
              onClose={() => setCloseShiftOpen(false)}
              onClosed={async () => {
                setCloseShiftOpen(false);
                const res = await getActiveShift();
                if (isOk(res)) setShift(res.data);
                await refreshGate();
                /* Gerbang selesai — langsung tawarkan shift hari ini supaya
                 * kasir tidak perlu mencari tab Shift sendiri. */
                setOpenShiftOpen(true);
              }}
              onOpenSettings={() =>
                toast.info("Pengaturan tidak bisa dibuka selagi shift terkunci.")
              }
            />
          </Suspense>
        ) : null}

        {gate.shift ? (
          <EmergencyCloseShiftModal
            open={gateEmergencyOpen}
            shiftId={gate.shift.id}
            canForceCloseDirectly={gate.canForceCloseDirectly}
            onClose={() => setGateEmergencyOpen(false)}
            onClosed={async () => {
              setGateEmergencyOpen(false);
              const res = await getActiveShift();
              if (isOk(res)) setShift(res.data);
              await refreshGate();
              setOpenShiftOpen(true);
            }}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div
      data-pos-kiosk
      className="flex h-[calc(100dvh-4rem)] w-full max-w-full overflow-hidden bg-neutral-50 touch:h-[calc(100dvh-3.5rem)]"
    >
      <PosLeftNav
        activeTab={tab}
        onTabChange={setTab}
        onLogout={handleLogout}
        role={session.user.role}
        cashierBadge={drafts.length}
        openBillsBadge={openBillsCount}
      />

      {/* MIDDLE COLUMN — content per tab. min-w-0 prevents flex child from
       * overflowing parent (causes horizontal swaying di tablet).
       *
       * Sesi AE-63 phase2 P2.2 — Cashier + dashboard tabs eager (default
       * landing). Panel lain di-lazy wrapped Suspense. Spinner one-time
       * saat chunk fetch pertama; setelah loaded, cached browser-side. */}
      <main className="flex-1 min-w-0 overflow-hidden">
        {tab === "dashboard" ? (
          <PosDashboardView cashierName={session.user.name} />
        ) : tab === "cashier" ? (
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
        ) : (
          <Suspense fallback={<PanelFallback />}>
            {tab === "open_bills" ? (
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
                onBillPaid={(trx) => {
                  // Sesi AE-26 — CRITICAL FIX: bump historyRefreshKey supaya
                  // Pesanan + History segera refetch. Sebelumnya hanya
                  // setPrintConfirm — bill yang baru dibayar hilang dari
                  // Bill Aktif (local tick refresh) tapi tidak muncul di
                  // Pesanan/History sampai 30s polling.
                  setHistoryRefreshKey((k) => k + 1);
                  setPrintConfirm({ trx, title: "Pembayaran sukses" });
                }}
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
            ) : tab === "petty_cash" ? (
              <PettyCashPanel />
            ) : tab === "kas" ? (
              <KasOwnerPanel viewerRole={session.user.role} />
            ) : tab === "goods_receive" ? (
              <GoodsReceivePanel />
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
          </Suspense>
        )}
      </main>

      {/* RIGHT COLUMN — order panel. Width adaptif: tablet kecil (~10")
       * pakai 320px supaya middle column dapat ruang lebih untuk grid menu;
       * desktop tetap 400px.
       *
       * sesi AD-6 — only render aside on Kasir tab. Other tabs (Bill
       * Aktif, Pesanan, Riwayat, Shift, Petty Cash, Settings) get full
       * viewport width since they don't need the cart/order panel.
       * Cart state (rightPanel.kind === "cart"/"paying") preserved when
       * user switches away — they can resume the draft when they come
       * back to Kasir.
       */}
      {tab === "cashier" ? (
        <>
          {/* Sesi AE-172 — backdrop drawer (HP only). Tap di luar = tutup. */}
          {mobileCartOpen ? (
            <button
              type="button"
              aria-label="Tutup keranjang"
              onClick={() => setMobileCartOpen(false)}
              className="fixed inset-0 z-40 bg-black/40 sm:hidden"
            />
          ) : null}
          <aside
            className={cn(
              "flex w-[280px] shrink-0 flex-col overflow-hidden border-l border-neutral-200 bg-white sm:w-[320px] tablet-landscape:w-[300px] lg:w-[360px] xl:w-[380px] 2xl:w-[400px] 3xl:w-[440px]",
              // HP (<sm): overlay drawer dari kanan; geser keluar saat tertutup.
              "max-sm:fixed max-sm:inset-y-0 max-sm:right-0 max-sm:z-50 max-sm:w-[88vw] max-sm:max-w-[360px] max-sm:border-l-0 max-sm:shadow-2xl max-sm:transition-transform max-sm:duration-300",
              mobileCartOpen
                ? "max-sm:translate-x-0"
                : "max-sm:translate-x-full",
            )}
          >
          {/* HP only — header tutup drawer */}
          <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2.5 sm:hidden">
            <span className="text-sm font-semibold text-neutral-800">
              Keranjang
            </span>
            <button
              type="button"
              onClick={() => setMobileCartOpen(false)}
              aria-label="Tutup keranjang"
              className="flex size-9 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
          {rightPanel.kind === "idle" ? (
            <IdlePanel
              drafts={drafts}
              shiftActive={shift !== null}
              onNewOrder={() => setNewOrderOpen(true)}
              onSelectDraft={openDraft}
              userName={session.user.name}
              userRole={session.user.role}
            />
          ) : (rightPanel.kind === "cart" || rightPanel.kind === "paying") &&
            activeDraft ? (
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
              onUpdateBillAndPay={handleUpdateBillAndPay}
              saveBillSubmitting={paymentSubmitting}
              onProceedToPayment={handleProceedToPayment}
              onCancel={handleCancelOrder}
              onSwitchDraft={() => setRightPanel({ kind: "idle" })}
              onSetBillNote={(note) => setBillNote(activeDraft.id, note)}
            />
          ) : rightPanel.kind === "paid" ? (
            // sesi AD-4 — right panel reverts to Idle while
            // TransactionSuccessModal owns the success UX. Cart visually
            // resets to "ready for next order" so kasir can start typing
            // the next customer immediately after closing the modal.
            <IdlePanel
              drafts={drafts}
              shiftActive={shift !== null}
              onNewOrder={() => setNewOrderOpen(true)}
              onSelectDraft={openDraft}
              userName={session.user.name}
              userRole={session.user.role}
            />
          ) : null}
          </aside>
          {/* Sesi AE-172 — FAB buka keranjang (HP only). Badge jumlah item +
           * total biar kasir tahu isi keranjang tanpa buka drawer. */}
          {!mobileCartOpen ? (
            <button
              type="button"
              onClick={() => setMobileCartOpen(true)}
              aria-label="Buka keranjang"
              className="fixed bottom-4 right-4 z-30 flex items-center gap-2 rounded-full bg-mahakan-green-700 px-5 py-3 text-white shadow-lg active:scale-95 sm:hidden"
            >
              <ShoppingCart className="size-5 shrink-0" aria-hidden />
              <span className="text-sm font-semibold">
                {mobileCartCount > 0
                  ? `${mobileCartCount} · ${formatRupiah(total)}`
                  : "Keranjang"}
              </span>
            </button>
          ) : null}
        </>
      ) : null}

      {/* Sesi AE-63 phase2 P2.2 — semua 15 modal di-lazy-load dalam Suspense
       * boundary tunggal. fallback=null karena modal close = invisible (no
       * UI shift). Saat modal pertama dibuka, chunk fetch ~50-150ms one-time
       * lalu cached browser-side. Trade-off: defer ~100-150KB JS parse dari
       * initial POS load → tablet boot lebih cepat. */}
      <Suspense fallback={null}>

      {/* sesi AD-4 — Post-payment success owned by dedicated 2-column modal
       * instead of inline right-column panel. Receipt gets ~60% width for
       * legibility, action buttons (cetak tiket / selesai) get ~40% with
       * bigger tap targets. Right cart panel reverts to Idle so kasir can
       * start the next customer the moment they tap "Selesai". */}
      {rightPanel.kind === "paid" ? (
        <TransactionSuccessModal
          open
          trx={rightPanel.trx}
          cashierName={session!.user.name ?? "Kasir"}
          receiptConfig={receiptConfig}
          onFinish={handleFinishOrder}
          onOpenSettings={() => setTab("settings")}
        />
      ) : null}

      {/* Phase 3.1+3.2 — full-viewport PaymentModal overlay menggantikan
       * PayingPanel di kolom kanan. Cart tetap visible di balik modal supaya
       * cancel kembali ke state cart yang sama. Conditional render kalau
       * activeDraft ada — JSX inside PaymentModal accesses draft.items
       * eagerly saat element construction (sebelum Modal sempat early-return),
       * jadi kita harus pastikan draft tidak null. */}
      {activeDraft ? (
        <PaymentModal
          open={rightPanel.kind === "paying"}
          draft={activeDraft}
          subtotal={subtotal}
          discountAmount={discountAmount}
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
          /* Sesi AE-155 — open split builder modal (separate dari main flow). */
          onUseSplit={() => setSplitBuilderOpen(true)}
        />
      ) : null}

      {/* Sesi AE-155 — Split metode payment builder. */}
      {activeDraft ? (
        <Suspense fallback={null}>
          <SplitMethodBuilderModal
            open={splitBuilderOpen}
            total={total}
            submitting={paymentSubmitting}
            onCancel={() => setSplitBuilderOpen(false)}
            onConfirm={(splits) => {
              void handleProcessSplitPayment(splits);
            }}
          />
        </Suspense>
      ) : null}

      {/* Sesi AE-151 — close-bill modal triggered after Update + Bayar.
       * Sama modal yang dipakai OpenBillPanel "Bayar Sekarang" — di-lift
       * ke shell supaya bisa di-trigger dari cart flow tanpa user pindah
       * tab. onClosed → success modal print + refresh history; onClose →
       * batal payment, bill tetap sudah ter-update sebagai open. */}
      <Suspense fallback={null}>
        <CloseOpenBillModal
          open={billToCloseAfterUpdate !== null}
          bill={billToCloseAfterUpdate}
          cashierName={session?.user.name ?? "Kasir"}
          receiptConfig={receiptConfig}
          onClose={() => setBillToCloseAfterUpdate(null)}
          onClosed={(closedTrx) => {
            setBillToCloseAfterUpdate(null);
            setHistoryRefreshKey((k) => k + 1);
            setPrintConfirm({
              trx: closedTrx,
              title: "Pembayaran sukses",
            });
          }}
          onOpenSettings={() => setTab("settings")}
        />
      </Suspense>

      {/* sesi AD-7 — screen-blocking overlay during Save Bill / Update Bill
       * submission. Prevents kasir double-tapping the button while server
       * action in flight (could create duplicate open bill entries). Only
       * activated when payment modal is NOT showing (PaymentModal owns its
       * own submitting indicator). */}
      {paymentSubmitting && rightPanel.kind !== "paying" ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-neutral-900/30 backdrop-blur-sm"
          role="status"
          aria-live="polite"
          aria-label="Menyimpan bill"
        >
          <div className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-5 py-4 shadow-lg">
            <Spinner className="size-5 text-mahakan-green-700" />
            <p className="text-sm font-medium text-neutral-900">
              Menyimpan bill…
            </p>
          </div>
        </div>
      ) : null}

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
        modifiers={
          variantItem
            ? modifiersByCategory[variantItem.categoryId] ?? []
            : []
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
        isOwner={session?.user.role === "owner"}
        onClose={() => setComplimentModalOpen(false)}
        onApproved={handleComplimentApproved}
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
        cashierName={session.user.name ?? undefined}
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
          cashierName={session.user.name ?? "Kasir"}
          receiptConfig={receiptConfig}
          varianceThreshold={varianceThreshold}
          onClose={() => setCloseShiftOpen(false)}
          onClosed={async () => {
            setCloseShiftOpen(false);
            const res = await getActiveShift();
            if (isOk(res)) setShift(res.data);
          }}
          onOpenSettings={() => setTab("settings")}
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
      </Suspense>
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
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 max-sm:basis-full">
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
            className="w-44 shrink-0 max-sm:w-auto max-sm:flex-1"
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
  /** Sesi AE-151 — chain editOpenBill + immediately open CloseOpenBillModal.
   *  Hanya valid kalau editingBillId set (cek di caller). */
  onUpdateBillAndPay: () => void;
  onOpenRedeem: () => void;
  redeemLoading: boolean;
  /** sesi AD-7: drives loading state on Save Bill / Update Bill buttons,
   *  prevents double-submit while server action is in flight. */
  saveBillSubmitting: boolean;
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
  onUpdateBillAndPay,
  saveBillSubmitting,
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

        {/* Aksi lainnya — collapsed by default untuk hemat space.
            Sesi AE-154 — polish: dropdown arrow lebih clean dari label
            "Buka"/"Tutup" yg crammed. Active dot lebih besar (2px). */}
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          className="flex w-full items-center justify-between rounded-md border border-neutral-200 bg-white px-3 py-2 text-xs font-medium text-neutral-700 transition-colors hover:border-neutral-300 hover:bg-neutral-50"
        >
          <span className="flex items-center gap-2">
            <MoreHorizontal className="size-4 text-neutral-500" aria-hidden />
            <span>Aksi Lain</span>
            {(draft.billNote ||
              draft.discount ||
              (draft.loyaltyPointsRedeemed ?? 0) > 0) ? (
              <span
                className="size-2 rounded-full bg-mahakan-green-700"
                title="Ada catatan / diskon / poin aktif"
              />
            ) : null}
          </span>
          <ChevronDown
            className={cn(
              "size-4 text-neutral-400 transition-transform",
              moreOpen && "rotate-180",
            )}
            aria-hidden
          />
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
                loading={saveBillSubmitting}
                disabled={draft.items.length === 0 || saveBillSubmitting}
                fullWidth
              >
                <FileText className="size-3.5" aria-hidden />
                {saveBillSubmitting ? "Menyimpan…" : "Simpan sebagai Open Bill"}
              </Button>
            ) : null}
          </div>
        ) : null}

        {/* Primary action — always visible, big touch target.
            Sesi AE-154 — Staff feedback (post AE-151): "Update & Bayar Rp"
            overflow di tablet kasir. Refactor:
            - Primary "Bayar Sekarang" full-width prominent
            - "Update Bill saja" sebagai secondary action di bawah dengan
              variant ghost, lebih kecil. Stack vertical biar nggak crammed.
            - Total Rupiah TIDAK di tombol — sudah ada di "TOTAL" row di
              atas; redundant + bikin layout berat. */}
        {draft.editingBillId ? (
          <div className="space-y-1.5">
            <Button
              size="lg"
              onClick={onUpdateBillAndPay}
              loading={saveBillSubmitting}
              disabled={draft.items.length === 0 || saveBillSubmitting}
              fullWidth
            >
              <Banknote className="size-4" aria-hidden />
              {saveBillSubmitting ? "Memproses…" : "Bayar Sekarang"}
            </Button>
            {/* Sesi AE-157 — staff feedback: tombol harus visible (border +
                bg), bukan ghost yang terlihat hanya text. Pakai outline
                variant. Label simplified per staff request. */}
            <Button
              size="md"
              variant="outline"
              onClick={onSaveAsOpenBill}
              loading={saveBillSubmitting}
              disabled={draft.items.length === 0 || saveBillSubmitting}
              fullWidth
            >
              <FileText className="size-3.5" aria-hidden />
              {saveBillSubmitting ? "Menyimpan…" : "Update Bill (bayar nanti)"}
            </Button>
          </div>
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

// sesi AD-4 — PaidPanel removed; success state now owned by
// TransactionSuccessModal (dedicated 2-column popup). Right panel
// reverts to IdlePanel after payment so kasir can immediately start
// the next order.

// ============================================================================
// Tiny helpers
// ============================================================================

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


