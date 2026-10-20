// Seats changing hands in all three games (games-service D-159): the board exchanges who plays a seat at any moment,
// for a person or an AI, and the game only hears onSeatChanged. These tests exchange seats at the awkward moments (in
// the middle of a turn, a bid, a doubling decision or a draw offer; during a reveal or between games; right before
// the end; back and forth), at every player count, with the longest names the table gives, and check that the AI
// that takes a seat moves at once, names follow the new player into views and summaries, secrets stay secret, the
// Game Viewer can describe every step, and the whole game replays exactly.
import { beforeAll, describe, expect, it } from "vitest";
import { buildMoves } from "../.games-service/apps/table-host/src/moves.ts";
import type { State as BgState } from "../games/backgammon/rules.ts";
import type { State as ChessState } from "../games/chess/rules.ts";
import type { State as LdState } from "../games/liars-dice/rules.ts";
import { loadGame, replaysExactly, seats, start, type Game, type GameRuntime, type SeatInfo, type VirtualClock } from "./harness.ts";

let ld: Game;
let chess: Game;
let bg: Game;
beforeAll(async () => {
  [ld, chess, bg] = await Promise.all([loadGame("liars-dice"), loadGame("chess"), loadGame("backgammon")]);
});

/** A seeded source for the AI's own random numbers. */
function rng(seed: number) {
  let x = seed;
  return () => ((x = (x * 48271) % 2147483647) / 2147483647);
}

/** Exchange a seat as the board does: another player, a person or an AI, plays it from now on. */
function exchange(rt: GameRuntime, seat: number, name: string, kind: "human" | "ai", aiOptions?: Record<string, unknown>) {
  const now = rt.seats.find((s) => s.seat === seat)!;
  const info: SeatInfo = { seat, playerId: `${kind}-${seat}-${name}`, name, kind, edge: now.edge };
  rt.seatChanged(info, aiOptions);
}

/**
 * Plays on: every AI seat is asked for a move after every step, as the table does; when none moves, the next timer
 * fires (a person who sits still is moved on by the game's turn timer). `each` runs before every step.
 */
function playOn(rt: GameRuntime, clock: VirtualClock, random: () => number, max: number, each?: (k: number) => void) {
  for (let k = 0; k < max && !rt.over; k++) {
    each?.(k);
    if (rt.over) break;
    let moved = false;
    for (const s of rt.seats) {
      if (s.kind !== "ai") continue;
      const intent = rt.aiIntent(s.seat, random);
      if (!intent) continue;
      expect(rt.submit(s.seat, intent, "ai"), `${s.name}: ${JSON.stringify(intent)}`).toEqual({ ok: true });
      moved = true;
      break;
    }
    if (!moved && !clock.advance()) throw new Error("the game is stuck: no AI move and no timer");
  }
}

/** The Game Viewer reads the whole log with the game's describe, with no step it could not describe. */
function viewerReads(game: Game, rt: GameRuntime) {
  const list = buildMoves(rt.log, game as never);
  expect(list.note).toBeUndefined();
  expect(list.described).toBe(true);
  for (const row of list.rows) {
    expect(row.flags, `line ${row.line}`).not.toContain("error");
    expect(row.details?.["describe failed"], `line ${row.line}`).toBeUndefined();
  }
  return list;
}

/** Every name in the summary's table is the seat's player now (the platform marks seats that changed hands). */
function namesAreCurrent(rt: GameRuntime) {
  const names = rt.seats.map((s) => s.name);
  for (const row of rt.summary!.table!.rows) expect(names).toContain(row[0]);
}

// The table cuts names to twelve characters, and an AI taking over a long name becomes "Alexand (AI)" (D-148, D-171).
const LONG = "Alexandra Ma";
const LONG_AI = "Alexand (AI)";

describe("Liar's Dice: seats exchanged at any moment", () => {
  /** Every seat's view is the board's view plus its own cup, nothing more; no cup is public while bidding. */
  function private_(rt: GameRuntime) {
    const st = rt.state as LdState;
    const board = rt.boardView() as Record<string, unknown>;
    if (st.phase === "bidding") expect(board.reveal).toBeNull();
    for (const s of rt.seats) {
      const { seat, myDice, out, myTurn, ...pub } = rt.view(s.seat) as Record<string, unknown>;
      expect(seat).toBe(s.seat);
      expect(pub).toEqual(board);
      expect(myDice).toEqual(st.players[s.seat].out ? [] : st.players[s.seat].dice);
      expect(out).toBe(st.players[s.seat].out);
      expect(myTurn).toBe(st.phase === "bidding" && st.turn === s.seat);
    }
  }

  for (const n of [2, 3, 4, 5, 6]) {
    it(`${n} players: every seat goes to an AI at a different moment, one goes back to a person and to an AI again; cups stay private, the game ends and replays`, () => {
      const { rt, clock } = start(ld, n, { startDice: 5, turnSeconds: 20, revealSeconds: 3 }, 100 + n);
      const random = rng(n);
      let reveals = 0;
      playOn(rt, clock, random, 20000, (k) => {
        private_(rt);
        const st = rt.state as LdState;
        // Seat i goes to an AI at step 2i+1, whatever is going on then: a bid, a reveal, someone else's turn.
        for (let i = 0; i < n; i++) if (k === 2 * i + 1) exchange(rt, i, i === 0 ? LONG : `Robo ${i} (AI)`, i === 0 ? "human" : "ai", { style: i % 2 ? "bold" : "cautious" });
        // Seat 0 changes hands twice more: to an AI, then (after a person's interlude) to another AI with a long name.
        if (k === 2 * n + 1) exchange(rt, 0, LONG_AI, "ai");
        if (k === 2 * n + 4) exchange(rt, 0, "Zed", "human");
        if (k === 2 * n + 9) exchange(rt, 0, LONG_AI, "ai", { style: "bold" });
        if (st.phase === "reveal") reveals++;
      });
      expect(rt.over).toBe(true);
      expect(reveals).toBeGreaterThan(0);
      private_(rt);
      const st = rt.state as LdState;
      expect(st.players[0].name).toBe(LONG_AI);
      expect(rt.summary!.text.startsWith(st.players[st.winner!].name)).toBe(true);
      namesAreCurrent(rt);
      expect(replaysExactly(ld, rt)).toBe(true);
      viewerReads(ld, rt);
    });
  }

  it("the player on turn, a bid in front of them, goes to an AI: it answers at once and the bid stands", () => {
    const { rt } = start(ld, 3, { turnSeconds: 0 }, 5);
    const first = (rt.state as LdState).turn;
    expect(rt.submit(first, { name: "bid", payload: { quantity: 2, face: 3 } }, "human")).toEqual({ ok: true });
    const next = (rt.state as LdState).turn;
    const dice = [...(rt.state as LdState).players[next].dice];
    exchange(rt, next, "Mia (AI)", "ai");
    const st = rt.state as LdState;
    expect(st.bid).toEqual({ seat: first, quantity: 2, face: 3 });
    expect(st.players[next]).toMatchObject({ name: "Mia (AI)", dice });
    expect((rt.boardView() as { players: { seat: number; name: string }[] }).players.find((p) => p.seat === next)!.name).toBe("Mia (AI)");
    const intent = rt.aiIntent(next, rng(1));
    expect(intent).not.toBeNull();
    expect(rt.submit(next, intent!, "ai")).toEqual({ ok: true });
    // And back to a person: nothing is owed, the game just goes on.
    exchange(rt, next, "Ben", "human");
    expect((rt.state as LdState).players[next].name).toBe("Ben");
  });

  it("the loser of a call goes to an AI during the reveal; it opens the next round at once", () => {
    const { rt, clock } = start(ld, 2, { turnSeconds: 0, revealSeconds: 4 }, 9);
    const first = (rt.state as LdState).turn;
    expect(rt.submit(first, { name: "bid", payload: { quantity: 10, face: 6 } }, "human")).toEqual({ ok: true }); // all ten sixes: a lie
    const other = (rt.state as LdState).turn;
    expect(rt.submit(other, { name: "liar" }, "human")).toEqual({ ok: true });
    expect((rt.state as LdState).reveal!.loser).toBe(first);
    exchange(rt, first, "Finn (AI)", "ai");
    expect(rt.aiIntent(first, rng(2))).toBeNull(); // the cups are up: nothing to do yet
    clock.advance();
    expect(rt.state).toMatchObject({ phase: "bidding", round: 2, turn: first });
    expect(rt.aiIntent(first, rng(2))).toMatchObject({ name: "bid" });
  });

  it("seats exchanged right before the last call: the summary names the new players; after the end nothing changes", () => {
    const { rt, clock } = start(ld, 2, { startDice: 2, turnSeconds: 10, revealSeconds: 2 }, 21, { seats: seats(2, "ai") });
    const random = rng(3);
    let swapped = 0;
    playOn(rt, clock, random, 5000, () => {
      const st = rt.state as LdState;
      // One die each: whatever happens next ends the game. Both seats change hands now, the one on turn twice.
      if (st.phase === "bidding" && st.bid && Object.values(st.players).every((p) => p.dice.length === 1) && !swapped) {
        exchange(rt, st.turn, "Lastminute", "human");
        exchange(rt, st.turn, LONG_AI, "ai");
        exchange(rt, st.bid.seat, LONG, "human");
        swapped++;
      }
    });
    expect(swapped).toBe(1);
    expect(rt.over).toBe(true);
    namesAreCurrent(rt);
    expect([LONG, LONG_AI].some((n) => rt.summary!.text.startsWith(`${n} wins`))).toBe(true);
    const end = JSON.stringify(rt.state);
    exchange(rt, 0, "Too late", "human");
    expect(JSON.stringify(rt.state)).toBe(end);
    expect(replaysExactly(ld, rt)).toBe(true);
    viewerReads(ld, rt);
  });

  it("the Game Viewer says what each step meant: bids, calls, rounds and the table acting for a slow player", () => {
    const { rt, clock } = start(ld, 3, { startDice: 2, turnSeconds: 5, revealSeconds: 2 }, 4);
    const random = rng(4);
    playOn(rt, clock, random, 5000, (k) => {
      if (k === 6) exchange(rt, 1, "Robo (AI)", "ai");
      if (k === 9) exchange(rt, 2, "Robo 2 (AI)", "ai");
    });
    const texts = viewerReads(ld, rt).rows.map((r) => r.text);
    expect(texts.some((t) => /^Out of time: the table (bids|calls Liar!)/.test(t))).toBe(true);
    expect(texts.some((t) => /^bids (one|two|three|four|five|six|\d+) \w+$/.test(t))).toBe(true);
    expect(texts.some((t) => /calls Liar! on .+ loses a die/.test(t))).toBe(true);
    expect(texts.some((t) => /^Round 2: everyone rolls; .+ opens\.$/.test(t))).toBe(true);
    expect(texts.some((t) => / wins\.$/.test(t))).toBe(true);
  });
});

describe("Chess: seats exchanged at any moment", () => {
  const move = (rt: GameRuntime, u: string) => {
    const st = rt.state as ChessState;
    const seat = st.seats[st.fen.split(" ")[1] === "b" ? 1 : 0];
    expect(rt.submit(seat, { name: "move", payload: { uci: u } }, "human"), u).toEqual({ ok: true });
  };

  it("the side to move goes to an AI: it moves at once; then back to a person, who plays on under their name", () => {
    const { rt } = start(chess, 2, { timeControl: "5+3", whiteSeat: "south" }, 3);
    move(rt, "e2e4");
    exchange(rt, 1, "Mia (AI)", "ai", { elo: 400 });
    const intent = rt.aiIntent(1, rng(5));
    expect(intent).toMatchObject({ name: "move" });
    expect(rt.submit(1, intent!, "ai")).toEqual({ ok: true });
    exchange(rt, 1, "Cleo", "human");
    move(rt, "d2d4");
    expect(rt.view(1)).toMatchObject({ myTurn: true, color: 1, names: { 1: "Cleo" } });
    expect(rt.aiIntent(0, rng(5))).toBeNull(); // not White's turn, whoever plays it
  });

  it("a draw offered to a seat that goes to an AI is answered at once; one the leaving player made is withdrawn", () => {
    const { rt } = start(chess, 2, {}, 3);
    move(rt, "e2e4");
    move(rt, "e7e5");
    expect(rt.submit(0, { name: "offerDraw" }, "human")).toEqual({ ok: true });
    exchange(rt, 1, "Mia (AI)", "ai", { elo: 400 });
    expect((rt.state as ChessState).drawOffer).toBe(0); // the offer stands for the newcomer to answer
    const answer = rt.aiIntent(1, rng(6));
    expect(answer?.name).toMatch(/^(accept|decline)Draw$/);
    expect(rt.submit(1, answer!, "ai")).toEqual({ ok: true });
    if (rt.over) return;
    // Black offers, then Black's seat changes hands: the newcomer did not offer anything.
    exchange(rt, 1, "Ben", "human");
    move(rt, "g1f3");
    expect(rt.submit(1, { name: "offerDraw" }, "human")).toEqual({ ok: true });
    exchange(rt, 1, LONG, "human");
    expect((rt.state as ChessState).drawOffer).toBeNull();
    expect(rt.submit(0, { name: "acceptDraw" }, "human")).toMatchObject({ ok: false, reason: "There is no draw offer to accept" });
    const texts = (rt.finish("terminated", null), viewerReads(chess, rt).rows.map((r) => r.text));
    expect(texts).toContain("Takes over the seat; the draw offer is withdrawn.");
  });

  it("Black changes hands right before mating: the result and the table name the new player; the clocks went on", () => {
    const { rt } = start(chess, 2, { timeControl: "1+0" }, 3);
    for (const u of ["f2f3", "e7e5", "g2g4"]) move(rt, u);
    exchange(rt, 1, LONG, "human");
    move(rt, "d8h4");
    expect(rt.over).toBe(true);
    expect(rt.summary!.text).toBe(`${LONG} wins with black by checkmate after two moves.`);
    namesAreCurrent(rt);
    expect(replaysExactly(chess, rt)).toBe(true);
  });

  it("people start, both seats go to AI players mid-game (back and forth once), and the game plays to its end and replays", () => {
    const { rt, clock } = start(chess, 2, {}, 11);
    move(rt, "d2d4");
    move(rt, "d7d5");
    exchange(rt, 0, "Rook (AI)", "ai", { elo: 400 });
    exchange(rt, 0, "Ann", "human");
    exchange(rt, 0, LONG_AI, "ai", { elo: 400 });
    exchange(rt, 1, "Pawn (AI)", "ai", { elo: 600 });
    playOn(rt, clock, rng(7), 3000);
    expect(rt.over).toBe(true);
    namesAreCurrent(rt);
    expect(replaysExactly(chess, rt)).toBe(true);
    viewerReads(chess, rt);
  }, 60000);
});

describe("Backgammon: seats exchanged at any moment", () => {
  it("the player answering a double goes to an AI: it takes or passes at once", () => {
    const { rt } = start(bg, 2, { matchLength: 5 }, 8);
    // Play the opening for the side that starts, then the other side doubles.
    const ai = rng(8);
    for (let k = 0; k < 10 && (rt.state as BgState).phase === "move"; k++) {
      const st = rt.state as BgState;
      expect(rt.submit(st.seats[st.turn], rt.aiIntent(st.seats[st.turn], ai) ?? { name: "done" }, "human")).toEqual({ ok: true });
    }
    const st = rt.state as BgState;
    expect(st.phase).toBe("roll");
    expect(rt.submit(st.seats[st.turn], { name: "double" }, "human")).toEqual({ ok: true });
    const taker = st.seats[st.turn ^ 1];
    exchange(rt, taker, "Mia (AI)", "ai", { level: "strong" });
    const answer = rt.aiIntent(taker, ai);
    expect(answer?.name).toMatch(/^(take|pass)$/);
    expect(rt.submit(taker, answer!, "ai")).toEqual({ ok: true });
    expect((rt.state as BgState).names[taker]).toBe("Mia (AI)");
  });

  it("the mover goes to an AI after one checker: the AI finishes the turn; Undo stays the seat's, and a person takes it back", () => {
    const { rt } = start(bg, 2, { matchLength: 3 }, 12);
    const st0 = rt.state as BgState;
    const mover = st0.seats[st0.turn];
    const first = rt.aiIntent(mover, rng(9))!;
    expect(rt.submit(mover, first, "human")).toEqual({ ok: true });
    exchange(rt, mover, LONG_AI, "ai", { level: "average" });
    expect((rt.state as BgState).turnMoves).toHaveLength(1); // the move made stays
    for (let k = 0; k < 6 && (rt.state as BgState).seats[(rt.state as BgState).turn] === mover; k++) {
      const intent = rt.aiIntent(mover, rng(9));
      expect(intent).not.toBeNull();
      expect(rt.submit(mover, intent!, "ai")).toEqual({ ok: true });
    }
    expect((rt.state as BgState).plays[0]).toMatchObject({ opening: true });
    exchange(rt, mover, "Ann", "human");
    expect(rt.view(mover)).toMatchObject({ names: { [mover]: "Ann" } });
  });

  it("a seat changes hands between games and while the doubler waits; the match plays to its end and replays", () => {
    const { rt, clock } = start(bg, 2, { matchLength: 7 }, 5, { seats: seats(2, "ai"), aiOptions: { 0: { level: "average" }, 1: { level: "beginner" } } });
    let between = 0;
    let doubled = 0;
    playOn(rt, clock, rng(10), 8000, () => {
      const st = rt.state as BgState;
      if (st.phase === "gameOver" && !between) {
        exchange(rt, st.seats[0], "Zed", "human");
        exchange(rt, st.seats[0], LONG_AI, "ai", { level: "strong" });
        between++;
      }
      if (st.phase === "double" && !doubled) {
        exchange(rt, st.seats[st.turn], "Doubler (AI)", "ai", { level: "average" }); // the doubler's seat: the double stands
        expect((rt.state as BgState).phase).toBe("double");
        doubled++;
      }
    });
    expect(rt.over).toBe(true);
    expect(between).toBe(1);
    expect(doubled).toBe(1);
    namesAreCurrent(rt);
    expect(Math.max(...(rt.state as BgState).match.score)).toBe(7);
    expect(replaysExactly(bg, rt)).toBe(true);
    viewerReads(bg, rt);
  }, 60000);

  it("people who sit still: the turn timer plays for them and takes their doubles, through to the end of a match", () => {
    const { rt, clock } = start(bg, 2, { matchLength: 3, turnSeconds: 15 }, 6, {
      seats: [
        { seat: 0, playerId: "a", name: "Ann", kind: "human", edge: "south" },
        { seat: 1, playerId: "m", name: "Mia (AI)", kind: "ai", edge: "north" },
      ],
      aiOptions: { 1: { level: "strong" } },
    });
    playOn(rt, clock, rng(11), 20000);
    expect(rt.over).toBe(true);
    // Every double Mia offered Ann was taken for her by the table.
    const takenForAnn = rt.log.filter((r: any) => r.t === "timer" && r.id === "turn" && r.events?.some((e: any) => e.name === "took"));
    expect(takenForAnn.length).toBeGreaterThan(0);
    expect((rt.state as BgState).games.filter((g) => g.kind === "pass" && g.winner === 1)).toEqual([]);
    expect(replaysExactly(bg, rt)).toBe(true);
  }, 60000);
});
