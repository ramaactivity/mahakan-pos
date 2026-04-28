/**
 * Tiny argv parser — reads `--flag value` and `--flag` (boolean) pairs from
 * process.argv. Returns a flat record. No commander dep needed.
 *
 * Recognized forms:
 *   --apply          → { apply: true }
 *   --source PATH    → { source: "PATH" }
 *   --source=PATH    → { source: "PATH" }
 *
 * Unknown flags are still captured (caller validates).
 */
export type CliArgs = Record<string, string | boolean>;

export function parseCliArgs(argv: readonly string[] = process.argv.slice(2)): CliArgs {
  const out: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eqIdx = a.indexOf("=");
    if (eqIdx >= 0) {
      const key = a.slice(2, eqIdx);
      const val = a.slice(eqIdx + 1);
      out[key] = val;
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

export function getString(args: CliArgs, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" ? v : undefined;
}

export function getBool(args: CliArgs, key: string): boolean {
  return args[key] === true;
}
