"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Plus, Trash2, Upload, X } from "lucide-react";
import {
  Badge,
  Button,
  DatePicker,
  Input,
  Modal,
  Select,
  Spinner,
  toast,
  type SelectOption,
} from "@/components/ui";
import {
  createEmployeeDocument,
  deleteEmployeeDocument,
  isOk,
  listEmployeeDocuments,
  type DocumentType,
  type Employee,
  type EmployeeDocument,
} from "@/features/employees";
import { formatIndonesianDateTime } from "@/lib/date";
import { differenceInCalendarDays, parseISO } from "date-fns";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ACCEPT_TYPES = "application/pdf,image/jpeg,image/png,image/webp";

const DOC_TYPE_LABELS: Record<DocumentType, string> = {
  ktp: "KTP",
  bpjs_kesehatan: "BPJS Kesehatan",
  bpjs_ketenagakerjaan: "BPJS Ketenagakerjaan",
  npwp: "NPWP",
  ijazah: "Ijazah",
  kontrak: "Kontrak",
  other: "Lainnya",
};

interface EmployeeDocsModalProps {
  open: boolean;
  employee: Employee | null;
  onClose: () => void;
}

export function EmployeeDocsModal({
  open,
  employee,
  onClose,
}: EmployeeDocsModalProps) {
  const [docs, setDocs] = useState<EmployeeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // Add-form state. fileUrl = manually-pasted URL (legacy "Drive link" path).
  // pendingFile = picked-but-not-yet-uploaded file (sesi AA hotfix —
  // deferred upload supaya tidak ada orphan files di Drive saat user
  // tutup modal tanpa klik Simpan, dan supaya tombol "Simpan Dokumen"
  // jadi single source of truth untuk commit). Either may be set;
  // pendingFile takes precedence on save.
  const [docType, setDocType] = useState<DocumentType>("ktp");
  const [title, setTitle] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open || !employee) return;
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    setDocType("ktp");
    setTitle("");
    setFileUrl("");
    setPendingFile(null);
    setUploadError(null);
    setExpiresAt("");
    setNotes("");
    setError(null);
    setSubmitting(false);
    /* eslint-enable react-hooks/set-state-in-effect */
    void (async () => {
      const res = await listEmployeeDocuments(employee.id);
      if (cancelled) return;
      if (isOk(res)) setDocs(res.data);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, employee, refreshKey]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadError(null);
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError("Ukuran file melebihi 10 MB");
      return;
    }
    // Defer upload until user clicks "Simpan Dokumen". Just remember
    // the file in memory — no orphan files in Drive if user abandons.
    setPendingFile(file);
    // Clear the manually-pasted URL since the file takes precedence.
    setFileUrl("");
  }

  function clearUpload() {
    setFileUrl("");
    setPendingFile(null);
    setUploadError(null);
  }

  async function uploadPendingFile(file: File): Promise<string> {
    if (!employee) throw new Error("Karyawan belum dipilih");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("employeeId", employee.id);
    const res = await fetch("/api/v1/employee-documents/upload", {
      method: "POST",
      body: fd,
    });
    const json = (await res.json()) as
      | { success: true; data: { url: string; folderPath: string } }
      | { success: false; error: { code: string; message: string } };
    if (!json.success) {
      throw new Error(json.error.message);
    }
    toast.success(`File tersimpan di Drive · ${json.data.folderPath}`);
    return json.data.url;
  }

  async function handleAdd() {
    if (!employee) return;
    if (submitting) return;
    setError(null);
    if (title.trim().length === 0) {
      setError("Judul dokumen wajib diisi");
      return;
    }
    setSubmitting(true);
    try {
      // If user picked a file, upload to Drive first then create DB row
      // with returned URL. Otherwise use the manually-pasted URL (or null).
      let resolvedUrl: string | null = fileUrl.trim() || null;
      if (pendingFile) {
        try {
          resolvedUrl = await uploadPendingFile(pendingFile);
        } catch (e) {
          setError(
            e instanceof Error
              ? `Upload gagal: ${e.message}`
              : "Upload gagal — coba lagi",
          );
          setSubmitting(false);
          return;
        }
      }
      const res = await createEmployeeDocument({
        employeeId: employee.id,
        docType,
        title: title.trim(),
        fileUrl: resolvedUrl,
        expiresAt: expiresAt || null,
        notes: notes.trim() || null,
      });
      if (!isOk(res)) {
        setError(res.error.message);
        return;
      }
      toast.success("Dokumen ditambahkan");
      setTitle("");
      setFileUrl("");
      setPendingFile(null);
      setExpiresAt("");
      setNotes("");
      setRefreshKey((k) => k + 1);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(doc: EmployeeDocument) {
    if (!confirm(`Hapus dokumen "${doc.title}"?`)) return;
    const res = await deleteEmployeeDocument(doc.id);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Dokumen dihapus");
    setRefreshKey((k) => k + 1);
  }

  if (!employee) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Dokumen — ${employee.fullName}`}
      description="Upload kontrak, KTP, BPJS, dll. Maks 10 MB · PDF / JPG / PNG / WebP. Kalau sudah di Drive/cloud lain, paste link di kolom URL."
      size="lg"
      footer={
        <Button variant="ghost" onClick={onClose}>
          Tutup
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold text-neutral-900">
            Tambah Dokumen
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Jenis"
              value={docType}
              onValueChange={(v) => setDocType(v as DocumentType)}
              disabled={submitting}
              options={(Object.keys(DOC_TYPE_LABELS) as DocumentType[]).map<SelectOption>(
                (key) => ({
                  value: key,
                  label: DOC_TYPE_LABELS[key],
                }),
              )}
            />
            <Input
              label="Judul / Label"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, 200))}
              placeholder="Mis. KTP Galih Pratama"
              required
              disabled={submitting}
            />
            <DatePicker
              label="Berlaku Sampai (opsional)"
              value={expiresAt || null}
              onChange={(v) => setExpiresAt(v ?? "")}
              disabled={submitting}
              placeholder="Pilih tanggal expiry"
            />
          </div>

          {/* File upload + URL fallback */}
          <div className="mt-3 space-y-2">
            <label className="block text-sm font-medium text-neutral-900">
              File / Link (opsional)
            </label>
            {pendingFile ? (
              <div className="rounded-md border border-warning-500/40 bg-warning-100/30 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText
                      className="size-4 shrink-0 text-warning-500"
                      aria-hidden
                    />
                    <span className="truncate text-sm text-neutral-900">
                      {pendingFile.name}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={clearUpload}
                    disabled={submitting}
                    aria-label="Batal pilih file"
                    className="rounded-sm p-1 text-neutral-500 hover:bg-warning-100 hover:text-danger-500"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-warning-500">
                  File belum tersimpan — klik <strong>Simpan Dokumen</strong> di bawah untuk upload ke Drive + catat ke daftar.
                </p>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={submitting}
                  >
                    <Upload className="size-4" aria-hidden /> Pilih File
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPT_TYPES}
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  <Input
                    type="url"
                    value={fileUrl}
                    onChange={(e) => setFileUrl(e.target.value.slice(0, 500))}
                    placeholder="atau paste URL: https://..."
                    disabled={submitting}
                    className="flex-1"
                  />
                </div>
                <p className="text-xs text-neutral-500">
                  Maks 10 MB · PDF, JPG, PNG, WebP. File otomatis upload ke Google Drive saat klik <strong>Simpan Dokumen</strong>.
                </p>
              </>
            )}
            {uploadError ? (
              <p role="alert" className="text-sm text-danger-500">
                {uploadError}
              </p>
            ) : null}
          </div>
          <Input
            label="Catatan (opsional)"
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, 500))}
            disabled={submitting}
          />
          {error ? (
            <p role="alert" className="mt-2 text-sm font-medium text-danger-500">
              {error}
            </p>
          ) : null}
          <Button
            onClick={handleAdd}
            loading={submitting}
            className="mt-3"
          >
            <Plus className="size-4" aria-hidden /> Simpan Dokumen
          </Button>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-neutral-900">
            Daftar Dokumen
          </h3>
          {loading ? (
            <div className="flex h-20 items-center justify-center">
              <Spinner className="size-5 text-mahakan-green-700" />
            </div>
          ) : docs.length === 0 ? (
            <p className="rounded-md border border-dashed border-neutral-300 bg-neutral-50 p-3 text-center text-sm italic text-neutral-500">
              Belum ada dokumen.
            </p>
          ) : (
            <ul className="space-y-2">
              {docs.map((d) => (
                <li
                  key={d.id}
                  className="flex items-start justify-between gap-3 rounded-md border border-neutral-200 bg-white p-3"
                >
                  <div className="flex min-w-0 items-start gap-2">
                    <FileText
                      className="mt-0.5 size-4 shrink-0 text-neutral-500"
                      aria-hidden
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-neutral-900">
                          {d.title}
                        </span>
                        <Badge variant="neutral">
                          {DOC_TYPE_LABELS[d.docType as DocumentType]}
                        </Badge>
                        {d.expiresAt ? (
                          (() => {
                            const days = differenceInCalendarDays(
                              parseISO(d.expiresAt),
                              new Date(),
                            );
                            const variant: "danger" | "warning" | "success" =
                              days < 0
                                ? "danger"
                                : days <= 30
                                  ? "warning"
                                  : "success";
                            const stamp =
                              days < 0
                                ? `Expired ${Math.abs(days)}h lalu`
                                : days === 0
                                  ? "Expire hari ini"
                                  : days <= 30
                                    ? `Expire ${days}h lagi`
                                    : `Exp ${d.expiresAt}`;
                            return <Badge variant={variant}>{stamp}</Badge>;
                          })()
                        ) : null}
                      </div>
                      {d.fileUrl ? (
                        <a
                          href={d.fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block truncate text-xs text-mahakan-green-700 hover:underline"
                        >
                          {d.fileUrl}
                        </a>
                      ) : null}
                      {d.notes ? (
                        <p className="text-xs italic text-neutral-600">
                          {d.notes}
                        </p>
                      ) : null}
                      <p className="text-[10px] text-neutral-400">
                        Ditambah {formatIndonesianDateTime(d.createdAt)}
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDelete(d)}
                    className="!text-danger-500 hover:!bg-danger-100/40"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
