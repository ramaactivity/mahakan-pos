"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Eye, EyeOff } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Modal,
  toast,
} from "@/components/ui";
import { isOk, updateBooksCutoff, type Outlet } from "@/features/outlets";

/**
 * Sesi AE-207 — kartu BATAS BUKU.
 *
 * Owner bisa menyalakan/mematikan sendiri tanpa developer. Ini penting: data
 * lama hanya DISEMBUNYIKAN, jadi tombol "Tampilkan semua data lagi" adalah
 * jalan keluar resmi kalau suatu saat butuh nota / laporan lama (audit, pajak).
 */
export function BooksCutoffCard({
  outlet,
  onSaved,
}: {
  outlet: Outlet;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const current = outlet.settings?.booksCutoff ?? null;
  const activeDate = current?.date ?? null;

  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(activeDate ?? "");
  const [opnameDate, setOpnameDate] = useState(current?.opnameDate ?? "");
  const [submitting, setSubmitting] = useState(false);

  async function save(nextDate: string | null) {
    if (submitting) return;
    setSubmitting(true);
    const res = await updateBooksCutoff(
      nextDate
        ? { date: nextDate, opnameDate: opnameDate || null }
        : { date: null },
    );
    setSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(
      nextDate
        ? `Buku dimulai ${formatTanggal(nextDate)}. Data sebelumnya disembunyikan.`
        : "Semua data lama ditampilkan kembali.",
    );
    setOpen(false);
    onSaved();
    // Angka di semua halaman berubah — segarkan seluruh cache admin.
    void queryClient.invalidateQueries();
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <CalendarClock className="h-5 w-5" aria-hidden />
                Batas Buku
              </CardTitle>
              <CardDescription>
                Mulai pencatatan bersih dari tanggal tertentu. Data sebelumnya
                cuma disembunyikan — tidak ada yang dihapus.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDate(activeDate ?? "");
                setOpnameDate(current?.opnameDate ?? "");
                setOpen(true);
              }}
            >
              Ubah
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {activeDate ? (
            <>
              <div className="flex items-center gap-2 rounded-lg bg-mahakan-green-50 px-3 py-2 text-sm">
                <EyeOff
                  className="h-4 w-4 shrink-0 text-mahakan-green-700"
                  aria-hidden
                />
                <span>
                  Buku dimulai{" "}
                  <strong>{formatTanggal(activeDate)}</strong> — Jurnal, Neraca,
                  Laba Rugi, Pembelian, Kas, dan Permintaan Belanja sebelum
                  tanggal ini tidak ditampilkan.
                </span>
              </div>
              {current?.opnameDate && current.opnameDate !== activeDate && (
                <p className="text-xs text-neutral-600">
                  Opname punya batas sendiri{" "}
                  <strong>{formatTanggal(current.opnameDate)}</strong> — sesi
                  opname akhir bulan sebelum cutoff sengaja tetap ditampilkan
                  karena itu stok awal periode baru.
                </p>
              )}
              <p className="text-xs text-neutral-600">
                Riwayat penjualan &amp; laporan menu TIDAK ikut disembunyikan.
                Nota yang belum dibayar juga tetap tampil di daftar hutang
                walaupun tanggalnya lebih tua.
              </p>
              <Button
                variant="outline"
                size="sm"
                disabled={submitting}
                onClick={() => void save(null)}
              >
                <Eye className="mr-1.5 h-4 w-4" aria-hidden />
                Tampilkan semua data lagi
              </Button>
            </>
          ) : (
            <p className="text-sm text-neutral-700">
              Belum aktif — semua data sejak awal ditampilkan.
            </p>
          )}
        </CardContent>
      </Card>

      <Modal
        open={open}
        onClose={() => !submitting && setOpen(false)}
        title="Batas Buku"
      >
        <div className="space-y-4">
          <label className="block space-y-1">
            <span className="text-sm font-medium">Buku dimulai tanggal</span>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <span className="block text-xs text-neutral-600">
              Kosongkan untuk mematikan batas buku (semua data lama muncul
              lagi).
            </span>
          </label>

          <label className="block space-y-1">
            <span className="text-sm font-medium">
              Batas khusus Opname{" "}
              <span className="font-normal text-neutral-500">(opsional)</span>
            </span>
            <Input
              type="date"
              value={opnameDate}
              onChange={(e) => setOpnameDate(e.target.value)}
            />
            <span className="block text-xs text-neutral-600">
              Isi tanggal LEBIH TUA dari batas buku supaya sesi opname akhir
              bulan sebelumnya tetap tampil. Sesi itu dipakai sebagai stok awal
              — kalau ikut disembunyikan, laporan pemakaian bahan periode baru
              jadi salah (pemakaian terbaca sebesar seluruh pembelian).
            </span>
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Batal
            </Button>
            <Button
              onClick={() => void save(date || null)}
              disabled={submitting}
            >
              {submitting ? "Menyimpan…" : "Simpan"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function formatTanggal(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const bulan = [
    "Januari",
    "Februari",
    "Maret",
    "April",
    "Mei",
    "Juni",
    "Juli",
    "Agustus",
    "September",
    "Oktober",
    "November",
    "Desember",
  ];
  return `${d} ${bulan[m - 1]} ${y}`;
}
