import { beforeEach, describe, expect, it, vi } from "vitest";
import updatesFixture from "../fixtures/updates-mentions.json";

const { mondayQuery } = vi.hoisted(() => ({ mondayQuery: vi.fn() }));
vi.mock("../../src/monday.js", () => ({ mondayQuery }));

import { mentionsCommand } from "../../src/commands/mentions.js";
import type { MondayContext } from "../../src/config.js";

const context: MondayContext = {
  boardId: "1234567890",
  personId: "999",
  columns: {},
  statusLabels: [],
};

describe("mentions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("filters updates on data-mention-id in the HTML body", async () => {
    mondayQuery.mockResolvedValue(updatesFixture);
    const output = await mentionsCommand([], context);
    expect(output).toContain("111");
    expect(output).toContain("count: 1");
  });

  it("ignores an update with no item_id even when it mentions the person", async () => {
    mondayQuery.mockResolvedValue({
      updates: [
        {
          id: "1",
          created_at: "2026-08-01T00:00:00Z",
          text_body: "x",
          body: '<span data-mention-id="999">x</span>',
          item_id: null,
          creator: { id: "1", name: "X" },
        },
      ],
    });
    const output = await mentionsCommand([], context);
    expect(output).toContain("0 mentions");
  });

  it("requires a configured personId", async () => {
    const noPerson: MondayContext = { ...context, personId: undefined };
    await expect(mentionsCommand([], noPerson)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("passes --limit as a variable, never inlined into the query", async () => {
    mondayQuery.mockResolvedValue(updatesFixture);
    await mentionsCommand(["--limit", "10"], context);
    const [query, variables] = mondayQuery.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(variables.limit).toBe(10);
    expect(query).not.toContain("10");
  });

  it("rejects unknown flags", async () => {
    await expect(mentionsCommand(["--bogus"], context)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});
