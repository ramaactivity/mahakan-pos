"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Coffee, Heart, Mail, Search } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Input,
  Modal,
  PinPad,
  QuantityStepper,
  Spinner,
  toast,
} from "@/components/ui";
import { formatRupiah, formatPercent } from "@/lib/format";

export default function DesignSystemShowcase() {
  const [modalOpen, setModalOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [qty, setQty] = useState(1);
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");

  return (
    <main className="mx-auto max-w-6xl space-y-12 p-6 md:p-10">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-neutral-600 transition hover:text-mahakan-green-700"
      >
        <ArrowLeft className="size-4" aria-hidden /> Kembali ke beranda
      </Link>
      <header className="space-y-3">
        <Badge variant="signature">
          <Heart className="size-3" /> Design System
        </Badge>
        <h1 className="text-3xl font-bold text-mahakan-green-900">
          Mahakan POS — UI Showcase
        </h1>
        <p className="max-w-2xl text-neutral-700">
          Visual reference untuk base components Phase 1. Verifikasi warna sage
          green, tipografi Inter + JetBrains Mono, dan state interaksi semua
          komponen.
        </p>
        <div className="flex flex-wrap gap-2 pt-2">
          <Link
            href="/login"
            className="inline-flex items-center gap-1 rounded-md bg-mahakan-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-mahakan-green-800"
          >
            Coba Login (Owner/Manager)
          </Link>
          <Link
            href="/pin"
            className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-100"
          >
            Coba PIN (Staff)
          </Link>
        </div>
      </header>

      {/* ============================================================== */}
      <Section title="1. Palette" subtitle="Mahakan sage green (derived from logo #539371)">
        <div className="grid grid-cols-6 gap-2 md:grid-cols-11">
          {PALETTE_SWATCHES.map(({ shade, className }) => (
            <div key={shade} className="space-y-1">
              <div
                className={`h-14 rounded-md border border-neutral-200 ${className}`}
              />
              <p className="text-center font-mono text-xs text-neutral-700">
                {shade}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-sm text-neutral-500">
          <span className="font-semibold text-neutral-900">600</span> = logo
          color (decorative). <span className="font-semibold text-neutral-900">700</span> =
          action color (WCAG AA). <span className="font-semibold text-neutral-900">900</span> =
          headings (WCAG AAA).
        </p>
      </Section>

      {/* ============================================================== */}
      <Section title="2. Typography" subtitle="Inter (UI) + JetBrains Mono (amounts, codes)">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold text-neutral-900">
            Display 4xl / Bold
          </h1>
          <h2 className="text-3xl font-bold text-neutral-900">
            Heading 3xl / Bold
          </h2>
          <h3 className="text-2xl font-semibold text-neutral-900">
            Heading 2xl / Semibold
          </h3>
          <h4 className="text-xl font-semibold text-neutral-900">
            Heading xl / Semibold
          </h4>
          <p className="text-base text-neutral-900">
            Body base — Selamat datang di Mahakan Coffee &amp; Space, homely
            space untuk semua.
          </p>
          <p className="text-sm text-neutral-700">
            Body sm secondary — catatan, helper text, metadata tambahan.
          </p>
          <p className="text-xs text-neutral-500">
            Caption xs — timestamp, atribusi, tag kecil.
          </p>
          <p className="font-mono text-lg font-semibold text-neutral-900">
            Monospace — Rp 1.250.000 · TRX-20260424-0042
          </p>
        </div>
      </Section>

      {/* ============================================================== */}
      <Section title="3. Buttons" subtitle="5 variants × 4 sizes">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm">Small</Button>
            <Button size="md">Medium</Button>
            <Button size="lg">Large</Button>
            <Button size="xl" variant="primary">
              <Coffee className="size-5" />
              XL (POS Primary Action)
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button loading>Loading…</Button>
            <Button disabled>Disabled</Button>
            <Button
              onClick={() => toast.success("Klik berhasil!", {
                description: "Toast muncul dari pojok kanan atas.",
              })}
            >
              Trigger Toast Success
            </Button>
            <Button
              variant="destructive"
              onClick={() => toast.error("Terjadi kesalahan", {
                description: "Contoh error toast dengan aksi.",
                action: { label: "Coba Lagi", onClick: () => {} },
              })}
            >
              Trigger Toast Error
            </Button>
          </div>
        </div>
      </Section>

      {/* ============================================================== */}
      <Section title="4. Inputs">
        <div className="grid max-w-2xl gap-4 md:grid-cols-2">
          <Input
            label="Email"
            type="email"
            placeholder="owner@mahakan.id"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailError("");
            }}
            onBlur={() => {
              if (email && !/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
                setEmailError("Format email tidak valid");
              }
            }}
            error={emailError}
            hint="Masukkan email yang terdaftar"
            leadingIcon={<Mail className="size-4" aria-hidden />}
          />
          <Input
            label="Pencarian menu"
            placeholder="Cari Americano…"
            leadingIcon={<Search className="size-4" aria-hidden />}
          />
          <Input label="Nominal kas awal" placeholder="100.000" inputMode="numeric" />
          <Input label="Nama barista" disabled placeholder="Disabled" />
        </div>
      </Section>

      {/* ============================================================== */}
      <Section title="5. Cards">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card variant="default">
            <CardHeader>
              <CardTitle>Default</CardTitle>
              <CardDescription>Standard surface, most use cases.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-neutral-700">
                Card content. Gunakan buat group related info.
              </p>
            </CardContent>
          </Card>
          <Card variant="interactive">
            <CardHeader>
              <CardTitle>Interactive</CardTitle>
              <CardDescription>Hover-enabled, tappable.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-neutral-700">Click-ish variant untuk list item.</p>
            </CardContent>
          </Card>
          <Card variant="flat">
            <CardHeader>
              <CardTitle>Flat</CardTitle>
              <CardDescription>No shadow, nested contexts.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-neutral-700">Dipakai inside modal/card lain.</p>
            </CardContent>
          </Card>
          <Card variant="emphasis">
            <CardHeader>
              <CardTitle>Emphasis</CardTitle>
              <CardDescription>Brand-tinted, featured content.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-mahakan-green-900">
                Buat featured info / announcement.
              </p>
            </CardContent>
            <CardFooter>
              <Button size="sm" variant="ghost">
                Tutup
              </Button>
              <Button size="sm">Lihat</Button>
            </CardFooter>
          </Card>
        </div>
      </Section>

      {/* ============================================================== */}
      <Section title="6. Badges">
        <div className="flex flex-wrap gap-2">
          <Badge variant="paid">Lunas</Badge>
          <Badge variant="voided">Dibatalkan</Badge>
          <Badge variant="refunded">Refund</Badge>
          <Badge variant="sold-out">Habis</Badge>
          <Badge variant="signature">
            <Heart className="size-3" /> Signature
          </Badge>
          <Badge variant="open-price">Harga Manual</Badge>
          <Badge variant="success">Success</Badge>
          <Badge variant="warning">Warning</Badge>
          <Badge variant="danger">Danger</Badge>
          <Badge variant="info">Info</Badge>
          <Badge variant="neutral">Neutral</Badge>
        </div>
      </Section>

      {/* ============================================================== */}
      <Section title="7. Modal">
        <Button onClick={() => setModalOpen(true)}>Buka Modal Demo</Button>
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title="Void Transaksi?"
          description="Transaksi akan ditandai dibatalkan dan tidak masuk laporan penjualan."
          footer={
            <>
              <Button variant="ghost" onClick={() => setModalOpen(false)}>
                Batal
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  setModalOpen(false);
                  toast.success("Transaksi dibatalkan");
                }}
              >
                Ya, Void
              </Button>
            </>
          }
        >
          <div className="space-y-3 text-sm text-neutral-700">
            <p>TRX-20260424-0042 · Pager 5 · Takeaway</p>
            <p className="font-mono text-base">
              Total: {formatRupiah(77400)}
            </p>
            <p>Aksi ini tidak bisa di-undo.</p>
          </div>
        </Modal>
      </Section>

      {/* ============================================================== */}
      <Section title="8. PinPad" subtitle="Untuk login staff (tablet POS)">
        <Card variant="flat" className="max-w-xs">
          <CardHeader>
            <CardTitle>Masukkan PIN</CardTitle>
            <CardDescription>
              Input: <span className="font-mono text-base">{"•".repeat(pin.length) || "—"}</span>
            </CardDescription>
          </CardHeader>
          <PinPad value={pin} onChange={setPin} maxLength={6} />
        </Card>
      </Section>

      {/* ============================================================== */}
      <Section title="9. QuantityStepper" subtitle="Untuk cart line item">
        <div className="flex items-center gap-4">
          <QuantityStepper value={qty} onChange={setQty} min={0} max={20} />
          <span className="text-sm text-neutral-700">
            Subtotal:{" "}
            <span className="font-mono font-semibold text-neutral-900">
              {formatRupiah(qty * 23000)}
            </span>
            <span className="text-neutral-500">
              {" "}({formatPercent(10)} discount preview ≈ {formatRupiah(Math.round(qty * 23000 * 0.1))})
            </span>
          </span>
        </div>
      </Section>

      {/* ============================================================== */}
      <Section title="10. Spinner">
        <div className="flex items-center gap-6">
          <Spinner className="size-4 text-mahakan-green-700" />
          <Spinner className="size-6 text-mahakan-green-700" />
          <Spinner className="size-8 text-mahakan-green-700" />
          <Spinner className="size-10 text-mahakan-green-700" />
        </div>
      </Section>

      <footer className="border-t border-neutral-200 pt-6 text-sm text-neutral-500">
        M2 — Design System Foundation · Phase 1 Fase A · Mahakan Coffee &amp; Space
      </footer>
    </main>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-neutral-900">{title}</h2>
        {subtitle ? (
          <p className="text-sm text-neutral-500">{subtitle}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

// Static palette mapping — Tailwind JIT requires literal class names.
const PALETTE_SWATCHES = [
  { shade: 50, className: "bg-mahakan-green-50" },
  { shade: 100, className: "bg-mahakan-green-100" },
  { shade: 200, className: "bg-mahakan-green-200" },
  { shade: 300, className: "bg-mahakan-green-300" },
  { shade: 400, className: "bg-mahakan-green-400" },
  { shade: 500, className: "bg-mahakan-green-500" },
  { shade: 600, className: "bg-mahakan-green-600" },
  { shade: 700, className: "bg-mahakan-green-700" },
  { shade: 800, className: "bg-mahakan-green-800" },
  { shade: 900, className: "bg-mahakan-green-900" },
  { shade: 950, className: "bg-mahakan-green-950" },
] as const;
