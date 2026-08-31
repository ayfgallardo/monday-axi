import { beforeEach, describe, expect, it, vi } from "vitest";

const { readFileSync } = vi.hoisted(() => ({ readFileSync: vi.fn() }));

vi.mock("node:fs", () => ({ readFileSync }));

import { AxiError } from "../src/errors.js";
import { configPath, loadConfig } from "../src/config.js";

const validConfig = {
  boardId: "1234567890",
  subitemBoardId: "1234567891",
  personId: "999",
  columns: { status: "status_1", person: "person_1" },
  statusLabels: [
    { label: "À faire", index: 0 },
    { label: "En cours", index: 1 },
    { label: "Terminé", index: 5 },
  ],
};

describe("loadConfig", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("reads the config from ~/.config/monday-axi/config.json", () => {
    readFileSync.mockReturnValue(JSON.stringify(validConfig));
    expect(loadConfig()).toEqual(validConfig);
    expect(readFileSync).toHaveBeenCalledWith(configPath(), "utf-8");
    expect(configPath()).toMatch(/\.config\/monday-axi\/config\.json$/);
  });

  it("defaults columns and status labels when absent", () => {
    readFileSync.mockReturnValue(JSON.stringify({ boardId: "1234567890" }));
    expect(loadConfig()).toEqual({
      boardId: "1234567890",
      columns: {},
      statusLabels: [],
    });
  });

  it("guides the user to `monday-axi setup` when the file is missing", () => {
    readFileSync.mockImplementation(() => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
    const error = captureError();
    expect(error.code).toBe("CONFIG_MISSING");
    expect(error.suggestions.join("\n")).toContain("monday-axi setup");
  });

  it("rejects a malformed config file", () => {
    readFileSync.mockReturnValue("{ not json");
    expect(captureError().code).toBe("VALIDATION_ERROR");
  });

  it("rejects a config without a board id", () => {
    readFileSync.mockReturnValue(JSON.stringify({ personId: "999" }));
    const error = captureError();
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.suggestions.join("\n")).toContain("monday-axi setup");
  });

  it("rejects statusLabels shaped as plain strings (the old, position-based format)", () => {
    readFileSync.mockReturnValue(
      JSON.stringify({
        boardId: "1234567890",
        statusLabels: ["À faire", "En cours"],
      }),
    );
    const error = captureError();
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.suggestions.join("\n")).toContain("label");
    expect(error.suggestions.join("\n")).toContain("index");
  });

  it("rejects a statusLabels entry missing a numeric index", () => {
    readFileSync.mockReturnValue(
      JSON.stringify({
        boardId: "1234567890",
        statusLabels: [{ label: "À faire" }],
      }),
    );
    expect(captureError().code).toBe("VALIDATION_ERROR");
  });

  it("accepts non-contiguous Monday settings indexes", () => {
    readFileSync.mockReturnValue(JSON.stringify(validConfig));
    expect(loadConfig().statusLabels).toEqual(validConfig.statusLabels);
  });
});

function captureError(): AxiError {
  try {
    loadConfig();
  } catch (error) {
    expect(error).toBeInstanceOf(AxiError);
    return error as AxiError;
  }
  throw new Error("loadConfig did not throw");
}
