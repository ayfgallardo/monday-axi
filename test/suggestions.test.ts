import { describe, expect, it } from "vitest";
import { getSuggestions } from "../src/suggestions.js";

describe("getSuggestions", () => {
  it("suggests viewing a ticket after a non-empty list", () => {
    const lines = getSuggestions({
      domain: "ticket",
      action: "list",
      isEmpty: false,
    });
    expect(lines.join(" ")).toContain("ticket view");
  });

  it("suggests --all after an empty list", () => {
    const lines = getSuggestions({
      domain: "ticket",
      action: "list",
      isEmpty: true,
    });
    expect(lines.join(" ")).toContain("--all");
  });

  it("suggests --full and includes the id after viewing a ticket", () => {
    const lines = getSuggestions({
      domain: "ticket",
      action: "view",
      id: "111",
    });
    expect(lines.join(" ")).toContain("--full");
    expect(lines.join(" ")).toContain("111");
  });

  it("suggests the ticket list command from mentions", () => {
    const lines = getSuggestions({
      domain: "mentions",
      action: "list",
      isEmpty: false,
    });
    expect(lines.join(" ")).toContain("ticket view");
  });

  it("suggests something actionable after an empty mentions list", () => {
    const lines = getSuggestions({
      domain: "mentions",
      action: "list",
      isEmpty: true,
    });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join(" ")).toContain("monday-axi");
  });

  it("suggests exploring commands from home", () => {
    const lines = getSuggestions({ domain: "home", action: "home" });
    expect(lines.join(" ")).toContain("monday-axi");
  });

  it("returns no suggestions for an unknown domain", () => {
    expect(getSuggestions({ domain: "bogus", action: "x" })).toEqual([]);
  });
});
