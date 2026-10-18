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

Games here:

- **Liar's Dice** (2–6 players, hidden dice on every phone, bids and calls, wild ones, two AI styles).
- **Chess** (2 players, moves made on the board, chess clocks from bullet to classical or none, draw offers and
  resignation on the phones, AI players at an approximate Elo from 400 to 2200, and a stand-in AI that takes over the
  seat of a player who leaves). Its clocks need games-service with game time (`ctx.now()`, D-126); on an older table
  it plays without a clock and says so.
- **Backgammon** (2 players, checkers moved on the board by tapping, rolls, doubles and Done on the phones too, matches
  to 1–15 points with the doubling cube and the Crawford rule, an optional time per turn, AI players at three
  strengths, and a stand-in that plays on for a player who leaves).

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

games-service lists `klaushofrichter/extra-games@production` from its deploy configuration
(`deploy/game-repos.json`, so it is there after every restart; the console marks it *deploy config*). Tick it for a table
in the console, either when approving its pairing code or later on its row. The service refetches every hour and on
*Refresh*; a failed fetch keeps the last good bundle. Details and the reasoning: games-service `docs/decisions.md`,
D-097 and D-098.

## Layout

| Path | What it is |
| --- | --- |
| `games/<id>/` | One folder per game, exactly like games-service's `games/`: `manifest.json`, `rules.ts`, `board.js`, `deck.js`, optional `board.css`/`deck.css`, `how-to-play.md` (rules for players) and `assets/`. Only this folder goes to tables. |
| `games-service.ref` | The games-service branch, tag or commit these games are tested against |
| `scripts/games-service.sh` | Brings games-service into `.games-service/` (git-ignored) for the tests; `npm run setup` runs it |
| `tests/` | Vitest: rules (`liars-dice.test.ts`, `chess.test.ts`, `backgammon.test.ts`), a real Table Host with fake phones (`host.test.ts`, `chess-host.test.ts`, `backgammon-host.test.ts`), and the bundle path the console and tables take (`bundle.test.ts`) |
| `scripts/soak.ts` | Many AI-only games per player count and style, through the host's simulation loop (Chess: its two weakest levels, plus a few games at club strength) |
| `scripts/chess-ladder.ts` | Chess strength check: matches between Elo levels, or against Stockfish limited to an Elo (Stockfish installed separately) |
| `scripts/bg-ladder.ts` | Backgammon strength check: AI-only matches between two levels, half with each colour |
| `scripts/e2e/` | Browser checks (Playwright): Liar's Dice with a board and three phones, Chess with a board and two phones (moves by tapping the board, clocks, a draw offer, mate), Backgammon with a board and two phones (moves by tapping the board and from a phone, Undo, a double and a take, a whole game, Next game), each opening the rules; uses games-service's e2e helpers from `.games-service/` |
| `docs/decisions.md` | Decisions for this repo |

## Writing a game

Write it as described in games-service's README (*Writing a game*), with one difference: import the SDK by name.

```ts
import { count, defineGame } from "@game-table/sdk";        // cards: "@game-table/sdk/cards"
```

The table host maps that name to its own SDK when it loads the rules, and `tsconfig.json` and `vitest.config.ts` map it
to `.games-service/` here.

A game's `version` is a calendar version, `YYYY.MM.DD.N`, that changes when, and only when, something in its folder
changes (games-service D-127, here E-008). Set it in the same pull request as the change, or let
`node .games-service/scripts/check-game-versions.ts --fix` do it; the PR checks enforce it.

Every game ships rules for players as `how-to-play.md`, with illustrations in `assets/` (games-service D-099): the phones
show them in a modal from a **Rules** button, with the settings chosen at the table on top. Use the Markdown subset
described in games-service's README (*Writing a game*), and name every setting by its manifest label;
`tests/bundle.test.ts` checks both. A game id must not be one of games-service's built-in games (a table skips an extra game that
would replace one) nor another extra repository's (the console flags clashes).

## Testing

Requires Node.js 26 and Python 3 for the browser check.

```sh
npm ci
npm run setup                         # = scripts/games-service.sh; GAMES_SERVICE_DIR=../games-service uses a local
                                      # checkout, GAMES_SERVICE_REF=<ref> another branch or tag
npm test                              # rules, host, bundle, rules for players
npm run typecheck
npm run soak -- 200                   # 200 AI-only games per player count
pip install -r scripts/e2e/requirements.txt && python -m playwright install chromium
scripts/e2e/run-all.sh out/           # board + phones in a real browser; screenshots in out/
```

## Branches and checks

```
feature branch → PR → main → (PR) → production → tables, at the console's next fetch
```

`checks.yml` runs `test` (tests, typecheck, a 200-game soak, `npm audit --audit-level=high`), `e2e` and `codeql` on
every PR to `main` or `production` and every push to `production`, and weekly (Mondays) against games-service `main`
instead of the pinned ref, so a platform change that breaks these games shows up here first. `production` is the
branch to protect with those three contexts, since that is what tables run.
