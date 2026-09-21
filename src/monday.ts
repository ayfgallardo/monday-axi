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

/** Monday refuses multipart on /v2 — uploads have their own endpoint. */
export const FILE_ENDPOINT = "https://api.monday.com/v2/file";

let memoizedResolve: Promise<string> | undefined;
let memoizedClient: { resolved: string; client: ApiClient } | undefined;

/** Resolve the token at most once per process. */
async function getToken(): Promise<string> {
  if (!memoizedResolve) {
    memoizedResolve = resolveToken();
  }
  try {
    return await memoizedResolve;
  } catch (error) {
    memoizedResolve = undefined;
    throw error;
  }
}

/** Resolve the token and build the ApiClient at most once per process. */
async function getClient(): Promise<ApiClient> {
  const resolved = await getToken();
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

/**
 * Upload transport for `https://api.monday.com/v2/file`: the SDK only speaks
 * JSON, and Monday rejects a multipart body on the regular endpoint. Follows
 * the GraphQL multipart request spec — `query`, `variables` with the file slot
 * nulled, `map` pointing at it, then the binary part — and counts the response
 * for `gain` the way `countingFetch` does for every other call.
 */
export async function mondayUpload<T>(
  query: string,
  variables: Record<string, unknown>,
  file: { name: string; content: Uint8Array<ArrayBuffer> },
): Promise<T> {
  const token = await getToken();

  const form = new FormData();
  form.append("query", query);
  form.append("variables", JSON.stringify({ ...variables, file: null }));
  form.append("map", JSON.stringify({ file: "variables.file" }));
  form.append("file", new Blob([file.content]), file.name);

  let text: string;
  let status: number;
  try {
    const response = await fetch(FILE_ENDPOINT, {
      method: "POST",
      headers: { Authorization: token, "API-Version": API_VERSION },
      body: form,
    });
    status = response.status;
    text = await response.text();
  } catch (error) {
    throw mapMondayError(error);
  }
  recordRawBody(text);

  let payload: { data?: T; errors?: unknown[] };
  try {
    payload = JSON.parse(text) as { data?: T; errors?: unknown[] };
  } catch {
    throw mapMondayError(
      new Error(`Monday file endpoint returned HTTP ${status} (not JSON)`),
    );
  }

  if (payload.errors?.length || payload.data === undefined) {
    throw mapMondayError({ response: { status, errors: payload.errors } });
  }
  return payload.data;
}
