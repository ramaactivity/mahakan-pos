"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui";
import { useSession } from "@/features/auth/SessionProvider";

export default function DashboardStubPage() {
  const { session } = useSession();
  if (!session) return null;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold text-mahakan-green-900">
          Halo, {session.user.name}
        </h1>
        <p className="text-neutral-700">
          Ini dashboard back office (stub). Stat cards + charts ke-wire di M6
          (Admin UI Prototype).
        </p>
      </header>
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Omzet Hari Ini</CardTitle>
            <CardDescription>Stub — real data di M14</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-3xl font-bold text-neutral-900">
              Rp —
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Transaksi</CardTitle>
            <CardDescription>Stub</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-3xl font-bold text-neutral-900">—</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Rata-rata per Trx</CardTitle>
            <CardDescription>Stub</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-3xl font-bold text-neutral-900">
              Rp —
            </p>
          </CardContent>
        </Card>
      </div>
      <Card variant="emphasis">
        <CardContent>
          <p className="text-sm text-mahakan-green-900">
            Logged in sebagai <strong>{session.user.role}</strong>. Session
            expires:{" "}
            <span className="font-mono">
              {new Date(session.expires).toLocaleString("id-ID")}
            </span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
