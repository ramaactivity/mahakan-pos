"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  toast,
} from "@/components/ui";
import { useSession } from "@/features/auth/SessionProvider";
import { isOk, shiftService } from "@/mocks/services";
import { formatRupiah, parseRupiah } from "@/lib/format";

export default function OpenShiftPage() {
  const router = useRouter();
  const { session } = useSession();

  const [openingCash, setOpeningCash] = useState("100000");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!session) return null;

  let parsedAmount = 0;
  try {
    parsedAmount = parseRupiah(openingCash);
  } catch {
    parsedAmount = 0;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (parsedAmount < 0) {
      setError("Kas awal tidak boleh negatif");
      return;
    }
    setSubmitting(true);
    setError(null);

    const res = await shiftService.openShift(session!.user.id, parsedAmount);
    if (!isOk(res)) {
      setError(res.error.message);
      setSubmitting(false);
      return;
    }

    toast.success(`Shift dibuka — kas awal ${formatRupiah(parsedAmount)}`);
    router.replace("/pos");
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <Link
        href="/pos"
        className="inline-flex items-center gap-1 text-sm font-medium text-neutral-700 hover:text-neutral-900"
      >
        <ArrowLeft className="size-4" aria-hidden /> Kembali
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>Buka Shift</CardTitle>
          <CardDescription>
            Hitung kas yang ada di laci sekarang dan masukkan jumlahnya.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <Input
              label="Kas Awal"
              type="text"
              inputMode="numeric"
              value={openingCash}
              onChange={(e) =>
                setOpeningCash(e.target.value.replace(/[^\d]/g, ""))
              }
              hint={`Preview: ${formatRupiah(parsedAmount)}`}
              required
              disabled={submitting}
            />
            {error ? (
              <p role="alert" className="text-sm font-medium text-danger-500">
                {error}
              </p>
            ) : null}
            <Button
              type="submit"
              loading={submitting}
              fullWidth
              size="lg"
              disabled={parsedAmount < 0}
            >
              Mulai Shift
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
