import { beforeEach, describe, expect, it, vi } from "vitest";

const { mondayQuery, readStdin, isStdinTTY, loadConfig } = vi.hoisted(() => ({
  mondayQuery: vi.fn(),
  readStdin: vi.fn(),
  isStdinTTY: vi.fn(),
  loadConfig: vi.fn(),
}));
vi.mock("../../src/monday.js", () => ({ mondayQuery }));
vi.mock("../../src/stdin.js", () => ({ readStdin, isStdinTTY }));
vi.mock("../../src/config.js", () => ({ loadConfig }));

import { apiCommand } from "../../src/commands/api.js";
import { AxiError } from "../../src/errors.js";

describe("api", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    isStdinTTY.mockReturnValue(true);
    loadConfig.mockImplementation(() => {
      throw new AxiError("No Monday configuration", "CONFIG_MISSING");
    });
  });

  it("returns the help text", async () => {
    expect(await apiCommand(["--help"])).toContain("monday-axi api");
  });

  it("works without any Monday configuration, an escape hatch usable before setup ever runs", async () => {
    mondayQuery.mockResolvedValue({ ok: true });
    await expect(apiCommand(["query { x }"])).resolves.toContain("ok");
    expect(loadConfig).not.toHaveBeenCalled();
  });

  it("runs a query given as an argument and returns raw JSON", async () => {
    mondayQuery.mockResolvedValue({ boards: [{ id: "1" }] });
    const output = await apiCommand(["query { boards { id } }"]);
    expect(JSON.parse(output)).toEqual({ boards: [{ id: "1" }] });
    expect(mondayQuery).toHaveBeenCalledWith("query { boards { id } }", {});
  });

  it("reads the query from stdin when no argument is given", async () => {
    isStdinTTY.mockReturnValue(false);
    readStdin.mockResolvedValue("query { me { name } }\n");
    mondayQuery.mockResolvedValue({ me: { name: "x" } });
    await apiCommand([]);
    expect(mondayQuery).toHaveBeenCalledWith("query { me { name } }", {});
  });

  it("reads the query from stdin when the argument is -", async () => {
    isStdinTTY.mockReturnValue(false);
    readStdin.mockResolvedValue("query { me { name } }");
    mondayQuery.mockResolvedValue({});
    await apiCommand(["-"]);
    expect(mondayQuery).toHaveBeenCalledWith("query { me { name } }", {});
  });

  it("requires a query argument or piped stdin", async () => {
    await expect(apiCommand([])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("passes --var as GraphQL variables, never interpolated", async () => {
    mondayQuery.mockResolvedValue({});
    await apiCommand([
      "query ($id: ID!) { boards(ids: [$id]) { name } }",
      "--var",
      "id=1234567890",
      "--var",
      "limit=5",
    ]);
    expect(mondayQuery).toHaveBeenCalledWith(
      "query ($id: ID!) { boards(ids: [$id]) { name } }",
      { id: "1234567890", limit: "5" },
    );
  });

  it("refuses a mutation without --allow-mutation", async () => {
    const error = await apiCommand(["mutation { change_column_value }"]).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AxiError);
    expect((error as AxiError).code).toBe("VALIDATION_ERROR");
    expect(mondayQuery).not.toHaveBeenCalled();
  });

  it("runs a mutation when --allow-mutation is passed", async () => {
    mondayQuery.mockResolvedValue({ ok: true });
    await apiCommand(["mutation { change_column_value }", "--allow-mutation"]);
    expect(mondayQuery).toHaveBeenCalledWith(
      "mutation { change_column_value }",
      {},
    );
  });

  it("rejects unknown flags", async () => {
    await expect(apiCommand(["query { x }", "--bogus"])).rejects.toThrow(
      /unknown flag/,
    );
  });

  it("rejects more than one positional argument", async () => {
    await expect(
      apiCommand(["query { x }", "query { y }"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
