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
