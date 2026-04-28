"use client";

import { useEffect, useMemo, useState } from "react";
import { Eye, Plus, Trash2, Wifi } from "lucide-react";
import {
  Button,
  Input,
  Modal,
  toast,
} from "@/components/ui";
import {
  isOk,
  updateReceiptSettings,
  type Outlet,
} from "@/features/outlets";

interface Props {
  open: boolean;
  outlet: Outlet;
  onClose: () => void;
  onSaved: (next: Outlet) => void;
}

const MAX_LINES = 3;
const MAX_LINE_LENGTH = 64;
const MAX_FOOTER_LENGTH = 200;

/**
 * Advanced receipt editor — edit struk customer secara komprehensif:
 * - Header lines (promo banner di atas nama outlet)
 * - Footer text (existing)
 * - WiFi credentials (SSID + password)
 * - Extra footer lines (catatan tambahan / IG handle / dll)
 *
 * Live monospace preview di kanan supaya owner/manager bisa lihat hasil
 * sebelum simpan. Owner + Manager dua-duanya bisa edit (RBAC
 * `settings.receipt.update` granted ke ["owner", "manager"]).
 */
export function ReceiptEditorModal({ open, outlet, onClose, onSaved }: Props) {
  const initial = useMemo(
    () => ({
      headerLines: outlet.settings?.receipt?.headerLines ?? [],
      footerText:
        outlet.settings?.receipt?.footerText ?? "Terima kasih, sampai jumpa!",
      extraFooterLines: outlet.settings?.receipt?.extraFooterLines ?? [],
      wifiSsid: outlet.settings?.receipt?.wifiSsid ?? "",
      wifiPassword: outlet.settings?.receipt?.wifiPassword ?? "",
    }),
    [outlet.settings?.receipt],
  );

  const [headerLines, setHeaderLines] = useState<string[]>(initial.headerLines);
  const [footer, setFooter] = useState(initial.footerText);
  const [extraLines, setExtraLines] = useState<string[]>(
    initial.extraFooterLines,
  );
  const [wifiSsid, setWifiSsid] = useState(initial.wifiSsid);
  const [wifiPassword, setWifiPassword] = useState(initial.wifiPassword);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setHeaderLines(initial.headerLines);
    setFooter(initial.footerText);
    setExtraLines(initial.extraFooterLines);
    setWifiSsid(initial.wifiSsid);
    setWifiPassword(initial.wifiPassword);
    setError(null);
    setSubmitting(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, initial]);

  function addHeaderLine() {
    if (headerLines.length >= MAX_LINES) return;
    setHeaderLines([...headerLines, ""]);
  }
  function removeHeaderLine(idx: number) {
    setHeaderLines(headerLines.filter((_, i) => i !== idx));
  }
  function setHeaderLine(idx: number, val: string) {
    setHeaderLines(
      headerLines.map((l, i) => (i === idx ? val.slice(0, MAX_LINE_LENGTH) : l)),
    );
  }
  function addExtraLine() {
    if (extraLines.length >= MAX_LINES) return;
    setExtraLines([...extraLines, ""]);
  }
  function removeExtraLine(idx: number) {
    setExtraLines(extraLines.filter((_, i) => i !== idx));
  }
  function setExtraLine(idx: number, val: string) {
    setExtraLines(
      extraLines.map((l, i) => (i === idx ? val.slice(0, MAX_LINE_LENGTH) : l)),
    );
  }

  async function onSubmit() {
    if (submitting) return;
    if (footer.trim().length > MAX_FOOTER_LENGTH) {
      setError("Footer maks 200 karakter");
      return;
    }
    setSubmitting(true);
    setError(null);
    const res = await updateReceiptSettings({
      footerText: footer.trim(),
      headerLines: headerLines.map((l) => l.trim()).filter((l) => l.length > 0),
      extraFooterLines: extraLines
        .map((l) => l.trim())
        .filter((l) => l.length > 0),
      wifiSsid: wifiSsid.trim(),
      wifiPassword: wifiPassword.trim(),
    });
    if (!isOk(res)) {
      setError(res.error.message);
      setSubmitting(false);
      return;
    }
    toast.success("Format struk diperbarui");
    setSubmitting(false);
    onSaved(res.data);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit Format Struk"
      description="Atur header promo, footer, WiFi info, dan baris tambahan yang muncul di struk customer."
      size="3xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button onClick={onSubmit} loading={submitting}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        {/* Form column */}
        <div className="space-y-6">
          <Section
            title="Header Promo (opsional)"
            hint={`Maks ${MAX_LINES} baris di atas nama outlet — cocok buat promo/event banner.`}
          >
            {headerLines.length === 0 ? (
              <EmptyAdd onAdd={addHeaderLine} label="Tambah baris header" />
            ) : (
              <div className="space-y-2">
                {headerLines.map((line, idx) => (
                  <LineRow
                    key={idx}
                    value={line}
                    onChange={(v) => setHeaderLine(idx, v)}
                    onRemove={() => removeHeaderLine(idx)}
                    placeholder="mis. PROMO Akhir Tahun! Diskon 10%"
                  />
                ))}
                {headerLines.length < MAX_LINES ? (
                  <Button size="sm" variant="outline" onClick={addHeaderLine}>
                    <Plus className="size-4" aria-hidden /> Tambah baris
                  </Button>
                ) : null}
              </div>
            )}
          </Section>

          <Section
            title="Footer Text"
            hint="Kalimat utama di bawah daftar item — defaultnya 'Terima kasih, sampai jumpa!'"
          >
            <Input
              value={footer}
              onChange={(e) => setFooter(e.target.value)}
              maxLength={MAX_FOOTER_LENGTH}
              placeholder="Terima kasih, sampai jumpa!"
              hint={`${footer.length}/${MAX_FOOTER_LENGTH} karakter`}
            />
          </Section>

          <Section
            title="Info WiFi (opsional)"
            hint="Tampil di bagian footer struk — biar customer langsung connect tanpa nanya."
            icon={<Wifi className="size-4" aria-hidden />}
          >
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                label="SSID / Nama WiFi"
                value={wifiSsid}
                onChange={(e) => setWifiSsid(e.target.value.slice(0, 48))}
                placeholder="MAHAKAN-WIFI"
              />
              <Input
                label="Password"
                value={wifiPassword}
                onChange={(e) => setWifiPassword(e.target.value.slice(0, 48))}
                placeholder="contoh: kopi12345"
              />
            </div>
            <p className="mt-1 text-xs text-neutral-500">
              Kosongkan SSID kalau tidak mau cetak info WiFi.
            </p>
          </Section>

          <Section
            title="Baris Tambahan Footer (opsional)"
            hint={`Maks ${MAX_LINES} baris setelah footer — IG handle, alamat website, jam operasional, dll.`}
          >
            {extraLines.length === 0 ? (
              <EmptyAdd onAdd={addExtraLine} label="Tambah baris tambahan" />
            ) : (
              <div className="space-y-2">
                {extraLines.map((line, idx) => (
                  <LineRow
                    key={idx}
                    value={line}
                    onChange={(v) => setExtraLine(idx, v)}
                    onRemove={() => removeExtraLine(idx)}
                    placeholder="mis. IG: @mahakan.coffee"
                  />
                ))}
                {extraLines.length < MAX_LINES ? (
                  <Button size="sm" variant="outline" onClick={addExtraLine}>
                    <Plus className="size-4" aria-hidden /> Tambah baris
                  </Button>
                ) : null}
              </div>
            )}
          </Section>

          {error ? (
            <p
              role="alert"
              className="rounded-md bg-danger-100 p-2 text-sm text-danger-500"
            >
              {error}
            </p>
          ) : null}
        </div>

        {/* Preview column */}
        <aside className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            <Eye className="size-3.5" aria-hidden /> Live Preview (32 kolom)
          </div>
          <ReceiptPreview
            outletName={outlet.name}
            outletAddress={outlet.address}
            outletPhone={outlet.phone}
            headerLines={headerLines}
            footerText={footer}
            extraLines={extraLines}
            wifiSsid={wifiSsid}
            wifiPassword={wifiPassword}
          />
          <p className="mt-2 text-[11px] text-neutral-500">
            Preview pakai data sample. Header outlet (nama/alamat/telepon) di-edit
            di kartu Business Info — Owner only.
          </p>
        </aside>
      </div>
    </Modal>
  );
}

function Section({
  title,
  hint,
  icon,
  children,
}: {
  title: string;
  hint?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-neutral-900">
          {icon}
          {title}
        </h3>
        {hint ? <p className="text-xs text-neutral-500">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function LineRow({
  value,
  onChange,
  onRemove,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onRemove: () => void;
  placeholder: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        hint={`${value.length}/${MAX_LINE_LENGTH}`}
        className="!h-9"
      />
      <Button
        size="sm"
        variant="ghost"
        onClick={onRemove}
        aria-label="Hapus baris"
        className="!size-9 !min-h-9 !p-0 text-danger-500 hover:bg-danger-100"
      >
        <Trash2 className="size-4" aria-hidden />
      </Button>
    </div>
  );
}

function EmptyAdd({ onAdd, label }: { onAdd: () => void; label: string }) {
  return (
    <Button size="sm" variant="outline" onClick={onAdd}>
      <Plus className="size-4" aria-hidden /> {label}
    </Button>
  );
}

interface PreviewProps {
  outletName: string;
  outletAddress: string | null;
  outletPhone: string | null;
  headerLines: string[];
  footerText: string;
  extraLines: string[];
  wifiSsid: string;
  wifiPassword: string;
}

function ReceiptPreview({
  outletName,
  outletAddress,
  outletPhone,
  headerLines,
  footerText,
  extraLines,
  wifiSsid,
  wifiPassword,
}: PreviewProps) {
  const COLS = 32;
  const center = (s: string) => {
    if (s.length >= COLS) return s.slice(0, COLS);
    const pad = Math.floor((COLS - s.length) / 2);
    return " ".repeat(pad) + s;
  };
  const dual = (l: string, r: string) => {
    const pad = Math.max(1, COLS - l.length - r.length);
    return l + " ".repeat(pad) + r;
  };
  const div = (ch: string) => ch.repeat(COLS);

  const lines: string[] = [];
  for (const h of headerLines.filter((l) => l.trim().length > 0)) {
    lines.push(center(h.trim()));
  }
  if (headerLines.filter((l) => l.trim().length > 0).length > 0) lines.push("");
  lines.push(center(outletName));
  if (outletAddress) {
    if (outletAddress.length <= COLS) lines.push(center(outletAddress));
    else {
      lines.push(center(outletAddress.slice(0, COLS - 1)));
      lines.push(center(outletAddress.slice(COLS - 1, COLS * 2 - 2)));
    }
  }
  if (outletPhone) lines.push(center(outletPhone));
  lines.push(div("="));
  lines.push("No   : TRX-20260428-0001");
  lines.push("Tgl  : 28/04/2026 22:30 WIB");
  lines.push("Pager 1 | Dine-in");
  lines.push("Kasir: Sample");
  lines.push(div("-"));
  lines.push("1x Iced Americano (Iced)");
  lines.push("  @Rp 16.000 x 1         Rp 16.000");
  lines.push(div("-"));
  lines.push(dual("Subtotal", "Rp 16.000"));
  lines.push(dual("TOTAL", "Rp 16.000"));
  lines.push(div("-"));
  lines.push(dual("TUNAI", "Rp 20.000"));
  lines.push(dual("KEMBALI", "Rp 4.000"));

  const trimmedFooter = footerText.trim();
  const trimmedExtras = extraLines.filter((l) => l.trim().length > 0);
  const trimmedSsid = wifiSsid.trim();
  const hasFooterBlock =
    trimmedFooter.length > 0 || trimmedSsid.length > 0 || trimmedExtras.length > 0;
  if (hasFooterBlock) {
    lines.push(div("="));
    if (trimmedFooter) lines.push(center(trimmedFooter));
    if (trimmedSsid) {
      lines.push("");
      lines.push(center("WiFi"));
      lines.push(center(`SSID: ${trimmedSsid}`));
      if (wifiPassword.trim()) lines.push(center(`Password: ${wifiPassword.trim()}`));
    }
    if (trimmedExtras.length > 0) {
      lines.push("");
      for (const l of trimmedExtras) lines.push(center(l.trim()));
    }
  }

  return (
    <pre className="overflow-x-auto rounded bg-white p-3 text-[10px] leading-relaxed text-neutral-900">
      {lines.join("\n")}
    </pre>
  );
}
