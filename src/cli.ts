import { encode } from "@toon-format/toon";
import { runAxiCli } from "axi-sdk-js";
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
  api: `usage: monday-axi api <graphql-query> [--var name=value]
`,
  setup: `usage: monday-axi setup
`,
};

type CommandFn = (
  args: string[],
  ctx: MondayContext | undefined,
) => Promise<string>;

/** Placeholder until the command module lands; see the porting plan. */
function notPortedYet(name: string): CommandFn {
  return async () => encode({ command: name, status: "not ported yet" });
}

const COMMANDS: Record<string, CommandFn> = Object.fromEntries(
  COMMAND_NAMES.map((name) => [name, notPortedYet(name)]),
);

export async function main(options: MainOptions = {}): Promise<void> {
  await runAxiCli<MondayContext | undefined>({
    ...(options.argv ? { argv: options.argv } : {}),
    description: DESCRIPTION,
    version: VERSION,
    topLevelHelp: TOP_HELP,
    ...(options.stdout ? { stdout: options.stdout } : {}),
    home: notPortedYet("home"),
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
      // `setup` writes the configuration, so it must run without one.
      if (command === "setup") {
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
    if ((arg === "--board" || arg === "--person") && index + 1 < args.length) {
      if (arg === "--board") {
        boardFlag = args[index + 1];
      } else {
        personFlag = args[index + 1];
      }
      index++;
      continue;
    }

    if (arg.startsWith("--board=") && arg.length > "--board=".length) {
      boardFlag = arg.slice("--board=".length);
      continue;
    }

    if (arg.startsWith("--person=") && arg.length > "--person=".length) {
      personFlag = arg.slice("--person=".length);
      continue;
    }

    strippedArgs.push(arg);
  }

  return { boardFlag, personFlag, strippedArgs };
}
