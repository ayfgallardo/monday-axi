import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import type { MondayContext, StatusLabel } from "../config.js";
import { mondayQuery, mondayUpload } from "../monday.js";
import { AxiError, type ErrorCode } from "../errors.js";
import {
  rejectUnknownFlags,
  resolveLimit,
  takeBoolFlag,
  takeFlag,
  takeNumericId,
  takeRepeatedFlag,
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

/** Runs against FILE_ENDPOINT, not /v2: the file travels as a multipart part. */
export const ADD_FILE_TO_UPDATE_MUTATION = `
  mutation ($updateId: ID!, $file: File!) {
    add_file_to_update(update_id: $updateId, file: $file) {
      id
      name
      file_size
    }
  }
`;

interface CreateUpdateResponse {
  create_update: { id: string } | null;
}

interface AddFileResponse {
  add_file_to_update: { id: string; name: string; file_size: number } | null;
}

/** Monday's hard cap on the file upload endpoint. */
export const MAX_FILE_BYTES = 500 * 1024 * 1024;

export function assertFileSize(name: string, bytes: number): void {
  if (bytes > MAX_FILE_BYTES) {
    throw new AxiError(
      `${name} is ${bytes} bytes, over the Monday upload limit of ${MAX_FILE_BYTES}`,
      "VALIDATION_ERROR",
      ["Compress or split the file, or share a link in the comment instead"],
    );
  }
}

interface Attachment {
  name: string;
  content: Uint8Array<ArrayBuffer>;
}

/**
 * Read every attachment up front: a comment must never be created for files
 * that turn out to be unreadable.
 */
function readAttachments(paths: string[]): Attachment[] {
  return paths.map((path) => {
    let size: number;
    try {
      const stats = statSync(path);
      if (stats.isDirectory()) {
        throw new AxiError(`${path} is a directory`, "VALIDATION_ERROR", [
          "Pass one --file per file to attach",
        ]);
      }
      size = stats.size;
    } catch (error) {
      if (error instanceof AxiError) throw error;
      throw new AxiError(`File not found: ${path}`, "NOT_FOUND", [
        "Pass a readable path: monday-axi ticket comment <id> <text> --file <path>",
      ]);
    }

    const name = basename(path);
    assertFileSize(name, size);

    try {
      return { name, content: new Uint8Array(readFileSync(path)) };
    } catch {
      throw new AxiError(`Cannot read ${path}`, "VALIDATION_ERROR", [
        "Check the file permissions",
      ]);
    }
  });
}

/** Uploads are sequential so a failure names exactly which file did not land. */
async function attachFiles(
  updateId: string,
  attachments: Attachment[],
): Promise<{ id: string; name: string; size: number }[]> {
  const assets: { id: string; name: string; size: number }[] = [];
  for (const attachment of attachments) {
    let asset: AddFileResponse["add_file_to_update"];
    try {
      asset = (
        await mondayUpload<AddFileResponse>(
          ADD_FILE_TO_UPDATE_MUTATION,
          { updateId },
          attachment,
        )
      ).add_file_to_update;
    } catch (error) {
      throw new AxiError(
        `Comment ${updateId} was created, but attaching ${attachment.name} failed: ${(error as Error).message}`,
        (error as { code?: ErrorCode }).code ?? "UNKNOWN",
        [
          `Do not repost the comment — retry the attachment only, e.g. \`monday-axi api\` on add_file_to_update with update_id ${updateId}`,
        ],
      );
    }
    if (!asset) {
      throw new AxiError(
        `Comment ${updateId} was created, but attaching ${attachment.name} returned no asset`,
        "UNKNOWN",
      );
    }
    assets.push({ id: asset.id, name: asset.name, size: asset.file_size });
  }
  return assets;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\r?\n/g, "<br>");
}

export const USERS_QUERY = `
  query {
    users {
      id
      name
    }
  }
`;

interface MondayUser {
  id: string;
  name: string;
}

interface UsersResponse {
  users: MondayUser[] | null;
}

function matchUser(users: MondayUser[], needle: string): MondayUser {
  const wanted = needle.toLowerCase();
  const exact = users.filter((u) => u.name.toLowerCase() === wanted);
  const matches =
    exact.length > 0
      ? exact
      : users.filter((u) => u.name.toLowerCase().includes(wanted));

  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    throw new AxiError(
      `No user matches --mention ${needle}`,
      "VALIDATION_ERROR",
      [
        "Pass a numeric Monday user id to skip the name lookup",
        "Run `monday-axi api 'query { users { id name } }'` to list the users",
      ],
    );
  }
  throw new AxiError(
    `--mention ${needle} is ambiguous`,
    "VALIDATION_ERROR",
    matches.map((u) => `${u.name} (id ${u.id})`),
  );
}

/** Numeric values are used as-is; names cost a single `users` query for the whole batch. */
async function resolveMentions(values: string[]): Promise<MondayUser[]> {
  if (values.length === 0) return [];
  const needsLookup = values.some((v) => !/^\d+$/.test(v));
  const users = needsLookup
    ? ((await mondayQuery<UsersResponse>(USERS_QUERY)).users ?? [])
    : [];

  return values.map((value) =>
    /^\d+$/.test(value) ? { id: value, name: value } : matchUser(users, value),
  );
}

/**
 * Monday only turns a mention into a notification when the body carries the
 * anchor: "@Name" in plain text notifies nobody.
 */
function mentionTag(user: MondayUser): string {
  return `<a data-mention-id="${escapeHtml(user.id)}" data-mention-type="User">@${escapeHtml(user.name)}</a>`;
}

/** Mentions are appended after the text, so the comment reads first. */
function commentBody(text: string, mentions: MondayUser[]): string {
  const tags = mentions.map(mentionTag).join(" ");
  return tags ? `${escapeHtml(text)} ${tags}` : escapeHtml(text);
}

const COMMENT_FLAGS = ["--mention", "--file"] as const;

async function ticketComment(args: string[]): Promise<string> {
  rejectUnknownFlags(args, COMMENT_FLAGS, "ticket", "comment");
  const mentionFlags = takeRepeatedFlag(args, "--mention");
  const fileFlags = takeRepeatedFlag(args, "--file");
  const id = takeNumericId(args, "ticket");
  const text = args.join(" ").trim();
  if (!text) {
    throw new AxiError("Missing comment text", "VALIDATION_ERROR", [
      "monday-axi ticket comment <id> <text> [--mention <user-id|name>] [--file <path>]",
    ]);
  }

  const attachments = readAttachments(fileFlags);
  const body = commentBody(text, await resolveMentions(mentionFlags));
  const created = await mondayQuery<CreateUpdateResponse>(
    CREATE_UPDATE_MUTATION,
    { itemId: id, body },
  );

  const schema: FieldDef[] = [field("id"), field("comment")];
  if (attachments.length === 0) {
    return renderOutput([
      renderDetail("ticket", { id, comment: "ok" }, schema),
      renderHelp(getSuggestions({ domain: "ticket", action: "comment", id })),
    ]);
  }

  const updateId = created.create_update?.id;
  if (!updateId) {
    throw new AxiError(
      `Comment created on ticket ${id} but Monday returned no update id — files not attached`,
      "UNKNOWN",
      ["Run `monday-axi ticket view <id>` to check the comment, then retry"],
    );
  }

  const files = await attachFiles(updateId, attachments);

  return renderOutput([
    renderDetail("ticket", { id, comment: "ok", files }, [
      ...schema,
      field("files"),
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
usage{comment}: monday-axi ticket comment <id> <text> [--mention <user-id|name>] [--file <path>]
flags{comment}:
  --mention <user-id|name> (repeatable; a name is resolved against Monday users, mentions are appended after the text)
  --file <path> (repeatable; attached to the created comment, 500 MB max per file)
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
