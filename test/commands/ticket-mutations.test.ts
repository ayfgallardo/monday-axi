import { beforeEach, describe, expect, it, vi } from "vitest";

const { mondayQuery } = vi.hoisted(() => ({ mondayQuery: vi.fn() }));
vi.mock("../../src/monday.js", () => ({ mondayQuery }));

import {
  CREATE_UPDATE_MUTATION,
  ticketCommand,
  USERS_QUERY,
} from "../../src/commands/ticket.js";
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

  it("refuses to mutate a subitem (item's board differs from the configured boardId) without calling the mutation", async () => {
    mondayQuery.mockResolvedValueOnce({
      items: [
        {
          id: "222",
          board: { id: context.subitemBoardId },
          column_values: [
            { id: "status_1", text: "À faire", label: "À faire" },
          ],
        },
      ],
    });

    await expect(
      ticketCommand(["status", "222", "En cours"], context),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    expect(mondayQuery).toHaveBeenCalledTimes(1);
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
    expect(output).toContain("already");
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

  it("sends the exported CREATE_UPDATE_MUTATION with id/body as variables, never inlined", async () => {
    mondayQuery.mockResolvedValueOnce({ create_update: { id: "555" } });

    await ticketCommand(["comment", "111", "hello"], context);

    const [query, vars] = mondayQuery.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(query).toBe(CREATE_UPDATE_MUTATION);
    expect(vars).toEqual({ itemId: "111", body: "hello" });
  });

  it("requires comment text", async () => {
    await expect(
      ticketCommand(["comment", "111"], context),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(mondayQuery).not.toHaveBeenCalled();
  });

  it("appends a mention anchor resolved by name, keeping the text escaped", async () => {
    mondayQuery
      .mockResolvedValueOnce({
        users: [
          { id: "42", name: "Florian Gallardo" },
          { id: "43", name: "Alice Martin" },
        ],
      })
      .mockResolvedValueOnce({ create_update: { id: "555" } });

    await ticketCommand(
      ["comment", "111", "à toi <b>", "--mention", "florian"],
      context,
    );

    const [usersQuery] = mondayQuery.mock.calls[0] as [string];
    expect(usersQuery).toBe(USERS_QUERY);
    const [, vars] = mondayQuery.mock.calls[1] as [
      string,
      Record<string, unknown>,
    ];
    expect(vars.body).toBe(
      'à toi &lt;b&gt; <a data-mention-id="42" data-mention-type="User">@Florian Gallardo</a>',
    );
  });

  it("resolves two mentions with a single users query", async () => {
    mondayQuery
      .mockResolvedValueOnce({
        users: [
          { id: "42", name: "Florian Gallardo" },
          { id: "43", name: "Alice Martin" },
        ],
      })
      .mockResolvedValueOnce({ create_update: { id: "555" } });

    await ticketCommand(
      ["comment", "111", "ping", "--mention", "florian", "--mention", "alice"],
      context,
    );

    expect(mondayQuery).toHaveBeenCalledTimes(2);
    const [, vars] = mondayQuery.mock.calls[1] as [
      string,
      Record<string, unknown>,
    ];
    expect(vars.body).toBe(
      'ping <a data-mention-id="42" data-mention-type="User">@Florian Gallardo</a> ' +
        '<a data-mention-id="43" data-mention-type="User">@Alice Martin</a>',
    );
  });

  it("uses a numeric --mention as-is, without querying users", async () => {
    mondayQuery.mockResolvedValueOnce({ create_update: { id: "555" } });

    await ticketCommand(
      ["comment", "111", "ping", "--mention", "12345"],
      context,
    );

    expect(mondayQuery).toHaveBeenCalledTimes(1);
    const [query, vars] = mondayQuery.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(query).toBe(CREATE_UPDATE_MUTATION);
    expect(vars.body).toBe(
      'ping <a data-mention-id="12345" data-mention-type="User">@12345</a>',
    );
  });

  it("rejects an ambiguous --mention name, listing the candidates", async () => {
    mondayQuery.mockResolvedValueOnce({
      users: [
        { id: "42", name: "Florian Gallardo" },
        { id: "44", name: "Florian Dupont" },
      ],
    });

    try {
      await ticketCommand(
        ["comment", "111", "ping", "--mention", "florian"],
        context,
      );
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toMatchObject({ code: "VALIDATION_ERROR" });
      const suggestions = (error as { suggestions: string[] }).suggestions;
      expect(suggestions.join(" ")).toContain("Florian Gallardo (id 42)");
      expect(suggestions.join(" ")).toContain("Florian Dupont (id 44)");
    }
    expect(mondayQuery).toHaveBeenCalledTimes(1);
  });

  it("rejects an unknown --mention name without creating the update", async () => {
    mondayQuery.mockResolvedValueOnce({
      users: [{ id: "42", name: "Florian Gallardo" }],
    });

    await expect(
      ticketCommand(["comment", "111", "ping", "--mention", "bob"], context),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    expect(mondayQuery).toHaveBeenCalledTimes(1);
  });

  it("returns explicit success output", async () => {
    mondayQuery.mockResolvedValueOnce({ create_update: { id: "555" } });
    const output = await ticketCommand(["comment", "111", "hello"], context);
    expect(output).toContain("111");
  });
});
