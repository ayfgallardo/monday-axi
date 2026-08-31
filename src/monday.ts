import { ApiClient } from "@mondaydotcomorg/api";
import { resolveToken } from "./auth.js";
import { mapMondayError } from "./errors.js";

/** Pinned so a Monday API rollout never changes this CLI's behaviour silently. */
export const API_VERSION = "2026-07";

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
      client: new ApiClient({ token: resolved, apiVersion: API_VERSION }),
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
