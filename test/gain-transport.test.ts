import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const home = { value: "" };

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => home.value };
});

const { flushGain, readGainLog, startGain } = await import("../src/gain.js");
const { mondayQuery, resetMondayClient } = await import("../src/monday.js");

const PAGE_ONE = JSON.stringify({
  data: {
    boards: [
      {
        items_page: {
          cursor: "c1",
          items: [{ id: "1", name: "First ticket", column_values: [] }],
        },
      },
    ],
  },
});
const PAGE_TWO = JSON.stringify({
  data: {
    next_items_page: {
      cursor: null,
      items: [{ id: "2", name: "Second ticket", column_values: [] }],
    },
  },
});

const fetchMock = vi.fn();

function jsonResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function tokens(text: string): Promise<number> {
  const { countTokens } = await import("gpt-tokenizer/model/gpt-4o");
  return countTokens(text);
}

describe("gain accounting through the Monday transport", () => {
  beforeEach(() => {
    home.value = mkdtempSync(join(tmpdir(), "monday-axi-gain-transport-"));
    vi.stubEnv("XDG_DATA_HOME", "");
    vi.stubEnv("LOCALAPPDATA", "");
    vi.stubEnv("AXI_GAIN", "");
    vi.stubEnv("MONDAY_API_TOKEN", "fake-token");
    resetMondayClient();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    resetMondayClient();
    rmSync(home.value, { recursive: true, force: true });
  });

  it("counts each response body once, exactly as returned by the API", async () => {
    fetchMock.mockResolvedValue(jsonResponse(PAGE_ONE));
    startGain();
    await mondayQuery("query { boards { id } }");
    await flushGain("ticket");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readGainLog()[0].raw).toBe(await tokens(PAGE_ONE));
  });

  it("cumulates the pages of a paginated invocation", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(PAGE_ONE))
      .mockResolvedValueOnce(jsonResponse(PAGE_TWO));
    startGain();
    await mondayQuery("query { boards { id } }");
    await mondayQuery("query { next_items_page { cursor } }");
    await flushGain("ticket");

    expect(readGainLog()[0].raw).toBe(
      await tokens(`${PAGE_ONE}${PAGE_TWO}`),
    );
  });

  it("still hands the parsed body to the caller", async () => {
    fetchMock.mockResolvedValue(jsonResponse(PAGE_TWO));
    startGain();

    const data = await mondayQuery<{
      next_items_page: { items: { id: string }[] };
    }>("query { next_items_page { items { id } } }");

    expect(data.next_items_page.items[0].id).toBe("2");
  });

  it("records nothing when AXI_GAIN=0", async () => {
    vi.stubEnv("AXI_GAIN", "0");
    fetchMock.mockResolvedValue(jsonResponse(PAGE_ONE));
    startGain();
    await mondayQuery("query { boards { id } }");
    await flushGain("ticket");

    expect(readGainLog()).toEqual([]);
  });
});
