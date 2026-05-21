"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link2 } from "lucide-react";
import {
  Button,
  Combobox,
  DatePicker,
  Input,
  Modal,
  Select,
  toast,
} from "@/components/ui";
import {
  createCreditor,
  isOk,
  updateCreditor,
  type Creditor,
  type CreateCreditorInput,
} from "@/features/creditors";
import { listInvestors } from "@/features/investors/actions";
import { formatRupiah, parseRupiah } from "@/lib/format";

/**
 * Sesi AE-80 — Form create/edit kreditur.
 */

interface CreditorFormModalProps {
  open: boolean;
  /** null = create new; else edit. */
  initial: Creditor | null;
  onClose: () => void;
  onSaved: () => void;
}

const today = () => new Date().toISOString().slice(0, 10);

export function CreditorFormModal({
  open,
  initial,
  onClose,
  onSaved,
}: CreditorFormModalProps) {
  const [fullName, setFullName] = useState("");
  const [nickname, setNickname] = useState("");
  const [nik, setNik] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankAccountHolderName, setBankAccountHolderName] = useState("");
  const [principalOriginal, setPrincipalOriginal] = useState("");
  const [interestRatePct, setInterestRatePct] = useState("0");
  const [interestPeriod, setInterestPeriod] = useState<
    "monthly" | "yearly" | "flat"
  >("monthly");
  const [startDate, setStartDate] = useState(today());
  const [dueDate, setDueDate] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [linkedInvestorId, setLinkedInvestorId] = useState<string | null>(null);

  /* Investor list untuk optional link (create mode only). */
  const investorsQuery = useQuery({
    queryKey: ["admin", "investors", "for-link"],
    queryFn: async () => {
      const res = await listInvestors({ status: "all", pageSize: 300 });
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data.items;
    },
    enabled: open && !initial,
    staleTime: 60 * 1000,
  });

  const investorLinkOptions = useMemo(
    () =>
      (investorsQuery.data ?? []).map((i) => ({
        value: i.id,
        label: i.fullName,
        hint: `${i.status === "exited" ? "exited · " : i.status === "inactive" ? "inactive · " : ""}Modal ${formatRupiah(i.modalDisetor)}`,
      })),
    [investorsQuery.data],
  );

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    if (initial) {
      setFullName(initial.fullName);
      setNickname(initial.nickname ?? "");
      setNik(initial.nik ?? "");
      setEmail(initial.email ?? "");
      setPhone(initial.phone ?? "");
      setBankName(initial.bankName ?? "");
      setBankAccountNumber(initial.bankAccountNumber ?? "");
      setBankAccountHolderName(initial.bankAccountHolderName ?? "");
      setPrincipalOriginal(String(initial.principalOriginal));
      setInterestRatePct(String(initial.interestRatePct));
      setInterestPeriod(initial.interestPeriod);
      setStartDate(initial.startDate);
      setDueDate(initial.dueDate ?? "");
      setNotes(initial.notes ?? "");
      setLinkedInvestorId(initial.linkedInvestorId ?? null);
    } else {
      setFullName("");
      setNickname("");
      setNik("");
      setEmail("");
      setPhone("");
      setBankName("");
      setBankAccountNumber("");
      setBankAccountHolderName("");
      setPrincipalOriginal("");
      setInterestRatePct("0");
      setInterestPeriod("monthly");
      setStartDate(today());
      setDueDate("");
      setNotes("");
      setLinkedInvestorId(null);
    }
    setSubmitting(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, initial]);

  /* Auto-fill contact/bank fields kalau owner pilih investor di link picker
   * (create mode only). Tidak overwrite kalau user sudah ngisi manual. */
  useEffect(() => {
    if (initial || !linkedInvestorId) return;
    const inv = (investorsQuery.data ?? []).find(
      (i) => i.id === linkedInvestorId,
    );
    if (!inv) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setFullName((cur) => cur || inv.fullName);
    setNickname((cur) => cur || inv.nickname || "");
    setNik((cur) => cur || inv.nik || "");
    setEmail((cur) => cur || inv.email || "");
    setPhone((cur) => cur || inv.phone || "");
    setBankName((cur) => cur || inv.bankName || "");
    setBankAccountNumber((cur) => cur || inv.bankAccountNumber || "");
    setBankAccountHolderName(
      (cur) => cur || inv.bankAccountHolderName || "",
    );
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [linkedInvestorId, initial, investorsQuery.data]);

  async function handleSubmit() {
    if (submitting) return;
    let parsedPrincipal = 0;
    try {
      parsedPrincipal = parseRupiah(principalOriginal);
    } catch {
      toast.error("Pokok awal tidak valid");
      return;
    }
    if (parsedPrincipal <= 0) {
      toast.error("Pokok awal harus > 0");
      return;
    }
    if (fullName.trim().length < 2) {
      toast.error("Nama wajib (min 2 char)");
      return;
    }

    const payload: CreateCreditorInput = {
      fullName: fullName.trim(),
      nickname: nickname.trim() || null,
      nik: nik.trim() || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      bankName: bankName.trim() || null,
      bankAccountNumber: bankAccountNumber.trim() || null,
      bankAccountHolderName: bankAccountHolderName.trim() || null,
      principalOriginal: parsedPrincipal,
      interestRatePct: Number(interestRatePct),
      interestPeriod,
      startDate,
      dueDate: dueDate || null,
      notes: notes.trim() || null,
      linkedInvestorId: linkedInvestorId ?? null,
    };

    setSubmitting(true);
    const res = initial
      ? await updateCreditor({ id: initial.id, ...payload })
      : await createCreditor(payload);
    setSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(initial ? "Kreditur diupdate" : "Kreditur baru ditambah");
    onSaved();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? `Edit Kreditur — ${initial.fullName}` : "Tambah Kreditur"}
      size="2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button onClick={handleSubmit} loading={submitting}>
            {initial ? "Simpan Perubahan" : "Tambah Kreditur"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {/* Optional link ke investor (create mode only). */}
        {!initial ? (
          <div className="rounded-md border border-dashed border-neutral-300 bg-neutral-50 p-3">
            <Combobox
              label="Link ke Investor (opsional)"
              options={investorLinkOptions}
              value={linkedInvestorId}
              onChange={setLinkedInvestorId}
              placeholder="— tidak di-link —"
              searchPlaceholder="Cari investor untuk auto-fill..."
              emptyText="Tidak ada investor"
              clearable
              hint="Pilih kalau kreditur ini adalah investor existing. Auto-fill kontak/bank tanpa exit investor. Untuk full convert pakai tombol 'Convert dari Investor'."
              loading={investorsQuery.isLoading}
            />
            {linkedInvestorId ? (
              <div className="mt-2 flex items-center gap-1.5 text-[11px] text-mahakan-green-700">
                <Link2 className="size-3" /> Linked — field kontak/bank
                ter-auto-fill dari profil investor
              </div>
            ) : null}
          </div>
        ) : initial.linkedInvestorId ? (
          <div className="flex items-center gap-2 rounded-md border border-mahakan-green-300 bg-mahakan-green-50 p-2 text-xs text-mahakan-green-800">
            <Link2 className="size-3" />
            Kreditur ini ter-link ke investor
            {initial.convertedFromInvestorAt ? (
              <span>
                {" "}
                — hasil convert dari investor pada{" "}
                {new Date(initial.convertedFromInvestorAt).toLocaleDateString(
                  "id-ID",
                )}
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2">
          <Input
            label="Nama Lengkap *"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            maxLength={120}
          />
          <Input
            label="Nickname"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={60}
          />
          <Input
            label="NIK"
            value={nik}
            onChange={(e) => setNik(e.target.value.replace(/[^\d]/g, ""))}
            maxLength={20}
            inputMode="numeric"
          />
          <Input
            label="No. HP"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={30}
          />
        </div>
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          maxLength={120}
        />
        <div className="grid gap-3 md:grid-cols-3">
          <Input
            label="Bank"
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            placeholder="mis. BCA"
            maxLength={60}
          />
          <Input
            label="No. Rekening"
            value={bankAccountNumber}
            onChange={(e) => setBankAccountNumber(e.target.value)}
            maxLength={40}
          />
          <Input
            label="Atas Nama"
            value={bankAccountHolderName}
            onChange={(e) => setBankAccountHolderName(e.target.value)}
            maxLength={120}
          />
        </div>

        <div className="border-t border-neutral-200 pt-3" />

        <div className="grid gap-3 md:grid-cols-2">
          <Input
            label="Pokok Awal Pinjaman *"
            type="text"
            inputMode="numeric"
            value={principalOriginal}
            onChange={(e) =>
              setPrincipalOriginal(e.target.value.replace(/[^\d]/g, ""))
            }
            placeholder="10000000"
            disabled={!!initial && initial.principalOutstanding > 0}
            hint={
              initial && initial.principalOutstanding > 0
                ? `Locked: ada outstanding Rp ${initial.principalOutstanding.toLocaleString("id-ID")}`
                : undefined
            }
            required
          />
          <Input
            label="Bunga (%)"
            type="number"
            value={interestRatePct}
            onChange={(e) => setInterestRatePct(e.target.value)}
            min={0}
            max={100}
            step={0.01}
          />
          <Select
            label="Period Bunga"
            options={[
              { value: "monthly", label: "Bulanan" },
              { value: "yearly", label: "Tahunan" },
              { value: "flat", label: "Flat (sekali)" },
            ]}
            value={interestPeriod}
            onValueChange={(v) =>
              setInterestPeriod(v as "monthly" | "yearly" | "flat")
            }
          />
          <DatePicker
            label="Tanggal Mulai *"
            value={startDate}
            onChange={(v) => setStartDate(v ?? today())}
            clearable={false}
            required
          />
          <DatePicker
            label="Jatuh Tempo (opsional)"
            value={dueDate || null}
            onChange={(v) => setDueDate(v ?? "")}
            clearable
          />
        </div>

        <Input
          label="Catatan"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={1000}
        />
      </div>
    </Modal>
  );
}
