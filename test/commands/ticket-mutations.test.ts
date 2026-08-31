import { beforeEach, describe, expect, it, vi } from "vitest";

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
  },
  statusLabels: [
    { label: "À faire", index: 0 },
    { label: "En cours", index: 1 },
    { label: "En revue", index: 2 },
    { label: "Terminé", index: 5 },
    { label: "Archivé", index: 107 },
  ],
};

describe("ticket status", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("rejects an unknown status label with VALIDATION_ERROR listing the valid labels", async () => {
    await expect(
      ticketCommand(["status", "111", "Bogus"], context),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(mondayQuery).not.toHaveBeenCalled();
  });

  it("lists the valid labels in the VALIDATION_ERROR suggestions", async () => {
    try {
      await ticketCommand(["status", "111", "Bogus"], context);
      throw new Error("expected rejection");
    } catch (error) {
      const suggestions = (error as { suggestions: string[] }).suggestions;
      expect(suggestions.join(" ")).toContain("À faire");
      expect(suggestions.join(" ")).toContain("En cours");
      expect(suggestions.join(" ")).toContain("Terminé");
      expect(suggestions.join(" ")).toContain("Archivé");
    }
  });

  it("resolves the item's own board (not the configured boardId) before mutating — subitem case", async () => {
    mondayQuery
      .mockResolvedValueOnce({
        items: [
          {
            id: "222",
            board: { id: "9999999999" },
            column_values: [
              { id: "status_1", text: "À faire", label: "À faire" },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({ change_simple_column_value: { id: "222" } });

    await ticketCommand(["status", "222", "En cours"], context);

    expect(mondayQuery).toHaveBeenCalledTimes(2);
    const [, mutationVars] = mondayQuery.mock.calls[1] as [
      string,
      Record<string, unknown>,
    ];
    expect(mutationVars.boardId).toBe("9999999999");
    expect(mutationVars.boardId).not.toBe(context.boardId);
    expect(mutationVars.itemId).toBe("222");
    expect(mutationVars.columnId).toBe("status_1");
    expect(mutationVars.value).toBe("En cours");
  });

  it("sets the status via change_simple_column_value with the raw label text", async () => {
    mondayQuery
      .mockResolvedValueOnce({
        items: [
          {
            id: "111",
            board: { id: "1234567890" },
            column_values: [
              { id: "status_1", text: "À faire", label: "À faire" },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({ change_simple_column_value: { id: "111" } });

    const output = await ticketCommand(["status", "111", "En cours"], context);

    expect(mondayQuery).toHaveBeenCalledTimes(2);
    expect(output).toContain("En cours");
  });

  it("is idempotent: setting a status already in place succeeds without calling the mutation", async () => {
    mondayQuery.mockResolvedValueOnce({
      items: [
        {
          id: "111",
          board: { id: "1234567890" },
          column_values: [
            { id: "status_1", text: "En cours", label: "En cours" },
          ],
        },
      ],
    });

    const output = await ticketCommand(["status", "111", "En cours"], context);

    expect(mondayQuery).toHaveBeenCalledTimes(1);
    expect(output).toContain("En cours");
  });

  it("throws NOT_FOUND when the ticket does not exist", async () => {
    mondayQuery.mockResolvedValueOnce({ items: [] });
    await expect(
      ticketCommand(["status", "999999", "En cours"], context),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("requires a status label argument", async () => {
    await expect(
      ticketCommand(["status", "111"], context),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(mondayQuery).not.toHaveBeenCalled();
  });
});

describe("ticket comment", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("escapes HTML-sensitive characters in the comment body", async () => {
    mondayQuery.mockResolvedValueOnce({ create_update: { id: "555" } });

    await ticketCommand(
      ["comment", "111", `<script>alert("x")</script> & 'quote'`],
      context,
    );

    const [query, vars] = mondayQuery.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(query).toContain("create_update");
    expect(vars.itemId).toBe("111");
    expect(vars.body).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quote&#39;",
    );
  });

  it("turns newlines into <br> in the comment body", async () => {
    mondayQuery.mockResolvedValueOnce({ create_update: { id: "555" } });

    await ticketCommand(["comment", "111", "line1\nline2"], context);

    const [, vars] = mondayQuery.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(vars.body).toBe("line1<br>line2");
  });

  it("passes the item id and body only as GraphQL variables, never inlined into the query", async () => {
    mondayQuery.mockResolvedValueOnce({ create_update: { id: "555" } });

    const [query] = await Promise.all([
      ticketCommand(["comment", "111", "hello"], context).then(
        () => mondayQuery.mock.calls[0][0] as string,
      ),
    ]);

    expect(query).not.toContain("111");
    expect(query).not.toContain("hello");
  });

  it("requires comment text", async () => {
    await expect(
      ticketCommand(["comment", "111"], context),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(mondayQuery).not.toHaveBeenCalled();
  });

  it("returns explicit success output", async () => {
    mondayQuery.mockResolvedValueOnce({ create_update: { id: "555" } });
    const output = await ticketCommand(["comment", "111", "hello"], context);
    expect(output).toContain("111");
  });
});
