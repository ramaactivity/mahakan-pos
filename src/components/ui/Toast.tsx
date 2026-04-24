"use client";

import { Toaster as SonnerToaster, toast as sonnerToast } from "sonner";

/**
 * Global toast container — mount once at app root.
 * Usage (client component):
 *   import { toast } from "@/components/ui/Toast";
 *   toast.success("Struk tercetak");
 *   toast.error("Printer gagal terhubung");
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      richColors
      closeButton
      duration={3000}
      toastOptions={{
        className: "font-sans",
      }}
    />
  );
}

export const toast = sonnerToast;
