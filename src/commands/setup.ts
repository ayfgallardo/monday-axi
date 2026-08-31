import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { encode } from "@toon-format/toon";
import { configPath, parseConfig } from "../config.js";
import { AxiError } from "../errors.js";
import { rejectUnknownFlags, takeFlag, takeRepeatedFlag } from "../args.js";

export const SETUP_HELP = `usage: monday-axi setup --board <BOARD_ID> [flags]
description: Write ~/.config/monday-axi/config.json non-interactively. Never handles a token — auth comes from env/.env/Keychain (see monday-axi --help).
flags[5]:
  --board <BOARD_ID> (required), --subitem-board <BOARD_ID>, --person <PERSON_ID>, --column name=<COLUMN_ID> (repeatable), --status-label "Label=id" (repeatable, id is the label's Monday label id — the key in the status column's settings_str labels map, NOT the "index" field shown by Monday tools)
examples:
  monday-axi setup --board 1234567890
  monday-axi setup --board 1234567890 --subitem-board 1234567891 --person 999 --column status=status_1 --status-label "En cours=1"
`;

const SETUP_FLAGS = [
  "--board",
  "--subitem-board",
  "--person",
  "--column",
  "--status-label",
] as const;

function parseColumns(pairs: string[]): Record<string, string> {
  const columns: Record<string, string> = {};
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq === -1) {
      throw new AxiError(
        `--column must be name=id, got: ${pair}`,
        "VALIDATION_ERROR",
      );
    }
    columns[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return columns;
}

function parseStatusLabelFlags(
  pairs: string[],
): { label: string; index: number }[] {
  return pairs.map((pair) => {
    const eq = pair.indexOf("=");
    if (eq === -1) {
      throw new AxiError(
        `--status-label must be Label=id (the label's Monday label id, not the display "index"), got: ${pair}`,
        "VALIDATION_ERROR",
      );
    }
    const label = pair.slice(0, eq);
    const index = Number(pair.slice(eq + 1));
    if (!Number.isInteger(index)) {
      throw new AxiError(
        `--status-label id must be an integer (the label id from the status column's settings_str, not the display "index"), got: ${pair}`,
        "VALIDATION_ERROR",
      );
    }
    return { label, index };
  });
}

export async function setupCommand(args: string[]): Promise<string> {
  if (args[0] === "--help" || args[0] === "-h") return SETUP_HELP;

  const board = takeFlag(args, "--board");
  const subitemBoard = takeFlag(args, "--subitem-board");
  const person = takeFlag(args, "--person");
  const columnPairs = takeRepeatedFlag(args, "--column");
  const statusLabelPairs = takeRepeatedFlag(args, "--status-label");
  rejectUnknownFlags(args, SETUP_FLAGS, "setup");

  if (args.length > 0) {
    throw new AxiError(
      `monday-axi setup takes no positional arguments: ${args.join(", ")}`,
      "VALIDATION_ERROR",
    );
  }

  if (!board) {
    throw new AxiError("Missing required flag: --board", "VALIDATION_ERROR", [
      "Run `monday-axi setup --help` for usage",
    ]);
  }

  const config = {
    boardId: board,
    ...(subitemBoard ? { subitemBoardId: subitemBoard } : {}),
    ...(person ? { personId: person } : {}),
    columns: parseColumns(columnPairs),
    statusLabels: parseStatusLabelFlags(statusLabelPairs),
  };

  const path = configPath();
  const raw = `${JSON.stringify(config, null, 2)}\n`;
  // Validate through the same shape check as loadConfig before ever touching
  // disk, so a bad `setup` invocation can never clobber a previously valid config.
  const validated = parseConfig(raw, path);

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, raw, "utf-8");

  return `${encode({ config_written: path, ...validated })}\n`;
}
