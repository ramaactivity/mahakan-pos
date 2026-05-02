"use client";

import { useEffect, useState } from "react";
import { AlertCircle, BookOpen, CheckCircle2, Calculator } from "lucide-react";
import { Button, Modal, NumericInput, Skeleton, toast } from "@/components/ui";
import {
  fetchCutoverPreflight,
  postOpeningBalance,
} from "@/features/accounting/actions";
import type { CutoverPreflight } from "@/features/accounting/actions";
import { formatRupiah } from "@/lib/money";

interface Props {
  open: boolean;
  onClose: () => void;
  onPosted: () => void;
}

const INITIAL_STR = "0";

export function CutoverWizard({ open, onClose, onPosted }: Props) {
  const [preflight, setPreflight] = useState<CutoverPreflight | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Owner inputs (string state for NumericInput)
  const [kasDrawer, setKasDrawer] = useState(INITIAL_STR);
  const [kasBrankas, setKasBrankas] = useState(INITIAL_STR);
  const [bankBca, setBankBca] = useState(INITIAL_STR);
  const [bankBri, setBankBri] = useState(INITIAL_STR);
  const [bankLain, setBankLain] = useState(INITIAL_STR);
  const [piutangQris, setPiutangQris] = useState(INITIAL_STR);
  const [piutangEdcBca, setPiutangEdcBca] = useState(INITIAL_STR);
  const [piutangGofood, setPiutangGofood] = useState(INITIAL_STR);
  const [piutangGrabfood, setPiutangGrabfood] = useState(INITIAL_STR);
  const [piutangShopeefood, setPiutangShopeefood] = useState(INITIAL_STR);
  const [biayaDibayarDimuka, setBiayaDibayarDimuka] = useState(INITIAL_STR);
  const [modalOwner, setModalOwner] = useState(INITIAL_STR);
  const [saldoLaba, setSaldoLaba] = useState(INITIAL_STR);

  function reset() {
    setKasDrawer(INITIAL_STR);
    setKasBrankas(INITIAL_STR);
    setBankBca(INITIAL_STR);
    setBankBri(INITIAL_STR);
    setBankLain(INITIAL_STR);
    setPiutangQris(INITIAL_STR);
    setPiutangEdcBca(INITIAL_STR);
    setPiutangGofood(INITIAL_STR);
    setPiutangGrabfood(INITIAL_STR);
    setPiutangShopeefood(INITIAL_STR);
    setBiayaDibayarDimuka(INITIAL_STR);
    setModalOwner(INITIAL_STR);
    setSaldoLaba(INITIAL_STR);
    setError(null);
  }

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    reset();
    setLoading(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    fetchCutoverPreflight()
      .then((res) => {
        if (res.ok) setPreflight(res.data);
        else toast.error(res.error.message);
      })
      .finally(() => setLoading(false));
  }, [open]);

  const n = (s: string) => Number(s) || 0;

  const totalDebit =
    n(kasDrawer) +
    n(kasBrankas) +
    n(bankBca) +
    n(bankBri) +
    n(bankLain) +
    n(piutangQris) +
    n(piutangEdcBca) +
    n(piutangGofood) +
    n(piutangGrabfood) +
    n(piutangShopeefood) +
    n(biayaDibayarDimuka) +
    (preflight?.persediaanKitchen ?? 0) +
    (preflight?.persediaanBar ?? 0) +
    (preflight?.persediaanPendukung ?? 0);

  const totalCredit =
    (preflight?.hutangDagang ?? 0) + n(modalOwner) + n(saldoLaba);

  const diff = totalDebit - totalCredit;
  const balanced = diff === 0;

  async function onSubmit() {
    if (submitting) return;
    if (!balanced) {
      setError(
        `Belum balance — selisih ${formatRupiah(Math.abs(diff))} (${diff > 0 ? "kredit kurang" : "debit kurang"}). Sesuaikan Modal Owner / Saldo Laba.`,
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    const res = await postOpeningBalance({
      kasDrawer: n(kasDrawer),
      kasBrankas: n(kasBrankas),
      bankBca: n(bankBca),
      bankBri: n(bankBri),
      bankLain: n(bankLain),
      piutangQris: n(piutangQris),
      piutangEdcBca: n(piutangEdcBca),
      piutangGofood: n(piutangGofood),
      piutangGrabfood: n(piutangGrabfood),
      piutangShopeefood: n(piutangShopeefood),
      biayaDibayarDimuka: n(biayaDibayarDimuka),
      modalOwner: n(modalOwner),
      saldoLaba: n(saldoLaba),
    });
    setSubmitting(false);
    if (res.ok) {
      toast.success(
        `Jurnal Pembukaan ${res.data.entryNumber} terposting. Periode 2026-05 dikunci.`,
      );
      onPosted();
    } else {
      setError(res.error.message);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Jurnal Pembukaan (Cutover 2026-05-31)"
      description="One-time setup. Owner input saldo per 31 Mei 2026. Submit akan kunci periode 2026-05 (irreversible kecuali via reopen)."
      size="3xl"
      bodyPadding="default"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <div className="text-sm">
            <span className="font-mono text-neutral-500">
              Dr {formatRupiah(totalDebit)} · Cr {formatRupiah(totalCredit)}
            </span>
            {balanced ? (
              <span className="ml-2 inline-flex items-center gap-1 text-success-500">
                <CheckCircle2 className="size-4" /> Balance
              </span>
            ) : (
              <span className="ml-2 inline-flex items-center gap-1 text-warning-500">
                <Calculator className="size-4" /> Selisih{" "}
                {formatRupiah(Math.abs(diff))}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={submitting}>
              Batal
            </Button>
            <Button
              onClick={onSubmit}
              loading={submitting}
              disabled={submitting || !balanced || preflight?.alreadyPosted}
            >
              <BookOpen className="size-4" /> Post Jurnal Pembukaan
            </Button>
          </div>
        </div>
      }
    >
      {loading || !preflight ? (
        <Skeleton className="h-96 w-full" />
      ) : preflight.alreadyPosted ? (
        <div className="rounded-md border border-warning-500/50 bg-warning-100/40 p-4 text-sm text-warning-500">
          <AlertCircle className="mr-2 inline size-4" />
          Jurnal Pembukaan sudah pernah di-post. Reverse dulu via &ldquo;Buka
          Periode Kembali&rdquo; di Periode tab kalau mau ganti.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-md border border-mahakan-green-100 bg-mahakan-green-50/40 p-3 text-xs text-neutral-700">
            <strong>Auto-computed (server-side):</strong>
            <ul className="ml-4 mt-1 list-disc">
              <li>
                Persediaan Kitchen: {formatRupiah(preflight.persediaanKitchen)}{" "}
                · Bar: {formatRupiah(preflight.persediaanBar)} · Pendukung:{" "}
                {formatRupiah(preflight.persediaanPendukung)}
              </li>
              <li>
                Hutang Dagang outstanding (TOP):{" "}
                {formatRupiah(preflight.hutangDagang)}
              </li>
            </ul>
          </div>

          <Section title="Aset Lancar — Kas">
            <Row>
              <NumericInput
                label="1101 Kas Tunai (Drawer POS)"
                value={kasDrawer}
                onChange={setKasDrawer}
                prefix="Rp"
              />
              <NumericInput
                label="1102 Kas Tunai (Brankas)"
                value={kasBrankas}
                onChange={setKasBrankas}
                prefix="Rp"
              />
            </Row>
          </Section>

          <Section title="Aset Lancar — Bank">
            <Row>
              <NumericInput
                label="1110 Bank BCA"
                value={bankBca}
                onChange={setBankBca}
                prefix="Rp"
              />
              <NumericInput
                label="1111 Bank BRI"
                value={bankBri}
                onChange={setBankBri}
                prefix="Rp"
              />
              <NumericInput
                label="1112 Bank Lain"
                value={bankLain}
                onChange={setBankLain}
                prefix="Rp"
              />
            </Row>
          </Section>

          <Section title="Aset Lancar — Piutang outstanding">
            <Row>
              <NumericInput
                label="1120 Piutang QRIS"
                value={piutangQris}
                onChange={setPiutangQris}
                prefix="Rp"
              />
              <NumericInput
                label="1121 Piutang EDC BCA"
                value={piutangEdcBca}
                onChange={setPiutangEdcBca}
                prefix="Rp"
              />
            </Row>
            <Row>
              <NumericInput
                label="1122 Piutang GoFood"
                value={piutangGofood}
                onChange={setPiutangGofood}
                prefix="Rp"
              />
              <NumericInput
                label="1123 Piutang GrabFood"
                value={piutangGrabfood}
                onChange={setPiutangGrabfood}
                prefix="Rp"
              />
              <NumericInput
                label="1124 Piutang ShopeeFood"
                value={piutangShopeefood}
                onChange={setPiutangShopeefood}
                prefix="Rp"
              />
            </Row>
          </Section>

          <Section title="Lain">
            <Row>
              <NumericInput
                label="1150 Biaya Dibayar Dimuka"
                value={biayaDibayarDimuka}
                onChange={setBiayaDibayarDimuka}
                prefix="Rp"
              />
            </Row>
          </Section>

          <Section title="Ekuitas — Owner adjusts to balance">
            <Row>
              <NumericInput
                label="3101 Modal Owner"
                value={modalOwner}
                onChange={setModalOwner}
                prefix="Rp"
              />
              <NumericInput
                label="3301 Saldo Laba Ditahan"
                value={saldoLaba}
                onChange={setSaldoLaba}
                prefix="Rp"
              />
            </Row>
            <p className="text-xs text-neutral-500">
              Saldo Laba = akumulasi laba/rugi sebelum cutover. Owner pakai 0
              kalau fresh start atau angka dari pembukuan manual sebelumnya.
            </p>
          </Section>

          {error ? (
            <div className="rounded-md border border-danger-500/50 bg-danger-100/40 p-3 text-sm text-danger-500">
              {error}
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-mahakan-green-900">
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">{children}</div>;
}
