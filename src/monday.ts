import { ApiClient } from "@mondaydotcomorg/api";
import { resolveToken } from "./auth.js";
import { mapMondayError } from "./errors.js";
import { recordRawBody } from "./gain.js";

/** Pinned so a Monday API rollout never changes this CLI's behaviour silently. */
export const API_VERSION = "2026-07";

/**
 * The single point every Monday response passes through: the SDK builds one
 * GraphQLClient per request and hands it `requestConfig.fetch`, so counting
 * here covers every query, mutation and pagination round-trip exactly once.
 * The body is read as text and replayed to the caller — undici has already
 * decompressed it, so this is what an agent calling the API itself would read.
 */
const countingFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  const text = await response.text();
  recordRawBody(text);
  const headers = new Headers(response.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  return new Response(text, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

let memoizedResolve: Promise<string> | undefined;
let memoizedClient: { resolved: string; client: ApiClient } | undefined;

/** Resolve the token and build the ApiClient at most once per process. */
async function getClient(): Promise<ApiClient> {
  if (!memoizedResolve) {
    memoizedResolve = resolveToken();
  }
  let resolved: string;
  try {
    resolved = await memoizedResolve;
  } catch (error) {
    memoizedResolve = undefined;
    throw error;
  }
  if (!memoizedClient || memoizedClient.resolved !== resolved) {
    memoizedClient = {
      resolved,
      client: new ApiClient({
        token: resolved,
        apiVersion: API_VERSION,
        requestConfig: { fetch: countingFetch },
      }),
    };
  }
  return memoizedClient.client;
}

/** Drop the memoized credential/client, so the next call re-resolves both. Test-only. */
export function resetMondayClient(): void {
  memoizedResolve = undefined;
  memoizedClient = undefined;
}

/** Run a GraphQL operation; values travel as variables, never inlined in `query`. */
export async function mondayQuery<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const client = await getClient();

  try {
    return await client.request<T>(query, variables);
  } catch (error) {
    throw mapMondayError(error);
  }
}
