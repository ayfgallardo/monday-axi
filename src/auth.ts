import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AxiError } from "./errors.js";

export const ENV_FILE_PATH = join(
  homedir(),
  "work",
  "tools",
  "console-geofoncier",
  ".env",
);

export const KEYCHAIN_SERVICE = "monday-orca";

/**
 * First hit wins: MONDAY_API_TOKEN, MONDAY_TOKEN, the console `.env` file, then
 * the Keychain. The token only ever travels through the Authorization header.
 */
export async function resolveToken(): Promise<string> {
  const token =
    process.env["MONDAY_API_TOKEN"] ||
    process.env["MONDAY_TOKEN"] ||
    envFileToken() ||
    (await keychainToken());

  if (!token) {
    throw new AxiError("No Monday API token found", "AUTH_REQUIRED", [
      "Set MONDAY_API_TOKEN in the environment",
      "Or set MONDAY_TOKEN in the environment",
      `Or add a MONDAY_TOKEN= line to ${ENV_FILE_PATH}`,
      `Or store it in the Keychain: security add-generic-password -s ${KEYCHAIN_SERVICE} -a "$USER" -w`,
    ]);
  }

  return token;
}

function envFileToken(): string | undefined {
  let content: string;
  try {
    content = readFileSync(ENV_FILE_PATH, "utf-8");
  } catch {
    return undefined;
  }
  const match = content.match(/^\s*MONDAY_TOKEN\s*=\s*(.*)$/m);
  if (!match) {
    return undefined;
  }
  return match[1].trim().replace(/^["']|["']$/g, "") || undefined;
}

function keychainToken(): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      "security",
      ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
      (error, stdout) => {
        resolve(error ? undefined : stdout.trim() || undefined);
      },
    );
  });
}
