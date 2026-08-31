// Compares monday-axi output against the Monday MCP server equivalent, token
// for token, using the same tokenizer/model as glab-axi's bench (o200k_base
// via gpt-4o). Input is a directory of pre-captured output pairs — this
// script does not run anything live.
//
//   pnpm run bench <directory>
//
// Each scenario is two files sharing a name: <scenario>.axi.<ext> holding the
// monday-axi output, <scenario>.mcp.<ext> holding the MCP-equivalent output.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { countTokens } from "gpt-tokenizer/model/gpt-4o";

interface Row {
  scenario: string;
  axiTokens: number;
  mcpTokens: number;
}

type Kind = "axi" | "mcp";

function pairScenarios(
  dir: string,
): Map<string, Partial<Record<Kind, string>>> {
  const scenarios = new Map<string, Partial<Record<Kind, string>>>();
  for (const entry of readdirSync(dir)) {
    const match = /^(.+)\.(axi|mcp)\.[^.]+$/.exec(entry);
    if (!match) continue;
    const [, scenario, kind] = match;
    const files = scenarios.get(scenario) ?? {};
    files[kind as Kind] = join(dir, entry);
    scenarios.set(scenario, files);
  }
  return scenarios;
}

function tokensOf(path: string): number {
  return countTokens(readFileSync(path, "utf-8"));
}

function printTable(rows: Row[]): void {
  const header = ["scenario", "axi tokens", "mcp tokens", "ratio"];
  const lines = rows.map((r) => [
    r.scenario,
    String(r.axiTokens),
    String(r.mcpTokens),
    r.axiTokens === 0 ? "n/a" : `${(r.mcpTokens / r.axiTokens).toFixed(1)}x`,
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...lines.map((l) => l[i].length)),
  );
  const format = (cols: string[]) =>
    cols.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log(format(header));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const line of lines) console.log(format(line));
}

function main(): void {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: pnpm run bench <directory>");
    console.error(
      "expects pairs of files per scenario: <scenario>.axi.<ext> and <scenario>.mcp.<ext>",
    );
    process.exit(1);
  }

  const scenarios = [...pairScenarios(dir)].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const rows: Row[] = [];
  for (const [scenario, files] of scenarios) {
    if (!files.axi || !files.mcp) {
      console.error(
        `skipping ${scenario}: missing ${files.axi ? "mcp" : "axi"} file`,
      );
      continue;
    }
    rows.push({
      scenario,
      axiTokens: tokensOf(files.axi),
      mcpTokens: tokensOf(files.mcp),
    });
  }

  if (rows.length === 0) {
    console.error(`no scenario pairs found in ${dir}`);
    process.exit(1);
  }

  printTable(rows);
}

main();
