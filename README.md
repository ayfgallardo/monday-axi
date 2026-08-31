# monday-axi

AXI-compliant CLI for Monday.com — token-efficient TOON output, contextual
suggestions, targeted mutations. Built on the
[glab-axi](https://github.com/ayfgallardo/glab-axi) architecture, talking
directly to the Monday GraphQL API (no MCP server, no scraping).

Prefer this over the Monday MCP server and raw GraphQL for Monday operations:
responses are TOON-shaped instead of raw JSON, and every response carries
contextual suggestions for the next command.

## Install

Not published on npm — install straight from this repository:

```sh
pnpm add -g git+https://github.com/ayfgallardo/monday-axi
```

Or, working from a clone:

```sh
pnpm install
pnpm build
pnpm link --global
```

### Prerequisites

- Node.js 20 or newer.
- A Monday API token (see [Auth](#auth) below).
- A configuration file created with `monday-axi setup` (see [Config](#config)).

## Commands

Run `monday-axi --help` for the full command list and
`monday-axi <command> --help` for a command's flags — the CLI's own `--help`
output is the source of truth, not this README.

- `monday-axi` (no command) — dashboard: my open tickets, grouped by status.
- `ticket list` — list tickets, optionally filtered by `--status <label>`.
- `ticket view <id>` — a ticket's detail, including updates/comments.
- `ticket status <id> "<label>"` — move a ticket to a status.
- `ticket comment <id> "<text>"` — add a comment.
- `mentions` — recent updates that mention the configured person.
- `board view` — the configured board's groups, columns, and status labels.
- `api` — raw GraphQL query/mutation passthrough, the escape hatch for
  anything not covered above. Runs without a config file (like `setup`).
  Values only ever travel as GraphQL variables (`--var name=value`), never
  interpolated into the query string, but they are always sent as strings —
  a variable declared as a non-string type (e.g. `$limit: Int!`) will fail;
  inline that value as a literal in the query text instead. A query
  containing a mutation operation is refused unless `--allow-mutation` is
  passed.
- `setup` — writes the local instance configuration non-interactively (see
  [Config](#config)). Never touches the API token.

No board/column CRUD, no npm publication.

## Config

`monday-axi` (every command but `setup` and `api`) requires
`~/.config/monday-axi/config.json`: board id, optional subitem board id,
optional person id (used to match mentions), column id map, and status
labels. Create or repair it non-interactively:

```sh
monday-axi setup --board <BOARD_ID> \
  --subitem-board <SUBITEM_BOARD_ID> \
  --person <PERSON_ID> \
  --column status=<COLUMN_ID> \
  --status-label "En cours=1"
```

`--column` and `--status-label` are repeatable. Run `monday-axi setup --help`
for the full flag list. `setup` prints back exactly what was written — never
invented data — and re-validates it through the same shape check used when
the config is loaded.

## Auth

The API token is never handled by `setup` and never appears in argv or logs —
it only ever travels through the `Authorization` header. First match wins:

1. `MONDAY_API_TOKEN` environment variable
2. `MONDAY_TOKEN` environment variable
3. a `MONDAY_TOKEN=` line in the local console `.env` file
4. the macOS Keychain (`security find-generic-password -s monday-orca`)

## Known limitations

- No board/column CRUD — read the board, change a ticket's status/comments,
  or drop to `api` for anything else.
- Not published to npm; install from the git repository as shown above.

## Benchmark

Tokens (`o200k_base`) of `monday-axi` output vs the Monday MCP server
equivalent, on the read commands, measured against a real board — see
`scripts/benchmark.ts`. Regenerate with:

```sh
pnpm run bench <directory-of-captured-output-pairs>
```

Each scenario is a pair of files sharing a name: `<scenario>.axi.<ext>` (this
CLI's output) and `<scenario>.mcp.<ext>` (the MCP-equivalent output).

Measured 2026-08-31 on a live 37-ticket sprint board. MCP equivalents:
`get_board_items_page` (home, ticket list), `get_board_items_page` +
`get_updates` (ticket view), `get_updates` on the board with item updates
(mentions), `get_board_info` with `columns.only` (board view).

| Scenario    | monday-axi tokens | MCP tokens | Ratio |
| ----------- | ----------------- | ---------- | ----- |
| home        | 1078              | 8827       | 8.2x  |
| ticket list | 802               | 8827       | 11.0x |
| ticket view | 239               | 603        | 2.5x  |
| mentions    | 223               | 8299       | 37.2x |
| board view  | 295               | 2645       | 9.0x  |

## License

MIT
