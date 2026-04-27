"use client";

import { useEffect, useState } from "react";
import { Button, Input, Modal, toast } from "@/components/ui";
import {
  isOk,
  updateBusinessInfo,
  type Outlet,
} from "@/features/outlets";

interface Props {
  open: boolean;
  outlet: Outlet;
  onClose: () => void;
  onSaved: (next: Outlet) => void;
}

export function BusinessInfoModal({ open, outlet, onClose, onSaved }: Props) {
  const [name, setName] = useState(outlet.name);
  const [address, setAddress] = useState(outlet.address ?? "");
  const [phone, setPhone] = useState(outlet.phone ?? "");
  const [logoUrl, setLogoUrl] = useState(outlet.logoUrl ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setName(outlet.name);
    setAddress(outlet.address ?? "");
    setPhone(outlet.phone ?? "");
    setLogoUrl(outlet.logoUrl ?? "");
    setError(null);
    setSubmitting(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, outlet]);

  async function onSubmit() {
    if (submitting) return;
    if (name.trim().length === 0) {
      setError("Nama wajib diisi");
      return;
    }
    setSubmitting(true);
    setError(null);
    const res = await updateBusinessInfo({
      name: name.trim(),
      address: address.trim() || null,
      phone: phone.trim() || null,
      logoUrl: logoUrl.trim() || null,
    });
    if (!isOk(res)) {
      setError(res.error.message);
      setSubmitting(false);
      return;
    }
    toast.success("Info bisnis tersimpan");
    onSaved(res.data);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit Info Bisnis"
      description="Tampil di header struk + dokumen ekspor."
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
        <Input
          label="Nama Bisnis"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          required
        />
        <Input
          label="Alamat"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          maxLength={500}
          placeholder="Puncak Rd No.KM 22, Cisarua, Bogor Regency, West Java 16750"
        />
        <Input
          label="Telepon"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          maxLength={40}
          placeholder="0838-1977-5665"
        />
        <Input
          label="URL Logo"
          value={logoUrl}
          onChange={(e) => setLogoUrl(e.target.value)}
          maxLength={500}
          placeholder="/assets/logo/Logo_Mahakan_Hijau_Transparent.png"
          hint="Path relatif ke /public atau URL eksternal."
        />
        {error ? (
          <p role="alert" className="text-sm font-medium text-danger-500">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
