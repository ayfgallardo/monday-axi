import { beforeEach, describe, expect, it, vi } from "vitest";

const { ApiClient, request, resolveToken } = vi.hoisted(() => {
  const request = vi.fn();
  return {
    request,
    resolveToken: vi.fn(),
    ApiClient: vi.fn(function (this: { request: unknown }) {
      this.request = request;
    }),
  };
});

vi.mock("@mondaydotcomorg/api", () => ({ ApiClient }));
vi.mock("../src/auth.js", () => ({ resolveToken }));

import { AxiError } from "../src/errors.js";
import { API_VERSION, mondayQuery, resetMondayClient } from "../src/monday.js";

const QUERY = "query ($id: ID!) { items (ids: [$id]) { id name } }";
const FAKE_TOKEN = "resolved-by-the-cascade";

describe("mondayQuery", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetMondayClient();
    ApiClient.mockImplementation(function (this: { request: unknown }) {
      this.request = request;
    });
    resolveToken.mockResolvedValue(FAKE_TOKEN);
  });

  it("pins the API version and authenticates with the resolved token", async () => {
    request.mockResolvedValue({ items: [] });
    await mondayQuery(QUERY, { id: "1234567890" });
    expect(ApiClient).toHaveBeenCalledWith({
      token: FAKE_TOKEN,
      apiVersion: API_VERSION,
    });
    expect(API_VERSION).toBe("2026-07");
  });

  it("passes values as GraphQL variables, never interpolated into the query", async () => {
    request.mockResolvedValue({ items: [] });
    await mondayQuery(QUERY, { id: "1234567890" });
    expect(request).toHaveBeenCalledWith(QUERY, { id: "1234567890" });
    const sentQuery = request.mock.calls[0][0] as string;
    expect(sentQuery).not.toContain("1234567890");
  });

  it("returns the typed payload", async () => {
    request.mockResolvedValue({ items: [{ id: "1", name: "Ticket" }] });
    await expect(
      mondayQuery<{ items: { id: string }[] }>(QUERY, { id: "1" }),
    ).resolves.toEqual({ items: [{ id: "1", name: "Ticket" }] });
  });

  it("maps a Monday application error to an AxiError", async () => {
    request.mockRejectedValue({
      response: {
        status: 200,
        errors: [
          {
            message: "Complexity budget exhausted",
            extensions: { code: "ComplexityException" },
          },
        ],
      },
    });
    const error = await mondayQuery(QUERY).catch((e: AxiError) => e);
    expect(error).toBeInstanceOf(AxiError);
    expect((error as AxiError).code).toBe("RATE_LIMITED");
  });

  it("propagates the auth error when no token can be resolved", async () => {
    resolveToken.mockRejectedValue(new AxiError("no token", "AUTH_REQUIRED"));
    await expect(mondayQuery(QUERY)).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("resolves the token and builds the client only once across calls", async () => {
    request.mockResolvedValue({ items: [] });
    await mondayQuery(QUERY, { id: "1" });
    await mondayQuery(QUERY, { id: "2" });
    expect(resolveToken).toHaveBeenCalledTimes(1);
    expect(ApiClient).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("re-resolves the token after a failed resolution", async () => {
    resolveToken.mockRejectedValueOnce(
      new AxiError("no token", "AUTH_REQUIRED"),
    );
    await expect(mondayQuery(QUERY)).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
    resolveToken.mockResolvedValue(FAKE_TOKEN);
    request.mockResolvedValue({ items: [] });
    await mondayQuery(QUERY);
    expect(resolveToken).toHaveBeenCalledTimes(2);
  });
});
