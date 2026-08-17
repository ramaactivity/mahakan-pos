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
 *
 * SESI AE-200 — kenapa jalur cadangan itu justru jadi jebakan:
 *   Audit produksi 45 hari: SEMUA 15 penolakan EXIF milik satu orang
 *   (Siti Sarah, ganti HP 28 Juli — sejak itu fotonya nol EXIF), dan
 *   SEMUA absennya yang berhasil lewat jalur "live". Polanya selalu sama:
 *   ditolak 1-3× di jalur "file" dulu, baru berhasil setelah dia menemukan
 *   tautan kecil "Pakai kamera live".
 *
 *   Sebabnya ada di komponen ini: begitu getUserMedia gagal SEKALI (izin
 *   belum diberikan, kamera lagi dipakai aplikasi lain, dibuka dari
 *   browser-dalam-aplikasi), state langsung jatuh ke "unsupported"/"denied"
 *   dan file picker DIBUKA OTOMATIS. Setelah itu tombol utama + tombol
 *   "Foto Ulang" ikut mengarah ke kamera bawaan HP — staff terkunci di
 *   jalur EXIF ketat sampai akhir sesi, padahal kamera live-nya sebenarnya
 *   jalan kalau dicoba lagi.
 *
 *   Yang berubah:
 *     1. Kamera live dicoba BERTINGKAT (3 set constraint) sebelum menyerah.
 *     2. Kegagalan yang bisa pulih (kamera dipakai aplikasi lain) tidak
 *        lagi dianggap "browser tidak mendukung".
 *     3. File picker TIDAK PERNAH dibuka otomatis. Jalur cadangan harus
 *        dipilih sadar oleh staff, lengkap dengan peringatannya.
 *     4. "Foto Ulang" selalu kembali mencoba kamera live dulu.
 *     5. Kalau foto jalur cadangan ternyata tanpa EXIF, staff diberi tahu
 *        SEBELUM submit + tombol satu-tap pindah ke kamera live — tidak
 *        perlu lagi ditolak server dulu baru tahu.
 */

export type CaptureMethod = "live" | "file";

type CamState =
  | "idle" /* belum start — tampilkan tombol Buka Kamera */
  | "starting"
  | "streaming"
  | "busy" /* kamera dipakai aplikasi lain — bisa dicoba lagi */
  | "denied" /* user tolak izin kamera */
  | "unsupported"; /* browser tidak punya getUserMedia / gagal start */

/** Sisi terpanjang foto hasil capture. Cukup buat verifikasi wajah,
 *  hasilnya ~150-400 KB jadi aman dari limit body 4.5 MB Vercel. */
const CAPTURE_SIZE = 1280;

/* Sesi AE-200 — tangga constraint. HP tertentu menolak permintaan
 * resolusi/facingMode tertentu; jangan menyerah ke jalur EXIF ketat cuma
 * gara-gara set pertama tidak cocok. Set terakhir sengaja paling longgar. */
const CONSTRAINT_LADDER: MediaStreamConstraints[] = [
  {
    video: {
      facingMode: { ideal: "user" },
      width: { ideal: CAPTURE_SIZE },
      height: { ideal: CAPTURE_SIZE },
    },
    audio: false,
  },
  { video: { facingMode: "user" }, audio: false },
  { video: true, audio: false },
];

/** Browser di dalam aplikasi lain (WhatsApp/Instagram/Facebook/Line) —
 *  di sini izin kamera sering diblokir oleh aplikasi induknya. */
function isInAppBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /\b(FBAN|FBAV|Instagram|Line|WhatsApp)\b/i.test(navigator.userAgent);
}

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
  /* Sesi AE-200 — foto jalur cadangan yang datang tanpa EXIF. Server pasti
   * menolaknya, jadi kasih tahu duluan di sini. */
  const [fileMissingExif, setFileMissingExif] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewRef = useRef<string | null>(null);
  /* getUserMedia bisa selesai SETELAH komponen dilepas (staff tap Batal
   * saat izin kamera masih ditanyakan). Tanpa penanda ini stream-nya
   * nyangkut dan lampu kamera HP tetap menyala. */
  const mountedRef = useRef(true);

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
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
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
    setFileMissingExif(false);
    /* Lepas stream lama dulu — "Foto Ulang" bisa memanggil ini saat kamera
     * masih hidup, dan dua stream sekaligus bikin sebagian HP gagal. */
    stopCamera();
    /* Browser dalam aplikasi (WhatsApp/IG) lama tidak punya getUserMedia
     * sama sekali. Sesi AE-200: JANGAN buka file picker otomatis di sini —
     * itu yang diam-diam mengunci staff ke jalur EXIF ketat. Tampilkan
     * tombol cadangan yang harus dipilih sadar. */
    if (typeof navigator.mediaDevices?.getUserMedia !== "function") {
      setCamState("unsupported");
      setCamError(
        isInAppBrowser()
          ? "Kamera diblokir karena halaman ini dibuka dari dalam aplikasi lain (WhatsApp/Instagram). Buka lewat aplikasi Mahakan Staff atau Chrome/Safari."
          : "Browser ini tidak mendukung kamera live. Buka halaman absen di Chrome atau Safari.",
      );
      return;
    }
    setCamState("starting");

    /* Coba bertingkat — hanya penolakan izin yang langsung berhenti,
     * sisanya lanjut ke constraint yang lebih longgar. */
    let lastError: unknown = null;
    for (const constraints of CONSTRAINT_LADDER) {
      try {
        const stream =
          await navigator.mediaDevices.getUserMedia(constraints);
        if (!mountedRef.current) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        streamRef.current = stream;
        setCamState("streaming");
        return;
      } catch (e) {
        lastError = e;
        const name = e instanceof DOMException ? e.name : "";
        if (name === "NotAllowedError" || name === "SecurityError") break;
      }
    }

    const name = lastError instanceof DOMException ? lastError.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      setCamState("denied");
      /* Kalau Permissions API ada, bedakan "belum dijawab" vs "diblokir
       * permanen" — instruksinya beda jauh buat staff. */
      let blockedPermanently = false;
      try {
        const status = await navigator.permissions?.query({
          name: "camera" as PermissionName,
        });
        blockedPermanently = status?.state === "denied";
      } catch {
        /* Permissions API tidak support 'camera' (Safari) — abaikan. */
      }
      setCamError(
        blockedPermanently
          ? "Izin kamera diblokir untuk situs ini. Buka menu browser → Setelan situs → Kamera → Izinkan, lalu tap Coba Lagi."
          : "Izin kamera belum diberikan. Tap Coba Lagi, lalu pilih Izinkan saat browser bertanya.",
      );
      return;
    }
    if (
      name === "NotReadableError" ||
      name === "AbortError" ||
      name === "TrackStartError"
    ) {
      /* Kamera dipegang aplikasi lain. Ini PULIH sendiri — jangan
       * turunkan ke jalur file input. */
      setCamState("busy");
      setCamError(
        "Kamera sedang dipakai aplikasi lain (Kamera/WhatsApp/Video call). Tutup aplikasi itu, lalu tap Coba Lagi.",
      );
      return;
    }
    setCamState("unsupported");
    setCamError(
      name === "NotFoundError" || name === "OverconstrainedError"
        ? "Kamera depan tidak terdeteksi di HP ini."
        : "Kamera live gagal dibuka. Tap Coba Lagi — kalau tetap gagal, pakai tombol cadangan di bawah.",
    );
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
      setFileMissingExif(false);
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
      /* Sesi AE-200 — tanpa segmen EXIF, server PASTI menolak. Bilang
       * sekarang, jangan bikin staff submit dulu baru ditolak. */
      setFileMissingExif(!result.exifPreserved);
      if (result.compressedSize < result.originalSize) {
        const pct = Math.round(
          (1 - result.compressedSize / result.originalSize) * 100,
        );
        setCompressInfo(
          `Foto ter-kompres ${pct}% (${formatBytes(result.originalSize)} → ${formatBytes(result.compressedSize)})`,
        );
      }
      onCaptured(result.file, "file");
    } catch {
      // Defensive: kalau compression gagal, kirim original — server
      // tetap reject kalau > limit, dengan pesan error yang lebih jelas.
      replacePreview(URL.createObjectURL(f));
      setMethod("file");
      setFileMissingExif(false);
      onCaptured(f, "file");
    } finally {
      setBusyBoth(false);
    }
  }

  /* Sesi AE-200 — "Foto Ulang" SELALU balik ke kamera live dulu. Dulu
   * kalau state-nya pernah gagal sekali, tombol ini terus membuka kamera
   * bawaan HP sampai akhir sesi. */
  function handleRetake() {
    replacePreview(null);
    setMethod(null);
    setCompressInfo(null);
    setCamError(null);
    setFileMissingExif(false);
    onCleared();
    void startCamera();
  }

  function switchToLive() {
    replacePreview(null);
    setMethod(null);
    setCompressInfo(null);
    setFileMissingExif(false);
    onCleared();
    void startCamera();
  }

  const liveFailed =
    camState === "unsupported" ||
    camState === "denied" ||
    camState === "busy";

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
        /* Sesi AE-200 — tombol utama SELALU kamera live, apa pun state-nya.
         * Jalur cadangan punya tombolnya sendiri di bawah. */
        <Button
          variant="outline"
          fullWidth
          onClick={() => void startCamera()}
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
              <span className="text-sm">
                {liveFailed ? "Coba Lagi — Kamera Live" : "Buka Kamera"}
              </span>
            </>
          )}
        </Button>
      )}

      {/* Jalur cadangan: kamera bawaan HP lewat file input. Dipakai kalau
       * getUserMedia diblokir (browser dalam aplikasi WhatsApp/IG).
       * Sesi AE-200 — tidak pernah dibuka otomatis lagi. */}
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
          <p className="min-w-0 flex-1">{camError}</p>
        </div>
      ) : null}

      {/* Sesi AE-200 — peringatan sebelum submit: foto jalur cadangan tanpa
       * EXIF pasti ditolak server. Satu tap untuk pindah ke kamera live. */}
      {fileMissingExif ? (
        <div className="mt-2 space-y-2 rounded-lg border-2 border-danger-300 bg-danger-100 p-3 text-xs text-danger-700">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p className="min-w-0 flex-1">
              <span className="font-semibold">
                Foto ini kemungkinan besar ditolak.
              </span>{" "}
              Kamera bawaan HP kamu tidak menyimpan info waktu di foto, jadi
              sistem tidak bisa memastikan fotonya baru. Pakai kamera live —
              itu tidak butuh info waktu.
            </p>
          </div>
          <Button
            size="sm"
            fullWidth
            onClick={switchToLive}
            disabled={disabled || busy}
          >
            <Camera className="size-4" /> Pakai Kamera Live
          </Button>
        </div>
      ) : null}

      {!preview && liveFailed ? (
        <div className="mt-2 space-y-1">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || busy}
            className="w-full rounded-lg border border-neutral-300 py-2 text-xs font-medium text-neutral-700 disabled:opacity-50"
          >
            Pakai kamera bawaan HP (cadangan)
          </button>
          <p className="text-[11px] text-neutral-500">
            Jalur cadangan sering ditolak di HP yang tidak menyimpan info
            waktu di foto. Kalau bisa, betulkan izin kamera lalu tap Coba
            Lagi di atas.
          </p>
        </div>
      ) : !preview && camState !== "streaming" ? (
        <p className="mt-2 text-[11px] text-neutral-500">
          Foto diambil langsung dari kamera depan saat ini. Upload dari galeri
          tidak bisa dilakukan.
        </p>
      ) : null}

      {method === "file" && !fileMissingExif ? (
        <button
          type="button"
          onClick={switchToLive}
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
