# monday-axi — contrat du repo

CLI AXI pour Monday.com (GraphQL direct, pas de CLI amont). Architecture calquée
sur glab-axi : `bin/` fast-path `--version`, `src/cli.ts` routage pur via
`runAxiCli` (axi-sdk-js), un module par famille de commandes dans
`src/commands/`, rendu TOON via `src/toon.ts`.

## Contraintes dures

- **Aucun id Géofoncier ni token dans le repo** (code, tests, fixtures, docs).
  Les identifiants d'instance (board, person, colonnes, labels) vivent dans
  `~/.config/monday-axi/config.json`, créé par `monday-axi setup`, jamais
  committé. Les fixtures de test sont anonymisées (ids factices).
- **Variables GraphQL uniquement** : jamais d'interpolation de valeurs dans une
  query. Le token ne transite que par header, jamais en argv ni dans les logs.
- Pas de shell : aucun `exec` sauf la lecture Keychain
  (`execFile("security", …)`).
- `API-Version: 2026-07` épinglée dans le transport (`src/monday.ts`).
- Toute mutation colonne passe par la garde `board_of(item)` (les sous-éléments
  vivent sur un autre board que le parent).
- Surface exacte : `home`, `ticket list|view|status|comment`, `mentions`,
  `board view`, `api`, `setup`, `--version`. Rien d'autre.

## Développement

- `pnpm test` (vitest, transport mocké — aucun appel réseau en test) et
  `pnpm build` (tsc) doivent rester verts.
- Commits directs sur main, messages en français, types conventionnels.
- Tests réels : lectures en smoke uniquement ; mutations réelles jamais sans
  accord explicite de Florian.
