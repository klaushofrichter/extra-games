// Liar's Dice rules: table order, bidding, calls, wild ones, the reveal, timers, leaving players (old logs), privacy,
// the AI, summaries and exact replay. Everything runs on games-service's own runtime (tests/harness.ts).
import { beforeAll, describe, expect, it } from "vitest";
import {
  biddableFaces,
  chooseMove,
  isRaise,
  matches,
  minimumFor,
  nextActive,
  tableOrder,
  totalDice,
  type Face,
  type State,
} from "../games/liars-dice/rules.ts";
import { loadGame, replaysExactly, seats, start, type Game } from "./harness.ts";

let game: Game;
beforeAll(async () => {
  game = await loadGame("liars-dice");
});

/** A game with no timers unless asked, so tests drive time explicitly. */
const quiet = { turnSeconds: 0, revealSeconds: 5 };

/** Put chosen cups and a chosen turn into a running game (the log no longer replays after this). */
function position(st: State, cups: Record<number, Face[]>, turn: number, bid: State["bid"] = null): State {
  const players = Object.fromEntries(Object.entries(st.players).map(([k, p]) => [k, { ...p, dice: cups[Number(k)] ?? p.dice }]));
  return { ...st, players, turn, bid, bids: bid ? [bid] : [], phase: "bidding" };
}

const bid = (quantity: number, face: number) => ({ name: "bid", payload: { quantity, face } });
const liar = { name: "liar" };

describe("helpers", () => {
  it("orders seats around the table: each edge left to right, edges south, east, north, west", () => {
    expect(tableOrder(seats(2))).toEqual([0, 1]); // south, north
    expect(tableOrder(seats(4))).toEqual([0, 3, 2, 1]); // south, east, north, west
    expect(tableOrder(seats(6, "human", 6))).toEqual([0, 1, 4, 2, 3, 5]); // S S E N N W
    expect(tableOrder(seats(3, "human", 6))).toEqual([0, 1, 2]);
    // Seats without an edge (as some callers make them) keep seat order.
    expect(tableOrder([{ seat: 2, playerId: "a", name: "A", kind: "human" }, { seat: 0, playerId: "b", name: "B", kind: "human" }])).toEqual([0, 2]);
  });

  it("counts matches, with ones wild for every face but one", () => {
    const cup: Face[] = [1, 1, 3, 5, 5];
    expect(matches(cup, 5, true)).toBe(4);
    expect(matches(cup, 5, false)).toBe(2);
    expect(matches(cup, 3, true)).toBe(3);
    expect(matches(cup, 1, false)).toBe(2);
    expect(matches(cup, 6, true)).toBe(2);
    expect(matches([], 4, true)).toBe(0);
  });

  it("knows which faces can be bid", () => {
    expect(biddableFaces(true)).toEqual([2, 3, 4, 5, 6]);
    expect(biddableFaces(false)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("accepts only raises: more dice, or as many of a higher face", () => {
    expect(isRaise(null, 1, 2)).toBe(true);
    expect(isRaise(null, 0, 2)).toBe(false);
    const prev = { quantity: 3, face: 4 as Face };
    expect(isRaise(prev, 3, 5)).toBe(true);
    expect(isRaise(prev, 4, 2)).toBe(true);
    expect(isRaise(prev, 3, 4)).toBe(false);
    expect(isRaise(prev, 3, 3)).toBe(false);
    expect(isRaise(prev, 2, 6)).toBe(false);
  });

  it("finds the cheapest raise on each face", () => {
    expect(minimumFor(null, 3)).toBe(1);
    const prev = { quantity: 3, face: 4 as Face };
    expect(minimumFor(prev, 5)).toBe(3);
    expect(minimumFor(prev, 4)).toBe(4);
    expect(minimumFor(prev, 2)).toBe(4);
  });
});

describe("setup", () => {
  it("gives every player a sorted cup of the configured size and a starting player", () => {
    const { state } = start(game, 4, { ...quiet, startDice: 3 });
    const s = state() as State;
    expect(s.order).toEqual([0, 3, 2, 1]);
    for (const p of Object.values(s.players)) {
      expect(p.dice).toHaveLength(3);
      expect([...p.dice].sort((a, b) => a - b)).toEqual(p.dice);
      expect(p.dice.every((d) => d >= 1 && d <= 6)).toBe(true);
    }
    expect(s.order).toContain(s.turn);
    expect(totalDice(s)).toBe(12);
    expect(s).toMatchObject({ phase: "bidding", round: 1, bid: null, onesWild: true });
  });

  it("uses the manifest defaults", () => {
    const { state } = start(game, 2);
    expect(state()).toMatchObject({ startDice: 5, onesWild: true, turnMs: 45000, revealMs: 6000 });
  });

  it("picks different starting players and cups for different seeds", () => {
    const starts = new Set<number>();
    const cups = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      const s = start(game, 4, quiet, seed).state() as State;
      starts.add(s.turn);
      cups.add(JSON.stringify(s.players[0].dice));
    }
    expect(starts.size).toBe(4);
    expect(cups.size).toBeGreaterThan(10);
  });

  it("rolls every face over many games, roughly evenly", () => {
    const seen = [0, 0, 0, 0, 0, 0, 0];
    for (let seed = 1; seed <= 300; seed++) for (const p of Object.values((start(game, 2, quiet, seed).state() as State).players)) for (const d of p.dice) seen[d]++;
    for (let f = 1; f <= 6; f++) expect(seen[f]).toBeGreaterThan(400); // 3000 dice, 500 expected per face
  });
});

describe("bidding", () => {
  it("lets the player on turn bid, then passes the turn around the table", () => {
    const { rt, state } = start(game, 4, quiet, 3);
    const first = state().turn;
    expect(rt.submit(first, bid(2, 3), "human")).toEqual({ ok: true });
    const s = state() as State;
    expect(s.bid).toEqual({ seat: first, quantity: 2, face: 3 });
    expect(s.turn).toBe(nextActive(s, first));
    expect(s.players[first].bids).toBe(1);
  });

  it("refuses bids out of turn, non-raises, wild ones, too many dice and malformed payloads", () => {
    const { rt, state } = start(game, 2, quiet, 5);
    const first = state().turn;
    const other = first === 0 ? 1 : 0;
    expect(rt.submit(other, bid(1, 2), "human")).toMatchObject({ ok: false, reason: expect.stringContaining("turn") });
    expect(rt.submit(first, bid(1, 1), "human")).toMatchObject({ ok: false, reason: expect.stringContaining("ones are wild") });
    expect(rt.submit(first, bid(0, 3), "human")).toMatchObject({ ok: false, reason: expect.stringContaining("at least one") });
    expect(rt.submit(first, bid(11, 3), "human")).toMatchObject({ ok: false, reason: expect.stringContaining("only ten dice") });
    expect(rt.submit(first, bid(2.5, 3), "human")).toMatchObject({ ok: false });
    expect(rt.submit(first, bid(2, 7), "human")).toMatchObject({ ok: false });
    expect(rt.submit(first, { name: "bid" }, "human")).toMatchObject({ ok: false });
    expect(rt.submit(first, { name: "bid", payload: { quantity: "2", face: "x" } }, "human")).toMatchObject({ ok: false });
    expect(rt.submit(first, { name: "dance" }, "human")).toMatchObject({ ok: false, reason: expect.stringContaining("unknown") });
    expect(rt.submit(first, liar, "human")).toMatchObject({ ok: false, reason: expect.stringContaining("no bid") });
    expect(rt.submit(first, bid(3, 4), "human")).toEqual({ ok: true });
    expect(rt.submit(other, bid(3, 4), "human")).toMatchObject({ ok: false, reason: expect.stringContaining("raise") });
    expect(rt.submit(other, bid(2, 6), "human")).toMatchObject({ ok: false });
    expect(rt.submit(other, bid(3, 5), "human")).toEqual({ ok: true });
    expect(state().bids).toHaveLength(2);
  });

  it("allows bidding on ones when they are not wild", () => {
    const { rt, state } = start(game, 2, { ...quiet, onesWild: false }, 5);
    expect(rt.submit(state().turn, bid(1, 1), "human")).toEqual({ ok: true });
  });

  it("refuses everything from a seat that is not in the game", () => {
    const { rt } = start(game, 2, quiet, 5);
    expect(rt.submit(5, bid(1, 2), "human")).toMatchObject({ ok: false });
  });
});

describe("calls", () => {
  it("a bid that holds costs the caller a die; wild ones count", () => {
    const { rt, state } = start(game, 2, quiet, 1);
    rt.state = position(state(), { 0: [1, 2, 3, 4, 5], 1: [1, 5, 5, 6, 6] }, 0);
    rt.submit(0, bid(5, 5), "human"); // 5s: one 5 + one 1 (seat 0), two 5s + one 1 (seat 1) = 5
    rt.submit(1, liar, "human");
    const s = state() as State;
    expect(s.phase).toBe("reveal");
    expect(s.reveal).toMatchObject({ matched: 5, bidHeld: true, loser: 1, caller: 1, auto: false });
    expect(s.players[1].dice).toHaveLength(4);
    expect(s.players[0].dice).toHaveLength(5);
    expect(s.players[0].callsWon).toBe(1);
    expect(s.reveal!.cups).toEqual({ 0: [1, 2, 3, 4, 5], 1: [1, 5, 5, 6, 6] });
  });

  it("a bid that fails costs the bidder a die", () => {
    const { rt, state } = start(game, 2, quiet, 1);
    rt.state = position(state(), { 0: [2, 2, 3, 4, 6], 1: [3, 3, 4, 6, 6] }, 0);
    rt.submit(0, bid(3, 5), "human");
    rt.submit(1, liar, "human");
    expect(state().reveal).toMatchObject({ matched: 0, bidHeld: false, loser: 0 });
    expect(state().players[0].dice).toHaveLength(4);
    expect(state().players[1].callsWon).toBe(1);
  });

  it("without wild ones, ones count only for a bid on ones", () => {
    const { rt, state } = start(game, 2, { ...quiet, onesWild: false }, 1);
    rt.state = { ...position(state(), { 0: [1, 1, 1, 4, 4], 1: [1, 4, 6, 6, 6] }, 0), onesWild: false };
    rt.submit(0, bid(3, 4), "human"); // three 4s exactly, ones don't help
    rt.submit(1, liar, "human");
    expect(state().reveal).toMatchObject({ matched: 3, bidHeld: true, loser: 1 });
  });

  it("an exact count holds", () => {
    const { rt, state } = start(game, 2, quiet, 1);
    rt.state = position(state(), { 0: [6, 6, 2, 3, 4], 1: [6, 2, 2, 3, 4] }, 0);
    rt.submit(0, bid(3, 6), "human");
    rt.submit(1, liar, "human");
    expect(state().reveal).toMatchObject({ matched: 3, bidHeld: true });
  });

  it("only the player on turn may call", () => {
    const { rt, state } = start(game, 4, quiet, 1);
    rt.state = position(state(), {}, 0);
    rt.submit(0, bid(1, 3), "human");
    expect(state().turn).toBe(3);
    expect(rt.submit(2, liar, "human")).toMatchObject({ ok: false });
    expect(rt.submit(0, liar, "human")).toMatchObject({ ok: false });
    expect(rt.submit(3, liar, "human")).toEqual({ ok: true });
  });

  it("refuses moves during the reveal", () => {
    const { rt, state } = start(game, 2, quiet, 1);
    rt.state = position(state(), {}, 0);
    rt.submit(0, bid(1, 3), "human");
    rt.submit(1, liar, "human");
    expect(rt.submit(0, bid(1, 4), "human")).toMatchObject({ ok: false, reason: expect.stringContaining("next round") });
  });

  it("emits the call with everything the board needs to animate it", () => {
    const { rt, state } = start(game, 2, quiet, 1);
    rt.state = position(state(), { 0: [2, 2, 2, 2, 2], 1: [3, 3, 3, 3, 3] }, 0);
    const events: unknown[] = [];
    rt.onChange((_k, e) => events.push(...e));
    rt.submit(0, bid(2, 3), "human");
    rt.submit(1, liar, "human");
    expect(events).toEqual([
      { name: "bid", data: { seat: 0, quantity: 2, face: 3, auto: false } },
      { name: "called", data: { caller: 1, bidder: 0, matched: 5, bidHeld: true, loser: 1, out: false, auto: false } },
    ]);
  });
});

describe("rounds", () => {
  it("after the reveal, everyone rerolls and the loser opens", () => {
    const { rt, state, clock } = start(game, 4, quiet, 2);
    // Seat 0 bid twenty sixes; nobody has a six or a one.
    rt.state = position(state(), { 0: [2, 2, 2, 2, 2], 1: [2, 2, 2, 2, 2], 2: [2, 2, 2, 2, 2], 3: [2, 2, 2, 2, 2] }, 3, { seat: 0, quantity: 20, face: 6 });
    rt.submit(3, liar, "human");
    expect(state().reveal.loser).toBe(0);
    expect(clock.advance()).toBe(true); // the "next" timer
    const s = state() as State;
    expect(s).toMatchObject({ phase: "bidding", round: 2, turn: 0, bid: null, bids: [], reveal: null });
    expect(s.players[0].dice).toHaveLength(4);
    expect(totalDice(s)).toBe(19);
  });

  it("a player who loses their last die is out, and the next player opens", () => {
    const { rt, state, clock } = start(game, 4, quiet, 2);
    const st = position(state(), { 0: [6], 1: [2, 2], 2: [2, 2], 3: [2, 2] }, 0);
    rt.state = st;
    rt.submit(0, bid(3, 6), "human"); // no sixes, no ones: fails
    rt.submit(3, liar, "human");
    expect(state().players[0]).toMatchObject({ out: true, dice: [], outInRound: 1 });
    clock.advance();
    expect(state().turn).toBe(3); // after seat 0 in table order
    expect(state().order.filter((x: number) => !state().players[x].out)).toEqual([3, 2, 1]);
    // Out players are skipped from now on.
    rt.submit(3, bid(1, 2), "human");
    rt.submit(2, bid(1, 3), "human");
    rt.submit(1, bid(1, 4), "human");
    expect(state().turn).toBe(3);
    expect(rt.submit(0, bid(2, 2), "human")).toMatchObject({ ok: false, reason: expect.stringContaining("out of dice") });
  });

  it("the last player with dice wins, with the reveal kept for the final screen", () => {
    const { rt, state } = start(game, 2, quiet, 2);
    rt.state = position(state(), { 0: [4], 1: [5, 5] }, 0);
    rt.submit(0, bid(2, 4), "human");
    rt.submit(1, liar, "human");
    const s = state() as State;
    expect(s).toMatchObject({ phase: "over", winner: 1 });
    expect(s.reveal).toMatchObject({ loser: 0 });
    expect(rt.over).toBe(true);
    expect(rt.summary!.text).toBe("Ben wins with two dice left after one round. Ann ran out of dice.");
    expect(rt.summary!.highlights).toMatchObject({ winner: "Ben", rounds: 1, diceLeft: 2, ranking: ["Ben", "Ann"] });
    expect(rt.summary!.table!.rows).toEqual([
      ["Ben", 2, 0, 1, 0],
      ["Ann", 0, 1, 0, 1],
    ]);
  });

  it("ranks players by dice left, then by how long they lasted", () => {
    const { rt, state } = start(game, 4, quiet, 2);
    const st = position(state(), { 0: [2, 2], 1: [], 2: [], 3: [3] }, 3, { seat: 0, quantity: 1, face: 3 });
    st.players[1] = { ...st.players[1], out: true, outInRound: 1, roundsLost: 5 };
    st.players[2] = { ...st.players[2], out: true, outInRound: 3, roundsLost: 5 };
    rt.state = { ...st, round: 4 };
    rt.submit(3, liar, "human"); // one three on the table: the bid holds, seat 3 loses its last die
    expect(state()).toMatchObject({ phase: "over", winner: 0 });
    expect(rt.summary!.highlights.ranking).toEqual(["Ann", "Dev", "Cleo", "Ben"]); // Dev out in round 4, Cleo in 3, Ben in 1
    expect(rt.summary!.text).toBe("Ann wins with two dice left after four rounds. Dev, Cleo and Ben ran out of dice.");
  });

  it("refuses everything once the game is over", () => {
    const { rt, state } = start(game, 2, quiet, 2);
    rt.state = position(state(), { 0: [4], 1: [5, 5] }, 0);
    rt.submit(0, bid(2, 4), "human");
    rt.submit(1, liar, "human");
    expect(rt.submit(1, bid(1, 2), "human")).toMatchObject({ ok: false });
  });
});

describe("timers", () => {
  it("a slow opener bids one of their most common face", () => {
    const { rt, state, clock } = start(game, 2, { turnSeconds: 10, revealSeconds: 5 }, 4);
    rt.state = position(state(), { 0: [3, 3, 4, 6, 1], 1: [2, 2, 2, 2, 2] }, 0);
    rt.fireTimer("turn");
    expect(state().bid).toEqual({ seat: 0, quantity: 1, face: 3 });
    expect(state().turn).toBe(1);
    expect(clock.now()).toBe(0);
  });

  it("a slow player with a bid in front of them calls it", () => {
    const { rt, state } = start(game, 2, { turnSeconds: 10, revealSeconds: 5 }, 4);
    rt.state = position(state(), {}, 1, { seat: 0, quantity: 2, face: 3 });
    rt.fireTimer("turn");
    expect(state().reveal).toMatchObject({ caller: 1, auto: true });
  });

  it("arms a turn timer for every turn and none in the reveal", () => {
    const { rt, state } = start(game, 2, { turnSeconds: 10, revealSeconds: 5 }, 4);
    expect(Object.keys(rt.timerDeadlines())).toEqual(["turn"]);
    rt.submit(state().turn, bid(1, 2), "human");
    expect(Object.keys(rt.timerDeadlines())).toEqual(["turn"]);
    rt.submit(state().turn, liar, "human");
    expect(Object.keys(rt.timerDeadlines())).toEqual(["next"]);
  });

  it("with no turn limit, only the reveal is timed", () => {
    const { rt, state } = start(game, 2, quiet, 4);
    expect(Object.keys(rt.timerDeadlines())).toEqual([]);
    rt.submit(state().turn, bid(1, 2), "human");
    rt.submit(state().turn, liar, "human");
    expect(rt.timerDeadlines().next).toBe(5000);
  });

  it("a game where nobody ever acts still ends, by the clock alone", () => {
    const { rt, clock } = start(game, 3, { turnSeconds: 5, revealSeconds: 2, startDice: 2 }, 9);
    let steps = 0;
    while (!rt.over && steps++ < 10000) clock.advance();
    expect(rt.over).toBe(true);
    expect(replaysExactly(game, rt)).toBe(true);
  });

  it("stale timers do nothing", () => {
    const { rt, state } = start(game, 2, quiet, 4);
    const before = JSON.stringify(state());
    rt.fireTimer("next"); // not in a reveal
    rt.fireTimer("nonsense");
    expect(JSON.stringify(state())).toBe(before);
  });
});

describe("players leaving (logs from before games-service D-159, E-016)", () => {
  it("restarts the round with fresh cups, without the leaver", () => {
    const { rt, state } = start(game, 4, quiet, 6);
    rt.state = position(state(), {}, 0);
    rt.submit(0, bid(2, 3), "human");
    expect(rt.seatLeft(2)).toBe(false);
    const s = state() as State;
    expect(s.players[2]).toMatchObject({ out: true, dice: [] });
    expect(s).toMatchObject({ round: 1, bid: null, bids: [], turn: 3, phase: "bidding" });
    expect(totalDice(s)).toBe(15);
  });

  it("passes the turn on if the leaver was on turn", () => {
    const { rt, state } = start(game, 4, quiet, 6);
    rt.state = position(state(), {}, 3);
    rt.seatLeft(3);
    expect(state().turn).toBe(2);
  });

  it("ends with the last player standing as the winner", () => {
    const { rt, state } = start(game, 2, quiet, 6);
    rt.seatLeft(0);
    expect(state()).toMatchObject({ phase: "over", winner: 1 });
    expect(rt.over).toBe(true);
    expect(rt.summary!.text).toMatch(/^Ben wins with five dice left after one round\.$/); // Ann left, she didn't lose
  });

  it("during the reveal, the next round goes on without the leaver", () => {
    const { rt, state, clock } = start(game, 3, quiet, 6);
    rt.state = position(state(), { 0: [2, 2, 2, 2, 2], 1: [3, 3, 3, 3, 3], 2: [4, 4, 4, 4, 4] }, 0);
    rt.submit(0, bid(20, 6), "human");
    rt.state = position(state(), { 0: [2, 2, 2, 2, 2], 1: [3, 3, 3, 3, 3], 2: [4, 4, 4, 4, 4] }, 1, { seat: 0, quantity: 15, face: 6 });
    rt.submit(1, liar, "human"); // seat 0 loses
    rt.seatLeft(0);
    clock.advance();
    expect(state()).toMatchObject({ phase: "bidding", round: 2 });
    expect(state().turn).not.toBe(0);
  });

  it("someone leaving twice, or after going out, changes nothing", () => {
    const { rt, state } = start(game, 3, quiet, 6);
    rt.seatLeft(1);
    const once = JSON.stringify(state());
    rt.seatLeft(1);
    expect(JSON.stringify(state())).toBe(once);
  });
});

describe("privacy", () => {
  it("a phone sees only its own cup while bidding", () => {
    const { rt, state } = start(game, 3, quiet, 7);
    for (const seat of [0, 1, 2]) {
      const v = rt.view(seat) as any;
      expect(v.myDice).toEqual(state().players[seat].dice);
      const others = [0, 1, 2].filter((x) => x !== seat).map((x) => state().players[x].dice);
      const text = JSON.stringify({ ...v, myDice: undefined });
      // No other cup appears anywhere in the view, as an array.
      for (const cup of others) expect(text).not.toContain(JSON.stringify(cup));
      expect(v.players.map((p: { dice: number }) => p.dice)).toEqual([5, 5, 5]);
    }
  });

  it("the board never shows a cup while bidding", () => {
    const { rt } = start(game, 4, quiet, 7);
    const b = rt.boardView() as any;
    expect(b.myDice).toBeUndefined();
    expect(b.reveal).toBeNull();
    expect(JSON.stringify(b)).not.toMatch(/"dice":\[/);
  });

  it("everyone sees every cup in the reveal", () => {
    const { rt, state } = start(game, 2, quiet, 7);
    rt.submit(state().turn, bid(1, 2), "human");
    rt.submit(state().turn, liar, "human");
    const cups = state().reveal.cups;
    expect((rt.boardView() as any).reveal.cups).toEqual(cups);
    expect((rt.view(0) as any).reveal.cups).toEqual(cups);
  });

  it("an out player sees no cup and is never on turn", () => {
    const { rt, state, clock } = start(game, 3, quiet, 7);
    rt.state = position(state(), { 0: [6], 1: [2, 2], 2: [2, 2] }, 0);
    rt.submit(0, bid(5, 6), "human");
    rt.submit(state().turn, liar, "human");
    clock.advance();
    const v = rt.view(0) as any;
    expect(v).toMatchObject({ out: true, myDice: [], myTurn: false });
  });
});

describe("AI", () => {
  const rnd = () => 0.5;

  it("calls a bid far above what it can expect", () => {
    expect(chooseMove([2, 3, 4, 5, 6], { seat: 1, quantity: 9, face: 6 }, 10, true, "cautious", rnd)).toEqual({ name: "liar" });
  });

  it("raises on the face it holds most", () => {
    const m = chooseMove([5, 5, 5, 2, 3], { seat: 1, quantity: 2, face: 4 }, 10, true, "cautious", rnd);
    expect(m).toEqual({ name: "bid", payload: { quantity: 2, face: 5 } });
  });

  it("counts its wild ones", () => {
    const m = chooseMove([1, 1, 6, 2, 3], { seat: 1, quantity: 3, face: 2 }, 10, true, "cautious", rnd) as any;
    expect(m.name).toBe("bid");
    expect(m.payload.face).toBe(6);
  });

  it("opens with a modest bid it can back", () => {
    const m = chooseMove([4, 4, 2, 3, 6], null, 10, true, "cautious", rnd) as any;
    expect(m.name).toBe("bid");
    expect(m.payload.face).toBe(4);
    expect(m.payload.quantity).toBeGreaterThanOrEqual(1);
    expect(m.payload.quantity).toBeLessThanOrEqual(3);
  });

  it("is bolder when bold", () => {
    const bidAt = { seat: 1, quantity: 4, face: 6 as Face }; // it expects 2.7 sixes: cautious calls, bold raises
    expect(chooseMove([2, 3, 4, 5, 6], bidAt, 10, true, "cautious", rnd)).toEqual({ name: "liar" });
    expect(chooseMove([2, 3, 4, 5, 6], bidAt, 10, true, "bold", rnd).name).toBe("bid");
  });

  it("never makes an illegal move, whatever the cup and bid", () => {
    const { manifest } = game;
    expect(manifest.ai.supported).toBe(true);
    let n = 0;
    for (let seed = 1; seed <= 400; seed++) {
      let x = seed;
      const r = () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
      const mine = Array.from({ length: 1 + Math.floor(r() * 5) }, () => (1 + Math.floor(r() * 6)) as Face);
      const total = mine.length + Math.floor(r() * 25);
      const onesWild = r() < 0.5;
      const faces = biddableFaces(onesWild);
      const b = r() < 0.2 ? null : { seat: 9, quantity: 1 + Math.floor(r() * total), face: faces[Math.floor(r() * faces.length)] };
      for (const style of ["cautious", "bold"] as const) {
        const m = chooseMove(mine, b, total, onesWild, style, r) as any;
        if (m.name === "liar") expect(b).not.toBeNull();
        else {
          expect(faces).toContain(m.payload.face);
          expect(m.payload.quantity).toBeLessThanOrEqual(total);
          expect(isRaise(b, m.payload.quantity, m.payload.face)).toBe(true);
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(100);
  });

  it("waits when it is not its turn", () => {
    const { rt, state } = start(game, 2, quiet, 3);
    const other = state().turn === 0 ? 1 : 0;
    expect(rt.aiIntent(other, () => 0.5)).toBeNull();
    expect(rt.aiIntent(state().turn, () => 0.5)).not.toBeNull();
  });
});

describe("whole games", () => {
  /** Play a game with AI moves for every seat until it ends. */
  function playOut(n: number, settings: Record<string, unknown>, seed: number, styles: string[] = []) {
    const aiOptions = Object.fromEntries(Array.from({ length: n }, (_, i) => [i, { style: styles[i % (styles.length || 1)] ?? "cautious" }]));
    const g = start(game, n, settings, seed, { aiOptions });
    let x = seed;
    const r = () => ((x = (x * 48271) % 2147483647) / 2147483647);
    let steps = 0;
    while (!g.rt.over && steps++ < 20000) {
      const s = g.state() as State;
      if (s.phase === "bidding") {
        const intent = g.rt.aiIntent(s.turn, r);
        expect(intent).not.toBeNull();
        expect(g.rt.submit(s.turn, intent!, "ai")).toEqual({ ok: true });
      } else g.clock.advance();
    }
    return g;
  }

  for (const n of [2, 3, 4, 5, 6]) {
    it(`${n} AI players finish, lose exactly one die per round, and replay exactly`, () => {
      for (const seed of [1, 2, 3]) {
        const { rt, state } = playOut(n, { turnSeconds: 30, revealSeconds: 3, startDice: 3 }, seed * 31 + n, ["cautious", "bold"]);
        expect(rt.over).toBe(true);
        const s = state() as State;
        // Every round but those cut short costs exactly one die: dice left + rounds lost = dice at the start.
        const lost = Object.values(s.players).reduce((a, p) => a + p.roundsLost, 0);
        const left = Object.values(s.players).reduce((a, p) => a + p.dice.length, 0);
        expect(lost + left).toBe(n * 3);
        expect(lost).toBe(s.round);
        expect(s.winner).not.toBeNull();
        expect(s.players[s.winner!].dice.length).toBeGreaterThan(0);
        expect(Object.values(s.players).filter((p) => !p.out)).toHaveLength(1);
        expect(replaysExactly(game, rt)).toBe(true);
      }
    });
  }

  it("works with wild ones off and the largest cups", () => {
    const { rt } = playOut(4, { onesWild: false, startDice: 6, turnSeconds: 0, revealSeconds: 2 }, 77);
    expect(rt.over).toBe(true);
    expect(replaysExactly(game, rt)).toBe(true);
  });

  it("a bold player beats a cautious one less often than a coin flip would suggest, or more: both win sometimes", () => {
    const wins = { cautious: 0, bold: 0 };
    for (let seed = 1; seed <= 60; seed++) {
      const { state } = playOut(2, { startDice: 3, turnSeconds: 0, revealSeconds: 2 }, seed, ["cautious", "bold"]);
      wins[state().winner === 0 ? "cautious" : "bold"]++;
    }
    expect(wins.cautious).toBeGreaterThan(5);
    expect(wins.bold).toBeGreaterThan(5);
  });
});
