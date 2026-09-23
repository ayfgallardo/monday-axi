import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mondayQuery, mondayUpload } = vi.hoisted(() => ({
  mondayQuery: vi.fn(),
  mondayUpload: vi.fn(),
}));
vi.mock("../../src/monday.js", () => ({ mondayQuery, mondayUpload }));

import {
  ADD_FILE_TO_UPDATE_MUTATION,
  assertFileSize,
  MAX_FILE_BYTES,
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

describe("ticket comment --file", () => {
  let dir = "";

  beforeEach(() => {
    vi.resetAllMocks();
    dir = mkdtempSync(join(tmpdir(), "monday-axi-upload-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeFixture(name: string, content: string): string {
    const path = join(dir, name);
    writeFileSync(path, content);
    return path;
  }

  it("creates the comment once, then uploads each file to the created update", async () => {
    const a = writeFixture("a.pdf", "aaa");
    const b = writeFixture("b.png", "bbbb");
    mondayQuery.mockResolvedValueOnce({ create_update: { id: "555" } });
    mondayUpload
      .mockResolvedValueOnce({
        add_file_to_update: { id: "11", name: "a.pdf", file_size: 3 },
      })
      .mockResolvedValueOnce({
        add_file_to_update: { id: "12", name: "b.png", file_size: 4 },
      });

    const output = await ticketCommand(
      ["comment", "111", "voici", "--file", a, "--file", b],
      context,
    );

    expect(mondayQuery).toHaveBeenCalledTimes(1);
    expect(mondayUpload).toHaveBeenCalledTimes(2);

    const [query, vars, file] = mondayUpload.mock.calls[0] as [
      string,
      Record<string, unknown>,
      { name: string; content: Uint8Array },
    ];
    expect(query).toBe(ADD_FILE_TO_UPDATE_MUTATION);
    expect(vars).toEqual({ updateId: "555" });
    expect(file.name).toBe("a.pdf");
    expect(Buffer.from(file.content).toString()).toBe("aaa");

    const [, , second] = mondayUpload.mock.calls[1] as [
      string,
      Record<string, unknown>,
      { name: string },
    ];
    expect(second.name).toBe("b.png");

    expect(output).toContain("a.pdf");
    expect(output).toContain("b.png");
    expect(output).toContain("11");
    expect(output).toContain("12");
  });

  it("rejects a missing file before any network call", async () => {
    await expect(
      ticketCommand(
        ["comment", "111", "voici", "--file", join(dir, "nope.pdf")],
        context,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(mondayQuery).not.toHaveBeenCalled();
    expect(mondayUpload).not.toHaveBeenCalled();
  });

  it("rejects a directory passed as --file before any network call", async () => {
    await expect(
      ticketCommand(["comment", "111", "voici", "--file", dir], context),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    expect(mondayQuery).not.toHaveBeenCalled();
    expect(mondayUpload).not.toHaveBeenCalled();
  });

  it("names the created update and the failing file when an upload fails", async () => {
    const a = writeFixture("a.pdf", "aaa");
    mondayQuery.mockResolvedValueOnce({ create_update: { id: "555" } });
    mondayUpload.mockRejectedValueOnce(new Error("upload exploded"));

    try {
      await ticketCommand(["comment", "111", "voici", "--file", a], context);
      throw new Error("expected rejection");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("555");
      expect(message).toContain("a.pdf");
      const suggestions =
        (error as { suggestions?: string[] }).suggestions ?? [];
      expect(suggestions.join(" ")).toContain("555");
    }
  });

  it("leaves the output unchanged when no --file is passed", async () => {
    mondayQuery.mockResolvedValueOnce({ create_update: { id: "555" } });
    const output = await ticketCommand(["comment", "111", "hello"], context);

    expect(mondayUpload).not.toHaveBeenCalled();
    expect(output).not.toContain("files");
  });
});

describe("assertFileSize", () => {
  it("accepts a file at the Monday limit", () => {
    expect(() => assertFileSize("a.pdf", MAX_FILE_BYTES)).not.toThrow();
  });

  it("rejects a file over the limit, naming it and the limit", () => {
    try {
      assertFileSize("a.pdf", MAX_FILE_BYTES + 1);
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toMatchObject({ code: "VALIDATION_ERROR" });
      expect((error as Error).message).toContain("a.pdf");
      expect((error as Error).message).toContain(String(MAX_FILE_BYTES));
    }
  });
});
