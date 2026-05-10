"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Modal,
  toast,
} from "@/components/ui";
import { isOk, resetMockupData } from "@/features/system";

const CONFIRM_PHRASE = "RESET DATA TRIAL";

/**
 * Sesi AE-32 — Owner-only nuclear reset untuk transition mockup → trial.
 * Hapus semua data operasional (transaksi, absen, shift, dll) tapi
 * preserve master (menu, bahan, supplier, employees, dll).
 *
 * Confirm-by-type "RESET DATA TRIAL" supaya gak ke-tap accidental.
 */
export function ResetMockupDataCard() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Record<string, number> | null>(null);

  function close() {
    if (submitting) return;
    setOpen(false);
    setConfirmText("");
    setResult(null);
  }

  async function onConfirm() {
    if (submitting) return;
    if (confirmText.trim().toUpperCase() !== CONFIRM_PHRASE) return;
    setSubmitting(true);
    const res = await resetMockupData();
    setSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(`Reset selesai: ${res.data.totalDeleted} record dihapus`);
    setResult(res.data.counts);
    // Force-refresh semua admin queries supaya UI sync.
    void queryClient.invalidateQueries();
  }

  return (
    <>
      <Card className="border-danger-300">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-danger-500">
            <ShieldAlert className="size-5" /> Reset Data Mockup
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-md border border-warning-300 bg-warning-100/40 p-3 text-xs text-warning-500">
            <p className="font-semibold">⚠️ Owner-only · Tidak bisa di-undo</p>
            <p className="mt-1">
              Sebelum trial real besok, hapus semua data operasional hasil
              smoke-test (transaksi, absen, shift, opname, pembelian,
              setoran, dll). <strong>Master tetap aman</strong>: menu,
              bahan, supplier, market list, karyawan, jadwal, COA.
            </p>
          </div>

          <div>
            <p className="text-sm font-semibold text-neutral-900">
              Yang akan dihapus:
            </p>
            <ul className="mt-1 grid grid-cols-1 gap-x-3 gap-y-0.5 text-xs text-neutral-700 sm:grid-cols-2">
              <li>• Transaksi POS + items + refund</li>
              <li>• Open bills + split payments</li>
              <li>• Inventory movements (stok 0)</li>
              <li>• Stock opname sessions</li>
              <li>• Purchase requests + pembelian</li>
              <li>• Setoran tunai + settlement</li>
              <li>• Pengeluaran + pemasukan</li>
              <li>• Attendance records</li>
              <li>• Shifts (open + closed)</li>
              <li>• Audit logs operasional</li>
              <li>• Journal entries (test)</li>
              <li>• Approval codes consumed</li>
              <li>• Payroll lines (period header tetap)</li>
            </ul>
          </div>

          <div>
            <p className="text-sm font-semibold text-neutral-900">
              Yang TETAP (master):
            </p>
            <ul className="mt-1 grid grid-cols-1 gap-x-3 gap-y-0.5 text-xs text-neutral-600 sm:grid-cols-2">
              <li>✓ Menu + kategori + modifier</li>
              <li>✓ Bahan (stok di-reset 0)</li>
              <li>✓ Recipe + COGS</li>
              <li>✓ Supplier + Market List</li>
              <li>✓ Karyawan + jadwal</li>
              <li>✓ Customer + loyalty points</li>
              <li>✓ Promo + bank accounts</li>
              <li>✓ Chart of accounts + periode</li>
              <li>✓ Outlet config + GPS + receipt</li>
              <li>✓ Fixed assets</li>
            </ul>
          </div>

          <Button
            variant="destructive"
            onClick={() => setOpen(true)}
            className="w-full sm:w-auto"
          >
            <AlertTriangle className="size-4" /> Reset Data Mockup Sekarang
          </Button>
        </CardContent>
      </Card>

      <Modal
        open={open}
        onClose={close}
        title={result ? "Reset Selesai" : "Konfirmasi Reset Data"}
        description={
          result
            ? "Data operasional sudah dihapus. Sistem siap untuk trial real."
            : `Ketik "${CONFIRM_PHRASE}" untuk konfirmasi.`
        }
        size={result ? "md" : "sm"}
        footer={
          result ? (
            <Button onClick={close}>Tutup</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={close} disabled={submitting}>
                Batal
              </Button>
              <Button
                variant="destructive"
                onClick={onConfirm}
                loading={submitting}
                disabled={
                  confirmText.trim().toUpperCase() !== CONFIRM_PHRASE ||
                  submitting
                }
              >
                Reset Sekarang
              </Button>
            </>
          )
        }
      >
        {result ? (
          <div className="space-y-2">
            <p className="text-sm text-neutral-700">
              Total{" "}
              <strong>
                {Object.values(result).reduce((s, n) => s + n, 0)}
              </strong>{" "}
              record dihapus + ingredients stock di-reset ke 0.
            </p>
            <div className="max-h-60 overflow-y-auto rounded-md border border-neutral-200 bg-neutral-50 p-3">
              <table className="w-full text-xs">
                <thead className="text-left text-neutral-500">
                  <tr>
                    <th className="pb-1">Tabel</th>
                    <th className="pb-1 text-right">Records</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(result)
                    .filter(([, n]) => n > 0)
                    .sort(([, a], [, b]) => b - a)
                    .map(([table, n]) => (
                      <tr key={table} className="border-t border-neutral-200">
                        <td className="py-1 font-mono">{table}</td>
                        <td className="py-1 text-right font-mono">{n}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-neutral-500">
              Refresh halaman supaya UI lain (POS, Dashboard, Riwayat)
              ikut sync ke state kosong.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-md border border-danger-300 bg-danger-100/40 p-3">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger-500" />
              <div className="text-sm text-danger-500">
                <p className="font-semibold">
                  Tindakan ini DESTRUCTIVE dan TIDAK bisa di-undo.
                </p>
                <p className="mt-1 text-xs">
                  Pastikan sudah konfirmasi dengan tim dan tidak ada
                  transaksi real yang masuk. Master data (menu, bahan,
                  supplier, dll) tetap aman.
                </p>
              </div>
            </div>
            <label className="block">
              <span className="text-xs font-medium text-neutral-700">
                Ketik <strong>{CONFIRM_PHRASE}</strong> untuk konfirmasi
              </span>
              <Input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={CONFIRM_PHRASE}
                autoFocus
              />
            </label>
          </div>
        )}
      </Modal>
    </>
  );
}
