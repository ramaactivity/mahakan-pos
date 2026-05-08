"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ModalSize = "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "full" | "fullscreen";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  size?: ModalSize;
  /**
   * Defaults to `true` — backdrop tap is a no-op so users do not lose form
   * data from accidental taps (terutama di tablet POS). Pass `false`
   * eksplisit kalau modal benar-benar mau backdrop-tap = cancel.
   */
  disableBackdropClose?: boolean;
  /** If true, pressing ESC does NOT close. */
  disableEscClose?: boolean;
  /** Optional footer area (usually action buttons). Sticky at bottom. */
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Body padding override — default px-6 py-5; set "none" to control spacing manually. */
  bodyPadding?: "default" | "compact" | "none";
}

// `fullscreen` = edge-to-edge on touch devices (POS tablet kiosk),
// centered max-w-6xl on pointer:fine (desktop). The `touch:` variants
// (defined in globals.css) flip layout for Galaxy A7 Lite operations.
const sizeStyles: Record<ModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-2xl",
  "2xl": "max-w-3xl",
  "3xl": "max-w-4xl",
  full: "max-w-[min(95vw,80rem)]",
  fullscreen:
    "max-w-[min(95vw,72rem)] touch:!max-w-full touch:!h-screen touch:!max-h-screen touch:!rounded-none",
};

const bodyPaddingStyles = {
  default: "px-6 py-5",
  compact: "px-4 py-3",
  none: "",
} as const;

export function Modal({
  open,
  onClose,
  title,
  description,
  size = "md",
  disableBackdropClose = true,
  disableEscClose = false,
  footer,
  children,
  className,
  bodyPadding = "default",
}: ModalProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Lifecycle: lock body scroll, capture previously focused, autofocus first
  // focusable inside modal. Depends ONLY on `open` — must NOT re-run on every
  // parent render (would steal focus away from the input being typed in).
  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const timer = setTimeout(() => {
      const focusable = contentRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      focusable?.focus();
    }, 0);

    return () => {
      document.body.style.overflow = prevOverflow;
      clearTimeout(timer);
      previouslyFocused.current?.focus();
    };
  }, [open]);

  // ESC handler — separate effect so re-binding on onClose change does not
  // disturb focus. No-op when disableEscClose is true.
  useEffect(() => {
    if (!open || disableEscClose) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, disableEscClose, onClose]);

  if (!open) return null;

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center",
        size === "fullscreen" ? "p-4 touch:p-0" : "p-2 sm:p-4",
      )}
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
          "relative flex w-full flex-col overflow-hidden rounded-xl bg-white shadow-xl",
          // fullscreen: tablet (touch:) overrides applied via sizeStyles (!max-w-full !h-screen !max-h-screen !rounded-none).
          // pointer:fine fallback gets max-h-[92vh] like other sizes.
          size === "fullscreen" ? "max-h-[92vh]" : "max-h-[92vh]",
          sizeStyles[size],
          className,
        )}
      >
        {title ? (
          <header
            className={cn(
              "sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-neutral-200 bg-white",
              size === "fullscreen" ? "px-4 py-3 touch:px-5 touch:py-2.5" : "px-6 py-4",
            )}
          >
            <div className="space-y-0.5">
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
          </header>
        ) : null}
        <div
          className={cn(
            "flex-1",
            // fullscreen modals delegate scroll to inner panels (e.g. 2-col layouts).
            // Other sizes use auto-scroll at body level for simple content.
            size === "fullscreen" ? "overflow-hidden" : "overflow-y-auto",
            bodyPaddingStyles[bodyPadding],
          )}
        >
          {children}
        </div>
        {footer ? (
          <footer
            className={cn(
              "sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-2 border-t border-neutral-200 bg-white",
              size === "fullscreen" ? "px-4 py-2.5 touch:px-5 touch:py-2.5" : "px-6 py-3",
            )}
          >
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
