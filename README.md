# extra-games

[![PR checks](https://github.com/klaushofrichter/extra-games/actions/workflows/checks.yml/badge.svg)](https://github.com/klaushofrichter/extra-games/actions/workflows/checks.yml)
[![Weekly check against games-service main](https://github.com/klaushofrichter/extra-games/actions/workflows/checks.yml/badge.svg?event=schedule)](https://github.com/klaushofrichter/extra-games/actions/workflows/checks.yml?query=event%3Aschedule)
<!-- Static assertion: GitHub publishes no endpoint for alert status. -->
[![Dependabot](https://img.shields.io/badge/dependabot-enabled-025E8C?logo=dependabot&logoColor=white)](https://github.com/klaushofrichter/extra-games/security/dependabot)

<!-- This repo is private, so these badges render blank: they are fetched anonymously and no token can help
     (kube-setup docs/repository-baseline.md, requirement 4). They start working if the repo ever goes public.
     No release badge: this repo cuts no releases; tables run whatever the production branch holds. -->

Private and early-release games for [Game Table](https://github.com/klaushofrichter/games-service). They are not in the
public games-service repository: the games-service console fetches them from here and gives them only to the tables an
administrator ticks. Remote players of such a table see them too, because their board and phone pages come from the
table itself.

Games here: **Liar's Dice** (2–6 players, hidden dice on every phone, bids and calls, wild ones, two AI styles).

## How a game gets onto a table

```
extra-games (this repo, branch production)
   │  the console fetches the games/ folder as one bundle (GAME_REPO_TOKEN reads private repos)
   ▼
games.skylar.technology  — console: Game repositories, and per table a checkbox for each repository
   │  the table's heartbeat lists its bundles; the table downloads them over its own authenticated link
   ▼
table PC  — checks the hash, unpacks into its data folder, adds the games to the lobby between games
```

In the console (*Game repositories*), add `klaushofrichter/extra-games` with branch `production`, then tick it for a
table, either when approving its pairing code or later on its row. The console refetches every hour and on *Refresh*;
a failed fetch keeps the last good bundle. Details and the reasoning: games-service `docs/decisions.md`, D-097.

## Layout

| Path | What it is |
| --- | --- |
| `games/<id>/` | One folder per game, exactly like games-service's `games/`: `manifest.json`, `rules.ts`, `board.js`, `deck.js`, optional CSS and `assets/`. Only this folder goes to tables. |
| `games-service.ref` | The games-service branch, tag or commit these games are tested against |
| `scripts/games-service.sh` | Brings games-service into `.games-service/` (git-ignored) for the tests |
| `tests/` | Vitest: rules (`liars-dice.test.ts`), a real Table Host with fake phones (`host.test.ts`), and the bundle path the console and tables take (`bundle.test.ts`) |
| `scripts/soak.ts` | Many AI-only games per player count and style, through the host's simulation loop |
| `scripts/e2e/` | Browser check (Playwright): board and three phones play a whole game |
| `docs/decisions.md` | Decisions for this repo |

## Writing a game

Write it as described in games-service's README (*Writing a game*), with one difference: import the SDK by name.

```ts
import { count, defineGame } from "@game-table/sdk";        // cards: "@game-table/sdk/cards"
```

The table host maps that name to its own SDK when it loads the rules, and `tsconfig.json` and `vitest.config.ts` map it
to `.games-service/` here. A game id must not be one of games-service's built-in games (a table skips an extra game that
would replace one) nor another extra repository's (the console flags clashes).

## Testing

Requires Node.js 26 and Python 3 for the browser check.

```sh
npm ci
scripts/games-service.sh              # or GAMES_SERVICE_DIR=../games-service scripts/games-service.sh
npm test                              # rules, host, bundle
npm run typecheck
npm run soak -- 200                   # 200 AI-only games per player count
pip install -r scripts/e2e/requirements.txt && python -m playwright install chromium
scripts/e2e/run-all.sh out/           # board + phones in a real browser; screenshots in out/
```

## Branches and checks

```
feature branch → PR → main → (PR) → production → tables, at the console's next fetch
```

`checks.yml` runs `test`, `e2e` and `codeql` on every PR to `main` or `production`, and weekly against games-service
`main` instead of the pinned ref, so a platform change that breaks these games shows up here first. `production` is the
branch to protect with those three contexts, since that is what tables run.
