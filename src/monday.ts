import { ApiClient } from "@mondaydotcomorg/api";
import { resolveToken } from "./auth.js";
import { mapMondayError } from "./errors.js";

/** Pinned so a Monday API rollout never changes this CLI's behaviour silently. */
export const API_VERSION = "2026-07";

/** Run a GraphQL operation; values travel as variables, never inlined in `query`. */
export async function mondayQuery<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const apiToken = await resolveToken();
  const client = new ApiClient({ token: apiToken, apiVersion: API_VERSION });

  try {
    return await client.request<T>(query, variables);
  } catch (error) {
    throw mapMondayError(error);
  }
}
