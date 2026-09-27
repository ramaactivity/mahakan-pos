"use client";

/**
 * Sesi AE-235 — "who is serving?" chip picker for every POS action.
 *
 * The tablet stays logged in as the shift opener, so the session user says
 * nothing about who actually rang up, edited or took payment. Every action
 * awaits `pickCrew(label)` first; there is no default selection and no skip
 * (owner requirement). Cancelling the picker cancels the action.
 *
 * Rendered as its own overlay above z-50 because POS modals are not
 * portalled — the picker must sit on top of the payment/close-bill modal
 * that triggered it.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { listPosCrew } from "./actions";
import type { PosCrew } from "./types";

type PickCrew = (actionLabel: string) => Promise<PosCrew | null>;

const CrewPickerContext = createContext<PickCrew | null>(null);

/**
 * Resolves to the chosen crew, or null when the cashier cancels.
 * Returns null OUTSIDE the POS (back office reuses some POS modals; there the
 * logged-in user is the actor and callers send `fromBackOffice` instead).
 */
export function useCrewPicker(): PickCrew | null {
  return useContext(CrewPickerContext);
}

const CACHE_MS = 60_000;
/* Last list kept on the device so the picker still works while the tablet is
 * offline (sales are queued locally then). */
const STORAGE_KEY = "mahakan.posCrew";

function readCachedCrew(): PosCrew[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PosCrew[]) : null;
  } catch {
    return null;
  }
}

export function CrewPickerProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<{ label: string } | null>(null);
  const [crew, setCrew] = useState<PosCrew[] | null>(null);
  const [showOthers, setShowOthers] = useState(false);
  const resolver = useRef<((c: PosCrew | null) => void) | null>(null);
  const fetchedAt = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const list = await listPosCrew();
      setCrew(list);
      fetchedAt.current = Date.now();
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      } catch {
        // storage blocked — the in-memory list still works
      }
    } catch {
      // offline or server error: fall back to the device copy
      setCrew((prev) => prev ?? readCachedCrew());
    }
  }, []);

  useEffect(() => {
    let alive = true;
    listPosCrew()
      .then((list) => {
        if (!alive) return;
        setCrew(list);
        fetchedAt.current = Date.now();
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
        } catch {
          // storage blocked
        }
      })
      .catch(() => {
        if (alive) setCrew(readCachedCrew());
      });
    return () => {
      alive = false;
    };
  }, []);

  const pickCrew = useCallback<PickCrew>(
    (actionLabel) => {
      if (Date.now() - fetchedAt.current > CACHE_MS) void refresh();
      setShowOthers(false);
      setRequest({ label: actionLabel });
      return new Promise<PosCrew | null>((resolve) => {
        resolver.current = resolve;
      });
    },
    [refresh],
  );

  const finish = (c: PosCrew | null) => {
    resolver.current?.(c);
    resolver.current = null;
    setRequest(null);
  };

  const onDuty = crew?.filter((c) => c.onDuty) ?? [];
  const others = crew?.filter((c) => !c.onDuty) ?? [];
  // Nobody clocked in (attendance down / forgot): show everyone right away.
  const othersOpen = showOthers || (crew !== null && onDuty.length === 0);

  return (
    <CrewPickerContext.Provider value={pickCrew}>
      {children}
      {request ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-neutral-900/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="crew-picker-title"
        >
          <div className="w-full max-w-lg rounded-2xl bg-neutral-50 p-5 shadow-xl">
            <div className="mb-1 flex items-center gap-2 text-mahakan-green-700">
              <Users className="size-5" />
              <h2 id="crew-picker-title" className="text-lg font-semibold text-neutral-900">
                Siapa yang melayani?
              </h2>
            </div>
            <p className="mb-4 text-sm text-neutral-600">
              {request.label}. Pilih nama crew yang sedang melakukan aksi ini.
            </p>

            {crew === null ? (
              <p className="py-6 text-center text-sm text-neutral-500">Memuat daftar crew…</p>
            ) : crew.length === 0 ? (
              <div className="py-6 text-center text-sm text-neutral-600">
                Daftar crew kosong.{" "}
                <button type="button" className="font-medium text-mahakan-green-700 underline" onClick={() => void refresh()}>
                  Muat ulang
                </button>
              </div>
            ) : (
              <>
                {onDuty.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {onDuty.map((c) => (
                      <CrewChip key={c.id} crew={c} onPick={finish} />
                    ))}
                  </div>
                ) : (
                  <p className="mb-2 text-sm text-warning-500">
                    Belum ada crew yang absen masuk. Pilih dari semua crew.
                  </p>
                )}

                {others.length > 0 ? (
                  <div className="mt-4">
                    {onDuty.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setShowOthers((v) => !v)}
                        className="text-sm font-medium text-mahakan-green-700"
                      >
                        {othersOpen ? "Sembunyikan crew lain" : `Crew lain (belum absen) · ${others.length}`}
                      </button>
                    ) : null}
                    {othersOpen ? (
                      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {others.map((c) => (
                          <CrewChip key={c.id} crew={c} onPick={finish} />
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => finish(null)}
                className="min-h-11 rounded-lg px-4 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
              >
                Batal
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </CrewPickerContext.Provider>
  );
}

function CrewChip({ crew, onPick }: { crew: PosCrew; onPick: (c: PosCrew) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPick(crew)}
      className={cn(
        "min-h-14 rounded-xl border px-3 py-2 text-left text-base font-semibold transition-colors",
        crew.onDuty
          ? "border-mahakan-green-200 bg-white text-neutral-900 hover:border-mahakan-green-700 hover:bg-mahakan-green-50"
          : "border-neutral-200 bg-neutral-100 text-neutral-700 hover:border-neutral-400",
      )}
    >
      {crew.name}
      {!crew.onDuty ? <span className="block text-xs font-normal text-neutral-500">belum absen</span> : null}
    </button>
  );
}
