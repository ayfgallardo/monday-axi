import { beforeEach, describe, expect, it, vi } from "vitest";
import itemsPageFixture from "../fixtures/items-page.json";
import itemViewFixture from "../fixtures/item-view.json";

const { mondayQuery } = vi.hoisted(() => ({ mondayQuery: vi.fn() }));
vi.mock("../../src/monday.js", () => ({ mondayQuery }));

import { ticketCommand } from "../../src/commands/ticket.js";
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
  statusLabels: ["À faire", "En cours", "En revue", "Terminé", "Archivé"],
};

describe("ticket list", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("excludes Archivé by default via the configured status index", async () => {
    mondayQuery.mockResolvedValue(itemsPageFixture);
    await ticketCommand(["list"], context);
    const [, variables] = mondayQuery.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(variables.queryParams).toEqual({
      operator: "and",
      rules: [
        { column_id: "status_1", compare_value: [4], operator: "not_any_of" },
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

  it("--status filters to the given label by index", async () => {
    mondayQuery.mockResolvedValue(itemsPageFixture);
    await ticketCommand(["list", "--status", "En cours"], context);
    const [, variables] = mondayQuery.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(variables.queryParams).toEqual({
      operator: "and",
      rules: [
        { column_id: "status_1", compare_value: [1], operator: "any_of" },
      ],
    });
  });

  it("rejects an unknown status label", async () => {
    await expect(
      ticketCommand(["list", "--status", "Bogus"], context),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("--module filters client-side, case-insensitively", async () => {
    mondayQuery.mockResolvedValue(itemsPageFixture);
    const output = await ticketCommand(["list", "--module", "auth"], context);
    expect(output).toContain("Fix login timeout");
    expect(output).not.toContain("Update onboarding email");
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

  it("passes --limit as a GraphQL variable, never inlined", async () => {
    mondayQuery.mockResolvedValue(itemsPageFixture);
    await ticketCommand(["list", "--limit", "5"], context);
    const [query, variables] = mondayQuery.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(variables.limit).toBe(5);
    expect(query).not.toContain("5");
  });

  it("renders an explicit empty state", async () => {
    mondayQuery.mockResolvedValue({
      boards: [{ items_page: { cursor: null, items: [] } }],
    });
    const output = await ticketCommand(["list"], context);
    expect(output).toContain("0 tickets");
  });

  it("hints more results are available when a cursor is returned", async () => {
    mondayQuery.mockResolvedValue(itemsPageFixture);
    const output = await ticketCommand(["list"], context);
    expect(output.toLowerCase()).toContain("--limit");
  });

  it("rejects an unknown flag", async () => {
    await expect(
      ticketCommand(["list", "--bogus"], context),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
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

  it("passes the ticket id as a GraphQL variable, never inlined", async () => {
    mondayQuery.mockResolvedValue(itemViewFixture);
    await ticketCommand(["view", "111"], context);
    const [query, variables] = mondayQuery.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(variables.id).toBe("111");
    expect(query).not.toContain("111");
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
