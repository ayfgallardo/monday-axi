import type { MondayContext } from "../config.js";
import { AxiError } from "../errors.js";
import { rejectUnknownFlags } from "../args.js";
import { getSuggestions } from "../suggestions.js";
import {
  custom,
  field,
  renderHelp,
  renderList,
  renderOutput,
  type FieldDef,
} from "../toon.js";
import {
  aggregateLine,
  archivedExclusionRule,
  fetchItems,
  moduleOf,
  personFilterRule,
  statusOf,
  type Item,
  type QueryRule,
} from "./ticket.js";

const HOME_LIMIT = 100;

export async function homeCommand(
  args: string[],
  ctx?: MondayContext,
): Promise<string> {
  rejectUnknownFlags(args, [], "home");

  if (!ctx) {
    throw new AxiError("Monday configuration required", "CONFIG_MISSING", [
      "Run `monday-axi setup` to create it",
    ]);
  }
  if (!ctx.personId) {
    throw new AxiError(
      "No person configured to fetch sprint tickets for",
      "VALIDATION_ERROR",
      [
        "Run `monday-axi setup` to configure a personId",
        "Or pass --person <PERSON_ID>",
      ],
    );
  }

  const rules: QueryRule[] = [];
  const personRule = personFilterRule(ctx);
  if (personRule) rules.push(personRule);
  const exclusion = archivedExclusionRule(ctx);
  if (exclusion) rules.push(exclusion);

  const { items, cursor } = await fetchItems(ctx, { rules, limit: HOME_LIMIT });

  const blocks: string[] = [aggregateLine(ctx, items)];

  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const status = statusOf(ctx, item);
    const group = groups.get(status) ?? [];
    group.push(item);
    groups.set(status, group);
  }

  const schema: FieldDef[] = [
    field("id"),
    field("name"),
    custom("module", (i: Item) => moduleOf(ctx, i)),
  ];
  for (const [status, groupItems] of groups) {
    blocks.push(renderList(status, groupItems, schema));
  }

  if (cursor) {
    blocks.push(`next_cursor: ${cursor}`);
  }

  const hints = [
    ...getSuggestions({
      domain: "home",
      action: "home",
      isEmpty: items.length === 0,
    }),
  ];
  if (cursor) {
    hints.push(
      `Run \`monday-axi ticket list --cursor ${cursor}\` to see more tickets`,
    );
  }
  blocks.push(renderHelp(hints));

  return renderOutput(blocks);
}
