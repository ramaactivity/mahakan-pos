"use client";

import { useEffect, useState } from "react";
import { Button, Modal } from "@/components/ui";

interface ItemNoteModalProps {
  open: boolean;
  initialValue: string | null;
  onClose: () => void;
  onSave: (note: string | null) => void;
}

export function ItemNoteModal({
  open,
  initialValue,
  onClose,
  onSave,
}: ItemNoteModalProps) {
  const [note, setNote] = useState("");

  useEffect(() => {
    // Sync from props when modal opens with new initialValue
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNote(initialValue ?? "");
  }, [initialValue, open]);

  function onSubmit() {
    onSave(note.trim() === "" ? null : note.trim());
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Catatan Item"
      description='Contoh: "tolong agak panas", "gula aren aja"'
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button onClick={onSubmit}>Simpan</Button>
        </>
      }
    >
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={200}
        rows={4}
        placeholder="Catatan barista (max 200 karakter)…"
        className="w-full rounded-md border border-neutral-300 bg-white p-3 text-base text-neutral-900 placeholder:text-neutral-500 focus:border-mahakan-green-700 focus:outline-none"
      />
      <p className="mt-1 text-right text-xs text-neutral-500">
        {note.length} / 200
      </p>
    </Modal>
  );
}
