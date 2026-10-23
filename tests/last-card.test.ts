// Last Card (E-023): the deck, the deal, what fits, the special cards, drawing and keeping, reshuffling, "Last card!",
// scoring and the end, privacy, the turn timer, seats changing hands, the AI, the Game Viewer, and whole games that
// replay exactly at every player count. Everything runs on games-service's own runtime (tests/harness.ts).
import { beforeAll, describe, expect, it } from "vitest";
import { chooseMove, fits, fullDeck, points, type Card, type Color, type Discard, type State } from "../games/last-card/rules.ts";
// @ts-ignore: a plain browser module of the game, with no types
import { cardBack, cardFace } from "../games/last-card/assets/cards.js";
// @ts-ignore: a plain browser module of the game, with no types
import { clockwise, upsideDownAmbiguous } from "../games/last-card/assets/table.js";
import { loadGame, replaysExactly, seats, start, type Game } from "./harness.ts";

let game: Game;
beforeAll(async () => {
  game = await loadGame("last-card");
});

const quiet = { turnSeconds: 0, roundSeconds: 2 };
let nextId = 1000;
const card = (c: Card["c"], k: Card["k"]): Card => ({ id: nextId++, c, k });
const onPile = (c: Card, color?: Color): Discard => ({ ...c, color: color ?? (c.c as Color), angle: 0, dx: 0, dy: 0, seat: null });
const playIt = (c: Card, color?: Color) => ({ name: "play", payload: { id: c.id, ...(color ? { color } : {}) } });

/** Put chosen hands, a top card and a turn into a running game (the log no longer replays after this). */
function position(st: State, o: { hands?: Record<number, Card[]>; top?: Card; color?: Color; turn?: number; drawPile?: Card[]; dir?: 1 | -1 }): State {
  const players = Object.fromEntries(Object.entries(st.players).map(([k, p]) => [k, { ...p, hand: o.hands?.[Number(k)] ?? p.hand }]));
  const discard = o.top ? [onPile(o.top, o.color)] : st.discard;
  return { ...st, players, discard, color: o.color ?? (o.top ? (o.top.c as Color) : st.color), turn: o.turn ?? st.turn, drawPile: o.drawPile ?? st.drawPile, dir: o.dir ?? st.dir, drewId: null };
}

/** Play AI moves (and fire timers between rounds) until the game ends. */
function playOut(rt: any, clock: any) {
  for (let guard = 0; !rt.over && guard < 60000; guard++) {
    const st = rt.state as State;
    if (st.phase !== "playing") {
      clock.advance();
      continue;
    }
    const m = chooseMove(rt.view(st.turn));
    if (!m) throw new Error("the AI found no move");
    const r = rt.submit(st.turn, m, "ai");
    if (r && r.ok === false) throw new Error(`the AI's move was refused: ${r.reason}`);
  }
}

describe("the cards", () => {
  it("has 108: per colour one 0, two of each 1–9, Skip, Reverse and Draw Two; four Wilds and four Wild Draw Fours", () => {
    const d = fullDeck();
    expect(d).toHaveLength(108);
    expect(new Set(d.map((c) => c.id)).size).toBe(108);
    for (const c of ["r", "y", "g", "b"] as const) {
      expect(d.filter((x) => x.c === c)).toHaveLength(25);
      expect(d.filter((x) => x.c === c && x.k === "0")).toHaveLength(1);
      expect(d.filter((x) => x.c === c && x.k === "7")).toHaveLength(2);
      expect(d.filter((x) => x.c === c && x.k === "+2")).toHaveLength(2);
    }
    expect(d.filter((x) => x.k === "wild")).toHaveLength(4);
    expect(d.filter((x) => x.k === "+4")).toHaveLength(4);
  });

  it("scores numbers by value, actions 20 and wilds 50", () => {
    expect([points({ k: "7" }), points({ k: "0" }), points({ k: "skip" }), points({ k: "+2" }), points({ k: "wild" }), points({ k: "+4" })]).toEqual([7, 0, 20, 20, 50, 50]);
  });

  it("fits on the colour to play, the same number or symbol, or anything for a wild", () => {
    const top = { k: "7" as const };
    expect(fits({ c: "r", k: "3" }, top, "r")).toBe(true);
    expect(fits({ c: "b", k: "7" }, top, "r")).toBe(true);
    expect(fits({ c: "b", k: "3" }, top, "r")).toBe(false);
    expect(fits({ c: "w", k: "+4" }, top, "r")).toBe(true);
    // On a wild, only the colour it called counts.
    expect(fits({ c: "b", k: "5" }, { k: "wild" }, "b")).toBe(true);
    expect(fits({ c: "g", k: "5" }, { k: "wild" }, "b")).toBe(false);
    expect(fits({ c: "w", k: "wild" }, { k: "wild" }, "b")).toBe(true);
  });

  it("draws every card face and the back as an SVG", () => {
    for (const c of fullDeck()) expect(cardFace(c, 76, 114)).toMatch(/^<svg[\s\S]*<\/svg>$/);
    expect(cardBack(76, 114)).toContain("LAST CARD");
  });
});

describe("dealing", () => {
  it("deals seven cards each and starts the pile with a number card", () => {
    for (let n = 2; n <= 8; n++) {
      for (let seed = 1; seed <= 5; seed++) {
        const { state }: any = start(game, n, quiet, seed);
        const s: State = state();
        for (const seat of s.order) expect(s.players[seat].hand).toHaveLength(7);
        expect(s.discard).toHaveLength(1);
        expect(s.discard[0].k).toMatch(/^\d$/);
        expect(s.color).toBe(s.discard[0].c);
        expect(n * 7 + 1 + s.drawPile.length).toBe(108);
      }
    }
  });
});

describe("a turn", () => {
  it("plays a card that fits, refuses one that doesn't, and only on your turn", () => {
    const { rt, state }: any = start(game, 3, quiet);
    const red5 = card("r", "5"), blue7 = card("b", "7"), green2 = card("g", "2");
    rt.state = position(state(), { hands: { 0: [red5, blue7, green2] }, top: card("r", "7"), turn: 0 });
    expect(rt.view(0).playable.sort()).toEqual([red5.id, blue7.id].sort());
    expect(rt.submit(0, playIt(green2), "human")).toMatchObject({ ok: false, reason: expect.stringMatching(/doesn't match/) });
    expect(rt.submit(1, playIt(red5), "human")).toMatchObject({ ok: false, reason: "Wait for your turn" });
    rt.submit(0, playIt(blue7), "human");
    expect(state().discard.at(-1).id).toBe(blue7.id);
    expect(state().color).toBe("b");
    expect(state().turn).toBe(state().order[1]);
  });

  it("asks a wild card for its colour, and the next player must follow it", () => {
    const { rt, state }: any = start(game, 3, quiet);
    const wild = card("w", "wild");
    const next = state().order[1];
    rt.state = position(state(), { hands: { 0: [wild, card("r", "1")], [next]: [card("g", "4"), card("y", "4")] }, top: card("r", "7"), turn: 0 });
    expect(rt.submit(0, playIt(wild), "human")).toMatchObject({ ok: false, reason: "Pick a colour for the wild card" });
    rt.submit(0, playIt(wild, "g"), "human");
    expect(state().color).toBe("g");
    expect(rt.view(next).playable).toEqual([state().players[next].hand[0].id]);
  });

  it("Skip passes the next player by, Reverse turns the play round, and with two players Reverse skips", () => {
    let { rt, state }: any = start(game, 4, quiet);
    const skip = card("r", "skip");
    rt.state = position(state(), { hands: { 0: [skip, card("r", "1")] }, top: card("r", "7"), turn: 0 });
    rt.submit(0, playIt(skip), "human");
    expect(state().turn).toBe(state().order[2]);

    ({ rt, state } = start(game, 4, quiet) as any);
    const rev = card("r", "rev");
    rt.state = position(state(), { hands: { 0: [rev, card("r", "1")] }, top: card("r", "7"), turn: 0 });
    rt.submit(0, playIt(rev), "human");
    expect(state().dir).toBe(-1);
    expect(state().turn).toBe(state().order[3]);

    ({ rt, state } = start(game, 2, quiet) as any);
    const rev2 = card("r", "rev");
    rt.state = position(state(), { hands: { 0: [rev2, card("r", "1")] }, top: card("r", "7"), turn: 0 });
    rt.submit(0, playIt(rev2), "human");
    expect(state().turn).toBe(0);
  });

  it("Draw Two and Wild Draw Four make the next player draw and miss their turn", () => {
    const { rt, state }: any = start(game, 3, quiet);
    const two = card("r", "+2"), four = card("w", "+4");
    rt.state = position(state(), { hands: { 0: [two, four, card("r", "1")] }, top: card("r", "7"), turn: 0 });
    const next = state().order[1];
    const before = state().players[next].hand.length;
    const r = rt.submit(0, playIt(two), "human");
    expect(state().players[next].hand.length).toBe(before + 2);
    expect(state().turn).toBe(state().order[2]);
    expect(r).not.toMatchObject({ ok: false });
    rt.state = position(state(), { turn: 0 });
    const third = state().order[1];
    const b2 = state().players[third].hand.length;
    rt.submit(0, playIt(four, "y"), "human");
    expect(state().players[third].hand.length).toBe(b2 + 4);
    expect(state().color).toBe("y");
  });
});

describe("drawing", () => {
  it("draws when nothing fits: a card that doesn't fit ends the turn", () => {
    const { rt, state }: any = start(game, 3, quiet);
    rt.state = position(state(), { hands: { 0: [card("g", "2")] }, top: card("r", "7"), turn: 0, drawPile: [card("b", "3")] });
    rt.submit(0, { name: "draw", payload: null }, "human");
    expect(state().players[0].hand).toHaveLength(2);
    expect(state().turn).toBe(state().order[1]);
  });

  it("a drawn card that fits may be played, and only that one, or kept", () => {
    const { rt, state }: any = start(game, 3, quiet);
    const drawn = card("r", "3"), other = card("y", "7");
    rt.state = position(state(), { hands: { 0: [other] }, top: card("r", "7"), turn: 0, drawPile: [drawn] });
    expect(rt.submit(0, { name: "keep", payload: null }, "human")).toMatchObject({ ok: false, reason: "Draw a card first" });
    rt.submit(0, { name: "draw", payload: null }, "human");
    expect(state().turn).toBe(0);
    expect(rt.view(0).playable).toEqual([drawn.id]);
    expect(rt.view(0).canKeep).toBe(true);
    expect(rt.submit(0, playIt(other), "human")).toMatchObject({ ok: false, reason: "Play the card you drew, or keep it" });
    expect(rt.submit(0, { name: "draw", payload: null }, "human")).toMatchObject({ ok: false });
    rt.submit(0, { name: "keep", payload: null }, "human");
    expect(state().turn).toBe(state().order[1]);
    expect(state().players[0].hand).toHaveLength(2);
  });

  it("turns the pile over into a new draw pile when it runs out, keeping the top card", () => {
    const { rt, state }: any = start(game, 3, quiet);
    const s = position(state(), { hands: { 0: [card("g", "2")] }, top: card("r", "7"), turn: 0, drawPile: [] });
    rt.state = { ...s, discard: [onPile(card("b", "1")), onPile(card("y", "2")), ...s.discard] };
    const r = rt.submit(0, { name: "draw", payload: null }, "human");
    expect(r).not.toMatchObject({ ok: false });
    expect(state().discard).toHaveLength(1);
    expect(state().discard[0].k).toBe("7");
    expect(state().drawPile.length + state().players[0].hand.length).toBe(3);
  });
});

describe("the end of a round", () => {
  it('calls "Last card!" at one card, and the first out scores the others\' cards', () => {
    const { rt, state }: any = start(game, 3, { ...quiet, target: 500 });
    const a = card("r", "1"), b = card("r", "2");
    rt.state = position(state(), { hands: { 0: [a, b], 1: [card("w", "wild"), card("b", "9")], 2: [card("g", "skip")] }, top: card("r", "7"), turn: 0 });
    rt.submit(0, playIt(a), "human");
    const events = (rt.log.at(-1) as any).events.map((e: any) => e.name);
    expect(events).toEqual(["played", "lastCard"]);
    rt.state = position(state(), { turn: 0 });
    rt.submit(0, playIt(b), "human");
    expect(state().phase).toBe("roundOver");
    expect(state().results.at(-1)).toMatchObject({ out: 0, scores: { 0: 50 + 9 + 20 } });
    expect(state().players[0].total).toBe(79);
  });

  it("ends the game when someone reaches the target", () => {
    const { rt, state }: any = start(game, 2, { ...quiet, target: 50 });
    const last = card("r", "1");
    rt.state = position(state(), { hands: { 0: [last], 1: [card("w", "wild")] }, top: card("r", "7"), turn: 0 });
    rt.submit(0, playIt(last), "human");
    expect(state().phase).toBe("over");
    expect(state().winners).toEqual([0]);
    expect(rt.over).toBeTruthy();
  });
});

describe("privacy", () => {
  it("a phone sees only its own cards, and the board sees no hand and no draw pile", () => {
    const { rt, state }: any = start(game, 4, quiet);
    const s: State = state();
    for (const seat of s.order) {
      const v = rt.view(seat);
      expect(v.hand).toEqual(s.players[seat].hand);
      for (const other of s.order.filter((x) => x !== seat)) for (const c of s.players[other].hand) expect(JSON.stringify(v)).not.toContain(`"id":${c.id},`);
    }
    const board = JSON.stringify(rt.boardView());
    for (const seat of s.order) for (const c of s.players[seat].hand) expect(board).not.toContain(`"id":${c.id},`);
    for (const c of s.drawPile) expect(board).not.toContain(`"id":${c.id},`);
  });
});

describe("the turn timer", () => {
  it("plays for a slow player, or draws and keeps", () => {
    const { rt, state, clock }: any = start(game, 3, { turnSeconds: 10, roundSeconds: 2 });
    const red = card("r", "4");
    rt.state = position(state(), { hands: { 0: [red, card("g", "1")] }, top: card("r", "7"), turn: 0 });
    clock.advance();
    expect(state().discard.at(-1).id).toBe(red.id);
    expect(state().turn).toBe(state().order[1]);
    // Nothing fits: the table draws for them and keeps the card, and the turn moves on.
    const next = state().turn;
    rt.state = position(state(), { hands: { [next]: [card("g", "1")] }, top: card("r", "7"), turn: next, drawPile: [card("b", "2"), card("r", "9")] });
    clock.advance();
    expect(state().players[next].hand).toHaveLength(2);
    expect(state().turn).not.toBe(next);
  });
});

describe("seats changing hands", () => {
  it("keeps the hand and score, and uses the new name", () => {
    const { rt, state }: any = start(game, 3, quiet);
    const hand = state().players[1].hand;
    const r = game.def.onSeatChanged!(state(), { seat: 1, playerId: "x", name: "Zoe", kind: "human" } as any, {} as any) as any;
    expect(r.state.players[1]).toMatchObject({ name: "Zoe", hand });
    expect(rt).toBeTruthy();
  });
});

describe("the AI", () => {
  it("draws when nothing fits, keeps wilds for later and hits a player who is nearly out", () => {
    const { rt, state }: any = start(game, 3, quiet);
    const wild = card("w", "wild"), red3 = card("r", "3"), two = card("r", "+2");
    rt.state = position(state(), { hands: { 0: [wild, red3] }, top: card("r", "7"), turn: 0 });
    expect(chooseMove(rt.view(0))).toEqual({ name: "play", payload: { id: red3.id } });
    rt.state = position(state(), { hands: { 0: [card("g", "1")] }, top: card("r", "7"), turn: 0 });
    expect(chooseMove(rt.view(0))).toEqual({ name: "draw", payload: null });
    const next = state().order[1];
    rt.state = position(state(), { hands: { 0: [red3, two], [next]: [card("b", "1")] }, top: card("r", "7"), turn: 0 });
    expect(chooseMove(rt.view(0))).toEqual({ name: "play", payload: { id: two.id } });
    expect(chooseMove(rt.view(next))).toBeNull();
  });
});

describe("whole games", () => {
  it("finish and replay exactly at every player count", () => {
    for (let n = 2; n <= 8; n++) {
      const { rt, clock }: any = start(game, n, { ...quiet, target: 150 }, n * 11);
      playOut(rt, clock);
      expect(rt.over, `${n} players`).toBeTruthy();
      expect(replaysExactly(game, rt), `${n} players`).toBe(true);
    }
  });

  it("sums up: the winner, a table by points and awards", () => {
    const { rt, clock }: any = start(game, 4, { ...quiet, target: 150 }, 5);
    playOut(rt, clock);
    const sum = game.def.isOver(rt.state) as any;
    expect(sum.text).toMatch(/wins? with \d+ points? after \w+ rounds?\./);
    expect(sum.table.columns[0]).toBe("Player");
    const pts = sum.table.rows.map((r: any[]) => r[1]);
    expect(pts).toEqual([...pts].sort((a: number, b: number) => b - a));
    expect(sum.awards.length).toBeGreaterThan(0);
  });

  it("hands out awards for the right players, ten kinds in all (E-024)", () => {
    const known = ["out-first", "troublemaker", "wild-one", "piled-on", "last-card", "chameleon", "big-haul", "comeback", "hoarder", "light-fingers"];
    const seen = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const { rt, clock }: any = start(game, 4, { ...quiet, target: 150 }, seed);
      playOut(rt, clock);
      const st: State = rt.state;
      const sum = game.def.isOver(st) as any;
      for (const a of sum.awards) {
        expect(known).toContain(a.id);
        seen.add(a.id);
        const of = (f: (p: any) => number) => a.seats.map((x: number) => f(st.players[x]));
        const all = (f: (p: any) => number) => st.order.map((x) => f(st.players[x]));
        if (a.id === "hoarder") expect(of((p) => p.maxHand)[0]).toBe(Math.max(...all((p) => p.maxHand)));
        if (a.id === "big-haul") expect(of((p) => p.bestRound)[0]).toBe(Math.max(...st.results.flatMap((r) => Object.values(r.scores))));
        if (a.id === "light-fingers") expect(of((p) => p.drawn)[0]).toBe(Math.min(...all((p) => p.drawn)));
        if (a.id === "comeback") for (const x of a.seats) expect(st.players[x].out).toBeGreaterThan(0);
      }
      // The counters behind them add up.
      for (const x of st.order) {
        const p = st.players[x];
        expect(p.maxHand).toBeGreaterThanOrEqual(7);
        expect(p.changes).toBeLessThanOrEqual(p.played);
      }
    }
    for (const id of ["chameleon", "big-haul", "comeback", "hoarder", "light-fingers"]) expect(seen, id).toContain(id);
  });

  it("describes steps for the Game Viewer", () => {
    const { rt, clock }: any = start(game, 3, { ...quiet, target: 50 }, 3);
    playOut(rt, clock);
    const d = game.def.describe!({ kind: "intent", seat: 0, intent: { name: "draw" }, by: "human", accepted: true, events: [], names: { 0: "Ann" }, before: rt.state, after: rt.state } as any);
    expect(d?.text).toBe("draws a card");
  });
});

describe("the board (E-025)", () => {
  it("underlines a hand's number when it reads as another number upside down, as the cards do", () => {
    for (const n of [6, 9, 16, 18, 19, 61, 66, 68, 86, 99]) expect(upsideDownAmbiguous(n), String(n)).toBe(true);
    for (const n of [0, 1, 2, 7, 8, 10, 11, 12, 69, 88, 96]) expect(upsideDownAmbiguous(n), String(n)).toBe(false);
  });

  /** Seat centres as the platform's board kit places them (board-kit.js, seatPositions). */
  function seatsAt(n: number) {
    const edges = seats(n).map((x) => x.edge!);
    const byEdge: Record<string, number[]> = {};
    edges.forEach((e, i) => (byEdge[e] ??= []).push(i));
    const pos: { x: number; y: number }[] = [];
    for (const [edge, list] of Object.entries(byEdge)) {
      list.forEach((seat, k) => {
        if (edge === "south" || edge === "north") {
          let x = (1920 - 1300) / 2 + (1300 * (k + 0.5)) / list.length;
          if (edge === "north") x = 1920 - x;
          pos[seat] = { x, y: edge === "south" ? 1080 - 92 : 92 };
        } else pos[seat] = { x: edge === "east" ? 1920 - 92 : 92, y: 540 };
      });
    }
    return pos;
  }

  it("turns the direction arrows the way play goes: south, east, north, west is counter-clockwise on the board", () => {
    for (let n = 3; n <= 8; n++) {
      const { state }: any = start(game, n, quiet);
      const order = (state() as State).order;
      const pos = seatsAt(n);
      // Play goes from the south edge to the east edge first: right, then up the board.
      expect(pos[order[1]].x, `${n} players`).toBeGreaterThanOrEqual(pos[order[0]].x);
      expect(clockwise(order, pos, 1), `${n} players, normal play`).toBe(false);
      expect(clockwise(order, pos, -1), `${n} players, reversed`).toBe(true);
    }
  });
});
