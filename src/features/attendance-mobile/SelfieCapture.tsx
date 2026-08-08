"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui";
import { compressSelfieJpeg } from "./compress-selfie";
import { formatBytes } from "./format-bytes";

/**
 * Sesi AE-194 — capture selfie absensi langsung dari kamera live.
 *
 * MASALAH YANG DIPERBAIKI:
 *   Jalur lama satu-satunya = `<input type="file" capture="user">`, lalu
 *   server wajib lihat EXIF DateTimeOriginal buat mastiin fotonya baru
 *   (anti upload-galeri). Masalahnya EXIF itu di luar kendali kita:
 *   sejumlah HP/browser (mis. iPhone yang motret HEIC lalu di-convert
 *   Safari ke JPEG saat upload) mengirim JPEG TANPA EXIF sama sekali.
 *   Akibatnya karyawan yang jujur ditolak dengan
 *   "EXIF DateTimeOriginal tidak ada" dan absen jadi mentok — persis yang
 *   kejadian saat staff ganti HP.
 *
 * SOLUSINYA:
 *   Ambil foto dari stream kamera live (getUserMedia) → gambar ke canvas
 *   → JPEG. Foto hasil canvas memang tidak punya EXIF, tapi EXIF-nya jadi
 *   TIDAK PERLU: browser tidak pernah membuka file picker, jadi secara
 *   desain mustahil mengambil foto lama dari galeri. Jaminan "foto diambil
 *   sekarang" datang dari mekanisme capture-nya, bukan dari metadata yang
 *   gampang hilang/dipalsu.
 *
 *   Jalur file input tetap dipertahankan sebagai cadangan (browser dalam
 *   aplikasi seperti WhatsApp kadang blokir kamera). Di jalur itu aturan
 *   EXIF lama tetap berlaku ketat.
 */

export type CaptureMethod = "live" | "file";

type CamState =
  | "idle" /* belum start — tampilkan tombol Buka Kamera */
  | "starting"
  | "streaming"
  | "denied" /* user tolak izin kamera */
  | "unsupported"; /* browser tidak punya getUserMedia / gagal start */

/** Sisi terpanjang foto hasil capture. Cukup buat verifikasi wajah,
 *  hasilnya ~150-400 KB jadi aman dari limit body 4.5 MB Vercel. */
const CAPTURE_SIZE = 1280;

export function SelfieCapture({
  disabled,
  onCaptured,
  onCleared,
  onBusyChange,
}: {
  disabled: boolean;
  onCaptured: (file: File, method: CaptureMethod) => void;
  onCleared: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [camState, setCamState] = useState<CamState>("idle");
  const [camError, setCamError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [method, setMethod] = useState<CaptureMethod | null>(null);
  const [compressInfo, setCompressInfo] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewRef = useRef<string | null>(null);

  const setBusyBoth = useCallback(
    (v: boolean) => {
      setBusy(v);
      onBusyChange(v);
    },
    [onBusyChange],
  );

  const stopCamera = useCallback(() => {
    const s = streamRef.current;
    if (s) {
      for (const track of s.getTracks()) track.stop();
      streamRef.current = null;
    }
    const v = videoRef.current;
    if (v) v.srcObject = null;
  }, []);

  /* Lepas kamera + object URL saat komponen dilepas — kalau tidak, lampu
   * kamera HP tetap nyala setelah absen selesai. */
  useEffect(() => {
    return () => {
      stopCamera();
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, [stopCamera]);

  /* srcObject baru bisa di-set setelah <video> ter-render, jadi pasang di
   * effect — bukan langsung di dalam startCamera(). */
  useEffect(() => {
    if (camState !== "streaming") return;
    const v = videoRef.current;
    const s = streamRef.current;
    if (!v || !s || v.srcObject === s) return;
    v.srcObject = s;
    /* iOS Safari butuh play() eksplisit walau ada autoPlay. */
    void v.play().catch(() => {});
  }, [camState]);

  function replacePreview(url: string | null) {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = url;
    setPreview(url);
  }

  async function startCamera() {
    setCamError(null);
    /* Browser dalam aplikasi (WhatsApp/IG) lama tidak punya getUserMedia
     * sama sekali. Kita masih di dalam gesture tap user, jadi file picker
     * boleh dibuka langsung — staff cukup tap sekali, tidak dua kali. */
    if (typeof navigator.mediaDevices?.getUserMedia !== "function") {
      setCamState("unsupported");
      fileInputRef.current?.click();
      return;
    }
    setCamState("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "user" },
          width: { ideal: CAPTURE_SIZE },
          height: { ideal: CAPTURE_SIZE },
        },
        audio: false,
      });
      streamRef.current = stream;
      setCamState("streaming");
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setCamState("denied");
        setCamError(
          "Izin kamera ditolak. Buka pengaturan browser → izinkan Kamera untuk situs ini, lalu tap Coba Lagi.",
        );
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setCamState("unsupported");
        setCamError("Kamera depan tidak terdeteksi di HP ini.");
      } else {
        setCamState("unsupported");
        setCamError(
          "Kamera live tidak bisa dibuka di browser ini. Pakai tombol cadangan di bawah.",
        );
      }
    }
  }

  async function captureFromStream() {
    const v = videoRef.current;
    if (!v || !v.videoWidth || !v.videoHeight) {
      setCamError("Kamera belum siap — tunggu gambar muncul lalu tap lagi.");
      return;
    }
    setBusyBoth(true);
    setCamError(null);
    try {
      /* Crop tengah jadi kotak biar sama dengan preview & rasio foto
       * absen sebelumnya. */
      const side = Math.min(v.videoWidth, v.videoHeight);
      const out = Math.min(side, CAPTURE_SIZE);
      const canvas = document.createElement("canvas");
      canvas.width = out;
      canvas.height = out;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas tidak tersedia");
      ctx.drawImage(
        v,
        (v.videoWidth - side) / 2,
        (v.videoHeight - side) / 2,
        side,
        side,
        0,
        0,
        out,
        out,
      );
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.85),
      );
      if (!blob) throw new Error("Gagal encode foto");
      const file = new File([blob], "selfie-live.jpg", {
        type: "image/jpeg",
      });
      stopCamera();
      setCamState("idle");
      replacePreview(URL.createObjectURL(file));
      setMethod("live");
      setCompressInfo(null);
      onCaptured(file, "live");
    } catch {
      setCamError("Gagal ambil foto dari kamera. Coba lagi.");
    } finally {
      setBusyBoth(false);
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    /* Reset value supaya memilih file yang sama dua kali tetap memicu
     * onChange (kasus "Foto Ulang" lalu batal). */
    e.target.value = "";
    if (!f) return;
    setCamError(null);
    setCompressInfo(null);
    setBusyBoth(true);
    try {
      /* Sesi AE-42 — compress JPEG di client sebelum upload. Vercel
       * Hobby plan reject body > 4.5 MB di edge dengan HTML 413; HP
       * modern selfie 12MP bisa 3-8 MB. Compress preserve EXIF supaya
       * server anti-fraud check (DateTimeOriginal) tetap lulus. */
      const result = await compressSelfieJpeg(f, {
        maxBytes: 1.5 * 1024 * 1024,
        maxDimension: CAPTURE_SIZE,
      });
      replacePreview(URL.createObjectURL(result.file));
      setMethod("file");
      if (result.compressedSize < result.originalSize) {
        const pct = Math.round(
          (1 - result.compressedSize / result.originalSize) * 100,
        );
        setCompressInfo(
          `Foto ter-kompres ${pct}% (${formatBytes(result.originalSize)} → ${formatBytes(result.compressedSize)})${
            result.exifPreserved ? "" : " ⚠️ EXIF strip"
          }`,
        );
      }
      onCaptured(result.file, "file");
    } catch {
      // Defensive: kalau compression gagal, kirim original — server
      // tetap reject kalau > limit, dengan pesan error yang lebih jelas.
      replacePreview(URL.createObjectURL(f));
      setMethod("file");
      onCaptured(f, "file");
    } finally {
      setBusyBoth(false);
    }
  }

  function handleRetake() {
    replacePreview(null);
    setMethod(null);
    setCompressInfo(null);
    setCamError(null);
    onCleared();
    if (camState === "unsupported" || camState === "denied") {
      fileInputRef.current?.click();
    } else {
      void startCamera();
    }
  }

  const liveBlocked = camState === "unsupported" || camState === "denied";

  return (
    <div className="rounded-xl border-2 border-neutral-200 bg-white p-4">
      <p className="mb-2 text-sm font-semibold text-neutral-900">
        Selfie wajib dari kamera depan
      </p>

      {preview ? (
        <div className="space-y-2">
          <div className="relative overflow-hidden rounded-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview}
              alt="Selfie preview"
              className="aspect-square w-full object-cover"
            />
            {busy ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
                <div className="flex items-center gap-2 rounded-lg bg-black/60 px-3 py-2 text-sm">
                  <Loader2 className="size-4 animate-spin" /> Memproses foto…
                </div>
              </div>
            ) : null}
          </div>
          <Button
            variant="outline"
            size="sm"
            fullWidth
            onClick={handleRetake}
            disabled={disabled || busy}
          >
            <RotateCcw className="size-4" /> Foto Ulang
          </Button>
        </div>
      ) : camState === "streaming" ? (
        <div className="space-y-2">
          <div className="relative overflow-hidden rounded-lg bg-neutral-900">
            <video
              ref={videoRef}
              playsInline
              autoPlay
              muted
              className="aspect-square w-full -scale-x-100 object-cover"
            />
            {busy ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
                <Loader2 className="size-6 animate-spin" />
              </div>
            ) : null}
          </div>
          <Button
            fullWidth
            onClick={captureFromStream}
            disabled={disabled || busy}
            className="!h-14"
          >
            <Camera className="size-5" /> Ambil Foto
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          fullWidth
          onClick={() =>
            liveBlocked ? fileInputRef.current?.click() : void startCamera()
          }
          disabled={disabled || busy || camState === "starting"}
          className="!h-16 !flex-col !gap-1"
        >
          {camState === "starting" || busy ? (
            <>
              <Loader2 className="size-6 animate-spin" />
              <span className="text-sm">
                {busy ? "Memproses foto…" : "Menyalakan kamera…"}
              </span>
            </>
          ) : (
            <>
              <Camera className="size-6" />
              <span className="text-sm">Buka Kamera</span>
            </>
          )}
        </Button>
      )}

      {/* Jalur cadangan: kamera bawaan HP lewat file input. Dipakai kalau
       * getUserMedia diblokir (browser dalam aplikasi WhatsApp/IG). */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="user"
        className="hidden"
        onChange={handleFileChange}
        disabled={disabled || busy}
      />

      {camError ? (
        <div className="mt-2 flex items-start gap-2 rounded-lg border border-warning-500 bg-warning-100 p-2 text-xs text-warning-700">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <p>{camError}</p>
            {camState === "denied" ? (
              <button
                type="button"
                onClick={() => void startCamera()}
                className="mt-1 font-semibold underline"
              >
                Coba Lagi
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {!preview && liveBlocked ? (
        <p className="mt-2 text-[11px] text-neutral-500">
          Kamera live tidak jalan di browser ini. Tombol di atas akan membuka
          kamera bawaan HP. Kalau tetap ditolak, buka link absen ini di Chrome
          atau Safari (bukan dari dalam aplikasi WhatsApp/Instagram).
        </p>
      ) : !preview && camState !== "streaming" ? (
        <p className="mt-2 text-[11px] text-neutral-500">
          Foto diambil langsung dari kamera depan saat ini. Upload dari galeri
          tidak bisa dilakukan.
        </p>
      ) : null}

      {method === "file" ? (
        <button
          type="button"
          onClick={() => void startCamera()}
          disabled={disabled || busy}
          className="mt-2 text-[11px] text-neutral-500 underline disabled:opacity-50"
        >
          Pakai kamera live (kalau foto dari kamera bawaan ditolak)
        </button>
      ) : null}

      {compressInfo ? (
        <p className="mt-1 text-[11px] text-mahakan-green-900">
          ✓ {compressInfo}
        </p>
      ) : null}
    </div>
  );
}
