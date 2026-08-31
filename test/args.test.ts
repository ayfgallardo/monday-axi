import { describe, expect, it } from "vitest";
import { AxiError } from "../src/errors.js";
import {
  rejectUnknownFlags,
  resolveLimit,
  takeBoolFlag,
  takeFlag,
  takeNumericId,
} from "../src/args.js";

describe("takeFlag", () => {
  it("reads and removes the space form", () => {
    const args = ["list", "--status", "En cours"];
    expect(takeFlag(args, "--status")).toBe("En cours");
    expect(args).toEqual(["list"]);
  });

  it("reads and removes the equals form", () => {
    const args = ["list", "--status=En cours"];
    expect(takeFlag(args, "--status")).toBe("En cours");
    expect(args).toEqual(["list"]);
  });

  it("returns undefined when absent", () => {
    expect(takeFlag(["list"], "--status")).toBeUndefined();
  });
});

describe("takeBoolFlag", () => {
  it("detects and removes the flag", () => {
    const args = ["view", "1234567890", "--full"];
    expect(takeBoolFlag(args, "--full")).toBe(true);
    expect(args).toEqual(["view", "1234567890"]);
  });

  it("returns false when absent", () => {
    expect(takeBoolFlag(["view"], "--full")).toBe(false);
  });
});

describe("takeNumericId", () => {
  it("extracts the numeric positional", () => {
    const args = ["1234567890", "--full"];
    expect(takeNumericId(args, "ticket")).toBe("1234567890");
    expect(args).toEqual(["--full"]);
  });

  it("throws VALIDATION_ERROR when missing", () => {
    expect(() => takeNumericId([], "ticket")).toThrow(AxiError);
  });
});

describe("resolveLimit", () => {
  it("defaults when absent", () => {
    expect(resolveLimit([], 25)).toBe(25);
  });

  it("parses --limit", () => {
    expect(resolveLimit(["--limit", "10"], 25)).toBe(10);
  });

  it("caps at the max page size", () => {
    expect(resolveLimit(["--limit", "500"], 25)).toBe(100);
  });

  it("rejects a non-positive-integer limit", () => {
    expect(() => resolveLimit(["--limit", "0"])).toThrow(AxiError);
    expect(() => resolveLimit(["--limit", "abc"])).toThrow(AxiError);
  });
});

describe("rejectUnknownFlags", () => {
  it("passes known flags", () => {
    expect(() =>
      rejectUnknownFlags(["--status", "x"], ["--status"], "ticket", "list"),
    ).not.toThrow();
  });

  it("rejects unknown flags with a listing message", () => {
    expect(() =>
      rejectUnknownFlags(["--bogus"], ["--status"], "ticket", "list"),
    ).toThrow(/unknown flag.*--bogus/);
  });

  it("always allows --help", () => {
    expect(() =>
      rejectUnknownFlags(["--help"], [], "ticket", "list"),
    ).not.toThrow();
  });
});
