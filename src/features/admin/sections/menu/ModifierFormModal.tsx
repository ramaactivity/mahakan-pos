"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  Button,
  Input,
  Modal,
  NumericInput,
  Select,
  toast,
} from "@/components/ui";
import {
  createModifier,
  updateModifier,
  isOk,
  type Category,
  type Modifier,
  type ModifierFormInput,
} from "@/features/menu";

type Mode = { kind: "create" } | { kind: "edit"; modifier: Modifier };

interface ModifierFormModalProps {
  open: boolean;
  mode: Mode | null;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}

interface OptionDraft {
  value: string;
  label: string;
}

export function ModifierFormModal({
  open,
  mode,
  categories,
  onClose,
  onSaved,
}: ModifierFormModalProps) {
  const [slug, setSlug] = useState("");
  const [label, setLabel] = useState("");
  const [type, setType] = useState<"single_select" | "toggle">("toggle");
  const [price, setPrice] = useState("0");
  const [options, setOptions] = useState<OptionDraft[]>([]);
  const [appliesAll, setAppliesAll] = useState(true);
  const [appliesTo, setAppliesTo] = useState<string[]>([]);
  const [isActive, setIsActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !mode) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setError(null);
    setSubmitting(false);
    if (mode.kind === "edit") {
      const m = mode.modifier;
      setSlug(m.slug);
      setLabel(m.label);
      setType(m.type);
      setPrice(String(m.price));
      setOptions(
        m.optionsJson?.map((o) => ({ value: o.value, label: o.label })) ?? [],
      );
      setAppliesAll(!m.appliesToCategories);
      setAppliesTo(m.appliesToCategories ?? []);
      setIsActive(m.isActive);
    } else {
      setSlug("");
      setLabel("");
      setType("toggle");
      setPrice("0");
      setOptions([{ value: "small", label: "Small" }]);
      setAppliesAll(true);
      setAppliesTo([]);
      setIsActive(true);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, mode]);

  function addOption() {
    setOptions((prev) => [...prev, { value: "", label: "" }]);
  }

  function removeOption(idx: number) {
    setOptions((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateOption(idx: number, field: keyof OptionDraft, value: string) {
    setOptions((prev) =>
      prev.map((o, i) => (i === idx ? { ...o, [field]: value } : o)),
    );
  }

  function toggleCategory(id: string) {
    setAppliesTo((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  }

  async function onSubmit() {
    if (!mode || submitting) return;
    const parsedPrice = parseInt(price, 10);
    if (Number.isNaN(parsedPrice)) {
      setError("Harga harus angka");
      return;
    }
    const input: ModifierFormInput = {
      slug: slug.trim(),
      label: label.trim(),
      type,
      price: parsedPrice,
      options:
        type === "single_select"
          ? options.map((o) => ({ value: o.value.trim(), label: o.label.trim() }))
          : null,
      appliesToCategories: appliesAll ? null : appliesTo,
      isActive,
    };
    setSubmitting(true);
    setError(null);
    const res =
      mode.kind === "create"
        ? await createModifier(input)
        : await updateModifier(input);
    if (!isOk(res)) {
      setError(res.error.message);
      setSubmitting(false);
      return;
    }
    toast.success(
      mode.kind === "create" ? "Modifier dibuat" : "Modifier diperbarui",
    );
    setSubmitting(false);
    onSaved();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        mode?.kind === "create" ? "Tambah Modifier" : `Edit ${mode?.modifier.label ?? ""}`
      }
      size="lg"
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
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Slug (kode)"
            type="text"
            value={slug}
            onChange={(e) =>
              setSlug(
                e.target.value
                  .toLowerCase()
                  .replace(/[^a-z0-9_]/g, "")
                  .slice(0, 60),
              )
            }
            placeholder="extra_shot"
            disabled={mode?.kind === "edit" || submitting}
            hint={
              mode?.kind === "edit"
                ? "Slug tidak bisa diubah setelah dibuat"
                : "Huruf kecil, angka, underscore. Max 60 karakter."
            }
            required
          />
          <Input
            label="Label (tampil)"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value.slice(0, 120))}
            placeholder="Extra Shot"
            disabled={submitting}
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Tipe"
            value={type}
            onValueChange={(v) =>
              setType(v as "single_select" | "toggle")
            }
            options={[
              { value: "toggle", label: "Toggle (yes/no)" },
              { value: "single_select", label: "Single select (pilihan)" },
            ]}
          />
          <NumericInput
            label="Harga (Rp)"
            value={price}
            onChange={setPrice}
            prefix="Rp"
            disabled={submitting}
            hint={
              type === "toggle"
                ? "Harga tambahan saat toggle ON"
                : "Harga dasar (semua pilihan kena harga ini)"
            }
          />
        </div>

        {type === "single_select" ? (
          <div className="space-y-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-neutral-900">Pilihan</p>
              <Button
                size="sm"
                variant="outline"
                onClick={addOption}
                disabled={submitting}
              >
                <Plus className="size-4" /> Tambah Pilihan
              </Button>
            </div>
            {options.length === 0 ? (
              <p className="text-xs italic text-neutral-500">
                Belum ada pilihan. Tap &ldquo;Tambah Pilihan&rdquo; untuk mulai.
              </p>
            ) : (
              <div className="space-y-2">
                {options.map((opt, idx) => (
                  <div key={idx} className="flex items-end gap-2">
                    <div className="flex-1">
                      <Input
                        label={idx === 0 ? "Value (kode)" : undefined}
                        type="text"
                        value={opt.value}
                        onChange={(e) =>
                          updateOption(
                            idx,
                            "value",
                            e.target.value
                              .toLowerCase()
                              .replace(/[^a-z0-9_]/g, ""),
                          )
                        }
                        placeholder="small"
                        disabled={submitting}
                      />
                    </div>
                    <div className="flex-1">
                      <Input
                        label={idx === 0 ? "Label" : undefined}
                        type="text"
                        value={opt.label}
                        onChange={(e) => updateOption(idx, "label", e.target.value)}
                        placeholder="Small"
                        disabled={submitting}
                      />
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeOption(idx)}
                      disabled={submitting || options.length === 1}
                      aria-label={`Hapus pilihan ${idx + 1}`}
                    >
                      <Trash2 className="size-4 text-danger-500" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

        <div className="space-y-2">
          <p className="text-sm font-medium text-neutral-900">
            Berlaku untuk Kategori
          </p>
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-neutral-200 p-2 hover:bg-neutral-50">
            <input
              type="checkbox"
              checked={appliesAll}
              onChange={(e) => setAppliesAll(e.target.checked)}
              disabled={submitting}
              className="size-4 rounded border-neutral-300 text-mahakan-green-700 focus:ring-mahakan-green-700"
            />
            <span className="text-sm">Semua kategori (global)</span>
          </label>
          {!appliesAll ? (
            <div className="grid grid-cols-2 gap-2">
              {categories.map((c) => (
                <label
                  key={c.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md border border-neutral-200 p-2 hover:bg-neutral-50"
                >
                  <input
                    type="checkbox"
                    checked={appliesTo.includes(c.id)}
                    onChange={() => toggleCategory(c.id)}
                    disabled={submitting}
                    className="size-4 rounded border-neutral-300 text-mahakan-green-700 focus:ring-mahakan-green-700"
                  />
                  <span className="text-sm">{c.name}</span>
                </label>
              ))}
            </div>
          ) : null}
        </div>

        <label className="flex cursor-pointer items-center gap-2 rounded-md border border-neutral-200 p-2 hover:bg-neutral-50">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            disabled={submitting}
            className="size-4 rounded border-neutral-300 text-mahakan-green-700 focus:ring-mahakan-green-700"
          />
          <span className="text-sm">Aktif (tampil di POS)</span>
        </label>

        {error ? (
          <p role="alert" className="text-sm font-medium text-danger-500">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
