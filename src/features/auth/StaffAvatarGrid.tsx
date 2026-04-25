"use client";

import { cn } from "@/lib/utils";
import type { PublicUser } from "@/mocks/types";

interface StaffAvatarGridProps {
  users: PublicUser[];
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

export function StaffAvatarGrid({
  users,
  selectedId,
  onSelect,
  className,
}: StaffAvatarGridProps) {
  if (users.length === 0) {
    return (
      <p className="text-center text-sm text-neutral-500">
        Belum ada staff terdaftar.
      </p>
    );
  }
  return (
    <div
      role="radiogroup"
      aria-label="Pilih user"
      className={cn("grid grid-cols-3 gap-3", className)}
    >
      {users.map((u) => {
        const isSelected = u.id === selectedId;
        return (
          <button
            type="button"
            key={u.id}
            role="radio"
            aria-checked={isSelected}
            onClick={() => onSelect(u.id)}
            className={cn(
              "flex flex-col items-center gap-2 rounded-xl border p-3 transition-all",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700 focus-visible:ring-offset-2",
              "active:scale-95",
              isSelected
                ? "border-mahakan-green-700 bg-mahakan-green-50 shadow-sm"
                : "border-neutral-200 bg-white hover:border-neutral-300",
            )}
          >
            <div
              className={cn(
                "flex size-14 items-center justify-center rounded-full text-lg font-bold",
                isSelected
                  ? "bg-mahakan-green-700 text-white"
                  : "bg-mahakan-green-100 text-mahakan-green-800",
              )}
            >
              {initials(u.name)}
            </div>
            <span className="text-center text-sm font-medium text-neutral-900 line-clamp-2">
              {u.name}
            </span>
            <span className="text-xs uppercase tracking-wider text-neutral-500">
              {u.role}
            </span>
          </button>
        );
      })}
    </div>
  );
}
