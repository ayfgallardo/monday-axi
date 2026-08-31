import type { MondayContext } from "../config.js";
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
  item: Item,
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

/** Excludes the configured "Archivé" status by its index in statusLabels. */
export function archivedExclusionRule(
  ctx: MondayContext,
): QueryRule | undefined {
  const statusColumnId = ctx.columns.status;
  if (!statusColumnId) return undefined;
  const archivedIndex = ctx.statusLabels.indexOf("Archivé");
  if (archivedIndex === -1) return undefined;
  return {
    column_id: statusColumnId,
    compare_value: [archivedIndex],
    operator: "not_any_of",
  };
}

export function statusFilterRule(ctx: MondayContext, label: string): QueryRule {
  const statusColumnId = ctx.columns.status;
  if (!statusColumnId) {
    throw new AxiError("No status column configured", "VALIDATION_ERROR");
  }
  const index = ctx.statusLabels.indexOf(label);
  if (index === -1) {
    throw new AxiError(`Unknown status label: ${label}`, "VALIDATION_ERROR", [
      `Valid labels: ${ctx.statusLabels.join(", ")}`,
    ]);
  }
  return {
    column_id: statusColumnId,
    compare_value: [index],
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

// ---------------------------------------------------------------------------
// Shared fetch used by ticket list and home
// ---------------------------------------------------------------------------

const LIST_QUERY = `
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

export async function fetchItems(
  ctx: MondayContext,
  options: { rules: QueryRule[]; limit: number },
): Promise<{ items: Item[]; cursor: string | null }> {
  const columnIds = Object.values(ctx.columns);
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

const LIST_FLAGS = ["--status", "--module", "--all", "--limit"] as const;

async function ticketList(args: string[], ctx: MondayContext): Promise<string> {
  rejectUnknownFlags(args, LIST_FLAGS, "ticket", "list");
  const statusFlag = takeFlag(args, "--status");
  const moduleFlag = takeFlag(args, "--module");
  const all = takeBoolFlag(args, "--all");
  const limit = resolveLimit(args, 25);

  const rules: QueryRule[] = [];
  if (statusFlag) {
    rules.push(statusFilterRule(ctx, statusFlag));
  } else if (!all) {
    const exclusion = archivedExclusionRule(ctx);
    if (exclusion) rules.push(exclusion);
  }

  const { items: fetched, cursor } = await fetchItems(ctx, { rules, limit });
  const items = moduleFlag
    ? fetched.filter((item) =>
        moduleOf(ctx, item).toLowerCase().includes(moduleFlag.toLowerCase()),
      )
    : fetched;

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
      "More tickets may be available — run with a higher --limit to see more",
    );
  }

  return renderOutput([
    aggregateLine(ctx, items),
    renderList("tickets", items, schema),
    renderHelp(hints),
  ]);
}

// ---------------------------------------------------------------------------
// ticket view
// ---------------------------------------------------------------------------

const VIEW_QUERY = `
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
// Router
// ---------------------------------------------------------------------------

export const TICKET_HELP = `usage: monday-axi ticket <list|view> [args] [flags]
flags{list}:
  --status <label>, --module <text>, --all, --limit <n>
flags{view}:
  --full
`;

const HANDLERS: Record<
  string,
  (args: string[], ctx: MondayContext) => Promise<string>
> = {
  list: ticketList,
  view: ticketView,
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
