import { mondayQuery } from "../monday.js";
import { AxiError } from "../errors.js";
import { rejectUnknownFlags, takeBoolFlag, takeRepeatedFlag } from "../args.js";
import { isStdinTTY, readStdin } from "../stdin.js";

export const API_HELP = `usage: monday-axi api <graphql-query|-> [--var name=value] [--allow-mutation]
description: Run a raw GraphQL query or mutation against the Monday API. Escape hatch for anything not covered by the other commands.
flags[2]:
  --var name=value (repeatable, passed as a GraphQL variable, never interpolated), --allow-mutation (required to run a query containing a mutation operation)
notes:
  Reads the query from stdin when no query argument is given, or when the argument is "-".
  Output is the raw JSON response, unshaped, since a passthrough query's result shape is unknown ahead of time.
  --var values are always sent as strings, never JSON-parsed. A variable declared as a non-string type (e.g. $limit: Int!) will fail — inline that value as a literal in the query text instead.
examples:
  monday-axi api "query { boards(ids: [1234567890]) { name } }"
  monday-axi api "query ($id: ID!) { boards(ids: [$id]) { name } }" --var id=1234567890
  echo 'query { me { name } }' | monday-axi api
  monday-axi api "mutation { ... }" --allow-mutation
`;

const API_FLAGS = ["--var", "--allow-mutation"] as const;

/** Conservative: a false positive only costs an extra --allow-mutation, never lets a mutation slip through. */
function containsMutation(query: string): boolean {
  return /\bmutation\b/.test(query);
}

function parseVariables(pairs: string[]): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq === -1) {
      throw new AxiError(
        `--var must be name=value, got: ${pair}`,
        "VALIDATION_ERROR",
      );
    }
    variables[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return variables;
}

export async function apiCommand(args: string[]): Promise<string> {
  if (args[0] === "--help" || args[0] === "-h") return API_HELP;

  const allowMutation = takeBoolFlag(args, "--allow-mutation");
  const varPairs = takeRepeatedFlag(args, "--var");
  rejectUnknownFlags(args, API_FLAGS, "api");

  if (args.length > 1) {
    throw new AxiError(
      "monday-axi api takes a single query argument",
      "VALIDATION_ERROR",
    );
  }

  const source = args[0];
  let query: string;
  if (source === undefined || source === "-") {
    if (isStdinTTY()) {
      throw new AxiError(
        "monday-axi api requires a query argument or piped stdin",
        "VALIDATION_ERROR",
        ['monday-axi api "query { ... }"', "echo '<query>' | monday-axi api"],
      );
    }
    query = (await readStdin()).trim();
  } else {
    query = source;
  }

  if (query === "") {
    throw new AxiError("Query must not be empty", "VALIDATION_ERROR");
  }

  if (containsMutation(query) && !allowMutation) {
    throw new AxiError(
      "Refusing to run a query containing a mutation without --allow-mutation",
      "VALIDATION_ERROR",
      ["Pass --allow-mutation once you have reviewed the mutation"],
    );
  }

  const data = await mondayQuery<unknown>(query, parseVariables(varPairs));
  return `${JSON.stringify(data)}\n`;
}
