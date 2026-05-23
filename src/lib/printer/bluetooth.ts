"use client";

/**
 * Web Bluetooth wrapper for ESC/POS thermal printers (e.g. RPP02).
 *
 * Pair-once-per-origin model: Chrome remembers the device after the
 * initial requestDevice() user gesture. We persist the device id in
 * localStorage so reconnect on page load can target the same printer.
 *
 * BLE quirks:
 * - GATT connection drops if the page goes to background → re-connect
 *   on next print attempt.
 * - Default MTU is 20 bytes per write; we chunk at 180 (closer to BLE
 *   standard MTU 185 + 5 byte ATT overhead) since printer murah suka
 *   reject chunk > negotiated MTU.
 * - First requestDevice MUST happen inside a click handler — browser
 *   blocks programmatic prompts.
 * - Sesi AE-48 (audit Tier 2) — staff feedback: struk berantakan kalau
 *   pesanan banyak (>3 item). Root cause: chunks dikirim back-to-back
 *   tanpa delay → printer buffer overflow / byte drop → printer
 *   mis-interpret data lanjut sebagai ESC commands acak → output
 *   garbled mulai item ke-4. Fix: 20ms inter-chunk delay. Total
 *   overhead ~80ms untuk receipt 4-chunk (acceptable trade-off).
 */

const SERVICE_UUID = "000018f0-0000-1000-8000-00805f9b34fb";
const WRITE_CHARACTERISTIC_UUID = "00002af1-0000-1000-8000-00805f9b34fb";
const STORAGE_KEY = "mahakan-pos.bluetooth.device-id";
const CHUNK_SIZE = 180;
const INTER_CHUNK_DELAY_MS = 20;

// Minimal Web Bluetooth surface — TS lib.dom has these only in newer
// versions / behind opt-in flags. Inlining keeps deps small and explicit.

interface BluetoothRemoteGATTCharacteristic {
  writeValue(value: BufferSource): Promise<void>;
}

interface BluetoothRemoteGATTService {
  getCharacteristic(uuid: string): Promise<BluetoothRemoteGATTCharacteristic>;
}

interface BluetoothRemoteGATTServer {
  connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<BluetoothRemoteGATTService>;
}

interface BluetoothDevice extends EventTarget {
  id?: string;
  name?: string;
  gatt?: BluetoothRemoteGATTServer;
}

interface NavigatorBluetooth {
  bluetooth: {
    requestDevice(opts: {
      filters?: Array<{ services?: string[]; namePrefix?: string }>;
      optionalServices?: string[];
      acceptAllDevices?: boolean;
    }): Promise<BluetoothDevice>;
    getDevices?: () => Promise<BluetoothDevice[]>;
  };
}

export type ConnectionState = "idle" | "pairing" | "connecting" | "connected" | "error";

export interface PrinterStatus {
  state: ConnectionState;
  deviceName: string | null;
  error: string | null;
}

export function isWebBluetoothSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "bluetooth" in navigator &&
    typeof (navigator as unknown as NavigatorBluetooth).bluetooth?.requestDevice ===
      "function"
  );
}

class PrinterClient {
  private device: BluetoothDevice | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private listeners = new Set<(s: PrinterStatus) => void>();
  private status: PrinterStatus = {
    state: "idle",
    deviceName: null,
    error: null,
  };

  getStatus(): PrinterStatus {
    return this.status;
  }

  subscribe(fn: (s: PrinterStatus) => void): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private setStatus(patch: Partial<PrinterStatus>) {
    this.status = { ...this.status, ...patch };
    for (const fn of this.listeners) fn(this.status);
  }

  /**
   * Trigger pairing UI. Must be called from a user-gesture event handler
   * (button onClick) or browser will reject. Persists device id on success.
   *
   * Sesi P fix: pakai filter `services + namePrefix` untuk show ONLY thermal
   * printer yang advertise SERVICE_UUID atau punya nama familiar (BT, RPP,
   * MTP, POS, GP, SPRT, Thermal, Printer). Sebelumnya pakai
   * `acceptAllDevices: true` jadi tablet show earphone/phone/jam tangan
   * sebagai "Perangkat Tidak Dikenal" — Galih lapor printer-nya tidak
   * detect karena tertimbun signal lain.
   *
   * Kalau filter terlalu strict dan printer tidak muncul, user bisa retry
   * via `pairAcceptAll()` (escape hatch).
   */
  async pair(opts: { acceptAll?: boolean } = {}): Promise<void> {
    if (!isWebBluetoothSupported()) {
      throw new Error(
        "Web Bluetooth tidak didukung. Pakai Chrome/Edge di Android.",
      );
    }
    this.setStatus({ state: "pairing", error: null });
    try {
      const nav = navigator as unknown as NavigatorBluetooth;
      const requestOptions: Record<string, unknown> = opts.acceptAll
        ? {
            acceptAllDevices: true,
            optionalServices: [SERVICE_UUID],
          }
        : {
            // Filter array — Chrome OR semantics: any matching filter shows.
            // Cover umum thermal printer brands + ESC/POS service UUID.
            filters: [
              { services: [SERVICE_UUID] },
              { namePrefix: "Printer" },
              { namePrefix: "BT-" },
              { namePrefix: "BlueTooth" },
              { namePrefix: "Bluetooth" },
              { namePrefix: "POS" },
              { namePrefix: "Thermal" },
              { namePrefix: "RPP" },
              { namePrefix: "MTP" },
              { namePrefix: "MPT" },
              { namePrefix: "GP-" },
              { namePrefix: "GPRT" },
              { namePrefix: "SPRT" },
              { namePrefix: "ZJ-" },
              { namePrefix: "PT-" },
              { namePrefix: "Star" },
              { namePrefix: "EPSON" },
            ],
            optionalServices: [SERVICE_UUID],
          };

      const device = (await nav.bluetooth.requestDevice(
        requestOptions,
      )) as BluetoothDevice;

      this.device = device;
      try {
        if (device.id && typeof localStorage !== "undefined") {
          localStorage.setItem(STORAGE_KEY, device.id);
        }
      } catch {
        // localStorage might be blocked; non-critical
      }
      this.setStatus({
        state: "idle",
        deviceName: device.name ?? "Unknown printer",
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Pairing dibatalkan";
      this.setStatus({ state: "error", error: message });
      throw e;
    }
  }

  /** Escape hatch: filter terlalu strict, izinkan user pilih device apapun.
   * Owner pakai kalau printer mereka tidak match prefix umum. */
  async pairAcceptAll(): Promise<void> {
    return this.pair({ acceptAll: true });
  }

  /**
   * Connect to the previously paired device. Idempotent — if already
   * connected, returns immediately.
   */
  async connect(): Promise<void> {
    if (!this.device) {
      throw new Error("Printer belum di-pair. Tap 'Pair' dulu.");
    }
    if (this.characteristic && this.device.gatt?.connected) return;

    this.setStatus({ state: "connecting", error: null });
    try {
      const server = await this.device.gatt!.connect();
      const service = await server.getPrimaryService(SERVICE_UUID);
      const ch = await service.getCharacteristic(WRITE_CHARACTERISTIC_UUID);
      this.characteristic = ch;

      this.device.addEventListener("gattserverdisconnected", () => {
        this.characteristic = null;
        this.setStatus({ state: "idle" });
      });

      this.setStatus({ state: "connected" });
    } catch (e) {
      const raw = e instanceof Error ? e.message : "Connect gagal";
      const message = /not found|no device|gatt server is disconnected/i.test(
        raw,
      )
        ? "Printer tidak ketemu. Cek printer on + Bluetooth tablet aktif."
        : `Gagal connect ke printer (${truncate(raw, 80)})`;
      this.setStatus({ state: "error", error: message });
      throw new Error(message);
    }
  }

  /**
   * Send raw bytes. Auto-connects if not yet connected. Chunks at
   * CHUNK_SIZE because BLE writes have an MTU ceiling.
   *
   * Sesi AE-133 — Retry once kalau GATT operation gagal mid-stream.
   * Penyebab umum: tablet sleep beberapa menit → OS-level drop GATT
   * tanpa firing `gattserverdisconnected` reliably → `writeValue()`
   * throw "GATT operation failed for unknown reason". Force re-connect
   * + ulang dari awal stream lebih reliable daripada lempar error ke
   * kasir. Total cost extra: 1-3 detik reconnect saat connection stale.
   */
  async send(bytes: Uint8Array): Promise<void> {
    if (!this.characteristic || !this.device?.gatt?.connected) {
      await this.connect();
    }
    if (!this.characteristic) {
      throw new Error(friendlyPrinterError("characteristic_missing"));
    }
    try {
      await this.writeChunked(bytes);
    } catch (e) {
      const original = e instanceof Error ? e : new Error(String(e));
      const looksStale =
        /gatt|disconnected|not connected|in progress|operation failed/i.test(
          original.message ?? "",
        );
      if (!looksStale) {
        throw new Error(friendlyPrinterError("write_failed", original.message));
      }
      /* Reset state and reconnect — kemungkinan besar BLE link sudah
       * silently drop. */
      this.characteristic = null;
      try {
        if (this.device?.gatt?.connected) this.device.gatt.disconnect();
      } catch {
        /* ignore — best-effort cleanup */
      }
      this.setStatus({ state: "idle", error: null });
      try {
        await this.connect();
      } catch (connectErr) {
        throw new Error(
          friendlyPrinterError(
            "reconnect_failed",
            connectErr instanceof Error ? connectErr.message : undefined,
          ),
        );
      }
      if (!this.characteristic) {
        throw new Error(friendlyPrinterError("characteristic_missing"));
      }
      try {
        await this.writeChunked(bytes);
      } catch (retryErr) {
        throw new Error(
          friendlyPrinterError(
            "retry_failed",
            retryErr instanceof Error ? retryErr.message : undefined,
          ),
        );
      }
    }
  }

  private async writeChunked(bytes: Uint8Array): Promise<void> {
    if (!this.characteristic) {
      throw new Error("Characteristic tidak tersedia");
    }
    for (let off = 0; off < bytes.length; off += CHUNK_SIZE) {
      const chunk = bytes.slice(off, off + CHUNK_SIZE);
      await this.characteristic.writeValue(chunk);
      // Inter-chunk delay (sesi AE-48) — kasih waktu printer process
      // buffer sebelum chunk berikutnya. Tanpa delay → byte drop di
      // BLE thermal printer murah (RPP02 + klone) saat receipt panjang.
      if (off + CHUNK_SIZE < bytes.length) {
        await new Promise((resolve) =>
          setTimeout(resolve, INTER_CHUNK_DELAY_MS),
        );
      }
    }
  }

  async disconnect(): Promise<void> {
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    this.characteristic = null;
    this.setStatus({ state: "idle" });
  }

  /**
   * Best-effort warm-up: open the GATT link ahead of the kasir actually
   * tapping print. BLE drops connection after a few minutes idle, so
   * waking it up at shift open + after tab visibility returns moves
   * the 1-3 second connect cost out of the customer-facing payment path.
   *
   * Silent — failure is logged but never thrown so it can't disrupt the
   * sale flow. Idempotent (connect() short-circuits if already connected).
   */
  async prewarm(): Promise<void> {
    if (!this.device) return; // not paired yet, nothing to warm
    if (this.isConnected()) return;
    try {
      await this.connect();
    } catch (e) {
      // Pre-warm is opportunistic — actual print will retry connect().
      console.debug("[printer:prewarm]", e);
    }
  }

  isPaired(): boolean {
    return this.device !== null;
  }

  isConnected(): boolean {
    return Boolean(this.characteristic && this.device?.gatt?.connected);
  }
}

let _client: PrinterClient | null = null;

export function getPrinterClient(): PrinterClient {
  if (!_client) _client = new PrinterClient();
  return _client;
}

/**
 * Sesi AE-133 — Map raw browser GATT errors (yang biasanya tidak
 * actionable buat kasir SMA) ke pesan Bahasa Indonesia yang jelas +
 * langkah tindak lanjut.
 */
type PrinterErrorKind =
  | "characteristic_missing"
  | "write_failed"
  | "reconnect_failed"
  | "retry_failed";

function friendlyPrinterError(kind: PrinterErrorKind, detail?: string): string {
  switch (kind) {
    case "characteristic_missing":
      return "Printer belum siap. Tutup tab POS, buka lagi, dan tap Print.";
    case "write_failed":
      return `Gagal kirim data ke printer${detail ? ` (${truncate(detail, 80)})` : ""}.`;
    case "reconnect_failed":
      return `Koneksi printer putus dan gagal connect ulang. Cek printer on + tidak ke-pair device lain. ${
        detail ? `Detail: ${truncate(detail, 80)}` : ""
      }`.trim();
    case "retry_failed":
      return `Printer terhubung tapi data masih gagal masuk. Coba: matikan printer 5 detik, nyalakan lagi, tap Print. ${
        detail ? `Detail: ${truncate(detail, 80)}` : ""
      }`.trim();
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}
