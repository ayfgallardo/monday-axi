import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const home = { value: "" };

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => home.value };
});

const {
  flushGain,
  gainCommandName,
  gainLogPath,
  gainStdout,
  readGainLog,
  recordRawBody,
  startGain,
} = await import("../src/gain.js");

const RAW = JSON.stringify({
  data: { items: [{ id: "1234567890", name: "Fix the import job" }] },
});

/**
 * `dataDir()` picks a different branch per platform, so a runner only ever
 * exercises one of them. Stubbing the platform lets a single test cover both.
 */
function stubPlatform(platform: NodeJS.Platform): () => void {
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: platform,
  });
  return () => {
    Object.defineProperty(process, "platform", original as PropertyDescriptor);
  };
}

function readLines(): string[] {
  return readFileSync(gainLogPath(), "utf-8").trim().split("\n");
}

describe("gain recorder", () => {
  beforeEach(() => {
    home.value = mkdtempSync(join(tmpdir(), "monday-axi-gain-"));
    vi.stubEnv("XDG_DATA_HOME", "");
    vi.stubEnv("LOCALAPPDATA", "");
    vi.stubEnv("AXI_GAIN", "");
    startGain();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(home.value, { recursive: true, force: true });
  });

  it("stores the log under the platform data directory", () => {
    expect(gainLogPath().startsWith(home.value)).toBe(true);
    expect(gainLogPath().endsWith(join("axi", "monday-axi.jsonl"))).toBe(true);
  });

  it("records raw response tokens minus rendered output tokens", async () => {
    recordRawBody(RAW);
    gainStdout({ write: () => true }).write("items[1]{id,name}:\n  1234567890\n");

    await flushGain("ticket");

    const entry = JSON.parse(readLines()[0]);
    expect(entry.cli).toBe("monday-axi");
    expect(entry.cmd).toBe("ticket");
    expect(entry.raw).toBeGreaterThan(entry.out);
    expect(entry.out).toBeGreaterThan(0);
  });

  it("writes one append-only JSONL line per invocation", async () => {
    recordRawBody(RAW);
    await flushGain("ticket");
    startGain();
    recordRawBody(RAW);
    await flushGain("mentions");

    const lines = readLines();
    expect(lines).toHaveLength(2);
    expect(Object.keys(JSON.parse(lines[0]))).toEqual([
      "ts",
      "cli",
      "cmd",
      "raw",
      "out",
      "ms",
    ]);
    const entry = JSON.parse(lines[1]);
    expect(entry.cmd).toBe("mentions");
    expect(Number.isInteger(entry.ts)).toBe(true);
    expect(Number.isInteger(entry.ms)).toBe(true);
  });

  it("cumulates every HTTP response of the invocation", async () => {
    recordRawBody(RAW);
    await flushGain("ticket");
    const single = JSON.parse(readLines()[0]).raw;

    startGain();
    recordRawBody(RAW);
    recordRawBody(RAW);
    await flushGain("ticket");

    expect(JSON.parse(readLines()[1]).raw).toBeGreaterThan(single);
  });

  it("records nothing when AXI_GAIN=0", async () => {
    vi.stubEnv("AXI_GAIN", "0");
    recordRawBody(RAW);
    gainStdout({ write: () => true }).write("out");

    await flushGain("ticket");

    expect(readGainLog()).toEqual([]);
  });

  it("records nothing for an invocation that issued no request", async () => {
    await flushGain("setup");

    expect(readGainLog()).toEqual([]);
  });

  it("never leaks arguments, flag values or item ids", async () => {
    recordRawBody(RAW);
    gainStdout({ write: () => true }).write("items[0]:\n");

    await flushGain(
      gainCommandName(
        ["ticket", "view", "1234567890", "--board", "9876543210"],
        ["ticket"],
      ),
    );

    const line = readLines()[0];
    for (const secret of [
      "view",
      "1234567890",
      "--board",
      "9876543210",
      "Fix the import job",
    ]) {
      expect(line).not.toContain(secret);
    }
  });

  it("only records a command name the CLI itself defines", () => {
    expect(gainCommandName([], ["ticket"])).toBe("home");
    expect(gainCommandName(["ticket"], ["ticket"])).toBe("ticket");
    expect(gainCommandName(["1234567890"], ["ticket"])).toBeUndefined();
  });

  for (const platform of ["darwin", "linux"] as const) {
    it(`keeps the command output intact when the log cannot be written on ${platform}`, async () => {
      const restorePlatform = stubPlatform(platform);
      try {
        const stdout = {
          chunks: [] as string[],
          write(chunk: string) {
            this.chunks.push(chunk);
            return true;
          },
        };
        const tee = gainStdout(stdout);
        tee.write("rendered output\n");
        recordRawBody(RAW);
        // A plain file where the data directory belongs, derived from the very
        // path production uses, so the block survives a change of layout.
        const dataDir = dirname(gainLogPath());
        mkdirSync(dirname(dataDir), { recursive: true });
        writeFileSync(dataDir, "");

        await expect(flushGain("ticket")).resolves.toBeUndefined();
        expect(stdout.chunks).toEqual(["rendered output\n"]);
        expect(process.exitCode).toBeUndefined();
      } finally {
        restorePlatform();
      }
    });
  }

  it("ignores malformed lines when reading the log", async () => {
    recordRawBody(RAW);
    await flushGain("ticket");
    const path = gainLogPath();
    writeFileSync(path, `${readFileSync(path, "utf-8")}not json\n{}\n`);

    expect(readGainLog()).toHaveLength(1);
  });
});
