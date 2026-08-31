interface SuggestionContext {
  domain: string;
  action: string;
  isEmpty?: boolean;
  id?: string | number;
}

type SuggestionEntry = {
  match: (ctx: SuggestionContext) => boolean;
  lines: (ctx: SuggestionContext) => string[];
};

const table: SuggestionEntry[] = [
  {
    match: (c) => c.domain === "home",
    lines: () => [
      "Run `monday-axi ticket list` for the full ticket list",
      "Run `monday-axi mentions` to see recent mentions",
    ],
  },

  {
    match: (c) => c.domain === "ticket" && c.action === "list" && !c.isEmpty,
    lines: () => [
      "Run `monday-axi ticket view <id>` to see ticket details",
      "Run `monday-axi ticket list --status <label>` to filter by status",
    ],
  },
  {
    match: (c) =>
      c.domain === "ticket" && c.action === "list" && c.isEmpty === true,
    lines: () => [
      "Run `monday-axi ticket list --all` to include archived tickets",
      "Run `monday-axi board view` to see the valid status labels",
    ],
  },

  {
    match: (c) => c.domain === "ticket" && c.action === "view",
    lines: (c) => [
      `Run \`monday-axi ticket view ${c.id} --full\` to see complete update text`,
      "Run `monday-axi mentions` to see recent mentions",
    ],
  },

  {
    match: (c) => c.domain === "mentions" && !c.isEmpty,
    lines: () => [
      "Run `monday-axi ticket view <id>` to see the mentioned ticket",
    ],
  },
  {
    match: (c) => c.domain === "mentions" && c.isEmpty === true,
    lines: () => [],
  },

  {
    match: (c) => c.domain === "board",
    lines: () => [
      "Run `monday-axi ticket list --status <label>` using a label from status_labels",
    ],
  },
];

export function getSuggestions(ctx: SuggestionContext): string[] {
  for (const entry of table) {
    if (entry.match(ctx)) {
      return entry.lines(ctx);
    }
  }
  return [];
}
