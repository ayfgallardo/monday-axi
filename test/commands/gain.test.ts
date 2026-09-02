import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const home = { value: "" };

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => home.value };
});

const { gainLogPath } = await import("../../src/gain.js");
const { gainCommand } = await import("../../src/commands/gain.js");

function seed(entries: object[]): void {
  const path = gainLogPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
  );
}

describe("gain command", () => {
  beforeEach(() => {
    home.value = mkdtempSync(join(tmpdir(), "monday-axi-gain-cmd-"));
    vi.stubEnv("XDG_DATA_HOME", "");
    vi.stubEnv("LOCALAPPDATA", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(home.value, { recursive: true, force: true });
  });

  it("reports a clear message on an absent log", async () => {
    const output = await gainCommand();
    expect(output).toContain("no invocation recorded");
  });

  it("reports a clear message on an empty log", async () => {
    seed([]);
    const output = await gainCommand();
    expect(output).toContain("no invocation recorded");
  });

  it("totals savings and breaks them down per sub-command", async () => {
    seed([
      {
        ts: 1788280000,
        cli: "monday-axi",
        cmd: "ticket",
        raw: 400,
        out: 100,
        ms: 300,
      },
      {
        ts: 1788280100,
        cli: "monday-axi",
        cmd: "ticket",
        raw: 600,
        out: 200,
        ms: 300,
      },
      {
        ts: 1788280200,
        cli: "monday-axi",
        cmd: "mentions",
        raw: 9000,
        out: 1500,
        ms: 400,
      },
    ]);

    const output = await gainCommand();

    expect(output).toContain("invocations: 3");
    expect(output).toContain("raw_tokens: 10000");
    expect(output).toContain("out_tokens: 1800");
    expect(output).toContain("saved_tokens: 8200");
    expect(output).toContain("saved_pct: 82");
    expect(output).toContain("since: 2026-09-01");
    expect(output).toContain("mentions,1,9000,1500,7500,83.3");
    expect(output).toContain("ticket,2,1000,300,700,70");
  });

  /** `Math.min(...entries)` blows the call stack well before this size. */
  it("aggregates a log of hundreds of thousands of lines", async () => {
    seed(
      Array.from({ length: 300_000 }, (_, index) => ({
        ts: 1788280000 + index,
        cli: "monday-axi",
        cmd: "ticket",
        raw: 10,
        out: 1,
        ms: 1,
      })),
    );

    const output = await gainCommand();

    expect(output).toContain("invocations: 300000");
    expect(output).toContain("since: 2026-09-01");
  });
});
