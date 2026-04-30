"use client";

import { useEffect, useState } from "react";
import { FileText, Plus, Trash2 } from "lucide-react";
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

  // Add-form state
  const [docType, setDocType] = useState<DocumentType>("ktp");
  const [title, setTitle] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !employee) return;
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    setDocType("ktp");
    setTitle("");
    setFileUrl("");
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

  async function handleAdd() {
    if (!employee) return;
    if (submitting) return;
    setError(null);
    if (title.trim().length === 0) {
      setError("Judul dokumen wajib diisi");
      return;
    }
    setSubmitting(true);
    const res = await createEmployeeDocument({
      employeeId: employee.id,
      docType,
      title: title.trim(),
      fileUrl: fileUrl.trim() || null,
      expiresAt: expiresAt || null,
      notes: notes.trim() || null,
    });
    setSubmitting(false);
    if (!isOk(res)) {
      setError(res.error.message);
      return;
    }
    toast.success("Dokumen ditambahkan");
    setTitle("");
    setFileUrl("");
    setExpiresAt("");
    setNotes("");
    setRefreshKey((k) => k + 1);
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
      description="Tracking metadata dokumen HR. Upload file akan ditambahkan di sesi berikutnya — sekarang isi link/url manual."
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
            <Input
              label="Link / URL (opsional)"
              type="url"
              value={fileUrl}
              onChange={(e) => setFileUrl(e.target.value.slice(0, 500))}
              placeholder="https://..."
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
            <Plus className="size-4" aria-hidden /> Tambah
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
                          <Badge variant="warning">
                            Exp {d.expiresAt}
                          </Badge>
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
