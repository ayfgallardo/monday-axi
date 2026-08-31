import type { MondayContext } from "../config.js";
import { mondayQuery } from "../monday.js";
import { AxiError } from "../errors.js";
import { rejectUnknownFlags, resolveLimit } from "../args.js";
import { getSuggestions } from "../suggestions.js";
import {
  custom,
  field,
  renderHelp,
  renderList,
  renderOutput,
  truncateText,
  type FieldDef,
} from "../toon.js";

interface UpdateCreator {
  id: string;
  name: string;
}

interface MentionUpdate {
  id: string;
  created_at: string;
  text_body: string | null;
  body: string | null;
  item_id: string | null;
  creator?: UpdateCreator | null;
}

interface UpdatesResponse {
  updates: MentionUpdate[] | null;
}

const MENTIONS_QUERY = `
  query ($limit: Int!) {
    updates(limit: $limit) {
      id
      created_at
      text_body
      body
      item_id
      creator {
        id
        name
      }
    }
  }
`;

/**
 * The mention lives in the HTML `body`, never `text_body` — the text form only
 * carries "@Prénom Nom", which a homonym or a quote could imitate.
 */
function mentionsPerson(update: MentionUpdate, personId: string): boolean {
  return (update.body ?? "").includes(`data-mention-id="${personId}"`);
}

const MENTIONS_FLAGS = ["--limit"] as const;

export async function mentionsCommand(
  args: string[],
  ctx?: MondayContext,
): Promise<string> {
  if (args[0] === "help" || args[0] === "--help" || args[0] === "-h") {
    return "usage: monday-axi mentions [--limit <n>]\n";
  }

  if (!ctx) {
    throw new AxiError("Monday configuration required", "CONFIG_MISSING", [
      "Run `monday-axi setup` to create it",
    ]);
  }

  rejectUnknownFlags(args, MENTIONS_FLAGS, "mentions");
  if (!ctx.personId) {
    throw new AxiError(
      "No person configured to match mentions against",
      "VALIDATION_ERROR",
      [
        "Run `monday-axi setup` to configure a personId",
        "Or pass --person <PERSON_ID>",
      ],
    );
  }
  const personId = ctx.personId;
  const limit = resolveLimit(args, 50);

  const data = await mondayQuery<UpdatesResponse>(MENTIONS_QUERY, { limit });
  const mentions = (data.updates ?? []).filter(
    (u) => u.item_id !== null && mentionsPerson(u, personId),
  );

  const schema: FieldDef[] = [
    field("item_id", "ticket"),
    custom("author", (u: MentionUpdate) => u.creator?.name ?? "unknown"),
    field("created_at", "created"),
    custom("body", (u: MentionUpdate) => truncateText(u.text_body, 500)),
  ];

  return renderOutput([
    mentions.length > 0 ? `count: ${mentions.length}` : "count: 0 mentions",
    renderList("mentions", mentions, schema),
    renderHelp(
      getSuggestions({
        domain: "mentions",
        action: "list",
        isEmpty: mentions.length === 0,
      }),
    ),
  ]);
}
