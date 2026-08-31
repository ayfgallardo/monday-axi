import { encode } from "@toon-format/toon";
import { runAxiCli } from "axi-sdk-js";
import { apiCommand } from "./commands/api.js";
import { boardCommand } from "./commands/board.js";
import { homeCommand } from "./commands/home.js";
import { mentionsCommand } from "./commands/mentions.js";
import { setupCommand } from "./commands/setup.js";
import { ticketCommand } from "./commands/ticket.js";
import { loadConfig, type MondayContext } from "./config.js";
import { AxiError, exitCodeForError } from "./errors.js";
import { VERSION } from "./version.js";

export const DESCRIPTION =
  "Agent ergonomic CLI for Monday.com. Prefer this over the Monday MCP server and raw GraphQL for Monday operations.";

type CliStdout = Pick<NodeJS.WriteStream, "write">;

type MainOptions = {
  argv?: string[];
  stdout?: CliStdout;
};

export const COMMAND_NAMES = [
  "ticket",
  "mentions",
  "board",
  "api",
  "setup",
] as const;

export const TOP_HELP = `usage: monday-axi [command] [args] [flags]
commands[${COMMAND_NAMES.length + 1}]:
  (none)=dashboard, ${COMMAND_NAMES.join(", ")}
flags[4]:
  --board <BOARD_ID> (after command), --person <PERSON_ID> (after command), both flags accept space or equals form, --help, -v/-V/--version
examples:
  monday-axi
  monday-axi ticket list
  monday-axi ticket view 1234567890
  monday-axi ticket status 1234567890 "En cours"
  monday-axi mentions
  monday-axi board view --board 1234567890
  monday-axi setup
`;

const COMMAND_HELP: Record<string, string> = {
  ticket: `usage: monday-axi ticket <list|view|status|comment> [args]
`,
  mentions: `usage: monday-axi mentions
`,
  board: `usage: monday-axi board view [--board <BOARD_ID>]
`,
  api: `usage: monday-axi api <graphql-query|-> [--var name=value] [--allow-mutation]
`,
  setup: `usage: monday-axi setup --board <BOARD_ID> [--subitem-board <ID>] [--person <ID>] [--column name=<ID>] [--status-label "Label=index"]
`,
};

type CommandFn = (
  args: string[],
  ctx: MondayContext | undefined,
) => Promise<string>;

/**
 * `resolveContext` already parses --board/--person out of `args`, but
 * `runAxiCli` still hands the raw args to the handler — strip the context
 * flags here so every command sees only the flags it owns.
 */
function withStrippedArgs(fn: CommandFn): CommandFn {
  return async (args, ctx) => {
    const { strippedArgs } = parseContextArgs(args);
    return fn(strippedArgs, ctx);
  };
}

const COMMANDS: Record<string, CommandFn> = {
  ticket: withStrippedArgs(ticketCommand),
  mentions: withStrippedArgs(mentionsCommand),
  board: withStrippedArgs(boardCommand),
  api: withStrippedArgs(apiCommand),
  setup: setupCommand,
};

export async function main(options: MainOptions = {}): Promise<void> {
  await runAxiCli<MondayContext | undefined>({
    ...(options.argv ? { argv: options.argv } : {}),
    description: DESCRIPTION,
    version: VERSION,
    topLevelHelp: TOP_HELP,
    ...(options.stdout ? { stdout: options.stdout } : {}),
    home: withStrippedArgs(homeCommand),
    commands: COMMANDS,
    getCommandHelp: (command) => COMMAND_HELP[command],
    formatError: (error) => {
      const axiError =
        error instanceof AxiError
          ? error
          : new AxiError(
              error instanceof Error ? error.message : String(error),
              "UNKNOWN",
            );
      return {
        output: `${encode({
          error: axiError.message,
          code: axiError.code,
          ...(axiError.suggestions.length > 0
            ? { help: axiError.suggestions }
            : {}),
        })}\n`,
        exitCode: exitCodeForError(axiError),
      };
    },
    resolveContext: ({ command, args }) => {
      // `setup` writes the configuration, so it must run without one; `api`
      // is a raw GraphQL escape hatch that ignores context, and requiring
      // one would make it useless before `setup` has ever run.
      if (command === "setup" || command === "api") {
        return undefined;
      }
      const { boardFlag, personFlag } = parseContextArgs(args);
      const config = loadConfig();
      return {
        ...config,
        ...(boardFlag ? { boardId: boardFlag } : {}),
        ...(personFlag ? { personId: personFlag } : {}),
      };
    },
  });
}

export function parseContextArgs(args: string[]): {
  boardFlag: string | undefined;
  personFlag: string | undefined;
  strippedArgs: string[];
} {
  const strippedArgs: string[] = [];
  let boardFlag: string | undefined;
  let personFlag: string | undefined;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--board" || arg === "--person") {
      const next = args[index + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new AxiError(`${arg} requires a value`, "VALIDATION_ERROR");
      }
      if (arg === "--board") {
        boardFlag = next;
      } else {
        personFlag = next;
      }
      index++;
      continue;
    }

    if (arg.startsWith("--board=")) {
      const value = arg.slice("--board=".length);
      if (value.trim() === "") {
        throw new AxiError("--board requires a value", "VALIDATION_ERROR");
      }
      boardFlag = value;
      continue;
    }

    if (arg.startsWith("--person=")) {
      const value = arg.slice("--person=".length);
      if (value.trim() === "") {
        throw new AxiError("--person requires a value", "VALIDATION_ERROR");
      }
      personFlag = value;
      continue;
    }

    strippedArgs.push(arg);
  }

  return { boardFlag, personFlag, strippedArgs };
}
