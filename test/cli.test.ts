import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  runAxiCli,
  loadConfig,
  ticketCommand,
  mentionsCommand,
  boardCommand,
  homeCommand,
  apiCommand,
  setupCommand,
} = vi.hoisted(() => ({
  runAxiCli: vi.fn(),
  loadConfig: vi.fn(),
  ticketCommand: vi.fn(async () => "ticket output"),
  mentionsCommand: vi.fn(async () => "mentions output"),
  boardCommand: vi.fn(async () => "board output"),
  homeCommand: vi.fn(async () => "home output"),
  apiCommand: vi.fn(async () => "api output"),
  setupCommand: vi.fn(async () => "setup output"),
}));

vi.mock("axi-sdk-js", async () => {
  const actual =
    await vi.importActual<typeof import("axi-sdk-js")>("axi-sdk-js");
  return { ...actual, runAxiCli };
});

vi.mock("../src/config.js", () => ({ loadConfig }));
vi.mock("../src/commands/ticket.js", () => ({ ticketCommand }));
vi.mock("../src/commands/mentions.js", () => ({ mentionsCommand }));
vi.mock("../src/commands/board.js", () => ({ boardCommand }));
vi.mock("../src/commands/home.js", () => ({ homeCommand }));
vi.mock("../src/commands/api.js", () => ({ apiCommand }));
vi.mock("../src/commands/setup.js", () => ({ setupCommand }));

import { AxiError } from "../src/errors.js";
import { COMMAND_NAMES, main, parseContextArgs, TOP_HELP } from "../src/cli.js";
import type { MondayContext } from "../src/config.js";
import { VERSION } from "../src/version.js";

const context: MondayContext = {
  boardId: "1234567890",
  subitemBoardId: "1234567891",
  personId: "999",
  columns: { status: "status_1" },
  statusLabels: [{ label: "À faire", index: 0 }],
};

async function cliOptions() {
  await main();
  return vi.mocked(runAxiCli).mock.calls[0][0];
}

describe("main CLI", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    loadConfig.mockReturnValue(context);
    ticketCommand.mockResolvedValue("ticket output");
    mentionsCommand.mockResolvedValue("mentions output");
    boardCommand.mockResolvedValue("board output");
    homeCommand.mockResolvedValue("home output");
    apiCommand.mockResolvedValue("api output");
    setupCommand.mockResolvedValue("setup output");
  });

  it("routes exactly the Monday command surface", () => {
    expect(COMMAND_NAMES).toEqual([
      "ticket",
      "mentions",
      "board",
      "api",
      "setup",
    ]);
  });

  it("declares the version and the top-level help", async () => {
    const options = await cliOptions();
    expect(options.version).toBe(VERSION);
    expect(options.topLevelHelp).toBe(TOP_HELP);
    expect(TOP_HELP).toContain("--board <BOARD_ID>");
    expect(TOP_HELP).toContain("--person <PERSON_ID>");
    expect(TOP_HELP).toContain("-v/-V/--version");
  });

  it("registers a handler for every advertised command plus home", async () => {
    const options = await cliOptions();
    expect(Object.keys(options.commands).sort()).toEqual(
      [...COMMAND_NAMES].sort(),
    );
    expect(options.home).toBeTypeOf("function");
  });

  it("dispatches api to its command module, stripping --board/--person", async () => {
    const options = await cliOptions();
    expect(
      await options.commands.api(["query { x }", "--board", "5"], context),
    ).toBe("api output");
    expect(apiCommand).toHaveBeenCalledWith(["query { x }"], context);
  });

  it("dispatches setup to its command module without stripping flags", async () => {
    const options = await cliOptions();
    expect(
      await options.commands.setup(["--board", "1234567890"], undefined),
    ).toBe("setup output");
    expect(setupCommand).toHaveBeenCalledWith(
      ["--board", "1234567890"],
      undefined,
    );
  });

  it("dispatches ticket/mentions/board/home to their command modules", async () => {
    const options = await cliOptions();
    expect(await options.commands.ticket(["list"], context)).toBe(
      "ticket output",
    );
    expect(ticketCommand).toHaveBeenCalledWith(["list"], context);

    expect(await options.commands.mentions([], context)).toBe(
      "mentions output",
    );
    expect(mentionsCommand).toHaveBeenCalledWith([], context);

    expect(await options.commands.board(["view"], context)).toBe(
      "board output",
    );
    expect(boardCommand).toHaveBeenCalledWith(["view"], context);

    expect(await options.home([], context)).toBe("home output");
    expect(homeCommand).toHaveBeenCalledWith([], context);
  });

  it("strips --board/--person before handing args to a command handler", async () => {
    const options = await cliOptions();
    await options.commands.ticket(
      ["list", "--board", "5555555555", "--status=En cours"],
      context,
    );
    expect(ticketCommand).toHaveBeenCalledWith(
      ["list", "--status=En cours"],
      context,
    );
  });

  it("exposes per-command help", async () => {
    const options = await cliOptions();
    for (const name of COMMAND_NAMES) {
      expect(options.getCommandHelp?.(name)).toContain(`monday-axi ${name}`);
    }
    expect(options.getCommandHelp?.("nope")).toBeUndefined();
  });

  it("resolves the context from the config file", async () => {
    const options = await cliOptions();
    expect(
      options.resolveContext?.({ command: "ticket", args: ["list"] }),
    ).toEqual(context);
  });

  it("lets --board and --person override the configured ids", async () => {
    const options = await cliOptions();
    expect(
      options.resolveContext?.({
        command: "ticket",
        args: ["list", "--board", "5555555555", "--person=42"],
      }),
    ).toEqual({ ...context, boardId: "5555555555", personId: "42" });
  });

  it("skips config loading for setup, which exists to create it", async () => {
    const options = await cliOptions();
    expect(
      options.resolveContext?.({ command: "setup", args: [] }),
    ).toBeUndefined();
    expect(loadConfig).not.toHaveBeenCalled();
  });

  it("renders an AxiError as TOON with its code and suggestions", async () => {
    const options = await cliOptions();
    const formatted = options.formatError?.(
      new AxiError("board not found", "NOT_FOUND", ["Run `monday-axi setup`"]),
    );
    expect(formatted?.output).toContain("error: board not found");
    expect(formatted?.output).toContain("code: NOT_FOUND");
    expect(formatted?.output).toContain("Run `monday-axi setup`");
    expect(formatted?.exitCode).toBe(1);
  });

  it("rejects --board with no value instead of silently ignoring it", async () => {
    const options = await cliOptions();
    expect(() =>
      options.resolveContext?.({
        command: "ticket",
        args: ["list", "--board"],
      }),
    ).toThrow(/--board requires a value/);
  });

  it("rejects --person=<empty> instead of silently ignoring it", async () => {
    const options = await cliOptions();
    expect(() =>
      options.resolveContext?.({
        command: "ticket",
        args: ["list", "--person="],
      }),
    ).toThrow(/--person requires a value/);
  });

  it("gives a validation error exit code 2", async () => {
    const options = await cliOptions();
    expect(
      options.formatError?.(new AxiError("bad input", "VALIDATION_ERROR"))
        ?.exitCode,
    ).toBe(2);
  });

  it("wraps a non-AxiError as UNKNOWN", async () => {
    const options = await cliOptions();
    const formatted = options.formatError?.(new Error("socket hang up"));
    expect(formatted?.output).toContain("code: UNKNOWN");
    expect(formatted?.exitCode).toBe(1);
  });
});

describe("parseContextArgs", () => {
  it("strips both flag forms and keeps the rest of the arguments", () => {
    expect(
      parseContextArgs([
        "list",
        "--board",
        "5555555555",
        "--person=42",
        "--limit",
        "5",
      ]),
    ).toEqual({
      boardFlag: "5555555555",
      personFlag: "42",
      strippedArgs: ["list", "--limit", "5"],
    });
  });

  it("leaves arguments untouched when no context flag is present", () => {
    expect(parseContextArgs(["view", "1234567890"])).toEqual({
      boardFlag: undefined,
      personFlag: undefined,
      strippedArgs: ["view", "1234567890"],
    });
  });

  it("throws VALIDATION_ERROR when --board is the last argument", () => {
    expect(() => parseContextArgs(["list", "--board"])).toThrow(
      /--board requires a value/,
    );
  });

  it("throws VALIDATION_ERROR when --board is followed by another flag", () => {
    expect(() =>
      parseContextArgs(["list", "--board", "--person", "1"]),
    ).toThrow(/--board requires a value/);
  });

  it("throws VALIDATION_ERROR on an empty --person=<value>", () => {
    expect(() => parseContextArgs(["list", "--person="])).toThrow(
      /--person requires a value/,
    );
  });
});
