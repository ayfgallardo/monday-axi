import type { MondayContext, StatusLabel } from "../config.js";
import { mondayQuery } from "../monday.js";
import { AxiError } from "../errors.js";
import {
  rejectUnknownFlags,
  resolveLimit,
  takeBoolFlag,
  takeFlag,
  takeNumericId,
} from "../args.js";
import { getSuggestions } from "../suggestions.js";
import {
  boolYesNo,
  custom,
  field,
  renderDetail,
  renderError,
  renderHelp,
  renderList,
  renderOutput,
  truncateText,
  type FieldDef,
} from "../toon.js";

// ---------------------------------------------------------------------------
// Monday response shapes
// ---------------------------------------------------------------------------

export interface ColumnValue {
  id: string;
  text: string | null;
  label?: string | null;
}

export interface UpdateCreator {
  id: string;
  name: string;
}

export interface Update {
  id: string;
  created_at: string;
  text_body: string | null;
  body: string | null;
  creator?: UpdateCreator | null;
}

export interface Asset {
  id: string;
  name: string;
  url: string;
}

interface FileUpdate {
  assets: Asset[];
}

export interface Item {
  id: string;
  name: string;
  board?: { id: string } | null;
  column_values: ColumnValue[];
  updates?: Update[];
  files?: FileUpdate[];
  subitems?: Item[];
  parent_item?: { id: string; name: string } | null;
}

interface ItemsPageResponse {
  boards: { items_page: { cursor: string | null; items: Item[] } }[] | null;
}

interface NextItemsPageResponse {
  next_items_page: { cursor: string | null; items: Item[] } | null;
}

interface ItemResponse {
  items: Item[] | null;
}

export interface QueryRule {
  column_id: string;
  compare_value: unknown[];
  operator: string;
}

export interface QueryParams {
  operator: "and";
  rules: QueryRule[];
}

// ---------------------------------------------------------------------------
// Column / rule helpers (also used by home.ts)
// ---------------------------------------------------------------------------

export function columnText(
  item: Pick<Item, "column_values">,
  columnId: string | undefined,
): string | null {
  if (!columnId) return null;
  const cv = item.column_values.find((c) => c.id === columnId);
  if (!cv) return null;
  return cv.label ?? cv.text ?? null;
}

export function statusOf(ctx: MondayContext, item: Item): string {
  return columnText(item, ctx.columns.status) ?? "unknown";
}

export function moduleOf(ctx: MondayContext, item: Item): string {
  return columnText(item, ctx.columns.module) ?? "unknown";
}

function findStatusLabel(
  ctx: MondayContext,
  label: string,
): StatusLabel | undefined {
  return ctx.statusLabels.find((s) => s.label === label);
}

function validStatusLabelsHelp(ctx: MondayContext): string[] {
  return [`Valid labels: ${ctx.statusLabels.map((s) => s.label).join(", ")}`];
}

/**
 * Excludes the configured "Archivé" status by its real Monday settings index
 * (not its position in statusLabels — Monday indexes are non-contiguous).
 */
export function archivedExclusionRule(
  ctx: MondayContext,
): QueryRule | undefined {
  const statusColumnId = ctx.columns.status;
  if (!statusColumnId) return undefined;
  const archived = findStatusLabel(ctx, "Archivé");
  if (!archived) return undefined;
  return {
    column_id: statusColumnId,
    compare_value: [archived.index],
    operator: "not_any_of",
  };
}

export function statusFilterRule(ctx: MondayContext, label: string): QueryRule {
  const statusColumnId = ctx.columns.status;
  if (!statusColumnId) {
    throw new AxiError("No status column configured", "VALIDATION_ERROR");
  }
  const found = findStatusLabel(ctx, label);
  if (!found) {
    throw new AxiError(`Unknown status label: ${label}`, "VALIDATION_ERROR", [
      `Valid labels: ${ctx.statusLabels.map((s) => s.label).join(", ")}`,
    ]);
  }
  return {
    column_id: statusColumnId,
    compare_value: [found.index],
    operator: "any_of",
  };
}

export function personFilterRule(ctx: MondayContext): QueryRule | undefined {
  const personColumnId = ctx.columns.person;
  if (!personColumnId || !ctx.personId) return undefined;
  return {
    column_id: personColumnId,
    compare_value: [`person-${ctx.personId}`],
    operator: "any_of",
  };
}

/** Server-side --module filter; undefined when no module column is configured. */
export function moduleFilterRule(
  ctx: MondayContext,
  text: string,
): QueryRule | undefined {
  const moduleColumnId = ctx.columns.module;
  if (!moduleColumnId) return undefined;
  return {
    column_id: moduleColumnId,
    compare_value: [text],
    operator: "contains_text",
  };
}

// ---------------------------------------------------------------------------
// Shared fetch used by ticket list and home
// ---------------------------------------------------------------------------

export const LIST_QUERY = `
  query ($boardId: ID!, $limit: Int!, $columnIds: [String!], $queryParams: ItemsQuery) {
    boards(ids: [$boardId]) {
      items_page(limit: $limit, query_params: $queryParams) {
        cursor
        items {
          id
          name
          column_values(ids: $columnIds) {
            id
            text
            ... on StatusValue {
              label
            }
          }
        }
      }
    }
  }
`;

/**
 * Continues a previous items_page response. query_params and cursor are
 * mutually exclusive on the Monday API — a cursor always replays the filters
 * of the page it came from, so no query_params travels here.
 */
export const NEXT_PAGE_QUERY = `
  query ($cursor: String!, $limit: Int!, $columnIds: [String!]) {
    next_items_page(cursor: $cursor, limit: $limit) {
      cursor
      items {
        id
        name
        column_values(ids: $columnIds) {
          id
          text
          ... on StatusValue {
            label
          }
        }
      }
    }
  }
`;

export async function fetchItems(
  ctx: MondayContext,
  options: { rules: QueryRule[]; limit: number; cursor?: string },
): Promise<{ items: Item[]; cursor: string | null }> {
  const columnIds = Object.values(ctx.columns);

  if (options.cursor) {
    const data = await mondayQuery<NextItemsPageResponse>(NEXT_PAGE_QUERY, {
      cursor: options.cursor,
      limit: options.limit,
      columnIds,
    });
    const page = data.next_items_page;
    return { items: page?.items ?? [], cursor: page?.cursor ?? null };
  }

  const data = await mondayQuery<ItemsPageResponse>(LIST_QUERY, {
    boardId: ctx.boardId,
    limit: options.limit,
    columnIds,
    queryParams:
      options.rules.length > 0
        ? { operator: "and", rules: options.rules }
        : null,
  });
  const page = data.boards?.[0]?.items_page;
  return { items: page?.items ?? [], cursor: page?.cursor ?? null };
}

/** Aggregate a status breakdown, e.g. "3 tickets, 2 En cours, 1 À faire". */
export function aggregateLine(ctx: MondayContext, items: Item[]): string {
  if (items.length === 0) return "0 tickets";
  const counts = new Map<string, number>();
  for (const item of items) {
    const status = statusOf(ctx, item);
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  const breakdown = [...counts.entries()]
    .map(([label, count]) => `${count} ${label}`)
    .join(", ");
  return `${items.length} tickets, ${breakdown}`;
}

// ---------------------------------------------------------------------------
// ticket list
// ---------------------------------------------------------------------------

const LIST_FLAGS = [
  "--status",
  "--module",
  "--all",
  "--limit",
  "--cursor",
] as const;

async function ticketList(args: string[], ctx: MondayContext): Promise<string> {
  rejectUnknownFlags(args, LIST_FLAGS, "ticket", "list");
  const statusFlag = takeFlag(args, "--status");
  const moduleFlag = takeFlag(args, "--module");
  const all = takeBoolFlag(args, "--all");
  const cursorFlag = takeFlag(args, "--cursor");
  const limit = resolveLimit(args, 25);

  if (
    cursorFlag &&
    (statusFlag !== undefined || moduleFlag !== undefined || all)
  ) {
    throw new AxiError(
      "--cursor cannot be combined with --status/--module/--all — query_params and cursor are mutually exclusive on the Monday API",
      "VALIDATION_ERROR",
      [
        "Run `monday-axi ticket list --cursor <cursor>` alone to continue the same page",
      ],
    );
  }

  const rules: QueryRule[] = [];
  if (!cursorFlag) {
    if (statusFlag) {
      rules.push(statusFilterRule(ctx, statusFlag));
    } else if (!all) {
      const exclusion = archivedExclusionRule(ctx);
      if (exclusion) rules.push(exclusion);
    }
    if (moduleFlag) {
      // moduleOf() reads the same column id, so without it every item would
      // read as "unknown" — filtering client-side would silently return
      // nothing rather than a real answer. Push it server-side or fail loud.
      const moduleRule = moduleFilterRule(ctx, moduleFlag);
      if (!moduleRule) {
        throw new AxiError(
          "No module column configured — cannot filter by --module",
          "VALIDATION_ERROR",
          [
            "Run `monday-axi board view` to see available columns",
            "Configure columns.module in the Monday context, or drop --module",
          ],
        );
      }
      rules.push(moduleRule);
    }
  }

  const { items, cursor } = await fetchItems(ctx, {
    rules,
    limit,
    cursor: cursorFlag,
  });

  const schema: FieldDef[] = [
    field("id"),
    field("name"),
    custom("status", (i: Item) => statusOf(ctx, i)),
    custom("module", (i: Item) => moduleOf(ctx, i)),
  ];

  const hints = [
    ...getSuggestions({
      domain: "ticket",
      action: "list",
      isEmpty: items.length === 0,
    }),
  ];
  if (cursor) {
    hints.push(
      `Run \`monday-axi ticket list --cursor ${cursor}\` to see the next page`,
    );
  }

  return renderOutput([
    aggregateLine(ctx, items),
    renderList("tickets", items, schema),
    ...(cursor ? [`next_cursor: ${cursor}`] : []),
    renderHelp(hints),
  ]);
}

// ---------------------------------------------------------------------------
// ticket view
// ---------------------------------------------------------------------------

export const VIEW_QUERY = `
  query ($id: ID!, $columnIds: [String!]) {
    items(ids: [$id]) {
      id
      name
      board {
        id
      }
      column_values(ids: $columnIds) {
        id
        text
        ... on StatusValue {
          label
        }
      }
      updates(limit: 100) {
        id
        created_at
        text_body
        body
        creator {
          id
          name
        }
      }
      files: updates(limit: 50) {
        assets {
          id
          name
          url
        }
      }
      subitems {
        id
        name
        column_values(ids: $columnIds) {
          id
          text
          ... on StatusValue {
            label
          }
        }
      }
      parent_item {
        id
        name
      }
    }
  }
`;

function uniqueAssets(files: FileUpdate[]): Asset[] {
  const seen = new Map<string, Asset>();
  for (const file of files) {
    for (const asset of file.assets) {
      seen.set(asset.id, asset);
    }
  }
  return [...seen.values()];
}

const VIEW_FLAGS = ["--full"] as const;

async function ticketView(args: string[], ctx: MondayContext): Promise<string> {
  rejectUnknownFlags(args, VIEW_FLAGS, "ticket", "view");
  const full = takeBoolFlag(args, "--full");
  const id = takeNumericId(args, "ticket");
  const columnIds = Object.values(ctx.columns);

  const data = await mondayQuery<ItemResponse>(VIEW_QUERY, { id, columnIds });
  const item = data.items?.[0];
  if (!item) {
    throw new AxiError(`Ticket ${id} not found`, "NOT_FOUND", [
      "Run `monday-axi ticket list` to see available tickets",
    ]);
  }

  const updates = item.updates ?? [];
  const files = uniqueAssets(item.files ?? []);
  const subitems = item.subitems ?? [];

  const schema: FieldDef[] = [
    field("id"),
    field("name"),
    custom("status", (i: Item) => statusOf(ctx, i)),
    custom("module", (i: Item) => moduleOf(ctx, i)),
    custom("updates", () =>
      updates.map((u) => ({
        id: u.id,
        created: u.created_at,
        author: u.creator?.name ?? "unknown",
        body: full ? (u.text_body ?? "") : truncateText(u.text_body, 500),
      })),
    ),
    custom("files", () =>
      files.map((a) => ({ id: a.id, name: a.name, url: a.url })),
    ),
    custom("subitems", () =>
      subitems.map((s) => ({
        id: s.id,
        name: s.name,
        status: statusOf(ctx, s),
      })),
    ),
  ];

  return renderOutput([
    renderDetail("ticket", item, schema),
    renderHelp(getSuggestions({ domain: "ticket", action: "view", id })),
  ]);
}

// ---------------------------------------------------------------------------
// ticket status
// ---------------------------------------------------------------------------

interface ItemStatusResponse {
  items: Pick<Item, "id" | "board" | "column_values">[] | null;
}

export const ITEM_STATUS_QUERY = `
  query ($id: ID!, $statusColumnId: [String!]) {
    items(ids: [$id]) {
      id
      board {
        id
      }
      column_values(ids: $statusColumnId) {
        id
        text
        ... on StatusValue {
          label
        }
      }
    }
  }
`;

export const SET_STATUS_MUTATION = `
  mutation ($itemId: ID!, $boardId: ID!, $columnId: String!, $value: String!) {
    change_simple_column_value(item_id: $itemId, board_id: $boardId, column_id: $columnId, value: $value) {
      id
    }
  }
`;

async function ticketStatus(
  args: string[],
  ctx: MondayContext,
): Promise<string> {
  const id = takeNumericId(args, "ticket");
  const label = args.shift();
  if (!label) {
    throw new AxiError("Missing status label", "VALIDATION_ERROR", [
      "monday-axi ticket status <id> <label>",
      ...validStatusLabelsHelp(ctx),
    ]);
  }
  rejectUnknownFlags(args, [], "ticket", "status");

  if (!findStatusLabel(ctx, label)) {
    throw new AxiError(`Unknown status label: ${label}`, "VALIDATION_ERROR", [
      ...validStatusLabelsHelp(ctx),
    ]);
  }

  const statusColumnId = ctx.columns.status;
  if (!statusColumnId) {
    throw new AxiError("No status column configured", "VALIDATION_ERROR");
  }

  const data = await mondayQuery<ItemStatusResponse>(ITEM_STATUS_QUERY, {
    id,
    statusColumnId: [statusColumnId],
  });
  const item = data.items?.[0];
  if (!item) {
    throw new AxiError(`Ticket ${id} not found`, "NOT_FOUND", [
      "Run `monday-axi ticket list` to see available tickets",
    ]);
  }

  // board_of guard: the item's OWN board, never ctx.boardId — a subitem
  // lives on subitemBoardId, not the parent board. v1 scope excludes
  // writing to subitems: ctx.columns.status / ctx.statusLabels describe the
  // parent board's schema, which may not even apply to the subitem's board.
  const boardId = item.board?.id;
  if (!boardId) {
    throw new AxiError(`Ticket ${id} has no board`, "UNKNOWN");
  }
  if (boardId !== ctx.boardId) {
    throw new AxiError(
      `Ticket ${id} lives on board ${boardId}, not the configured board ${ctx.boardId} — likely a subitem`,
      "VALIDATION_ERROR",
      [
        "Mutating subitem status is out of scope for v1 — run `monday-axi ticket status` on the parent item instead",
      ],
    );
  }

  const currentLabel = columnText(item, statusColumnId);
  const schema: FieldDef[] = [field("id"), field("status")];
  const hints = renderHelp(
    getSuggestions({ domain: "ticket", action: "status", id }),
  );

  if (currentLabel === label) {
    return renderOutput([
      renderDetail("ticket", { id, status: label, already: true }, [
        ...schema,
        boolYesNo("already"),
      ]),
      hints,
    ]);
  }

  await mondayQuery(SET_STATUS_MUTATION, {
    itemId: id,
    boardId,
    columnId: statusColumnId,
    value: label,
  });

  return renderOutput([
    renderDetail("ticket", { id, status: label }, schema),
    hints,
  ]);
}

// ---------------------------------------------------------------------------
// ticket comment
// ---------------------------------------------------------------------------

export const CREATE_UPDATE_MUTATION = `
  mutation ($itemId: ID!, $body: String!) {
    create_update(item_id: $itemId, body: $body) {
      id
    }
  }
`;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\r?\n/g, "<br>");
}

async function ticketComment(args: string[]): Promise<string> {
  const id = takeNumericId(args, "ticket");
  const text = args.join(" ").trim();
  if (!text) {
    throw new AxiError("Missing comment text", "VALIDATION_ERROR", [
      "monday-axi ticket comment <id> <text>",
    ]);
  }

  const body = escapeHtml(text);
  await mondayQuery(CREATE_UPDATE_MUTATION, { itemId: id, body });

  return renderOutput([
    renderDetail("ticket", { id, comment: "ok" }, [
      field("id"),
      field("comment"),
    ]),
    renderHelp(getSuggestions({ domain: "ticket", action: "comment", id })),
  ]);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const TICKET_HELP = `usage: monday-axi ticket <list|view|status|comment> [args] [flags]
flags{list}:
  --status <label>, --module <text>, --all, --limit <n>, --cursor <c> (continue a previous page; cannot combine with --status/--module/--all)
flags{view}:
  --full
usage{status}: monday-axi ticket status <id> <label>
usage{comment}: monday-axi ticket comment <id> <text>
`;

const HANDLERS: Record<
  string,
  (args: string[], ctx: MondayContext) => Promise<string>
> = {
  list: ticketList,
  view: ticketView,
  status: ticketStatus,
  comment: ticketComment,
};

export async function ticketCommand(
  args: string[],
  ctx?: MondayContext,
): Promise<string> {
  const sub = args[0];
  const rest = args.slice(1);

  if (sub === undefined || sub === "help" || sub === "--help" || sub === "-h") {
    return TICKET_HELP;
  }

  const handler = HANDLERS[sub];
  if (!handler) {
    return renderError(
      `Unknown ticket subcommand: ${sub}`,
      "VALIDATION_ERROR",
      ["Run `monday-axi ticket --help` to see available subcommands"],
    );
  }

  if (!ctx) {
    throw new AxiError("Monday configuration required", "CONFIG_MISSING", [
      "Run `monday-axi setup` to create it",
    ]);
  }

  return handler(rest, ctx);
}
