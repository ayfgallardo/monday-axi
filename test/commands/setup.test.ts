import { beforeEach, describe, expect, it, vi } from "vitest";

const { readFileSync, writeFileSync, mkdirSync } = vi.hoisted(() => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));
vi.mock("node:fs", () => ({ readFileSync, writeFileSync, mkdirSync }));

import { setupCommand } from "../../src/commands/setup.js";
import { configPath } from "../../src/config.js";
import { AxiError } from "../../src/errors.js";

describe("setup", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    writeFileSync.mockImplementation((_path, content) => {
      readFileSync.mockReturnValue(content);
    });
  });

  it("returns the help text", async () => {
    expect(await setupCommand(["--help"])).toContain("monday-axi setup");
  });

  it("writes the config and prints back what was written", async () => {
    const output = await setupCommand([
      "--board",
      "1234567890",
      "--subitem-board",
      "1234567891",
      "--person",
      "999",
      "--column",
      "status=status_1",
      "--status-label",
      "En cours=1",
    ]);

    expect(mkdirSync).toHaveBeenCalledWith(expect.any(String), {
      recursive: true,
    });
    expect(writeFileSync).toHaveBeenCalledWith(
      configPath(),
      expect.stringContaining('"boardId": "1234567890"'),
      "utf-8",
    );
    expect(output).toContain("1234567890");
    expect(output).toContain("status_1");
    expect(output).toContain("En cours");
  });

  it("accepts --board alone, defaulting columns and status labels", async () => {
    const output = await setupCommand(["--board", "1234567890"]);
    expect(output).toContain("1234567890");
    expect(writeFileSync).toHaveBeenCalled();
  });

  it("never writes a subitemBoardId or personId when not given", async () => {
    await setupCommand(["--board", "1234567890"]);
    const written = JSON.parse(writeFileSync.mock.calls[0][1] as string);
    expect(written).not.toHaveProperty("subitemBoardId");
    expect(written).not.toHaveProperty("personId");
  });

  it("rejects when --board is missing", async () => {
    const error: unknown = await setupCommand([]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AxiError);
    expect((error as AxiError).code).toBe("VALIDATION_ERROR");
    expect((error as AxiError).message).toContain("--board");
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it("rejects an unknown flag", async () => {
    await expect(
      setupCommand(["--board", "1234567890", "--bogus"]),
    ).rejects.toThrow(/unknown flag/);
  });

  it("rejects a positional argument", async () => {
    await expect(
      setupCommand(["--board", "1234567890", "extra"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a malformed --column", async () => {
    await expect(
      setupCommand(["--board", "1234567890", "--column", "status"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a malformed --status-label index", async () => {
    await expect(
      setupCommand(["--board", "1234567890", "--status-label", "En cours=abc"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
