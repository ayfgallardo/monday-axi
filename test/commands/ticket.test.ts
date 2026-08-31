import { beforeEach, describe, expect, it, vi } from "vitest";
import itemsPageFixture from "../fixtures/items-page.json";
import itemViewFixture from "../fixtures/item-view.json";

const { mondayQuery } = vi.hoisted(() => ({ mondayQuery: vi.fn() }));
vi.mock("../../src/monday.js", () => ({ mondayQuery }));

import {
  LIST_QUERY,
  NEXT_PAGE_QUERY,
  ticketCommand,
  VIEW_QUERY,
} from "../../src/commands/ticket.js";
import type { MondayContext } from "../../src/config.js";

const context: MondayContext = {
  boardId: "1234567890",
  subitemBoardId: "1234567891",
  personId: "999",
  columns: {
    status: "status_1",
    person: "person_1",
    module: "module_1",
    alertDate: "date_1",
    mrLink: "mrlink_1",
    severity: "severity_1",
    urgency: "urgency_1",
    type: "type_1",
  },
  // Non-contiguous Monday settings indexes on purpose: catches any code that
  // derives the index from the array position instead of the configured one.
  statusLabels: [
    { label: "À faire", index: 0 },
    { label: "En cours", index: 1 },
    { label: "En revue", index: 2 },
    { label: "Terminé", index: 5 },
    { label: "Archivé", index: 107 },
  ],
};

describe("ticket list", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("excludes Archivé by default via the configured (non-contiguous) status index", async () => {
    mondayQuery.mockResolvedValue(itemsPageFixture);
    await ticketCommand(["list"], context);
    const [, variables] = mondayQuery.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(variables.queryParams).toEqual({
      operator: "and",
      rules: [
        {
          column_id: "status_1",
          compare_value: [107],
          operator: "not_any_of",
        },
      ],
    });
  });

  it("renders the ticket list with status/module and an aggregate line", async () => {
    mondayQuery.mockResolvedValue(itemsPageFixture);
    const output = await ticketCommand(["list"], context);
    expect(output).toContain("tickets");
    expect(output).toContain("111");
    expect(output).toContain("Fix login timeout");
    expect(output).toContain("En cours");
  });

  it("--status filters to the given label by its configured index", async () => {
    mondayQuery.mockResolvedValue(itemsPageFixture);
    await ticketCommand(["list", "--status", "Terminé"], context);
    const [, variables] = mondayQuery.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(variables.queryParams).toEqual({
      operator: "and",
      rules: [
        { column_id: "status_1", compare_value: [5], operator: "any_of" },
      ],
    });
  });

  it("rejects an unknown status label", async () => {
    await expect(
      ticketCommand(["list", "--status", "Bogus"], context),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("pushes --module as a contains_text rule into query_params alongside the status rule", async () => {
    mondayQuery.mockResolvedValue(itemsPageFixture);
    await ticketCommand(["list", "--module", "Auth"], context);
    const [, variables] = mondayQuery.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    const queryParams = variables.queryParams as { rules: unknown[] };
    expect(queryParams.rules).toEqual(
      expect.arrayContaining([
        {
          column_id: "module_1",
          compare_value: ["Auth"],
          operator: "contains_text",
        },
      ]),
    );
  });

  it("rejects --module with a clear error when no module column is configured, instead of silently filtering nothing", async () => {
    const noModuleColumn: MondayContext = {
      ...context,
      columns: { status: "status_1" },
    };
    await expect(
      ticketCommand(["list", "--module", "auth"], noModuleColumn),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(mondayQuery).not.toHaveBeenCalled();
  });

  it("--all includes archived tickets without an exclusion rule", async () => {
    mondayQuery.mockResolvedValue(itemsPageFixture);
    await ticketCommand(["list", "--all"], context);
    const [, variables] = mondayQuery.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(variables.queryParams).toBeNull();
  });

  it("passes --limit as a GraphQL variable, never inlined into the constant query", async () => {
    mondayQuery.mockResolvedValue(itemsPageFixture);
    await ticketCommand(["list", "--limit", "5"], context);
    const [query, variables] = mondayQuery.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(variables.limit).toBe(5);
    expect(query).toBe(LIST_QUERY);
  });

  it("throws VALIDATION_ERROR when --status has no value", async () => {
    await expect(
      ticketCommand(["list", "--status"], context),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("renders an explicit empty state", async () => {
    mondayQuery.mockResolvedValue({
      boards: [{ items_page: { cursor: null, items: [] } }],
    });
    const output = await ticketCommand(["list"], context);
    expect(output).toContain("0 tickets");
  });

  it("rejects an unknown flag", async () => {
    await expect(
      ticketCommand(["list", "--bogus"], context),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  describe("--cursor pagination", () => {
    it("continues the page via next_items_page and shows the next cursor", async () => {
      mondayQuery.mockResolvedValue({
        next_items_page: {
          cursor: "cursor-page3",
          items: itemsPageFixture.boards[0].items_page.items,
        },
      });
      const output = await ticketCommand(
        ["list", "--cursor", "cursor-page2"],
        context,
      );
      const [query, variables] = mondayQuery.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(query).toBe(NEXT_PAGE_QUERY);
      expect(variables.cursor).toBe("cursor-page2");
      expect(output).toContain("next_cursor: cursor-page3");
      expect(output).toContain("--cursor cursor-page3");
    });

    it("does not surface a cursor hint when the last page has none", async () => {
      mondayQuery.mockResolvedValue({
        next_items_page: { cursor: null, items: [] },
      });
      const output = await ticketCommand(
        ["list", "--cursor", "cursor-last"],
        context,
      );
      expect(output).not.toContain("next_cursor");
    });

    it("rejects --cursor combined with --status", async () => {
      await expect(
        ticketCommand(
          ["list", "--cursor", "c", "--status", "En cours"],
          context,
        ),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it("rejects --cursor combined with --module", async () => {
      await expect(
        ticketCommand(["list", "--cursor", "c", "--module", "Auth"], context),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it("rejects --cursor combined with --all", async () => {
      await expect(
        ticketCommand(["list", "--cursor", "c", "--all"], context),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });
  });

  it("shows a next_cursor line and a --cursor hint for the first page when more results exist", async () => {
    mondayQuery.mockResolvedValue(itemsPageFixture);
    const output = await ticketCommand(["list"], context);
    expect(output).toContain(
      `next_cursor: ${itemsPageFixture.boards[0].items_page.cursor}`,
    );
    expect(output).toContain("--cursor");
  });
});

describe("ticket view", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("renders ticket detail with subitems and files", async () => {
    mondayQuery.mockResolvedValue(itemViewFixture);
    const output = await ticketCommand(["view", "111"], context);
    expect(output).toContain("Fix login timeout");
    expect(output).toContain("444");
    expect(output).toContain("screenshot.png");
  });

  it("truncates long update bodies and shows the size", async () => {
    mondayQuery.mockResolvedValue(itemViewFixture);
    const output = await ticketCommand(["view", "111"], context);
    expect(output).toContain("truncated");
    expect(output).toContain("chars total");
  });

  it("--full shows the complete update text untruncated", async () => {
    mondayQuery.mockResolvedValue(itemViewFixture);
    const output = await ticketCommand(["view", "111", "--full"], context);
    expect(output).not.toContain("truncated");
    expect(output).toContain("laborum.");
  });

  it("throws NOT_FOUND when the ticket does not exist", async () => {
    mondayQuery.mockResolvedValue({ items: [] });
    await expect(
      ticketCommand(["view", "999999"], context),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("requires a numeric ticket id", async () => {
    await expect(ticketCommand(["view"], context)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("passes the ticket id as a GraphQL variable, never inlined into the constant query", async () => {
    mondayQuery.mockResolvedValue(itemViewFixture);
    await ticketCommand(["view", "111"], context);
    const [query, variables] = mondayQuery.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(variables.id).toBe("111");
    expect(query).toBe(VIEW_QUERY);
  });
});

describe("ticket router", () => {
  it("rejects an unknown subcommand", async () => {
    const output = await ticketCommand(["bogus"], context);
    expect(output).toContain("Unknown ticket subcommand");
  });

  it("shows help with no subcommand", async () => {
    const output = await ticketCommand([], context);
    expect(output).toContain("usage: monday-axi ticket");
  });
});
