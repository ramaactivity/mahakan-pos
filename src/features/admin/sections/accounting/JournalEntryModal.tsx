"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Loader2,
  Paperclip,
  Scale,
  Sparkles,
  UploadCloud,
  X,
} from "lucide-react";
import {
  Badge,
  Button,
  Combobox,
  DatePicker,
  Input,
  Modal,
  NumericInput,
  Select,
  toast,
  type ComboboxOption,
} from "@/components/ui";
import {
  fetchAccounts,
  postAdjustingJournal,
  saveManualJournal,
  updateDraftJournalEntry,
} from "@/features/accounting/actions";
import { planAutoBalance } from "@/features/accounting/journal-balance-pure";
import {
  ADJUSTMENT_KINDS,
  planAdjustmentDelta,
  type AdjustmentKind,
  type AdjustSourceLine,
} from "@/features/accounting/adjusting-pure";
import type {
  AccountListRow,
  AccountType,
  JournalEntryWithLines,
  NormalBalance,
} from "@/features/accounting/types";
import { formatRupiah } from "@/lib/money";
import { cn } from "@/lib/utils";
import { jakartaDateOf, todayJakarta } from "@/lib/tz";

/* Sesi AE-72 — UX helper: format akun type untuk badge label. */
function formatAccountTypeLabel(type: AccountType): string {
  switch (type) {
    case "asset":
      return "Aset";
    case "liability":
      return "Liabilitas";
    case "equity":
      return "Ekuitas";
    case "revenue":
      return "Pendapatan";
    case "cogs":
      return "HPP";
    case "expense":
      return "Beban";
    default:
      return type;
  }
}

function accountTypeBadgeVariant(
  type: AccountType,
): "neutral" | "success" | "warning" | "danger" | "info" {
  switch (type) {
    case "asset":
      return "success";
    case "liability":
      return "warning";
    case "equity":
      return "info";
    case "revenue":
      return "success";
    case "cogs":
    case "expense":
      return "danger";
    default:
      return "neutral";
  }
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** Owner can post directly. Manager can save as draft. */
  isOwner: boolean;
  /** Sesi AE-63 phase4 — kalau di-set, modal berjalan di edit mode.
   * Pre-fill date/description/lines dari draft. Pada save, panggil
   * updateDraftJournalEntry (entryId stable, no new entry number). */
  editEntry?: JournalEntryWithLines | null;
  /** Sesi AE-211 — "adjusting" = Jurnal Penyesuaian: entry BARU berisi
   * selisih, entry aslinya tetap berlaku. Beda dari edit draft (mengubah
   * entry yang sama) dan dari reverse (meniadakan keduanya). */
  mode?: "manual" | "adjusting";
  /** Sesi AE-211 — jurnal yang sedang disesuaikan. Kalau diisi, modal
   * menampilkan alat hitung "nilai seharusnya" per baris. Boleh kosong untuk
   * penyesuaian berdiri sendiri (mis. penyusutan bulanan). */
  adjustTarget?: JournalEntryWithLines | null;
}

type LineDraft = {
  id: string;
  accountId: string | null;
  debit: string; // numeric input string
  credit: string;
  description: string;
};

function blankLine(): LineDraft {
  return {
    id: crypto.randomUUID(),
    accountId: null,
    debit: "0",
    credit: "0",
    description: "",
  };
}

export function JournalEntryModal({
  open,
  onClose,
  onSaved,
  isOwner,
  editEntry,
  mode = "manual",
  adjustTarget = null,
}: Props) {
  const isEdit = editEntry != null;
  const isAdjusting = mode === "adjusting";
  const [accounts, setAccounts] = useState<AccountListRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [entryDate, setEntryDate] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([blankLine(), blankLine()]);
  const [error, setError] = useState<string | null>(null);
  /* Sesi AE-204 — baris penyeimbang otomatis.
   *
   * Owner: "kalau isi debit, kreditnya keisi sendiri dengan nominal yang sama,
   * begitu juga sebaliknya." Ini id baris yang nilainya DIISI SISTEM. Nilainya
   * selalu = sisa selisih baris-baris lain, jadi 2 baris → nominal kembar,
   * 3+ baris → baris ini menutup sisanya. Begitu baris ini diketik manual,
   * penandanya dilepas supaya angka ketikan tidak pernah ditimpa sistem. */
  const [autoLineId, setAutoLineId] = useState<string | null>(null);
  /* Sesi AE-207 — petunjuk arah debit/kredit dari template yang baru dipilih. */
  const [activeHint, setActiveHint] = useState<string | null>(null);
  /* Sesi AE-211 — khusus mode penyesuaian. `corrected` = "nilai seharusnya"
   * per baris jurnal asli (kunci = journal_lines.id); selisihnya dihitung
   * `planAdjustmentDelta` lalu dituang ke tabel baris di bawah. */
  const [adjustmentType, setAdjustmentType] =
    useState<AdjustmentKind>("koreksi_nilai");
  const [reason, setReason] = useState("");
  const [corrected, setCorrected] = useState<Record<string, string>>({});
  /* Sesi AE-206 — bukti transaksi/transfer (link Google Drive). */
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    if (editEntry) {
      /* Pre-fill from existing draft. entryDate dari DB kemungkinan
       * sudah YYYY-MM-DD string atau Date — coerce ke string. */
      const dateStr =
        typeof editEntry.entryDate === "string"
          ? editEntry.entryDate
          : jakartaDateOf(new Date(editEntry.entryDate));
      setEntryDate(dateStr);
      setDescription(editEntry.description);
      setLines(
        editEntry.lines.length >= 2
          ? editEntry.lines.map((l) => ({
              id: l.id,
              accountId: l.accountId,
              debit: String(Number(l.debit) || 0),
              credit: String(Number(l.credit) || 0),
              description: l.description ?? "",
            }))
          : [blankLine(), blankLine()],
      );
      setReceiptUrl(editEntry.receiptImageUrl ?? null);
    } else if (isAdjusting && adjustTarget) {
      /* Penyesuaian atas jurnal tertentu: tanggalnya default HARI INI, bukan
       * tanggal jurnal aslinya — penyesuaian adalah kejadian baru, dan
       * tanggal lama kemungkinan besar ada di bulan yang sudah tutup buku. */
      setEntryDate(todayJakarta());
      setDescription(`Penyesuaian ${adjustTarget.entryNumber} — ${adjustTarget.description}`.slice(0, 200));
      setLines([blankLine(), blankLine()]);
      setReceiptUrl(null);
    } else {
      setEntryDate(todayJakarta());
      setDescription("");
      setLines([blankLine(), blankLine()]);
      setReceiptUrl(null);
    }
    setAdjustmentType(adjustTarget ? "koreksi_nilai" : "penyusutan");
    setReason("");
    setCorrected({});
    setError(null);
    setAutoLineId(null);
    setActiveHint(null);
    setUploadingReceipt(false);
    setLoading(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    fetchAccounts({ isActive: true })
      .then((res) => {
        if (res.ok) setAccounts(res.data);
        else toast.error(res.error.message);
      })
      .finally(() => setLoading(false));
  }, [open, editEntry, isAdjusting, adjustTarget]);

  const accountOptions: ComboboxOption[] = useMemo(
    () =>
      accounts.map((a) => ({
        value: a.id,
        label: `${a.code} — ${a.name}`,
        hint: `${formatAccountTypeLabel(a.type as AccountType)} · Normal ${a.normalBalance === "debit" ? "DR" : "CR"}`,
        keywords: [a.code, a.name, a.type],
      })),
    [accounts],
  );

  /* Sesi AE-72 — Lookup map untuk fetch metadata akun saat user pilih.
   * Dipakai render per-row badge + auto-clear opposite Dr/Cr field. */
  const accountById = useMemo(() => {
    const m = new Map<string, AccountListRow>();
    for (const a of accounts) m.set(a.id, a);
    return m;
  }, [accounts]);

  const totals = useMemo(() => {
    let dr = 0;
    let cr = 0;
    for (const l of lines) {
      dr += Number(l.debit) || 0;
      cr += Number(l.credit) || 0;
    }
    return { dr, cr, diff: dr - cr };
  }, [lines]);
  const balanced = totals.dr > 0 && totals.diff === 0;

  /* Sesi AE-73 — akun unidirectional (revenue/expense/cogs non-kontra) hanya
   * boleh diisi di sisi normal-nya. Dipakai render (disable field) DAN
   * penyeimbang otomatis (jangan isi sisi yang terkunci). */
  function lockedSidesOf(accountId: string | null) {
    const acc = accountId ? accountById.get(accountId) : null;
    const unidirectional =
      acc != null &&
      !acc.isContra &&
      (acc.type === "revenue" || acc.type === "expense" || acc.type === "cogs");
    return {
      lockDebit: unidirectional && acc.normalBalance === "credit",
      lockCredit: unidirectional && acc.normalBalance === "debit",
    };
  }

  function updateLine(id: string, patch: Partial<LineDraft>) {
    const applied = lines.map((l) => {
      if (l.id !== id) return l;
      const next = { ...l, ...patch };
      /* Sesi AE-72 — Smart Dr/Cr exclusivity:
       * Setiap baris hanya boleh Dr ATAU Cr, tidak keduanya. Saat user
       * isi salah satu > 0, otomatis clear yang sebaliknya supaya
       * tidak accidentally double-input + tidak perlu manual reset. */
      if (patch.debit !== undefined && Number(patch.debit) > 0) {
        next.credit = "0";
      }
      if (patch.credit !== undefined && Number(patch.credit) > 0) {
        next.debit = "0";
      }
      return next;
    });

    const touchesAmount = patch.debit !== undefined || patch.credit !== undefined;
    if (!touchesAmount) {
      setLines(applied);
      return;
    }

    /* Sesi AE-204 — isi sisi lawannya otomatis (logikanya di
     * `journal-balance-pure.ts` supaya bisa dites). */
    const plan = planAutoBalance(applied, id, autoLineId, lockedSidesOf);
    setLines(plan.lines);
    setAutoLineId(plan.autoLineId);
  }

  /* Sesi AE-72 + AE-73 — Quick templates: preset 1-tap untuk pola umum.
   * Setelah dipick, modal pre-fill description + 2 lines dengan akun yang
   * masuk akal. Owner masih harus isi nominal + edit akhir sebelum post.
   *
   * Owner request: lebih lengkap + most-used templates. Group berdasarkan
   * konteks (setup awal, operasional, koreksi). */
  type Template = {
    key: string;
    label: string;
    description: string;
    lineDebitCode: string;
    lineCreditCode: string;
    /** Group label untuk visual organize. */
    group: "Saldo Awal" | "Operasional" | "Koreksi";
    /* Sesi AE-207 — penjelasan ARAH debit/kredit, tampil sebagai tooltip.
     * Template itu sepasang akun dengan arah TETAP, padahal penyesuaian bisa
     * dua arah (stok naik atau turun). Tanpa penjelasan ini owner mudah
     * memasukkan angka ke sisi yang salah — dan jurnalnya tetap "seimbang"
     * jadi tidak ada error yang menahan. */
    hint?: string;
  };
  const TEMPLATES: Template[] = [
    /* === Saldo Awal === */
    {
      key: "saldo-bank",
      label: "Saldo Awal Bank",
      description: "Penyesuaian Saldo Awal Bank ",
      lineDebitCode: "1110",
      lineCreditCode: "3101",
      group: "Saldo Awal",
    },
    {
      key: "saldo-kas",
      label: "Saldo Awal Kas",
      description: "Penyesuaian Saldo Awal Kas",
      lineDebitCode: "1101",
      lineCreditCode: "3101",
      group: "Saldo Awal",
    },
    {
      key: "owner-suntik",
      label: "Suntik Modal Owner",
      description: "Setoran modal owner ",
      lineDebitCode: "1110",
      lineCreditCode: "3101",
      group: "Saldo Awal",
      hint: "Uang modal BARU yang benar-benar masuk sekarang: Debit Bank BCA, Kredit Modal Owner. Untuk setoran LAMA yang belum pernah dijurnal, pakai 'Koreksi Modal Disetor'.",
    },
    /* Sesi AE-207 — penyesuaian saldo awal setelah cutoff "mulai bersih".
     * Saldo awal 1 Juli diambil dari GL apa adanya, jadi owner butuh jalan
     * yang mudah untuk membetulkannya ke angka riil tanpa hafal kode akun.
     * Lawannya 3301 Saldo Laba Ditahan (bukan 3101 Modal Owner): selisih ini
     * hasil pencatatan periode lalu, bukan setoran modal baru. */
    {
      key: "saldo-persediaan-kitchen",
      label: "Nilai Stok Kitchen",
      description: "Penyesuaian nilai Persediaan Kitchen per ",
      lineDebitCode: "1140",
      lineCreditCode: "3301",
      group: "Saldo Awal",
      hint: "Isi SELISIHNYA saja, bukan nilai totalnya. Susunan ini untuk stok riil LEBIH BESAR dari catatan. Kalau lebih KECIL, tukar angkanya: Debit 3301, Kredit 1140.",
    },
    {
      key: "saldo-persediaan-bar",
      label: "Nilai Stok Bar",
      description: "Penyesuaian nilai Persediaan Bar per ",
      lineDebitCode: "1141",
      lineCreditCode: "3301",
      group: "Saldo Awal",
      hint: "Isi SELISIHNYA saja. Susunan ini untuk stok riil LEBIH BESAR dari catatan; kalau lebih KECIL, tukar jadi Debit 3301, Kredit 1141.",
    },
    {
      key: "saldo-persediaan-pendukung",
      label: "Nilai Stok Pendukung",
      description: "Penyesuaian nilai Persediaan Bahan Pendukung per ",
      lineDebitCode: "1142",
      lineCreditCode: "3301",
      group: "Saldo Awal",
      hint: "Isi SELISIHNYA saja. Saldo awal 1 Juli akun ini di-nol-kan (aslinya minus), jadi kalau ada nilai stok pendukung riil, masukkan di sini.",
    },
    {
      key: "saldo-hutang-dagang",
      label: "Saldo Awal Hutang Dagang",
      description: "Penyesuaian Hutang Dagang supplier per ",
      lineDebitCode: "3301",
      lineCreditCode: "2101",
      group: "Saldo Awal",
      hint: "Susunan ini MENAMBAH hutang (Kredit 2101). Untuk MENGURANGI hutang, tukar jadi Debit 2101, Kredit 3301.",
    },
    {
      key: "saldo-modal-reklas",
      label: "Koreksi Modal Disetor",
      description: "Koreksi Modal disetor investor & pengelola yang belum terjurnal ",
      lineDebitCode: "3301",
      lineCreditCode: "3101",
      group: "Saldo Awal",
      hint: "Untuk setoran modal LAMA yang belum pernah masuk jurnal. TIDAK menambah kas — hanya memindahkan dari Saldo Laba Ditahan ke Modal Owner, jadi total ekuitas tidak berubah, cuma barisnya jadi benar.",
    },
    /* === Operasional === */
    {
      key: "bayar-sewa",
      label: "Bayar Sewa Lokasi",
      description: "Pembayaran sewa lokasi bulan ",
      lineDebitCode: "6201",
      lineCreditCode: "1110",
      group: "Operasional",
    },
    {
      key: "bayar-listrik",
      label: "Bayar Listrik",
      description: "Pembayaran listrik bulan ",
      lineDebitCode: "6202",
      lineCreditCode: "1110",
      group: "Operasional",
    },
    {
      key: "bayar-internet",
      label: "Bayar Internet",
      description: "Pembayaran internet bulan ",
      lineDebitCode: "6204",
      lineCreditCode: "1110",
      group: "Operasional",
    },
    {
      key: "sewa-ruang",
      label: "Terima Sewa Ruang",
      description: "Pendapatan sewa ruang acara ",
      lineDebitCode: "1110",
      lineCreditCode: "4202",
      group: "Operasional",
    },
    {
      key: "titip-jual",
      label: "Terima Titip Jual",
      description: "Pendapatan titip jual ",
      lineDebitCode: "1101",
      lineCreditCode: "4203",
      group: "Operasional",
    },
    /* === Koreksi === */
    {
      key: "kas-ke-bank",
      label: "Setor Kas ke Bank",
      description: "Setoran kas drawer ke Bank ",
      lineDebitCode: "1110",
      lineCreditCode: "1101",
      group: "Koreksi",
    },
    {
      key: "bank-ke-kas",
      label: "Tarik Bank ke Kas",
      description: "Tarik tunai dari Bank ",
      lineDebitCode: "1101",
      lineCreditCode: "1110",
      group: "Koreksi",
    },
  ];

  /* Sesi AE-211 — template khusus Jurnal Penyesuaian. Pola akhir bulan yang
   * memang bentuknya penyesuaian, bukan transaksi kas. Beberapa akunnya
   * NONAKTIF di seed (1290, 6501–6504) — kalau kosong saat dipilih, owner
   * perlu mengaktifkannya dulu di Bagan Akun. */
  const ADJUSTING_TEMPLATES: Template[] = [
    {
      key: "adj-penyusutan",
      label: "Penyusutan Bulanan",
      description: "Beban penyusutan bulan ",
      lineDebitCode: "6501",
      lineCreditCode: "1290",
      group: "Operasional",
      hint: "Debit beban penyusutan, Kredit Akumulasi Penyusutan. Ganti akun bebannya sesuai jenis aset (6501 furniture, 6502 dapur, 6503 bar, 6504 IT). Kalau akunnya tidak muncul, aktifkan dulu di Bagan Akun.",
    },
    {
      key: "adj-sewa-dimuka",
      label: "Sewa Dibayar di Muka Jadi Beban",
      description: "Pengakuan beban sewa bulan ",
      lineDebitCode: "6201",
      lineCreditCode: "1150",
      group: "Operasional",
      hint: "Untuk sewa yang dibayar sekaligus beberapa bulan. Isi JATAH BULAN INI saja — Debit Beban Sewa, Kredit Biaya Dibayar Dimuka.",
    },
    {
      key: "adj-gaji-akrual",
      label: "Gaji Masih Harus Dibayar",
      description: "Gaji bulan ini yang belum dibayar ",
      lineDebitCode: "6101",
      lineCreditCode: "2102",
      group: "Operasional",
      hint: "Beban gajinya masuk bulan ini walau uangnya keluar bulan depan: Debit Gaji Karyawan, Kredit Hutang Gaji. Saat benar-benar dibayar nanti, jurnalnya Debit Hutang Gaji / Kredit Bank.",
    },
    {
      key: "adj-pendapatan-dimuka",
      label: "Pendapatan Diterima di Muka Diakui",
      description: "Pengakuan pendapatan diterima di muka ",
      lineDebitCode: "2120",
      lineCreditCode: "4202",
      group: "Operasional",
      hint: "Uang sudah diterima duluan (mis. DP sewa ruang). Akui bagian yang acaranya SUDAH jalan: Debit Pendapatan Diterima Dimuka, Kredit Pendapatan Sewa Ruang.",
    },
    {
      key: "adj-stok-kitchen",
      label: "Selisih Nilai Stok Kitchen",
      description: "Penyesuaian nilai persediaan Kitchen per ",
      lineDebitCode: "6903",
      lineCreditCode: "1140",
      group: "Koreksi",
      hint: "Susunan ini untuk stok fisik LEBIH KECIL dari catatan (ada susut/terbuang). Kalau stok fisik lebih BESAR, tukar: Debit 1140, Kredit 6903. Isi selisihnya saja.",
    },
  ];
  const activeTemplates = isAdjusting ? ADJUSTING_TEMPLATES : TEMPLATES;
  /* Sesi AE-211 — alat hitung selisih. Owner cuma mengetik BERAPA YANG
   * SEHARUSNYA per baris jurnal asli; sisi debit/kreditnya diambil dari baris
   * itu, dan kalau nilai yang benar lebih KECIL, selisihnya otomatis jatuh ke
   * sisi sebaliknya. Logikanya di `adjusting-pure.ts` supaya bisa dites. */
  const adjustSourceLines: AdjustSourceLine[] = useMemo(
    () =>
      (adjustTarget?.lines ?? []).map((l) => ({
        lineId: l.id,
        accountId: l.accountId,
        accountCode: l.accountCode,
        accountName: l.accountName,
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0,
      })),
    [adjustTarget],
  );
  const deltaPlan = useMemo(
    () => planAdjustmentDelta(adjustSourceLines, corrected),
    [adjustSourceLines, corrected],
  );

  function applyDeltaToLines() {
    if (deltaPlan.lines.length === 0) return;
    setLines(
      deltaPlan.lines.map((l) => ({
        id: crypto.randomUUID(),
        accountId: l.accountId,
        debit: String(l.debit),
        credit: String(l.credit),
        description: "Selisih penyesuaian",
      })),
    );
    /* Baris hasil hitungan JANGAN ditandai auto-line: nilainya sudah final,
     * bukan angka penyeimbang yang boleh ditimpa sistem saat baris lain diisi. */
    setAutoLineId(null);
    setError(null);
  }

  function applyTemplate(t: Template) {
    const findId = (code: string) =>
      accounts.find((a) => a.code === code)?.id ?? null;

    /* Sesi AE-140 — guard description overwrite. Inab Finance lapor:
     * "user udah ngetik description sendiri lalu pilih template, input
     * mereka bisa hilang tanpa sadar". Solution: kalau description
     * sudah terisi (non-empty trimmed), konfirmasi dulu sebelum
     * overwrite. Kalau kosong, langsung fill. */
    const currentDesc = description.trim();
    let shouldOverwrite = true;
    if (currentDesc.length > 0 && currentDesc !== t.description.trim()) {
      shouldOverwrite = window.confirm(
        `Description "${currentDesc}" akan ditimpa jadi "${t.description.trim()}". Lanjut?`,
      );
    }
    if (shouldOverwrite) {
      setDescription(t.description);
    }
    /* Sesi AE-207 — tampilkan petunjuk arah debit/kredit sebagai TEKS, bukan
     * cuma tooltip: back office kadang dibuka dari tablet, dan di layar sentuh
     * `title` tidak pernah muncul. */
    setActiveHint(t.hint ?? null);
    setLines([
      {
        id: crypto.randomUUID(),
        accountId: findId(t.lineDebitCode),
        debit: "0",
        credit: "0",
        description: "",
      },
      {
        id: crypto.randomUUID(),
        accountId: findId(t.lineCreditCode),
        debit: "0",
        credit: "0",
        description: "",
      },
    ]);
    setAutoLineId(null);
  }

  /* Sesi AE-206 — upload bukti ke Drive lewat endpoint khusus jurnal.
   * Filenya masuk folder "BUKTI JURNAL/{tahun}/{bulan}" mengikuti Tanggal
   * Entry, jadi upload baru bisa jalan setelah tanggalnya terisi. */
  async function handleReceiptUpload(file: File) {
    if (uploadingReceipt) return;
    setError(null);
    if (!entryDate) {
      setError("Isi Tanggal Entry dulu sebelum unggah bukti");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Bukti transaksi maksimal 5 MB");
      return;
    }
    setUploadingReceipt(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("entryDate", entryDate);
      const res = await fetch("/api/v1/journal-receipts/upload", {
        method: "POST",
        body: fd,
      });
      const json = (await res.json()) as
        | { success: true; data: { url: string; folderPath: string } }
        | { success: false; error: { code: string; message: string } };
      if (!json.success) throw new Error(json.error.message);
      setReceiptUrl(json.data.url);
      toast.success(`Bukti tersimpan di Drive · ${json.data.folderPath}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload bukti gagal");
    } finally {
      setUploadingReceipt(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function addLine() {
    setLines((prev) => [...prev, blankLine()]);
  }

  function removeLine(id: string) {
    setLines((prev) => (prev.length > 2 ? prev.filter((l) => l.id !== id) : prev));
    if (autoLineId === id) setAutoLineId(null);
  }

  async function submit(status: "draft" | "posted") {
    if (submitting) return;
    setError(null);

    if (!entryDate) {
      setError("Tanggal wajib diisi");
      return;
    }
    if (description.trim().length < 3) {
      setError("Deskripsi minimal 3 karakter");
      return;
    }
    if (isAdjusting && reason.trim().length < 10) {
      setError(
        "Alasan penyesuaian minimal 10 karakter — jurnal ini mengoreksi angka yang sudah masuk laporan, jadi harus bisa dijelaskan",
      );
      return;
    }
    const validLines = lines.filter(
      (l) => l.accountId && (Number(l.debit) > 0 || Number(l.credit) > 0),
    );
    if (validLines.length < 2) {
      setError("Minimal 2 baris valid");
      return;
    }
    for (const l of validLines) {
      const dr = Number(l.debit);
      const cr = Number(l.credit);
      if ((dr > 0 && cr > 0) || (dr === 0 && cr === 0)) {
        setError("Setiap baris harus debit ATAU credit, bukan keduanya");
        return;
      }
    }
    if (!balanced) {
      setError(
        `Belum balance — selisih ${formatRupiah(Math.abs(totals.diff))}`,
      );
      return;
    }

    setSubmitting(true);
    const inputLines = validLines.map((l) => ({
      accountId: l.accountId!,
      debit: Number(l.debit),
      credit: Number(l.credit),
      description: l.description.trim() || null,
    }));
    const res = isAdjusting
      ? await postAdjustingJournal({
          entryDate,
          description: description.trim(),
          reason: reason.trim(),
          adjustmentType,
          adjustsEntryId: adjustTarget?.id ?? null,
          status,
          lines: inputLines,
          receiptImageUrl: receiptUrl,
        })
      : isEdit
      ? await updateDraftJournalEntry({
          entryId: editEntry!.id,
          entryDate,
          description: description.trim(),
          newStatus: status,
          lines: inputLines,
          receiptImageUrl: receiptUrl,
        })
      : await saveManualJournal({
          entryDate,
          description: description.trim(),
          status,
          lines: inputLines,
          receiptImageUrl: receiptUrl,
        });
    setSubmitting(false);

    if (res.ok) {
      /* Sesi AE-191 — sebut TANGGAL jurnalnya, bukan cuma nomor.
       *
       * Daftar jurnal diurutkan per tanggal, jadi entry bertanggal mundur
       * mendarat di bawah entry hari ini — bukan di baris teratas tempat mata
       * mencari. Owner sempat mengira jurnalnya hilang karena itu. */
      const tanggal = entryDate
        ? new Intl.DateTimeFormat("id-ID", {
            day: "numeric",
            month: "long",
            year: "numeric",
          }).format(new Date(`${entryDate}T00:00:00Z`))
        : "";
      const suffix = tanggal ? ` — tanggal ${tanggal}` : "";
      toast.success(
        isAdjusting
          ? status === "posted"
            ? `Jurnal penyesuaian ${res.data.entryNumber} terposting${suffix}`
            : `Draft penyesuaian ${res.data.entryNumber} disimpan${suffix}`
          : isEdit
          ? status === "posted"
            ? `Entry ${res.data.entryNumber} ter-edit + ter-post${suffix}`
            : `Draft ${res.data.entryNumber} ter-update${suffix}`
          : status === "draft"
            ? `Draft ${res.data.entryNumber} disimpan${suffix}`
            : `Entry ${res.data.entryNumber} terposting${suffix}`,
      );
      onSaved();
    } else {
      setError(res.error.message);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        isAdjusting
          ? adjustTarget
            ? `Jurnal Penyesuaian atas ${adjustTarget.entryNumber}`
            : "Jurnal Penyesuaian"
          : isEdit
            ? `Edit Draft ${editEntry!.entryNumber}`
            : "Entry Jurnal Manual"
      }
      description={
        isAdjusting
          ? "Entry BARU berisi selisihnya saja. Jurnal yang lama tetap berlaku dan tetap terhitung — tidak dihapus, tidak diubah."
          : isEdit
            ? "Edit draft entry. Save changes sebagai draft, atau post langsung (Owner) sekalian."
            : isOwner
              ? "Owner: post langsung atau save as draft. Reverse via Jurnal tab kalau perlu."
              : "Manager: save as draft. Owner approve + post via Jurnal tab."
      }
      /* Sesi AE-205 — dilebarkan dari 3xl (max-w-4xl) ke full
       * (min(95vw, 80rem)). Entry jurnal punya 5 kolom + numpad inline; di
       * laptop 4xl bikin kolom Catatan & tombol hapus kepotong. */
      size="full"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <div className="text-sm">
            <span className="font-mono text-neutral-500">
              Dr {formatRupiah(totals.dr)} · Cr {formatRupiah(totals.cr)}
            </span>
            {balanced ? (
              <span className="ml-2 inline-flex items-center gap-1 text-success-500">
                <CheckCircle2 className="size-4" /> Balance
              </span>
            ) : totals.dr === 0 ? (
              <span className="ml-2 text-xs text-neutral-500">
                Isi minimal 2 baris
              </span>
            ) : (
              <span className="ml-2 inline-flex items-center gap-1 text-warning-500">
                <AlertCircle className="size-4" /> Selisih{" "}
                {formatRupiah(Math.abs(totals.diff))}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={submitting}>
              Batal
            </Button>
            {/* Sesi AE-206 — jangan simpan selagi bukti masih naik ke Drive;
                URL-nya belum ada, entry-nya jadi tanpa lampiran. */}
            <Button
              variant="outline"
              onClick={() => submit("draft")}
              disabled={submitting || uploadingReceipt}
            >
              Save Draft
            </Button>
            {isOwner ? (
              <Button
                onClick={() => submit("posted")}
                loading={submitting}
                disabled={submitting || uploadingReceipt || !balanced}
              >
                {isAdjusting ? "Post Penyesuaian" : "Post Entry"}
              </Button>
            ) : null}
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        {/* Sesi AE-211 — panel Jurnal Penyesuaian: apa bedanya dengan dua
            tombol koreksi yang lain, jenis penyesuaiannya apa, dan alasannya
            (wajib, ikut ke jejak audit). */}
        {isAdjusting ? (
          <div className="space-y-3 rounded-md border border-mahakan-green-500/40 bg-mahakan-green-50/50 p-3">
            <div className="flex items-start gap-2">
              <Scale
                className="mt-0.5 size-4 shrink-0 text-mahakan-green-700"
                aria-hidden
              />
              <div className="text-xs leading-relaxed text-neutral-700">
                <span className="font-semibold text-mahakan-green-900">
                  Penyesuaian menambah jurnal baru berisi SELISIHNYA saja.
                </span>{" "}
                Jurnal lama tetap ada dan tetap terhitung.
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-neutral-600">
                  <li>
                    Kalau jurnalnya memang <em>tidak boleh ada</em> — pakai{" "}
                    <strong>Reverse</strong>, bukan ini.
                  </li>
                  <li>
                    Kalau jurnalnya masih <em>draft</em> — pakai{" "}
                    <strong>Edit Draft</strong>, tidak perlu penyesuaian.
                  </li>
                </ul>
              </div>
            </div>
            {adjustTarget ? (
              <div className="rounded-md border border-neutral-200 bg-white p-2 text-xs">
                <div className="mb-1 font-medium text-neutral-800">
                  Jurnal yang disesuaikan:{" "}
                  <span className="font-mono">{adjustTarget.entryNumber}</span>{" "}
                  <span className="text-neutral-500">
                    · {String(adjustTarget.entryDate)}
                  </span>
                </div>
                <p className="text-neutral-600">{adjustTarget.description}</p>
              </div>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-2">
              <Select
                label="Jenis Penyesuaian"
                options={ADJUSTMENT_KINDS.map((k) => ({
                  value: k.value,
                  label: k.label,
                }))}
                value={adjustmentType}
                onValueChange={(v) => setAdjustmentType(v as AdjustmentKind)}
                size="sm"
              />
              <Input
                label="Alasan penyesuaian"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="mis. nota supplier ternyata Rp 450rb, bukan Rp 500rb"
                hint="Minimal 10 karakter — tersimpan di jurnal & Audit Log."
                maxLength={300}
              />
            </div>
            <p className="text-[11px] italic text-neutral-600">
              {ADJUSTMENT_KINDS.find((k) => k.value === adjustmentType)?.help}
            </p>
          </div>
        ) : null}

        {/* Sesi AE-211 — alat hitung selisih. Owner cukup mengetik BERAPA YANG
            SEHARUSNYA per baris; sisi debit/kredit + arah selisihnya diurus
            sistem. Ini yang bikin penyesuaian tidak perlu hitung manual. */}
        {isAdjusting && adjustSourceLines.length > 0 ? (
          <div className="rounded-md border border-neutral-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
                Hitung selisih dari nilai yang benar
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={applyDeltaToLines}
                disabled={deltaPlan.lines.length === 0}
              >
                Isi Baris Selisih
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-neutral-50 text-neutral-500">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-medium">Akun</th>
                    <th className="px-3 py-1.5 text-right font-medium">
                      Sisi
                    </th>
                    <th className="px-3 py-1.5 text-right font-medium">
                      Nilai sekarang
                    </th>
                    <th className="px-3 py-1.5 text-left font-medium">
                      Nilai seharusnya
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {adjustSourceLines.map((l) => {
                    const isDebitSide = l.debit > 0;
                    return (
                      <tr key={l.lineId}>
                        <td className="px-3 py-1.5 align-middle text-neutral-800">
                          <span className="font-mono text-neutral-500">
                            {l.accountCode}
                          </span>{" "}
                          {l.accountName}
                        </td>
                        <td className="px-3 py-1.5 text-right font-medium text-neutral-600">
                          {isDebitSide ? "Debit" : "Kredit"}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-neutral-800">
                          {formatRupiah(isDebitSide ? l.debit : l.credit)}
                        </td>
                        <td className="w-56 px-3 py-1.5">
                          <NumericInput
                            ariaLabel={`Nilai seharusnya ${l.accountCode}`}
                            value={corrected[l.lineId] ?? ""}
                            onChange={(v) =>
                              setCorrected((prev) => ({
                                ...prev,
                                [l.lineId]: v,
                              }))
                            }
                            prefix="Rp"
                            placeholder="kosongkan kalau sudah benar"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="border-t border-neutral-100 px-3 py-2 text-xs">
              {deltaPlan.unchanged ? (
                <span className="text-neutral-500">
                  Kosongkan baris yang nilainya sudah benar. Isi hanya yang
                  berubah — selisihnya dihitung otomatis.
                </span>
              ) : (
                <div className="space-y-1">
                  {deltaPlan.lines.map((l) => (
                    <div
                      key={l.accountId}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="text-neutral-700">
                        <span className="font-mono text-neutral-500">
                          {l.accountCode}
                        </span>{" "}
                        {l.accountName}
                      </span>
                      <span className="font-mono text-neutral-900">
                        {l.debit > 0
                          ? `Debit ${formatRupiah(l.debit)}`
                          : `Kredit ${formatRupiah(l.credit)}`}
                      </span>
                    </div>
                  ))}
                  {!deltaPlan.balanced ? (
                    <p className="rounded-md bg-warning-100/50 p-2 text-[11px] text-warning-700">
                      Selisihnya belum seimbang (beda{" "}
                      {formatRupiah(Math.abs(deltaPlan.diff))}). Isi juga baris
                      lawannya, atau tekan &ldquo;Isi Baris Selisih&rdquo; lalu
                      tambahkan baris penyeimbang di tabel bawah.
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        ) : null}

        {/* Sesi AE-72/AE-73 — Quick templates grouped. Hanya tampil di
         * mode CREATE, bukan edit (edit pre-fill dari existing entry). */}
        {!isEdit ? (
          <div className="space-y-2 rounded-md border border-dashed border-neutral-200 bg-neutral-50/50 px-3 py-2">
            <div className="flex items-center gap-2 text-xs">
              <Sparkles
                className="size-3.5 text-mahakan-green-700"
                aria-hidden
              />
              <span className="font-medium text-neutral-700">
                Quick Template
              </span>
              <span className="text-[10px] text-neutral-500">
                — pilih template untuk auto-fill akun + deskripsi
              </span>
            </div>
            {(["Saldo Awal", "Operasional", "Koreksi"] as const).map(
              (group) => {
                const groupTemplates = activeTemplates.filter(
                  (t) => t.group === group,
                );
                if (groupTemplates.length === 0) return null;
                return (
                  <div
                    key={group}
                    className="flex flex-wrap items-center gap-1.5"
                  >
                    <span className="min-w-[80px] text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                      {group}
                    </span>
                    {groupTemplates.map((t) => (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => applyTemplate(t)}
                        /* Sesi AE-207 — tooltip arah debit/kredit. Jurnal yang
                         * sisinya kebalik tetap seimbang, jadi tidak ada
                         * validasi yang bisa menahannya — penjelasannya harus
                         * ada sebelum owner mengetik angka. */
                        title={t.hint ?? t.description.trim()}
                        className="rounded-md border border-neutral-300 bg-white px-2 py-0.5 text-[11px] font-medium text-neutral-700 hover:border-mahakan-green-500 hover:bg-mahakan-green-50 hover:text-mahakan-green-900"
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                );
              },
            )}
            {activeHint ? (
              <p className="rounded-md border border-mahakan-green-500/30 bg-mahakan-green-50 px-2 py-1.5 text-[11px] leading-relaxed text-neutral-700">
                {activeHint}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <DatePicker
            label="Tanggal Entry"
            value={entryDate}
            onChange={setEntryDate}
          />
          <Input
            label="Deskripsi"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="contoh: Adjust stock raw bean Mei"
            maxLength={200}
          />
        </div>

        {/* Sesi AE-205 — tabel baris jurnal kepotong di laptop layar kecil:
         * lebar kolom dulu ikut isi (`min-w-full`), jadi field Debit/Credit
         * mendorong kolom Catatan + tombol hapus keluar layar dan modal ikut
         * scroll ke samping. Sekarang `table-fixed` + colgroup: proporsi
         * kolom tetap dan semua field mengecil mengikuti lebar modal. Kalau
         * jendelanya benar-benar sempit, yang menggulir HANYA kotak tabel
         * ini (min-w 56rem), bukan seluruh isi modal. */}
        <div className="overflow-x-auto rounded-md border border-neutral-200">
          <table className="w-full min-w-[56rem] table-fixed text-sm">
            <colgroup>
              <col className="w-[30%]" />
              <col className="w-[21%]" />
              <col className="w-[21%]" />
              <col className="w-[24%]" />
              <col className="w-[4%]" />
            </colgroup>
            <thead className="bg-neutral-50">
              <tr>
                <th className="px-2 py-1.5 text-left text-xs font-medium uppercase text-neutral-500">
                  Akun
                </th>
                <th className="px-2 py-1.5 text-left text-xs font-medium uppercase text-neutral-500">
                  Debit
                </th>
                <th className="px-2 py-1.5 text-left text-xs font-medium uppercase text-neutral-500">
                  Credit
                </th>
                <th className="px-2 py-1.5 text-left text-xs font-medium uppercase text-neutral-500">
                  Catatan
                </th>
                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {lines.map((line) => {
                /* Sesi AE-72 — pre-resolve account untuk badge + smart
                 * highlight Dr/Cr cell sesuai normalBalance. */
                const acc = line.accountId ? accountById.get(line.accountId) : null;
                const normalBalance: NormalBalance | null = acc?.normalBalance ?? null;
                /* Sesi AE-73 hotfix — hard lock HANYA untuk akun yang
                 * unidirectional secara natural (revenue/expense/cogs).
                 * Asset/liability/equity bolak-balik valid (mis. Bank Dr
                 * untuk inflow, Cr untuk outflow). Untuk akun bolak-balik,
                 * tetap soft highlight tapi tidak disable field.
                 *
                 * Plus: kontra account (akun yang flip normal balance,
                 * mis. Diskon Penjualan 4110) skip hard lock juga karena
                 * sengaja inverted. */
                const { lockDebit, lockCredit } = lockedSidesOf(line.accountId);
                /* Sesi AE-204 — tandai baris yang nominalnya diisi sistem,
                 * supaya owner tahu angka itu boleh ditimpa manual. */
                const isAutoLine =
                  line.id === autoLineId &&
                  (Number(line.debit) > 0 || Number(line.credit) > 0);
                return (
                  <tr key={line.id}>
                    <td className="px-2 py-1.5 align-top">
                      <Combobox
                        hideLabel
                        ariaLabel="Pilih akun"
                        options={accountOptions}
                        value={line.accountId}
                        onChange={(v) => updateLine(line.id, { accountId: v })}
                        placeholder="— pilih akun —"
                        loading={loading}
                        size="sm"
                      />
                      {acc ? (
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          <Badge
                            variant={accountTypeBadgeVariant(acc.type as AccountType)}
                            className="!text-[9px]"
                          >
                            {formatAccountTypeLabel(acc.type as AccountType)}
                          </Badge>
                          <span className="text-[9px] uppercase tracking-wide text-neutral-500">
                            Normal{" "}
                            <span className="font-semibold text-neutral-700">
                              {normalBalance === "debit" ? "DR" : "CR"}
                            </span>
                          </span>
                        </div>
                      ) : null}
                    </td>
                    {/* Sesi AE-73 — Hard lock untuk akun unidirectional
                     * (revenue/expense/cogs non-contra). Asset/Liability/
                     * Equity tetap free karena bolak-balik valid (mis.
                     * Bank Dr inflow, Cr outflow). */}
                    <td
                      className={cn(
                        "px-2 py-1.5 align-top",
                        normalBalance === "debit" &&
                          "bg-mahakan-green-50/40",
                        lockDebit && "bg-neutral-100/60",
                      )}
                    >
                      <NumericInput
                        ariaLabel="Debit"
                        value={line.debit}
                        onChange={(v) => updateLine(line.id, { debit: v })}
                        prefix="Rp"
                        disabled={lockDebit}
                      />
                      {lockDebit ? (
                        <p className="mt-0.5 text-[10px] italic text-neutral-400">
                          Akun ini normal CR — isi di kolom Credit
                        </p>
                      ) : isAutoLine && Number(line.debit) > 0 ? (
                        <p className="mt-0.5 text-[10px] italic text-mahakan-green-700">
                          Terisi otomatis — bisa diubah manual
                        </p>
                      ) : null}
                    </td>
                    <td
                      className={cn(
                        "px-2 py-1.5 align-top",
                        normalBalance === "credit" &&
                          "bg-mahakan-green-50/40",
                        lockCredit && "bg-neutral-100/60",
                      )}
                    >
                      <NumericInput
                        ariaLabel="Credit"
                        value={line.credit}
                        onChange={(v) => updateLine(line.id, { credit: v })}
                        prefix="Rp"
                        disabled={lockCredit}
                      />
                      {lockCredit ? (
                        <p className="mt-0.5 text-[10px] italic text-neutral-400">
                          Akun ini normal DR — isi di kolom Debit
                        </p>
                      ) : isAutoLine && Number(line.credit) > 0 ? (
                        <p className="mt-0.5 text-[10px] italic text-mahakan-green-700">
                          Terisi otomatis — bisa diubah manual
                        </p>
                      ) : null}
                    </td>
                    <td className="px-2 py-1.5 align-top">
                      <Input
                        placeholder="opsional"
                        value={line.description}
                        onChange={(e) =>
                          updateLine(line.id, { description: e.target.value })
                        }
                        maxLength={200}
                      />
                    </td>
                    <td className="px-2 py-1.5 align-top">
                      <button
                        type="button"
                        onClick={() => removeLine(line.id)}
                        disabled={lines.length <= 2}
                        className={cn(
                          "rounded p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-danger-500",
                          lines.length <= 2 && "cursor-not-allowed opacity-30",
                        )}
                        aria-label="Hapus baris"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="border-t border-neutral-100 p-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={addLine}
            >
              <Plus className="size-4" /> Tambah Baris
            </Button>
          </div>
        </div>

        {/* Sesi AE-206 — bukti transaksi/transfer.
         * Filenya naik ke Google Drive (folder BUKTI JURNAL/{tahun}/{bulan})
         * dan URL-nya nempel di entry, jadi bisa dibuka lagi dari daftar
         * Jurnal lewat tombol "Lihat bukti". */}
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-neutral-900">
            Bukti Transaksi{" "}
            <span className="font-normal text-neutral-500">(opsional)</span>
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleReceiptUpload(file);
            }}
          />
          {receiptUrl ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-mahakan-green-700/30 bg-mahakan-green-50 px-3 py-2">
              <a
                href={receiptUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium text-mahakan-green-900 hover:underline"
              >
                <Paperclip className="size-4 shrink-0" aria-hidden />
                <span className="truncate">
                  Bukti tersimpan di Drive — klik untuk lihat
                </span>
                <ExternalLink className="size-3.5 shrink-0" aria-hidden />
              </a>
              <button
                type="button"
                onClick={() => setReceiptUrl(null)}
                disabled={submitting || uploadingReceipt}
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-neutral-500 hover:bg-danger-100 hover:text-danger-500"
                aria-label="Lepas bukti dari entry ini (file tetap ada di Drive)"
                title="Lepas bukti dari entry ini (file tetap ada di Drive)"
              >
                <X className="size-4" />
              </button>
            </div>
          ) : (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file) void handleReceiptUpload(file);
              }}
              className="flex flex-col items-center gap-1.5 rounded-md border border-dashed border-neutral-300 bg-neutral-50/60 px-3 py-5 text-center"
            >
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingReceipt || submitting}
              >
                {uploadingReceipt ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Mengunggah…
                  </>
                ) : (
                  <>
                    <UploadCloud className="size-4" /> Lampirkan Bukti Transfer
                    / Nota
                  </>
                )}
              </Button>
              <p className="text-[11px] text-neutral-500">
                Tarik file ke sini atau klik tombol · JPG / PNG / WebP / PDF,
                maks 5 MB · disimpan ke Google Drive folder{" "}
                <em>BUKTI JURNAL</em>
              </p>
            </div>
          )}
        </div>

        {error ? (
          <div className="rounded-md border border-danger-500/50 bg-danger-100/40 p-3 text-sm text-danger-500">
            {error}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
