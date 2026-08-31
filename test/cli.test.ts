import { beforeEach, describe, expect, it, vi } from "vitest";

const { runAxiCli, loadConfig } = vi.hoisted(() => ({
  runAxiCli: vi.fn(),
  loadConfig: vi.fn(),
}));

vi.mock("axi-sdk-js", async () => {
  const actual =
    await vi.importActual<typeof import("axi-sdk-js")>("axi-sdk-js");
  return { ...actual, runAxiCli };
});

vi.mock("../src/config.js", () => ({ loadConfig }));

import { AxiError } from "../src/errors.js";
import { COMMAND_NAMES, main, parseContextArgs, TOP_HELP } from "../src/cli.js";
import type { MondayContext } from "../src/config.js";
import { VERSION } from "../src/version.js";

const context: MondayContext = {
  boardId: "1234567890",
  subitemBoardId: "1234567891",
  personId: "999",
  columns: { status: "status_1" },
  statusLabels: ["À faire"],
};

async function cliOptions() {
  await main();
  return vi.mocked(runAxiCli).mock.calls[0][0];
}

describe("main CLI", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    loadConfig.mockReturnValue(context);
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

  it("answers with a not-ported-yet stub for each command", async () => {
    const options = await cliOptions();
    for (const name of COMMAND_NAMES) {
      const output = await options.commands[name]([], context);
      expect(String(output)).toContain("not ported yet");
      expect(String(output)).toContain(name);
    }
    expect(String(await options.home([], context))).toContain("not ported yet");
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
});
