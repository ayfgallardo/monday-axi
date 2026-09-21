import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  API_VERSION,
  FILE_ENDPOINT,
  mondayUpload,
  resetMondayClient,
} from "../src/monday.js";

const fetchMock = vi.fn();

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** The FormData the transport actually posted. */
function sentForm(): FormData {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return init.body as FormData;
}

const QUERY =
  "mutation ($updateId: ID!, $file: File!) { add_file_to_update(update_id: $updateId, file: $file) { id } }";

describe("mondayUpload", () => {
  beforeEach(() => {
    vi.stubEnv("MONDAY_API_TOKEN", "fake-token");
    vi.stubEnv("AXI_GAIN", "0");
    resetMondayClient();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    resetMondayClient();
  });

  it("posts the multipart request to the file endpoint with the auth and version headers", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ data: { add_file_to_update: { id: "9" } } }),
    );

    await mondayUpload(
      QUERY,
      { updateId: "555" },
      { name: "a.pdf", content: new Uint8Array([1, 2, 3]) },
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(FILE_ENDPOINT);
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("fake-token");
    expect(headers.get("api-version")).toBe(API_VERSION);
    // Set by FormData itself: a hand-written Content-Type loses the boundary.
    expect(headers.get("content-type")).toBeNull();
  });

  it("sends query, variables and map as spec'd by the GraphQL multipart request", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ data: { add_file_to_update: { id: "9" } } }),
    );

    await mondayUpload(
      QUERY,
      { updateId: "555" },
      { name: "a.pdf", content: new Uint8Array([1, 2, 3]) },
    );

    const form = sentForm();
    expect(form.get("query")).toBe(QUERY);
    expect(JSON.parse(form.get("variables") as string)).toEqual({
      updateId: "555",
      file: null,
    });
    expect(JSON.parse(form.get("map") as string)).toEqual({
      file: "variables.file",
    });
  });

  it("sends the binary part under the mapped name, preserving the file name", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ data: { add_file_to_update: { id: "9" } } }),
    );

    await mondayUpload(
      QUERY,
      { updateId: "555" },
      { name: "rapport final.pdf", content: new Uint8Array([1, 2, 3, 4]) },
    );

    const part = sentForm().get("file") as File;
    expect(part.name).toBe("rapport final.pdf");
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
  });

  it("returns the data payload", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: { add_file_to_update: { id: "9", name: "a.pdf" } },
      }),
    );

    const data = await mondayUpload<{
      add_file_to_update: { id: string; name: string };
    }>(
      QUERY,
      { updateId: "555" },
      { name: "a.pdf", content: new Uint8Array() },
    );

    expect(data.add_file_to_update).toEqual({ id: "9", name: "a.pdf" });
  });

  it("maps a GraphQL error payload through mapMondayError", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        errors: [
          {
            message: "User unauthorized to perform action",
            extensions: { code: "UserUnauthorizedException" },
          },
        ],
      }),
    );

    await expect(
      mondayUpload(
        QUERY,
        { updateId: "555" },
        { name: "a.pdf", content: new Uint8Array() },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("maps a non-JSON response to a structured error", async () => {
    fetchMock.mockResolvedValue(
      new Response("<html>502 Bad Gateway</html>", { status: 502 }),
    );

    await expect(
      mondayUpload(
        QUERY,
        { updateId: "555" },
        { name: "a.pdf", content: new Uint8Array() },
      ),
    ).rejects.toMatchObject({ code: "UNKNOWN" });
  });
});
