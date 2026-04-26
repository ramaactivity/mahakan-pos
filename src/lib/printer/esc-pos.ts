/**
 * ESC/POS command builder for 58mm thermal printers (e.g. RPP02).
 *
 * Pure encoder — produces Uint8Array sequences ready for transport.
 * No I/O. Bluetooth send happens in `./bluetooth.ts`.
 *
 * Reference: ESC/POS spec § ESC, GS commands. Most receipt printers
 * implement a common subset; the few that diverge usually tolerate
 * unknown commands silently.
 */

export const ESC = 0x1b;
export const GS = 0x1d;
export const LF = 0x0a;

const TE = new TextEncoder();

/** Concatenate multiple Uint8Array fragments. */
export function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Encode plain text using the printer's default codepage (CP437/UTF-8 subset). */
export function text(s: string): Uint8Array {
  return TE.encode(s);
}

/** ESC @ — reset printer to defaults. Always emit at start. */
export function init(): Uint8Array {
  return new Uint8Array([ESC, 0x40]);
}

/** LF — feed one line. */
export function lf(): Uint8Array {
  return new Uint8Array([LF]);
}

/** ESC d n — feed n lines. */
export function feed(n: number): Uint8Array {
  return new Uint8Array([ESC, 0x64, clamp(n, 0, 255)]);
}

/** ESC a n — alignment (0=left, 1=center, 2=right). */
export type Align = "left" | "center" | "right";
export function align(a: Align): Uint8Array {
  const n = a === "left" ? 0 : a === "center" ? 1 : 2;
  return new Uint8Array([ESC, 0x61, n]);
}

/** ESC E n — bold on/off. */
export function bold(on: boolean): Uint8Array {
  return new Uint8Array([ESC, 0x45, on ? 0x01 : 0x00]);
}

/** GS ! n — character size. width/height each 1..8 (n = ((width-1)<<4) | (height-1)). */
export function size(width: number, height: number): Uint8Array {
  const w = clamp(width, 1, 8) - 1;
  const h = clamp(height, 1, 8) - 1;
  return new Uint8Array([GS, 0x21, (w << 4) | h]);
}

/** Convenience: reset to default size. */
export function sizeReset(): Uint8Array {
  return size(1, 1);
}

/** GS V m — paper cut. m=0 full cut, m=1 partial cut. */
export function cut(partial = false): Uint8Array {
  return new Uint8Array([GS, 0x56, partial ? 0x01 : 0x00]);
}

/**
 * Print a left-and-right justified line within a fixed column count.
 * Truncates the left side with ellipsis if it would overflow.
 *
 * 58mm printers typically render 32 chars per line at the default font.
 */
export function dualLine(
  left: string,
  right: string,
  cols = 32,
): Uint8Array {
  if (left.length + right.length + 1 > cols) {
    const max = cols - right.length - 2;
    left = max <= 0 ? left.slice(0, 1) : `${left.slice(0, max)}…`;
  }
  const padding = " ".repeat(cols - left.length - right.length);
  return text(`${left}${padding}${right}\n`);
}

/** Center text within `cols` columns. */
export function centerLine(s: string, cols = 32): Uint8Array {
  if (s.length >= cols) return text(`${s.slice(0, cols)}\n`);
  const pad = Math.floor((cols - s.length) / 2);
  return text(`${" ".repeat(pad)}${s}\n`);
}

/** Horizontal divider using a fixed character. */
export function divider(char = "-", cols = 32): Uint8Array {
  return text(`${char.repeat(cols)}\n`);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
