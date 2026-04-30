"use client";

import { useEffect, useState } from "react";
import { Button, Modal, Select, toast } from "@/components/ui";
import {
  bulkAssignSection,
  isOk,
  type IngredientSection,
} from "@/features/inventory";

interface SectionAssignModalProps {
  open: boolean;
  ingredientIds: string[];
  onClose: () => void;
  onSaved: () => void;
}

const OPTIONS: Array<{ value: IngredientSection | "__none"; label: string }> = [
  { value: "kitchen", label: "Kitchen" },
  { value: "bar", label: "Bar" },
  { value: "supporting", label: "Supporting Supplies" },
  { value: "cleaning", label: "Cleaning Supplies" },
  { value: "__none", label: "Belum diset (clear)" },
];

export function SectionAssignModal({
  open,
  ingredientIds,
  onClose,
  onSaved,
}: SectionAssignModalProps) {
  const [target, setTarget] = useState<IngredientSection | "__none">(
    "kitchen",
  );
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setTarget("kitchen");
    setSubmitting(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open]);

  async function onSubmit() {
    if (submitting) return;
    setSubmitting(true);
    const res = await bulkAssignSection({
      ingredientIds,
      section: target === "__none" ? null : (target as IngredientSection),
    });
    setSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(
      `${res.data.updated} bahan di-set ke ${
        OPTIONS.find((o) => o.value === target)?.label ?? target
      }`,
    );
    onSaved();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Set Section — ${ingredientIds.length} bahan dipilih`}
      description="Section bahan akan di-update sekaligus untuk semua yang dipilih. Bisa pilih 'Belum diset' untuk clear assignment."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button
            onClick={onSubmit}
            loading={submitting}
            disabled={ingredientIds.length === 0}
          >
            Terapkan
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Select
          label="Section target"
          options={OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          value={target}
          onValueChange={(v) =>
            setTarget(v as IngredientSection | "__none")
          }
        />
      </div>
    </Modal>
  );
}
