import { beforeEach, describe, expect, it, vi } from "vitest";
import homeFixture from "../fixtures/home-items.json";

const { mondayQuery } = vi.hoisted(() => ({ mondayQuery: vi.fn() }));
vi.mock("../../src/monday.js", () => ({ mondayQuery }));

import { homeCommand } from "../../src/commands/home.js";
import type { MondayContext } from "../../src/config.js";

const context: MondayContext = {
  boardId: "1234567890",
  personId: "999",
  columns: { status: "status_1", person: "person_1", module: "module_1" },
  statusLabels: [
    { label: "À faire", index: 0 },
    { label: "En cours", index: 1 },
    { label: "En revue", index: 2 },
    { label: "Terminé", index: 5 },
    { label: "Archivé", index: 107 },
  ],
};

describe("home", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("groups sprint tickets by status with an aggregate line", async () => {
    mondayQuery.mockResolvedValue(homeFixture);
    const output = await homeCommand([], context);
    expect(output).toContain("3 tickets");
    expect(output).toContain("En cours");
    expect(output).toContain("À faire");
    expect(output).toContain("Fix login timeout");
  });

  it("filters by the configured person and excludes archived by default", async () => {
    mondayQuery.mockResolvedValue(homeFixture);
    await homeCommand([], context);
    const [, variables] = mondayQuery.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    const queryParams = variables.queryParams as { rules: unknown[] };
    expect(queryParams.rules).toEqual(
      expect.arrayContaining([
        {
          column_id: "person_1",
          compare_value: ["person-999"],
          operator: "any_of",
        },
        {
          column_id: "status_1",
          compare_value: [107],
          operator: "not_any_of",
        },
      ]),
    );
  });

  it("shows an explicit empty state", async () => {
    mondayQuery.mockResolvedValue({
      boards: [{ items_page: { cursor: null, items: [] } }],
    });
    const output = await homeCommand([], context);
    expect(output).toContain("0 tickets");
  });

  it("requires a configured personId", async () => {
    const noPerson: MondayContext = { ...context, personId: undefined };
    await expect(homeCommand([], noPerson)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("surfaces the pagination cursor instead of dropping it", async () => {
    mondayQuery.mockResolvedValue({
      boards: [
        {
          items_page: {
            cursor: "cursor-home-2",
            items: homeFixture.boards[0].items_page.items,
          },
        },
      ],
    });
    const output = await homeCommand([], context);
    expect(output).toContain("next_cursor: cursor-home-2");
    expect(output).toContain("--cursor cursor-home-2");
  });
});
