"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  toast,
} from "@/components/ui";
// Direct imports (not via barrel) so client bundle doesn't see server-only
// deps from actions.ts → @/lib/email/send.
import {
  listApprovalCodes,
  revokeApprovalCode,
} from "@/features/approval-codes/actions";
import { isOk, type ApprovalCode } from "@/features/approval-codes/types";

const ACTION_LABEL: Record<string, string> = {
  "pos.transaction.void": "Void",
  "pos.transaction.refund": "Refund",
};

type CodeStatus = "active" | "consumed" | "revoked" | "expired";

function deriveStatus(code: ApprovalCode): CodeStatus {
  if (code.consumedAt) return "consumed";
  if (code.revokedAt) return "revoked";
  if (new Date(code.expiresAt).getTime() < Date.now()) return "expired";
  return "active";
}

function fmtTime(d: Date | string): string {
  return new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(new Date(d));
}

function fmtDateTime(d: Date | string): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(new Date(d));
}

export function ApprovalCodesPanel() {
  const [rows, setRows] = useState<ApprovalCode[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const res = await listApprovalCodes(50);
    if (isOk(res)) setRows(res.data);
    setLoading(false);
  }

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    void load();
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const stats = useMemo(() => {
    if (!rows) return { active: 0, consumed: 0, expired: 0, revoked: 0 };
    let active = 0,
      consumed = 0,
      expired = 0,
      revoked = 0;
    for (const r of rows) {
      const s = deriveStatus(r);
      if (s === "active") active++;
      else if (s === "consumed") consumed++;
      else if (s === "expired") expired++;
      else if (s === "revoked") revoked++;
    }
    return { active, consumed, expired, revoked };
  }, [rows]);

  async function handleRevoke(id: string) {
    if (revokingId) return;
    setRevokingId(id);
    const res = await revokeApprovalCode(id);
    setRevokingId(null);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Kode di-revoke");
    await load();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>
              <ShieldCheck className="mr-2 inline size-5" aria-hidden /> Approval
              Codes (Void / Refund)
            </CardTitle>
            <CardDescription>
              Kode 6-digit yang dikirim ke email Owner saat staff minta approval
              void/refund. Owner-only.
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void load()}>
            <RefreshCw className="size-4" /> Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          <Badge variant="success">Aktif: {stats.active}</Badge>
          <Badge variant="info">Consumed: {stats.consumed}</Badge>
          <Badge variant="warning">Expired: {stats.expired}</Badge>
          <Badge variant="danger">Revoked: {stats.revoked}</Badge>
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : !rows || rows.length === 0 ? (
          <p className="rounded-md bg-neutral-50 p-4 text-center text-sm text-neutral-500">
            Belum ada approval code di-issue.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-3 py-2 text-left">Waktu</th>
                  <th className="px-3 py-2 text-left">Aksi</th>
                  <th className="px-3 py-2 text-left">Kode</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Expiry</th>
                  <th className="px-3 py-2 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {rows.map((r) => {
                  const status = deriveStatus(r);
                  return (
                    <tr key={r.id} className="hover:bg-neutral-50">
                      <td className="px-3 py-3 text-xs text-neutral-700">
                        {fmtDateTime(r.createdAt)}
                      </td>
                      <td className="px-3 py-3 text-sm">
                        {ACTION_LABEL[r.actionType] ?? r.actionType}
                      </td>
                      <td className="px-3 py-3 font-mono text-xs">
                        {r.codeFirstTwo}…
                      </td>
                      <td className="px-3 py-3 text-xs">
                        <StatusBadge status={status} />
                      </td>
                      <td className="px-3 py-3 text-xs text-neutral-600">
                        {fmtTime(r.expiresAt)} WIB
                      </td>
                      <td className="px-3 py-3 text-right">
                        {status === "active" ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={revokingId === r.id}
                            onClick={() => void handleRevoke(r.id)}
                          >
                            <ShieldX className="size-3.5" />
                            {revokingId === r.id ? "..." : "Revoke"}
                          </Button>
                        ) : (
                          <span className="text-neutral-400 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: CodeStatus }) {
  if (status === "active") {
    return (
      <Badge variant="success">
        <ShieldCheck className="size-3" aria-hidden /> Aktif
      </Badge>
    );
  }
  if (status === "consumed") {
    return (
      <Badge variant="info">
        <ShieldCheck className="size-3" aria-hidden /> Consumed
      </Badge>
    );
  }
  if (status === "revoked") {
    return (
      <Badge variant="danger">
        <ShieldX className="size-3" aria-hidden /> Revoked
      </Badge>
    );
  }
  return (
    <Badge variant="warning">
      <ShieldAlert className="size-3" aria-hidden /> Expired
    </Badge>
  );
}
