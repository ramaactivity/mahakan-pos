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
 * - Default MTU is 20 bytes per write; we chunk at 256 since most
 *   modern printers negotiate a larger MTU but don't crash on smaller.
 * - First requestDevice MUST happen inside a click handler — browser
 *   blocks programmatic prompts.
 */

const SERVICE_UUID = "000018f0-0000-1000-8000-00805f9b34fb";
const WRITE_CHARACTERISTIC_UUID = "00002af1-0000-1000-8000-00805f9b34fb";
const STORAGE_KEY = "mahakan-pos.bluetooth.device-id";
const CHUNK_SIZE = 256;

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
   */
  async pair(): Promise<void> {
    if (!isWebBluetoothSupported()) {
      throw new Error(
        "Web Bluetooth tidak didukung. Pakai Chrome/Edge di Android.",
      );
    }
    this.setStatus({ state: "pairing", error: null });
    try {
      const nav = navigator as unknown as NavigatorBluetooth;
      const device = (await nav.bluetooth.requestDevice({
        // Accept any device, filter by service via optionalServices so the
        // characteristic discovery later picks the right one.
        acceptAllDevices: true,
        optionalServices: [SERVICE_UUID],
      })) as BluetoothDevice;

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
      const message = e instanceof Error ? e.message : "Connect gagal";
      this.setStatus({ state: "error", error: message });
      throw e;
    }
  }

  /**
   * Send raw bytes. Auto-connects if not yet connected. Chunks at
   * CHUNK_SIZE because BLE writes have an MTU ceiling.
   */
  async send(bytes: Uint8Array): Promise<void> {
    if (!this.characteristic || !this.device?.gatt?.connected) {
      await this.connect();
    }
    if (!this.characteristic) {
      throw new Error("Printer characteristic tidak tersedia");
    }
    for (let off = 0; off < bytes.length; off += CHUNK_SIZE) {
      const chunk = bytes.slice(off, off + CHUNK_SIZE);
      await this.characteristic.writeValue(chunk);
    }
  }

  async disconnect(): Promise<void> {
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    this.characteristic = null;
    this.setStatus({ state: "idle" });
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
