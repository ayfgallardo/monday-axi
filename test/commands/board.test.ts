import { beforeEach, describe, expect, it, vi } from "vitest";
import boardFixture from "../fixtures/board-view.json";

const { mondayQuery } = vi.hoisted(() => ({ mondayQuery: vi.fn() }));
vi.mock("../../src/monday.js", () => ({ mondayQuery }));

import { boardCommand } from "../../src/commands/board.js";
import type { MondayContext } from "../../src/config.js";

const context: MondayContext = {
  boardId: "1234567890",
  columns: { status: "status_1" },
  statusLabels: [
    { label: "À faire", index: 0 },
    { label: "En cours", index: 1 },
    { label: "En revue", index: 2 },
    { label: "Terminé", index: 5 },
    { label: "Archivé", index: 107 },
  ],
};

describe("board view", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("renders groups, columns, and configured status labels", async () => {
    mondayQuery.mockResolvedValue(boardFixture);
    const output = await boardCommand(["view"], context);
    expect(output).toContain("Board projet démo");
    expect(output).toContain("À faire");
    expect(output).toContain("En cours");
    expect(output).toContain("status_1");
    expect(output).toContain("107: Archivé");
  });

  it("errors when the board is not found", async () => {
    mondayQuery.mockResolvedValue({ boards: [] });
    await expect(boardCommand(["view"], context)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("uses ctx.boardId as a GraphQL variable, never inlined", async () => {
    mondayQuery.mockResolvedValue(boardFixture);
    await boardCommand(["view"], context);
    const [query, variables] = mondayQuery.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(variables.boardId).toBe("1234567890");
    expect(query).not.toContain("1234567890");
  });

  it("shows help with no subcommand", async () => {
    const output = await boardCommand([], context);
    expect(output).toContain("usage: monday-axi board");
  });

  it("rejects an unknown subcommand", async () => {
    const output = await boardCommand(["bogus"], context);
    expect(output).toContain("Unknown board subcommand");
  });
});
