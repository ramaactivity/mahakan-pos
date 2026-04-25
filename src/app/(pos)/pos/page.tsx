"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui";
import { useSession } from "@/features/auth/SessionProvider";

export default function PosStubPage() {
  const { session } = useSession();
  if (!session) return null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold text-mahakan-green-900">
          Selamat bekerja, {session.user.name}
        </h1>
        <p className="text-neutral-700">
          Ini POS screen (stub). Menu grid, cart, dan payment flow ke-wire di
          M5 (POS UI Prototype).
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Shift Aktif</CardTitle>
          <CardDescription>Stub — shift logic di M5/M12</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-neutral-500">
            Buka shift dulu sebelum mulai transaksi. UI open-shift belum di-wire
            — tunggu M5.
          </p>
        </CardContent>
      </Card>
      <Card variant="emphasis">
        <CardContent>
          <p className="text-sm text-mahakan-green-900">
            Role: <strong>{session.user.role}</strong> · Session valid hingga{" "}
            <span className="font-mono">
              {new Date(session.expires).toLocaleString("id-ID")}
            </span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
