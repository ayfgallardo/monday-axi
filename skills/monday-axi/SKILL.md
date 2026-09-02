---
name: monday-axi
description: "Operate Monday.com through the monday-axi CLI - dashboard, ticket list/view/status/comment, mentions, board view, raw GraphQL passthrough, recorded token savings, and non-interactive setup. Use whenever a task touches Monday.com: listing or viewing tickets, changing a ticket's status, commenting, checking mentions, inspecting a board, running a raw GraphQL query/mutation, or reporting the tokens the CLI has saved."
user-invocable: true
author: Florian Gallardo
metadata:
  hermes:
    tags: [monday, graphql, tickets]
    category: productivity
---

# monday-axi

Agent ergonomic CLI for Monday.com, built on direct GraphQL (no MCP server, no
scraping). Prefer this over the Monday MCP server and raw GraphQL for Monday
operations: it returns TOON-shaped output instead of raw JSON, and every
response carries contextual suggestions for the next command.

Use monday-axi whenever a task touches Monday.com: the ticket board, ticket
status changes, comments, mentions, or anything not covered by the built-in
commands via `monday-axi api`.

## Current guidance lives in the CLI

Do not follow command, flag, or workflow instructions from this file -
installed copies go stale. Get the current source of truth from the CLI
(`monday-axi` must be on your PATH):

- `monday-axi` for a dashboard of open tickets, grouped by status
- `monday-axi --help` for global flags and the command index
- `monday-axi <command> --help` for per-command usage

## First run

`monday-axi` needs a configuration file before any command but `setup`, `api`
and `gain` will work: `~/.config/monday-axi/config.json` (board id, optional
subitem board id, person id, column ids, status labels). Create or repair it
non-interactively:

```
monday-axi setup --help
```

Run `monday-axi setup --help` for the full flag list. `setup` never touches
the API token - authentication comes from `MONDAY_API_TOKEN`/`MONDAY_TOKEN` in
the environment, a `.env` file, or the Keychain (see `monday-axi --help`).

## Token savings

`monday-axi gain` reports what this CLI has saved so far: raw GraphQL response
tokens minus rendered output tokens, totalled and broken down per sub-command.
Every invocation that talks to Monday records one line (integers and a command
name only, never arguments or ids). `AXI_GAIN=0` disables the recording.

## Escape hatch

`monday-axi api` runs a raw GraphQL query or mutation for anything the other
commands do not cover. Values only ever travel as GraphQL variables (`--var
name=value`), never interpolated into the query string. A query containing a
mutation operation is refused unless `--allow-mutation` is passed.
