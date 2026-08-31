import { encode } from "@toon-format/toon";
import type { MondayContext } from "../config.js";
import { mondayQuery } from "../monday.js";
import { AxiError } from "../errors.js";
import { rejectUnknownFlags } from "../args.js";
import { getSuggestions } from "../suggestions.js";
import {
  custom,
  field,
  renderDetail,
  renderError,
  renderHelp,
  renderOutput,
  type FieldDef,
} from "../toon.js";

interface BoardGroup {
  id: string;
  title: string;
}

interface BoardColumn {
  id: string;
  title: string;
  type: string;
}

interface Board {
  id: string;
  name: string;
  items_count?: number | null;
  groups: BoardGroup[];
  columns: BoardColumn[];
}

interface BoardsResponse {
  boards: Board[] | null;
}

const BOARD_QUERY = `
  query ($boardId: ID!) {
    boards(ids: [$boardId]) {
      id
      name
      items_count
      groups {
        id
        title
      }
      columns {
        id
        title
        type
      }
    }
  }
`;

const schema: FieldDef[] = [
  field("id"),
  field("name"),
  field("items_count"),
  custom("groups", (b: Board) => b.groups.map((g) => g.title)),
  custom("columns", (b: Board) =>
    b.columns.map((c) => `${c.title} (${c.id}, ${c.type})`),
  ),
];

async function boardView(args: string[], ctx: MondayContext): Promise<string> {
  rejectUnknownFlags(args, [], "board", "view");

  const data = await mondayQuery<BoardsResponse>(BOARD_QUERY, {
    boardId: ctx.boardId,
  });
  const board = data.boards?.[0];
  if (!board) {
    throw new AxiError(`Board ${ctx.boardId} not found`, "NOT_FOUND");
  }

  return renderOutput([
    renderDetail("board", board, schema),
    encode({ status_labels: ctx.statusLabels }),
    renderHelp(getSuggestions({ domain: "board", action: "view" })),
  ]);
}

export const BOARD_HELP = `usage: monday-axi board view [--board <BOARD_ID>]
`;

const HANDLERS: Record<
  string,
  (args: string[], ctx: MondayContext) => Promise<string>
> = {
  view: boardView,
};

export async function boardCommand(
  args: string[],
  ctx?: MondayContext,
): Promise<string> {
  const sub = args[0];
  const rest = args.slice(1);

  if (sub === undefined || sub === "help" || sub === "--help" || sub === "-h") {
    return BOARD_HELP;
  }

  const handler = HANDLERS[sub];
  if (!handler) {
    return renderError(`Unknown board subcommand: ${sub}`, "VALIDATION_ERROR", [
      "Run `monday-axi board --help` to see available subcommands",
    ]);
  }

  if (!ctx) {
    throw new AxiError("Monday configuration required", "CONFIG_MISSING", [
      "Run `monday-axi setup` to create it",
    ]);
  }

  return handler(rest, ctx);
}
