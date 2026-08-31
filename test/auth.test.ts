import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { readFileSync, execFile } = vi.hoisted(() => ({
  readFileSync: vi.fn(),
  execFile: vi.fn(),
}));

vi.mock("node:fs", () => ({ readFileSync }));
vi.mock("node:child_process", () => ({ execFile }));

import { AxiError } from "../src/errors.js";
import { ENV_FILE_PATH, KEYCHAIN_SERVICE, resolveToken } from "../src/auth.js";

type ExecCallback = (
  error: Error | null,
  stdout: string,
  stderr: string,
) => void;

function keychainReturns(token: string | null): void {
  execFile.mockImplementation(
    (_file: string, _args: string[], callback: ExecCallback) => {
      if (token === null) {
        callback(new Error("could not be found"), "", "");
      } else {
        callback(null, `${token}\n`, "");
      }
    },
  );
}

function envFileAbsent(): void {
  readFileSync.mockImplementation(() => {
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  });
}

describe("resolveToken", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env["MONDAY_API_TOKEN"];
    delete process.env["MONDAY_TOKEN"];
    envFileAbsent();
    keychainReturns(null);
  });

  afterEach(() => {
    delete process.env["MONDAY_API_TOKEN"];
    delete process.env["MONDAY_TOKEN"];
  });

  it("prefers MONDAY_API_TOKEN over everything else", async () => {
    process.env["MONDAY_API_TOKEN"] = "from-api-token-env";
    process.env["MONDAY_TOKEN"] = "from-token-env";
    await expect(resolveToken()).resolves.toBe("from-api-token-env");
    expect(readFileSync).not.toHaveBeenCalled();
    expect(execFile).not.toHaveBeenCalled();
  });

  it("falls back to MONDAY_TOKEN", async () => {
    process.env["MONDAY_TOKEN"] = "from-token-env";
    await expect(resolveToken()).resolves.toBe("from-token-env");
    expect(execFile).not.toHaveBeenCalled();
  });

  it("reads MONDAY_TOKEN from the console .env file", async () => {
    readFileSync.mockReturnValue(
      "OTHER=1\nMONDAY_TOKEN=from-env-file\nTRAILING=2\n",
    );
    await expect(resolveToken()).resolves.toBe("from-env-file");
    expect(readFileSync).toHaveBeenCalledWith(ENV_FILE_PATH, "utf-8");
    expect(execFile).not.toHaveBeenCalled();
  });

  it("strips quotes and whitespace around the .env value", async () => {
    readFileSync.mockReturnValue('MONDAY_TOKEN = "quoted-token" \n');
    await expect(resolveToken()).resolves.toBe("quoted-token");
  });

  it("ignores an .env file without a MONDAY_TOKEN line", async () => {
    readFileSync.mockReturnValue("SOMETHING_ELSE=1\n");
    keychainReturns("from-keychain");
    await expect(resolveToken()).resolves.toBe("from-keychain");
  });

  it("falls back to the Keychain last", async () => {
    keychainReturns("from-keychain");
    await expect(resolveToken()).resolves.toBe("from-keychain");
    expect(execFile).toHaveBeenCalledWith(
      "security",
      ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
      expect.any(Function),
    );
  });

  it("never passes the token in argv", async () => {
    keychainReturns("from-keychain");
    await resolveToken();
    const args = execFile.mock.calls[0][1] as string[];
    expect(args).not.toContain("from-keychain");
  });

  it("throws a guided AUTH_REQUIRED error when nothing yields a token", async () => {
    await expect(resolveToken()).rejects.toBeInstanceOf(AxiError);
    const error = await resolveToken().catch((e: AxiError) => e);
    expect(error.code).toBe("AUTH_REQUIRED");
    expect(error.suggestions).toHaveLength(4);
    expect(error.suggestions.join("\n")).toContain("MONDAY_API_TOKEN");
    expect(error.suggestions.join("\n")).toContain(KEYCHAIN_SERVICE);
  });
});
