"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ModalSize = "sm" | "md" | "lg" | "xl";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  size?: ModalSize;
  /** If true, clicking backdrop does NOT close (force user to use buttons). */
  disableBackdropClose?: boolean;
  /** If true, pressing ESC does NOT close. */
  disableEscClose?: boolean;
  /** Optional footer area (usually action buttons). */
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
}

const sizeStyles: Record<ModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-2xl",
};

export function Modal({
  open,
  onClose,
  title,
  description,
  size = "md",
  disableBackdropClose = false,
  disableEscClose = false,
  footer,
  children,
  className,
}: ModalProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // ESC to close + lock body scroll when open
  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !disableEscClose) {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);

    // Focus first focusable inside modal
    const timer = setTimeout(() => {
      const focusable = contentRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      focusable?.focus();
    }, 0);

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      clearTimeout(timer);
      previouslyFocused.current?.focus();
    };
  }, [open, disableEscClose, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? "modal-title" : undefined}
      aria-describedby={description ? "modal-description" : undefined}
    >
      <button
        type="button"
        aria-label="Tutup"
        tabIndex={-1}
        onClick={disableBackdropClose ? undefined : onClose}
        className={cn(
          "absolute inset-0 bg-neutral-900/50 backdrop-blur-sm transition-opacity",
          disableBackdropClose ? "cursor-default" : "cursor-pointer",
        )}
      />
      <div
        ref={contentRef}
        className={cn(
          "relative w-full rounded-xl bg-white p-6 shadow-xl",
          sizeStyles[size],
          className,
        )}
      >
        {title ? (
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className="space-y-1">
              <h2
                id="modal-title"
                className="text-lg font-semibold text-neutral-900"
              >
                {title}
              </h2>
              {description ? (
                <p id="modal-description" className="text-sm text-neutral-500">
                  {description}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              aria-label="Tutup dialog"
              onClick={onClose}
              className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
            >
              <X className="size-5" />
            </button>
          </div>
        ) : null}
        <div className={title ? "" : "pt-2"}>{children}</div>
        {footer ? (
          <div className="mt-6 flex items-center justify-end gap-2 border-t border-neutral-200 pt-4">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
