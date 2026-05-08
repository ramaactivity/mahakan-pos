"use client";

import { cn } from "@/lib/utils";

interface StaffAvatarGridProps {
  users: ReadonlyArray<{ id: string; name: string; role: string }>;
  selectedId: string | null;
  onSelect: (userId: string) => void;
  className?: string;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  supervisor: "Supervisor",
  staff: "Staff",
};

/**
 * Staff avatar selection grid — sesi AD-6b redesign.
 *
 * Trigger 4-col layout via `landscape:md:` (≥768px landscape) which
 * reliably matches Galaxy A7 Lite landscape (1340×800). Earlier `lg:`
 * (1024) was inconsistent on Chrome Android.
 *
 * Responsive col count:
 *   - 2 cols: phone portrait (default)
 *   - 3 cols: phone landscape / tablet portrait (sm: ≥640)
 *   - 4 cols: tablet landscape (landscape:md:) + desktop (lg:)
 *
 * Tile dims: p-2.5, size-12 avatar = ~96px height. 7 users at 4-col =
 * 2 rows ≈ 210px. Fits in 60% card width × ~560px height on tablet
 * landscape comfortably.
 */
export function StaffAvatarGrid({
  users,
  selectedId,
  onSelect,
  className,
}: StaffAvatarGridProps) {
  if (users.length === 0) {
    return (
      <p className="text-center text-sm text-neutral-600">
        Belum ada staff terdaftar.
      </p>
    );
  }
  return (
    <div
      role="radiogroup"
      aria-label="Pilih user"
      className={cn(
        "grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-2.5 landscape:md:grid-cols-4 landscape:md:gap-2.5 lg:gap-3",
        className,
      )}
    >
      {users.map((u) => {
        const isSelected = u.id === selectedId;
        const roleLabel = ROLE_LABEL[u.role] ?? u.role.toUpperCase();
        return (
          <button
            type="button"
            key={u.id}
            role="radio"
            aria-checked={isSelected}
            onClick={() => onSelect(u.id)}
            className={cn(
              "flex flex-col items-center gap-1.5 rounded-xl border bg-white p-2.5 transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700 focus-visible:ring-offset-2",
              "active:scale-[0.97]",
              isSelected
                ? "border-mahakan-green-700 bg-mahakan-green-50 shadow-sm"
                : "border-neutral-200 hover:border-mahakan-green-300",
            )}
          >
            <div
              className={cn(
                "flex size-12 items-center justify-center rounded-full text-base font-bold",
                isSelected
                  ? "bg-mahakan-green-700 text-white"
                  : "bg-mahakan-green-100 text-mahakan-green-800",
              )}
            >
              {initials(u.name)}
            </div>
            <span className="line-clamp-1 w-full text-center text-sm font-medium text-neutral-900">
              {u.name}
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
              {roleLabel}
            </span>
          </button>
        );
      })}
    </div>
  );
}
