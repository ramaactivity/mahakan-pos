"use client";

import { useRef, useState } from "react";
import { FileText, ImagePlus, Loader2, Plus, X } from "lucide-react";
import { Button, toast } from "@/components/ui";

export interface PurchaseReceipt {
  url: string;
  name: string;
}

export const MAX_PURCHASE_RECEIPTS = 5;

interface PurchaseReceiptsFieldProps {
  value: PurchaseReceipt[];
  onChange: (updater: (prev: PurchaseReceipt[]) => PurchaseReceipt[]) => void;
  /** Tanggal nota — menentukan folder tahun/bulan di Google Drive. */
  purchaseDate: string;
  /** Form sedang submit — kunci tombol upload/hapus. */
  disabled?: boolean;
  label?: string;
  /** Kalau diisi, error upload dilempar ke parent (bukan toast). */
  onError?: (message: string) => void;
}

/**
 * Sesi AE-209 — kolom "Bukti Pembelian / Transfer" yang dipakai bersama oleh
 * Catat Pembelian dan Edit PO.
 *
 * Sebelumnya blok ini hanya ada di Catat Pembelian, jadi nota yang datang
 * BELAKANGAN (alur normal Mahakan: PO dibuat dulu harga Rp 0, notanya
 * menyusul) tidak punya tempat menempel — padahal kolomnya sudah tersimpan
 * di PO (`receiptImageUrls`) dan sudah ikut terkirim saat Edit PO disimpan.
 * Dijadikan satu komponen supaya aturan uploadnya (maks 5 file, 5 MB,
 * JPG/PNG/WebP/PDF, folder NOTA MAHAKAN → tahun → bulan) tidak bercabang.
 */
export function PurchaseReceiptsField({
  value,
  onChange,
  purchaseDate,
  disabled = false,
  label = "Bukti Pembelian / Transfer (opsional)",
  onError,
}: PurchaseReceiptsFieldProps) {
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reportError(message: string) {
    if (onError) onError(message);
    else toast.error(message);
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label className="block text-sm font-medium text-neutral-900">
          {label}
        </label>
        {value.length > 0 ? (
          <span className="text-xs text-neutral-500">
            {value.length} / {MAX_PURCHASE_RECEIPTS} nota
          </span>
        ) : null}
      </div>

      {/* Daftar bukti yang sudah menempel. Tiap baris: buka file + hapus. */}
      {value.length > 0 ? (
        <ul className="space-y-1.5">
          {value.map((r, idx) => (
            <li
              key={`${r.url}-${idx}`}
              className="flex items-center justify-between gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-2"
            >
              <a
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-w-0 flex-1 items-center gap-2 text-xs text-mahakan-green-900 hover:underline"
              >
                <FileText className="size-4 shrink-0" />
                <span className="truncate">{r.name}</span>
              </a>
              <button
                type="button"
                onClick={() => onChange((prev) => prev.filter((_, i) => i !== idx))}
                disabled={disabled || uploading}
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-neutral-500 hover:bg-danger-100 hover:text-danger-500"
                aria-label={`Hapus nota ${idx + 1} dari form (file tetap di Drive)`}
                title="Hapus dari form. File yang sudah di Drive tidak ikut terhapus — hapus manual via Drive kalau perlu."
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {value.length < MAX_PURCHASE_RECEIPTS ? (
        <div className="rounded-md border border-dashed border-neutral-300 bg-neutral-50/50 p-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setUploading(true);
              try {
                if (file.size > 5 * 1024 * 1024) {
                  throw new Error("Ukuran maks 5 MB");
                }
                // Server yang urus auth + bikin folder tahun/bulan mengikuti
                // struktur NOTA MAHAKAN milik Owner (sesi AA #2 Opsi B).
                const fd = new FormData();
                fd.append("file", file);
                fd.append("purchaseDate", purchaseDate);
                const res = await fetch("/api/v1/purchase-receipts/upload", {
                  method: "POST",
                  body: fd,
                });
                const json = (await res.json()) as
                  | { success: true; data: { url: string; folderPath: string } }
                  | { success: false; error: { code: string; message: string } };
                if (!json.success) throw new Error(json.error.message);
                /* Cap defensif juga di sini — kalau user double-tap saat sudah
                 * ada 4 di daftar, tetap ter-clamp. */
                onChange((prev) =>
                  prev.length >= MAX_PURCHASE_RECEIPTS
                    ? prev
                    : [...prev, { url: json.data.url, name: file.name }],
                );
                toast.success(
                  `Bukti tersimpan di Drive · ${json.data.folderPath}`,
                );
              } catch (err) {
                reportError(err instanceof Error ? err.message : "Upload gagal");
              } finally {
                setUploading(false);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || disabled}
          >
            {uploading ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Uploading…
              </>
            ) : value.length > 0 ? (
              <>
                <Plus className="size-4" /> Tambah Nota Lain
              </>
            ) : (
              <>
                <ImagePlus className="size-4" /> Upload Foto / PDF
              </>
            )}
          </Button>
          <p className="mt-1 text-xs text-neutral-500">
            JPG / PNG / WebP / PDF, max 5 MB per file. Bisa upload sampai{" "}
            <strong>{MAX_PURCHASE_RECEIPTS} nota</strong> (mis. belanja dari
            beberapa toko). Tersimpan otomatis di Google Drive Anda — folder{" "}
            <strong>NOTA MAHAKAN</strong> → tahun → bulan, sesuai struktur lama.
          </p>
        </div>
      ) : (
        <p className="rounded-md border border-info-200 bg-info-50 p-2 text-xs text-info-700">
          Sudah {MAX_PURCHASE_RECEIPTS} nota — hapus salah satu kalau mau ganti.
        </p>
      )}
    </div>
  );
}
