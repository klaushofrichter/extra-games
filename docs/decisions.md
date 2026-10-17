# Decision log

Decisions for the extra-games repository, newest last. Platform decisions live in games-service `docs/decisions.md`
(D-097 describes how these games reach tables). "Klaus" marks product decisions; "Claude" marks implementation
choices, which Klaus can overrule.

Format: **E-nnn · date · decided by** — decision. *Why:* reason.

- **E-001 · 2026-10-14 · Klaus** — A private repository for games that are not public yet (private games, early
  releases). Tables get them only when an administrator ticks this repository for them in the games-service console.
- **E-002 · 2026-10-14 · Claude** — Games import the SDK as `@game-table/sdk`; the table host maps the name to its own
  copy, and the tests map it to a checkout of games-service (`scripts/games-service.sh`, ref in `games-service.ref`).
  *Why:* no copy of the SDK to drift, and the tests run the games on exactly the runtime a table runs.
- **E-003 · 2026-10-14 · Claude** — Tables run the `production` branch (the console entry is
  `klaushofrichter/extra-games@production`); `main` → `production` by PR, the same shape as the cluster's services.
  Required checks on `production`: `test`, `e2e`, `codeql`. *Why:* the console refetches hourly, so whatever the
  tracked branch holds reaches tables within the hour; that branch needs the gate.
- **E-004 · 2026-10-14 · Claude** — kube-setup's repository baseline applies as far as it fits: alerts and security
  updates, `dependabot.yml` (npm, pip, github-actions; no docker, there is no image), the audit and a typecheck in the
  required `test` job, badges (blank while private), Node 26 everywhere, delete head branches on merge. Requirement 6
  (release evidence) does not apply: nothing here deploys or cuts releases.
- **E-005 · 2026-10-14 · Claude** — First game: Liar's Dice. Cups are private to each phone; the board shows them only
  after a call. Ones are wild by default (then ones can't be bid on). A slow player's turn timer opens with one of their
  most common face, or calls the bid in front of them. A player leaving mid-round restarts the round with fresh cups,
  since the bids so far counted their dice. AI styles: cautious (calls early, raises carefully) and bold (believes
  bids more, sometimes pushes one die further). In 2-player soak runs bold wins about two games in three.
- **E-006 · 2026-10-17 · Klaus** — Second game: Chess, for two players, with AI players whose strength is set as an
  Elo value, chess clocks (standard time controls and shorter ones, or none), and an AI that takes the seat of a player
  who drops. Moves are made on the board; the phone indicates Ready, and during the game shows the clocks and the last
  moves and offers resignation. *Implementation (Claude):*
  - **Rules** (`games/chess/chess.ts`): a 0x88 board with make/unmake, checked against the standard perft counts of
    five positions. All the rules of chess: castling, en passant, promotion to any piece, check and mate, stalemate,
    threefold repetition, the fifty-move rule and insufficient material (automatic draws, no claiming), resignation and
    draws by agreement. A move by the other side answers a draw offer with no; your own offer stands.
  - **Board** (`board.js`): White's first rank toward White's seat, each side's pieces standing up for their own
    player, and at each player's right hand a panel facing them (clock, captured pieces, the last moves, check, a draw
    offer, the stand-in). Tap a piece, then its square (`boardIntents: ["move"]`, games-service D-102); a promotion asks
    which piece. Pieces are drawn here (simple geometric SVG), no outside piece set.
  - **Phone** (`deck.js`): both clocks, the moves, offer, accept or decline a draw, Resign with a second tap. Remote
    players move on their copy of the board.
  - **Clocks:** "no clock", bullet 1+0, blitz 3+2 and 5+3, rapid 10+0 and 10+5, classical 15+10 and 30+0 (minutes +
    seconds added per move); default 10+5. They run on game time (`ctx.now()`, games-service D-126, added for this), so
    a pause on the table stops both and replays stay exact. White's clock starts with the game. A flag falling against
    a side that can't mate is a draw. On a table without D-126 the game plays without a clock and says so.
  - **AI** (`engine.ts`): alpha-beta with a transposition table, quiescence, null-move pruning and late move
    reductions, over material and piece-square tables, in a worker thread (D-112). The Elo option (400 to 2200, default
    1200) sets the search's depth and node budget, noise on the move scores and an occasional lapse for the weaker
    levels; with a clock it also keeps to a share of its time. It accepts a draw offer unless it stands clearly better,
    and never offers one. The Elo numbers are approximate: see E-007.
  - **A player who leaves** (games-service D-111 override): after the table's waiting time (a dropped phone gets a
    minute, D-119; their clock runs meanwhile) the game's own engine, the *stand-in*, plays the seat at the setting
    *Stand-in strength* (default 1200). It runs inside the rules with a node budget only, so replay reaches the same
    moves. Someone who sits in the empty seat (`dynamicPlayers`) takes over from it. If no human is left, the game ends.
    The platform could offer this instead: an AI taking over a seat for any game (the Loopy list asks for it too).
  - **Checks:** `tests/chess.test.ts` (perft, notation, every ending, clocks with pauses, draw offers, the stand-in,
    the AI's levels, replays), `tests/chess-host.test.ts` (board and phone moves on a real host, an AI in its worker,
    the stand-in and taking the seat back, simulations), `scripts/e2e/chess.py` (a game by tapping the board, clocks and
    a draw offer on two phones, the rules on a 320 px phone), and the soak run.
- **E-007 · 2026-10-17 · Klaus** — Chess: all pieces stand the same way, toward the edge the board faces, and the
  board's turn-around button (games-service D-101) turns them; White plays from the south seat by default. *Why:* on
  the table, pieces facing their own players were hard to read for both. *Implementation (Claude):* pieces rotate by
  `info.rotation`, so on a remote board they face the remote player; the clock panels still face their players, the
  promotion choice faces the player who promotes. Chess 0.2.0. *Strength check (Claude):* 20 games each against
  Stockfish 19 limited to an Elo (`scripts/chess-ladder.ts`, 200 ms a move): level 1400 scored 14/20 against 1320
  (about 1470), 1800 scored 9/20 against 1600 (about 1560), 2200 scored 17/20 against 2000 (about 2300). With 20 games
  each estimate is good to about ±150, so the levels stay as they are; their labels are approximate, as the setting
  says.
- **E-008 · 2026-10-17 · Klaus** — Game versions follow games-service D-127: `YYYY.MM.DD.N` in each game's manifest,
  changed when, and only when, something in the game's folder changes, never by a platform change. Liar's Dice and
  Chess switch to `2026.10.17.1`. *Implementation (Claude):* the `test` check runs games-service's
  `scripts/check-game-versions.ts` from `.games-service` against the branch a pull request goes into;
  `node .games-service/scripts/check-game-versions.ts --fix` sets the version of every changed game.
- **E-009 · 2026-10-17 · Klaus** — Chess: offering a draw and resigning on the phone each ask for confirmation in a
  dialog first (Cancel, tapping beside it or Escape changes nothing). Replaces the second tap for Resign (E-006).
  Accepting or declining an offer the other player made stays one tap. The dialog closes by itself when the game ends.
- **E-010 · 2026-10-17 · Klaus** — Chess: the stand-in takes the seat of a player who leaves also when the other side is
  an AI player; the game no longer ends because no person is left. The game plays on by itself to its end, and anyone
  who joins sits in the empty seat and takes the side back. *Why:* a phone put to sleep during a game against the
  computer (to take a photo) ended the game after the waiting time, and the board kept showing "Your move" beside
  *Show result*. Refines E-006. *Also:* when the table ends a game itself (a player removed, *End game*), the board's
  panels and the phones say "The game has ended" instead of whose move it is, and the clocks stop; the opponent's panel
  names the stand-in while it moves.
- **E-011 · 2026-10-17 · Klaus** — Chess: with one player at the table and the other remote or AI, the player at the
  table sits south (games-service D-128, `"localSeat": "south"`), and the default time control is "no clock" (was
  10+5). *Why:* the table's board doesn't turn for a remote player, so the one person at it must sit on the side the
  board is drawn for; remote boards already turn to their player (D-059). On a table without D-128 the field is
  ignored and seats stay as chosen.
