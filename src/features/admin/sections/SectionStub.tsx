"use client";

import { Construction } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui";

interface SectionStubProps {
  title: string;
  description: string;
  /** Brief notes — what's coming, in which chunk. */
  notes?: string[];
}

export function SectionStub({ title, description, notes }: SectionStubProps) {
  return (
    <div className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-mahakan-green-900">{title}</h1>
        <p className="text-sm text-neutral-700">{description}</p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Construction className="size-5 text-warning-500" aria-hidden />
            Segera Hadir
          </CardTitle>
          <CardDescription>
            Section ini sedang dalam pengembangan. Lihat{" "}
            <span className="font-mono text-mahakan-green-700">
              docs/99-EXECUTION-PLAN.md
            </span>{" "}
            untuk roadmap lengkap.
          </CardDescription>
        </CardHeader>
        {notes && notes.length > 0 ? (
          <CardContent>
            <ul className="list-inside list-disc space-y-1 text-sm text-neutral-700">
              {notes.map((n, idx) => (
                <li key={idx}>{n}</li>
              ))}
            </ul>
          </CardContent>
        ) : null}
      </Card>
    </div>
  );
}
