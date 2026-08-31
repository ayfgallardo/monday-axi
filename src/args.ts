import { AxiError } from "./errors.js";

function flagEqualsPrefix(flag: string): string {
  return `${flag}=`;
}

/**
 * Get a flag's value from --flag value or --flag=value and remove it from
 * args. Throws VALIDATION_ERROR when the flag is present without a usable
 * value (missing, or the next token looks like another flag) — a flag with a
 * missing value must never silently fall back to a default.
 */
export function takeFlag(args: string[], flag: string): string | undefined {
  const equalsPrefix = flagEqualsPrefix(flag);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === flag) {
      const val = args[i + 1];
      if (val === undefined || val.startsWith("--")) {
        throw new AxiError(`${flag} requires a value`, "VALIDATION_ERROR");
      }
      args.splice(i, 2);
      return val;
    }
    if (arg.startsWith(equalsPrefix)) {
      const val = arg.slice(equalsPrefix.length);
      if (val.trim() === "") {
        throw new AxiError(`${flag} requires a value`, "VALIDATION_ERROR");
      }
      args.splice(i, 1);
      return val;
    }
  }
  return undefined;
}

/** Collect every occurrence of a repeatable flag, removing each from args. */
export function takeRepeatedFlag(args: string[], flag: string): string[] {
  const values: string[] = [];
  let value = takeFlag(args, flag);
  while (value !== undefined) {
    values.push(value);
    value = takeFlag(args, flag);
  }
  return values;
}

/** Check if a boolean flag is present and remove it from args. */
export function takeBoolFlag(args: string[], flag: string): boolean {
  const idx = args.indexOf(flag);
  if (idx === -1) return false;
  args.splice(idx, 1);
  return true;
}

/** Find the first numeric positional arg, remove it from args, and return it. */
export function takeNumericId(args: string[], label: string): string {
  const raw = args.find((a) => /^\d+$/.test(a));
  if (!raw) throw new AxiError(`Missing ${label} id`, "VALIDATION_ERROR");
  args.splice(args.indexOf(raw), 1);
  return raw;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/** Clamp --limit to a sane page size; defaults when absent. */
export function resolveLimit(args: string[], fallback = DEFAULT_LIMIT): number {
  const raw = takeFlag(args, "--limit");
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new AxiError(
      "--limit must be a positive integer",
      "VALIDATION_ERROR",
    );
  }
  return Math.min(parsed, MAX_LIMIT);
}

/**
 * Reject flags not listed in `known`, after the subcommand parsed the ones it
 * recognizes. Positionals and --help/-h always pass; `--` ends flag scanning.
 * Never silently drop an unknown flag (AXI principle 6).
 */
export function rejectUnknownFlags(
  args: string[],
  known: readonly string[],
  command: string,
  sub?: string,
): void {
  const knownSet = new Set(known);
  const unknown: string[] = [];
  for (const tok of args) {
    if (tok === "--") break;
    if (!tok.startsWith("-") || tok === "-") continue;
    const name = tok.split("=", 1)[0];
    if (name === "--help" || name === "-h") continue;
    if (knownSet.has(name)) continue;
    if (!unknown.includes(name)) unknown.push(name);
  }
  if (unknown.length === 0) return;
  const list = unknown.join(", ");
  const usage = sub ? `${command} ${sub}` : command;
  throw new AxiError(
    `unknown flag${unknown.length > 1 ? "s" : ""} for monday-axi ${usage}: ${list}`,
    "VALIDATION_ERROR",
    [`monday-axi ${usage} [flags]`, `monday-axi ${usage} --help`],
  );
}
