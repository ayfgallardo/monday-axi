import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AxiError } from "./errors.js";

/** A status label paired with its real Monday settings index (non-contiguous, board-specific). */
export interface StatusLabel {
  label: string;
  index: number;
}

export interface MondayContext {
  boardId: string;
  subitemBoardId?: string;
  personId?: string;
  /** Human name → Monday column id, e.g. `{ status: "status_1" }`. */
  columns: Record<string, string>;
  statusLabels: StatusLabel[];
}

const SETUP_HELP = ["Run `monday-axi setup` to create it"];
const STATUS_LABELS_SHAPE_HELP = [
  'statusLabels must be [{ "label": string, "index": number }, ...]',
  ...SETUP_HELP,
];

export function configPath(): string {
  return join(homedir(), ".config", "monday-axi", "config.json");
}

function isStatusLabel(value: unknown): value is StatusLabel {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as StatusLabel).label === "string" &&
    typeof (value as StatusLabel).index === "number" &&
    Number.isInteger((value as StatusLabel).index)
  );
}

function parseStatusLabels(value: unknown, path: string): StatusLabel[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(isStatusLabel)) {
    throw new AxiError(
      `Invalid statusLabels in ${path}`,
      "VALIDATION_ERROR",
      STATUS_LABELS_SHAPE_HELP,
    );
  }
  return value;
}

export function loadConfig(): MondayContext {
  const path = configPath();

  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    throw new AxiError(
      `No Monday configuration at ${path}`,
      "CONFIG_MISSING",
      SETUP_HELP,
    );
  }

  let parsed: Partial<MondayContext>;
  try {
    parsed = JSON.parse(raw) as Partial<MondayContext>;
  } catch {
    throw new AxiError(
      `Malformed Monday configuration at ${path}`,
      "VALIDATION_ERROR",
      SETUP_HELP,
    );
  }

  if (!parsed.boardId) {
    throw new AxiError(
      `Missing boardId in ${path}`,
      "VALIDATION_ERROR",
      SETUP_HELP,
    );
  }

  return {
    ...parsed,
    boardId: parsed.boardId,
    columns: parsed.columns ?? {},
    statusLabels: parseStatusLabels(parsed.statusLabels, path),
  };
}
