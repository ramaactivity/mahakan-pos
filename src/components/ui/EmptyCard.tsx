"use client";

import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "./Card";
import { cn } from "@/lib/utils";

interface EmptyCardProps {
  /** Icon component from lucide-react. Optional but recommended. */
  icon?: LucideIcon;
  /** Main heading — short, neutral-700, font-medium. Required. */
  title: string;
  /** Supplementary helper text — neutral-500, smaller. Optional. */
  description?: string;
  /** Optional action slot (button, link). Rendered below text with mt-4 spacing. */
  action?: React.ReactNode;
  /** Override Card padding/className kalau perlu lebih compact. */
  className?: string;
}

/**
 * Phase 9.2 — uniform empty state primitive untuk admin list views.
 * Replicates the polished sesi Y pattern (icon + title + helper text + CTA)
 * sebagai single source of truth.
 *
 * Usage:
 * ```
 * {items.length === 0 ? (
 *   <EmptyCard
 *     icon={Sparkles}
 *     title="Belum ada promo"
 *     description="Buat promo pertama supaya staff bisa apply di POS."
 *     action={
 *       <Button onClick={openCreate}>
 *         <Plus className="size-4" /> Buat Promo
 *       </Button>
 *     }
 *   />
 * ) : null}
 * ```
 */
export function EmptyCard({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyCardProps) {
  return (
    <Card className={className}>
      <CardContent className={cn("py-12 text-center")}>
        {Icon ? (
          <Icon
            className="mx-auto size-10 text-neutral-300"
            aria-hidden
          />
        ) : null}
        <p
          className={cn(
            "text-sm font-medium text-neutral-700",
            Icon ? "mt-3" : "",
          )}
        >
          {title}
        </p>
        {description ? (
          <p className="mt-1 text-xs text-neutral-500">{description}</p>
        ) : null}
        {action ? <div className="mt-4">{action}</div> : null}
      </CardContent>
    </Card>
  );
}
