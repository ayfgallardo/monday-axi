import { AxiError, exitCodeForError } from "axi-sdk-js";

export type ErrorCode =
  | "NOT_FOUND"
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "CONFIG_MISSING"
  | "UNKNOWN";

export { AxiError, exitCodeForError };

interface GraphqlErrorEntry {
  message?: string;
  extensions?: { code?: string };
}

interface GraphqlErrorResponse {
  status?: number;
  errors?: GraphqlErrorEntry[];
}

const RATE_LIMIT_HELP = [
  "Wait ~60s before retrying",
  "Ask for fewer items or fewer columns per query",
];

const AUTH_HELP = [
  "Set MONDAY_API_TOKEN, or store the token in the Keychain",
  "Check the token is still valid in Monday > Admin > API",
];

const codeMap: Record<string, { code: ErrorCode; suggestions: string[] }> = {
  ComplexityException: { code: "RATE_LIMITED", suggestions: RATE_LIMIT_HELP },
  COMPLEXITY_BUDGET_EXHAUSTED: {
    code: "RATE_LIMITED",
    suggestions: RATE_LIMIT_HELP,
  },
  UserUnauthorizedException: {
    code: "FORBIDDEN",
    suggestions: [
      "Check your permissions on this board in Monday",
      "A token scoped to another account cannot see this item",
    ],
  },
};

const statusMap: Record<number, { code: ErrorCode; suggestions: string[] }> = {
  401: { code: "AUTH_REQUIRED", suggestions: AUTH_HELP },
  429: { code: "RATE_LIMITED", suggestions: RATE_LIMIT_HELP },
};

/**
 * Monday answers application errors with HTTP 200 and an `errors` array, so the
 * GraphQL error code is the primary signal and the HTTP status only a fallback.
 */
export function mapMondayError(error: unknown): AxiError {
  if (error instanceof AxiError) {
    return error;
  }

  const response = graphqlResponse(error);
  const entry = response?.errors?.[0];
  const message = entry?.message ?? errorMessage(error);

  const byCode = entry?.extensions?.code
    ? codeMap[entry.extensions.code]
    : undefined;
  if (byCode) {
    return new AxiError(message, byCode.code, byCode.suggestions);
  }

  if (/not found|does not exist|doesn't exist/i.test(message)) {
    return new AxiError(message, "NOT_FOUND");
  }

  const byStatus = response?.status ? statusMap[response.status] : undefined;
  if (byStatus) {
    return new AxiError(message, byStatus.code, byStatus.suggestions);
  }

  return new AxiError(message, "UNKNOWN");
}

function graphqlResponse(error: unknown): GraphqlErrorResponse | undefined {
  if (typeof error !== "object" || error === null || !("response" in error)) {
    return undefined;
  }
  const { response } = error as { response: unknown };
  return typeof response === "object" && response !== null
    ? (response as GraphqlErrorResponse)
    : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
