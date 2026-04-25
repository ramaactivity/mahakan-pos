"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Percent, Search, ShoppingCart, X } from "lucide-react";
import {
  Badge,
  Button,
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
import { isOk, menuService } from "@/mocks/services";
import type { Category, MenuItem } from "@/mocks/types";
import type { Discount } from "@/lib/money";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

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

  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  const [activeCategory, setActiveCategory] = useState<string | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Modal state
  const [variantItem, setVariantItem] = useState<MenuItem | null>(null);
  const [openPriceItem, setOpenPriceItem] = useState<MenuItem | null>(null);
  const [noteEditingId, setNoteEditingId] = useState<string | null>(null);
  const [discountModalOpen, setDiscountModalOpen] = useState(false);
  const [approverOpen, setApproverOpen] = useState(false);
  const [pendingDiscount, setPendingDiscount] = useState<{
    discount: Discount;
    reason: string;
  } | null>(null);

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
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

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

  function handleItemTap(item: MenuItem) {
    if (item.isSoldOut) return;
    if (item.priceType === "open") {
      setOpenPriceItem(item);
      return;
    }
    if (item.priceType === "variant") {
      setVariantItem(item);
      return;
    }
    // fixed → check applicable modifiers (sugar/extra_topping_ayam)
    // For Phase 1 Bakmie has extra_topping_ayam, others may need sugar (drinks).
    // Show modifier modal if applicable; else add direct.
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
    // Staff → need approver
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

  const editingNoteItem = noteEditingId
    ? draft.items.find((i) => i.cartItemId === noteEditingId)
    : null;

  return (
    <div className="-mx-4 sm:-mx-6 -mt-4 sm:-mt-6 grid h-[calc(100vh-4rem)] grid-cols-1 lg:grid-cols-[1fr_400px]">
      {/* MENU AREA */}
      <section className="flex flex-col overflow-hidden border-b lg:border-b-0 lg:border-r border-neutral-200">
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
          {loading ? (
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
                  onSelect={handleItemTap}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* CART SIDEBAR */}
      <aside className="flex flex-col overflow-hidden bg-white">
        <header className="flex items-center justify-between border-b border-neutral-200 p-4">
          <h2 className="flex items-center gap-2 text-base font-semibold text-neutral-900">
            <ShoppingCart className="size-5" aria-hidden /> Order Aktif
          </h2>
          <button
            type="button"
            onClick={() => {
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
                onQuantityChange={(id, qty) =>
                  updateQuantity(draftId, id, qty)
                }
                onRemove={(id) => removeItem(draftId, id)}
                onEditNote={(id) => setNoteEditingId(id)}
              />
            ))
          )}
        </div>

        <footer className="border-t border-neutral-200 bg-neutral-50 p-4 space-y-3">
          <Row
            label="Subtotal"
            value={formatRupiah(subtotal)}
            muted
          />
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
            <Row
              label="TOTAL"
              value={formatRupiah(total)}
              bold
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setDiscountModalOpen(true)}
              disabled={draft.items.length === 0}
              fullWidth
            >
              <Percent className="size-4" aria-hidden /> Diskon
            </Button>
            <Button
              size="lg"
              onClick={() => router.push(`/pos/order/${draftId}/payment`)}
              disabled={draft.items.length === 0}
              fullWidth
            >
              Bayar
            </Button>
          </div>
        </footer>
      </aside>

      {/* MODALS */}
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
