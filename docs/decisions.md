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
    The platform could offer this instead: an AI taking over a seat for any game.
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
- **E-012 · 2026-10-18 · Klaus** — Chess sends awards for the statistics window (games-service D-136): *Killer* (most
  pieces taken), *Pawn Rush* (most pawn moves), *Marathon* (the owner of the piece that travelled farthest),
  *Frequenter* (the owner of the piece that moved most often), *Treasure Hunter* (most material taken), *Check!* (most
  checks), *Crowning* (most promotions) and *Homebody* (the side whose king never moved). *Implementation (Claude):*
  `games/chess/stats.ts` follows every piece from its starting square through the moves at the end of the game (castling
  moves the rook, en passant takes the pawn beside, a promoted pawn keeps its history); distance is in king steps (a
  knight's move is 2). Nothing is kept in the state. The table adds captures, material, pawn moves and checks. The award
  helper is kept in the game, not taken from the SDK, so Chess still runs on tables before D-136.
- **E-013 · 2026-10-18 · Klaus** — Third game: Backgammon, for two players. *Implementation (Claude):*
  - **Rules** (`games/backgammon/bg.ts`, `rules.ts`): all the rules of backgammon: the opening roll (each player
    throws one die, the higher plays both), using both dice when possible and the larger one when only one can be
    played, entering from the bar, blocked points, bearing off (with a larger die from the highest point only), and
    single, gammon and backgammon wins. Played as a match to *Points to win the match* (1–15, odd, default 3) with the
    *Doubling cube* (on by default; take or pass, only its owner doubles again, the Crawford game, no dead cube offered,
    no beavers or Jacoby rule). One step at a time: each checker move is an intent and can be undone until *Done*; a
    turn with no legal move passes by itself after a moment; bearing off the last checker ends the game at once.
  - **Board** (`board.js`): White's home at the south player's right hand, moves animated one checker at a time, a
    panel at each player's right with score, pips, the cube and the last moves. Tap the dice to roll, a checker to
    pick it up (its targets light up, also several dice away), then where it goes; *Undo* and *Done* on the panel
    (`boardIntents: ["roll", "move", "undo", "done"]`), *Next game* skips the wait between games. Board and checkers
    are drawn here, no outside artwork.
  - **Phone** (`deck.js`): roll, double (with a confirmation dialog, as Chess's E-009), take or pass, Undo, Done, and
    the legal single moves as buttons in the player's own numbering, for a remote player or anyone who prefers it.
  - **AI** (`ai.ts`, in the host's worker): a hand-made position evaluation (race, blots and the shots at them, made
    points, primes, anchors). *beginner* adds noise and never doubles; *average* plays the best move by the
    evaluation and doubles and takes by it; *strong* looks at its best few plays over all 21 replies. In single-game
    matches (`scripts/bg-ladder.ts`, 100 each) strong beat average 59–41 and beginner 59–1; average beats beginner
    about nine in ten. Moves one checker at a time; the board's `whenIdle` (games-service D-134, D-137) holds the next
    AI move until the last one has been shown.
  - **Seconds per turn** (0–180, default none): when it runs out, the table plays the turn for the player and takes a
    double for them. A player who leaves is replaced by the stand-in, as Chess's E-010, until someone takes the seat;
    the player at the table sits south (`"localSeat": "south"`, E-011).
  - **Statistics** (games-service D-136): a table of points, games won and hits per player, and awards *Hitman*,
    *Doublets*, *High Roller*, *Back from the Bar*, *Gammon Maker* and *Cube Handler*, the award helper kept in the game
    as Chess does. The table has four columns because the phones' result card (games-service `deck.css`,
    `.summary-table`) neither scrolls nor wraps single-word headers: eight columns made a 320 px phone 486 px wide.
    Chess's eight-column table has the same exposure; a scrolling wrapper in games-service would fix it for every game.
  - **Checks**: `tests/backgammon.test.ts` (move generation and the forced-play rules, the cube, Crawford, the match,
    timers, the stand-in, the AI, replays), `tests/backgammon-host.test.ts` (a real host with fake phones),
    `scripts/e2e/backgammon.py` (board and two phones, one at 320 px), and the soak run.
- **E-014 · 2026-10-18 · Klaus** — Backgammon: before a roll, the dice on the board's *Tap to roll* button show no
  numbers and are dimmer (40 %, was 80 % with a 5 and a 2). *Why:* sample numbers on the waiting dice could be taken for
  a roll that had not happened yet. Backgammon 2026.10.18.2.
- **E-015 · 2026-10-18 · Klaus** — Backgammon: *Points to win the match* goes up to 100 (was 15); − and + still step by
  two, a typed number can be any from 1 to 100. A number out of range is now said in the settings window itself
  (games-service D-146). Backgammon and Chess: the side panel of the player to move is framed in that player's lobby
  colour, as their seat plate is, instead of the board's brass. Backgammon 2026.10.18.3, Chess 2026.10.18.2.
- **E-016 · 2026-10-19 · Klaus** — Chess, Liar's Dice and Backgammon follow games-service D-159: a running game keeps its
  players, and the board exchanges who plays a seat. *Implementation (Claude):* `onSeatChanged` in all three: the seat's
  name changes (the side, dice or match stay). The stand-in (E-010) and Liar's Dice's end when a player leaves no longer
  happen at a table, since the platform never removes a player of a running game (their `onSeatLeft` stays for logs).
  Tests: removal refused; exchanged for someone at the table (Chess, Backgammon: the new player plays the side under
  their name) or for an AI (Chess against an AI, Liar's Dice).
- **E-017 · 2026-10-19 · Klaus** — This repository is public: a public example of a game package for Game Table (E-001
  made it private for games not public yet). *Why:* Klaus: "Extra-games does not need to be private as repository and
  from reference point of view. It can be a public example of a game package"; "The repositories games-service and
  extra games should refer to each other." *Implementation (Claude):* before the switch the whole history was checked
  for credentials (none: the workflows use only GitHub's own token). The README introduces the repository as the
  example and points to games-service's developer guide (games-service D-160, D-161), which points back here; no other
  game repository is referred to; the badges render; the console no longer needs `GAME_REPO_TOKEN` for it. The licence was
  still open (settled by E-018). Branch protection for `production` (`test`, `e2e`, `codeql`, no force pushes or
  deletion) was already in place; an earlier version of this entry listed it as open by mistake.
- **E-018 · 2026-10-19 · Klaus** — This repository is under the MIT licence, like games-service (D-162), so its layout
  and games can be copied for a game repository of one's own. *Why:* Klaus: "I want to use MIT for the public repos."
  *Implementation (Claude):* `LICENSE` (Copyright (c) 2026 Klaus Hofrichter), `"license": "MIT"` in `package.json`, a
  *Licence* section in the README. No third-party images, sounds or fonts are in the repository.
- **E-019 · 2026-10-19 · Claude** — An overnight review of the three games against games-service's developer guide
  after its D-171 (no `onSeatLeft` during games, `seatColors` always empty, AI names cut to twelve characters, remote
  watchers), with tests for seats changing hands at every awkward moment. *Why:* Klaus: "Do another /simplify run …
  Apply any fixes, invent new testcases then needed, specifically for cornercases like "all seats are taken, can we
  add another", and deploy when all test are green." *Implementation (Claude):*
  - **Fixed:** Backgammon played any match longer than 25 points as 25 (the rules still capped it at E-013's old
    range; E-015 offers up to 100). Backgammon's turn timer *evaluated* a double for a slow player and could pass it,
    losing them the game; it now takes it, as E-013 and the rules for players say (it still never doubles for them;
    the stand-in of old logs keeps judging). Chess: a draw offered by a player whose seat is then exchanged is
    withdrawn, since the newcomer did not offer it (an offer *to* the seat stands, for the newcomer or the AI to
    answer at once); the Game Viewer says so.
  - **Stale since E-016:** the rules for players of all three games still described the stand-in, the empty seat and a
    round restarted for a player who left; they now describe the exchange. Chess's setting *Stand-in strength (Elo) for
    a player who leaves* could never take effect and is gone (the rules keep 1200, or an old log's value, so old logs
    replay), as is "an AI that takes over the seat of a player who leaves" in its description. `"dynamicPlayers"` is
    `false` for Chess and Backgammon: with two seats for two players nobody could be seated mid-game anyway, and it
    only served the stand-in. The stand-in, `onSeatLeft` and `onSeatJoined` stay, marked as reached only by logs from
    before games-service D-159 (as E-016 decided), so the Game Viewer can still replay them.
  - **Simplified:** the unreachable `abandoned` result in Chess, an unused export in `chess/assets/pieces.js`, stale
    comments (the rules' headers, a reference to a document outside this repository), the indentation of
    Backgammon's animation queue.
  - **Added:** Liar's Dice describes its steps for the Game Viewer (bids, calls, new rounds, the table acting for a slow
    player) with *Round* and *Bid* columns, like the other two games.
  - **Checked, unchanged:** no game reads `seatColors` (all use `playerColor`); no view leaks a cup; each game updates
    only names in `onSeatChanged`, which is all their rules keep about a seat's player, and an AI that takes a seat
    moves at once because it reads only its view; `canContinueWithout` stays the default everywhere, since every game
    can wait for a player; summaries put the player's name first. The confirmation dialog in the Chess and Backgammon
    phones looks alike but stays in each game: games are versioned and installed one folder each, so one game must not
    load another's files.
  - **Tests:** `tests/seats.test.ts`: Liar's Dice at 2 to 6 players with every seat going to an AI at a different
    moment and one changing hands back and forth, every cup checked private at every step; the seat on turn exchanged
    in the middle of a bid, the loser during the reveal, both seats right before the last call (the summary names the
    new players; an exchange after the end changes nothing); Chess with the side to move exchanged (the AI moves at
    once), a draw offer to and from an exchanged seat, Black exchanged right before mating, people replaced by AI
    players back and forth; Backgammon with the player answering a double, the mover after one checker, a seat between
    games and the doubler's seat while a double waits, and a whole match of a person who sits still against an AI.
    Every game also replays exactly and the Game Viewer describes every step, names at the table's twelve characters
    included. `chess-host.test.ts`: every seat taken, a third phone is refused and the game goes on; the exchange
    is the way in. `backgammon.test.ts`: matches up to 100 points; the timer's take.
- **E-020 · 2026-10-22 · Klaus** — A fourth game, Mexican Train: dominoes for 2 to 8 players with the most
  customised board in this repository, to show what a game can do within the platform. *Why:* Klaus: "I would like to
  add a highly customized game that changes the board considerable, similar to Loopy. It should be colorful, have
  screen animations, support 2 to 8 players. It needs to take advantage of the private deck. It will be included in
  the ExtraGames, so it can't be under copyrights." Of the suggestions (Mexican Train, Crazy Eights, a tile rummy) he
  took Mexican Train, asked how its trains of unpredictable length fit the board, and reviewed four mockups. Then:
  "the point of this is to show customization of the board and the deck, but of course to stay within the platform.
  Add soundeffects, possibly even background music, and add game specific settings"; "We music only for this game at
  this time, as long as it is aligned with the platform. Rule options can be presented when the game starts";
  "Tiles look a bit small. Can we consider dynamic sizing of the tiles? … a different background … subtile
  animations, perhaps like clouds or a slow moving starfield"; frames and zoom for the player on turn, semi-transparent
  plates; "can we use some screensaver-style background with animation? … write our own engine as part of the game
  (not the platform)"; a picture from a phone as the background was left out for now ("lets skipp the upload"), since
  a phone reaches a game only through logged moves, and logs go to the service. *Implementation (Claude):*
  - **Rules** (`rules.ts`): the common published rules with a double-twelve set. Engines from double twelve down,
    15, 12 or 10 tiles by player count, one tile a turn on your own train, the Mexican train or a marked one; draw one
    when nothing fits, then pass with a marker; a double is covered before anything else and its player plays again;
    a round ends when someone plays their last tile or nobody can play with nothing left to draw; pips in hand score,
    the fewest points win. Settings chosen when the game is started: *Rounds* (1–13), *First turn of a round: play a
    run of tiles on your own train* (on; Done ends the run), *Double blank counts 50 points* (off), and the turn and
    score times. A slow player's tile is played (or a tile drawn, or the run ended) by the table. Two AI styles:
    *planner* keeps its longest chain for its own train and sends other tiles elsewhere, heaviest first; *steady*.
    No name is a trademark; the tiles, colours, sounds and music are made for the game.
  - **Measured, not guessed** (`scripts/train-lengths.ts`): 3,500 AI-only games through the host's simulation loop.
    The longest train in 99 % of rounds: 47 tiles at two players, 29 at four, 24 at six, 21 at eight; at most 89 tiles
    on the board. Two players draw most of the boneyard, so they get the longest trains.
  - **The board** (`board.js`, `assets/layout.js`): a lane per train from the hub toward its owner's seat, the Mexican
    train in the gap with the most room. A train leaves the hub straight and, where its lane is wide enough, bends into
    rows square to the board that wind toward its player. All tiles share one scale, as big as the room allows (up to
    160 %), shrinking when a train needs the space (down to 60 %) and never growing again within a round; past that, a
    train folds its middle into a "+n" chip (not needed in any measured game). Big open-end numbers, markers, rails
    and a light running along the rails of the player on turn; tiles slide in from their player's seat, and
    `whenIdle()` holds AI players until the board has shown them. The scores after a round, with *Next round*.
  - **The seat plates** are the platform's (board kit), restyled in the game's own CSS, scoped to its root: glass tinted
    in the player's colour with the background showing through; on their turn a zoom, a light running round the frame
    and a slow glow.
  - **Backgrounds** (`assets/scenes.js`): our own screensaver-style scenes (Aurora, Lava lamp, Plasma, Fireflies) at a
    third of the board's resolution, at most 30 frames a second, paused while hidden; Starfield and Clouds as pictures
    painted once and slid by the compositor. Existing screensavers were not copied: XScreenSaver's are desktop programs,
    and shader collections mostly allow only non-commercial use. A still frame with motion off or reduced motion.
  - **Sound** (`assets/audio.js`): effects through the board kit's `playSound()` (only while the table's sound is on),
    and music that composes itself (key, mode, tempo, progressions, a motif in A A B A, then a new tune), off by default,
    following the table's sound switch and stopping with the game. All synthesised: no files to license.
  - **Board settings** (display only, per table): background, a new background each round, background motion, music,
    tile faces, big end numbers.
  - **The phone** (`deck.js`): your tiles only; the trains you may play on with their open ends; a tile that fits
    glows, then a highlighted train plays it (a second tap plays a tile that fits one train only); Draw, Done; it
    vibrates when your turn begins. Laid out for 320 px.
  - **Checks:** `tests/mexican-train.test.ts` (dealing, legal plays, markers, doubles, drawing, blocked rounds, both
    options, privacy, the timer, an exchange, the AI, whole games at 2–8 players replaying exactly, the summary, and
    the layout through real games: every tile inside the play area, no two trains on top of each other);
    `scripts/e2e/mexican_train.py` (a board, three phones and an AI player over two rounds); the soak.
