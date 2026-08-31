import { describe, expect, it } from "vitest";
import { AxiError, mapMondayError } from "../src/errors.js";

function graphqlError(
  message: string,
  code?: string,
  status = 200,
): { response: unknown } {
  return {
    response: {
      status,
      errors: [{ message, ...(code ? { extensions: { code } } : {}) }],
    },
  };
}

describe("mapMondayError", () => {
  it("passes an AxiError through unchanged", () => {
    const original = new AxiError("already mapped", "NOT_FOUND");
    expect(mapMondayError(original)).toBe(original);
  });

  it("maps ComplexityException to RATE_LIMITED", () => {
    const error = mapMondayError(
      graphqlError("Complexity budget exhausted", "ComplexityException"),
    );
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.message).toContain("Complexity budget exhausted");
    expect(error.suggestions.length).toBeGreaterThan(0);
  });

  it("maps COMPLEXITY_BUDGET_EXHAUSTED to RATE_LIMITED", () => {
    expect(
      mapMondayError(
        graphqlError("budget exhausted", "COMPLEXITY_BUDGET_EXHAUSTED"),
      ).code,
    ).toBe("RATE_LIMITED");
  });

  it("maps UserUnauthorizedException to FORBIDDEN", () => {
    const error = mapMondayError(
      graphqlError("User unauthorized", "UserUnauthorizedException"),
    );
    expect(error.code).toBe("FORBIDDEN");
    expect(error.suggestions.length).toBeGreaterThan(0);
  });

  it("maps a not-found message to NOT_FOUND", () => {
    const error = mapMondayError(
      graphqlError("Item not found", "ResourceNotFoundException"),
    );
    expect(error.code).toBe("NOT_FOUND");
    expect(error.message).toContain("Item not found");
  });

  it("maps HTTP 429 to RATE_LIMITED", () => {
    expect(
      mapMondayError(graphqlError("Too many requests", undefined, 429)).code,
    ).toBe("RATE_LIMITED");
  });

  it("maps HTTP 401 to AUTH_REQUIRED", () => {
    const error = mapMondayError(graphqlError("Unauthorized", undefined, 401));
    expect(error.code).toBe("AUTH_REQUIRED");
    expect(error.suggestions.length).toBeGreaterThan(0);
  });

  it("maps an unrecognized GraphQL error to UNKNOWN with its message", () => {
    const error = mapMondayError(graphqlError("Something odd happened"));
    expect(error.code).toBe("UNKNOWN");
    expect(error.message).toBe("Something odd happened");
  });

  it("maps a plain Error to UNKNOWN", () => {
    const error = mapMondayError(new Error("socket hang up"));
    expect(error.code).toBe("UNKNOWN");
    expect(error.message).toBe("socket hang up");
  });

  it("maps a non-error value to UNKNOWN", () => {
    expect(mapMondayError("boom").message).toBe("boom");
  });
});
