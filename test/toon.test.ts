import { describe, it, expect } from "vitest";
import {
  extract,
  field,
  pluck,
  joinArray,
  relativeTime,
  boolYesNo,
  mapEnum,
  lower,
  custom,
  renderList,
  renderDetail,
  renderHelp,
  renderError,
  renderOutput,
} from "../src/toon.js";

describe("field extractors", () => {
  it("field() passes through values", () => {
    expect(extract({ id: "1234567890" }, [field("id")])).toEqual({
      id: "1234567890",
    });
  });

  it("field() with alias", () => {
    expect(extract({ name: "Ticket" }, [field("name", "title")])).toEqual({
      title: "Ticket",
    });
  });

  it("pluck() extracts nested value", () => {
    expect(
      extract({ board: { id: "1234567890" } }, [pluck("board", "id")]),
    ).toEqual({ board: "1234567890" });
  });

  it("pluck() returns null for missing", () => {
    expect(extract({}, [pluck("board", "id")])).toEqual({ board: null });
  });

  it("joinArray() joins sub-values", () => {
    expect(
      extract({ tags: [{ name: "bug" }, { name: "urgent" }] }, [
        joinArray("tags", "name"),
      ]),
    ).toEqual({ tags: "bug,urgent" });
  });

  it('joinArray() returns "none" for empty', () => {
    expect(extract({ tags: [] }, [joinArray("tags", "name")])).toEqual({
      tags: "none",
    });
  });

  it("boolYesNo() converts booleans", () => {
    expect(extract({ archived: true }, [boolYesNo("archived")])).toEqual({
      archived: "yes",
    });
    expect(extract({ archived: false }, [boolYesNo("archived")])).toEqual({
      archived: "no",
    });
  });

  it("mapEnum() maps values", () => {
    const map = { "En cours": "doing", Terminé: "done" };
    expect(
      extract({ status: "En cours" }, [mapEnum("status", map, "none")]),
    ).toEqual({ status: "doing" });
    expect(extract({ status: "" }, [mapEnum("status", map, "none")])).toEqual({
      status: "none",
    });
  });

  it("lower() lowercases strings", () => {
    expect(extract({ state: "ACTIVE" }, [lower("state")])).toEqual({
      state: "active",
    });
  });

  it("custom() runs arbitrary function", () => {
    expect(
      extract({ a: 1, b: 2 }, [custom("sum", (item) => item.a + item.b)]),
    ).toEqual({ sum: 3 });
  });

  it("relativeTime() formats recent times", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(
      extract({ updated_at: fiveMinAgo }, [
        relativeTime("updated_at", "updated"),
      ]),
    ).toEqual({ updated: "5m ago" });
  });

  it("relativeTime() handles null", () => {
    expect(
      extract({ updated_at: null }, [relativeTime("updated_at", "updated")]),
    ).toEqual({ updated: "unknown" });
  });
});

describe("renderList", () => {
  it("renders a TOON list", () => {
    const items = [
      { id: "1", name: "Bug", state: "ACTIVE" },
      { id: "2", name: "Feature", state: "DONE" },
    ];
    const output = renderList("tickets", items, [
      field("id"),
      field("name"),
      lower("state"),
    ]);
    expect(output).toContain("tickets[2]{id,name,state}:");
    expect(output).toContain('"1",Bug,active');
    expect(output).toContain('"2",Feature,done');
  });
});

describe("renderDetail", () => {
  it("renders a TOON detail block", () => {
    const output = renderDetail("ticket", { id: "1", name: "Test" }, [
      field("id"),
      field("name"),
    ]);
    expect(output).toContain("ticket:");
    expect(output).toContain("name: Test");
  });
});

describe("renderHelp", () => {
  it("renders help lines", () => {
    expect(renderHelp(["Do this", "Do that"])).toBe(
      "help[2]:\n  Do this\n  Do that",
    );
  });

  it("returns empty for no lines", () => {
    expect(renderHelp([])).toBe("");
  });
});

describe("renderError", () => {
  it("renders error with code and suggestions", () => {
    const output = renderError("Not found", "NOT_FOUND", ["Try listing"]);
    expect(output).toContain("error: Not found");
    expect(output).toContain("code: NOT_FOUND");
    expect(output).toContain("help[1]:");
    expect(output).toContain("Try listing");
  });
});

describe("renderOutput", () => {
  it("combines blocks and filters empty", () => {
    expect(renderOutput(["block1", "", "block2"])).toBe("block1\nblock2");
  });
});
