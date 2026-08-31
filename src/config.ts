import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AxiError } from "./errors.js";

export interface MondayContext {
  boardId: string;
  subitemBoardId?: string;
  personId?: string;
  /** Human name → Monday column id, e.g. `{ status: "status_1" }`. */
  columns: Record<string, string>;
  statusLabels: string[];
}

const SETUP_HELP = ["Run `monday-axi setup` to create it"];

export function configPath(): string {
  return join(homedir(), ".config", "monday-axi", "config.json");
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
    statusLabels: parsed.statusLabels ?? [],
  };
}
