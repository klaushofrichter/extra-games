// Mexican Train (E-020): dealing, legal plays, markers, doubles, drawing, blocked rounds, scoring, the two options
// (opening run, double blank 50), privacy, the turn timer, seats changing hands, the AI, whole games that replay
// exactly at every player count, and the board's layout (every tile inside the play area, no two trains overlapping).
// Everything runs on games-service's own runtime (tests/harness.ts).
import { beforeAll, describe, expect, it } from "vitest";
import { chooseMove, engineOf, handSize, legalMoves, longestChain, openEnd, pips, type State, type Tile } from "../games/mexican-train/rules.ts";
// @ts-ignore: a plain browser module of the game, with no types
import { FIELD, HALF, layout, MAX_SCALE, MIN_SCALE } from "../games/mexican-train/assets/layout.js";
// @ts-ignore: a plain browser module of the game, with no types
import { tileSvg } from "../games/mexican-train/assets/tiles.js";
import { loadGame, replaysExactly, seats, start, type Game } from "./harness.ts";

let game: Game;
beforeAll(async () => {
  game = await loadGame("mexican-train");
});

const quiet = { turnSeconds: 0, openingRun: false };
const play = (tile: Tile, train: string) => ({ name: "play", payload: { tile, train } });

/** Put chosen hands, trains and a turn into a running game (the log no longer replays after this). */
function position(st: State, o: { hands?: Record<number, Tile[]>; trains?: Record<string, Tile[]>; markers?: string[]; turn?: number; boneyard?: Tile[]; pending?: string | null }): State {
  const players = Object.fromEntries(Object.entries(st.players).map(([k, p]) => [k, { ...p, hand: o.hands?.[Number(k)] ?? p.hand }]));
  const trains = Object.fromEntries(Object.entries(st.trains).map(([id, t]) => [id, { ...t, tiles: (o.trains?.[id] ?? t.tiles) as [number, number][], marker: id === "m" || (o.markers ?? []).includes(id) }]));
  return { ...st, players, trains, turn: o.turn ?? st.turn, boneyard: o.boneyard ?? st.boneyard, pending: o.pending ?? null, drew: false, turnPlays: 0 };
}

/** Play AI moves (and fire timers between rounds) until the game ends. */
function playOut(rt: any, clock: any, style: "planner" | "steady" = "planner") {
  for (let guard = 0; !rt.over && guard < 40000; guard++) {
    const st = rt.state as State;
    if (st.phase !== "playing") {
      clock.advance();
      continue;
    }
    const m = chooseMove(rt.view(st.turn), style);
    if (!m) throw new Error("the AI found no move");
    const r = rt.submit(st.turn, m, "ai");
    if (r && r.ok === false) throw new Error(`the AI's move was refused: ${r.reason}`);
  }
}

describe("dealing", () => {
  it("deals 15, 12 or 10 tiles by player count, and the rest is the boneyard", () => {
    for (const [n, size] of [[2, 15], [4, 15], [5, 12], [6, 12], [7, 10], [8, 10]] as const) {
      expect(handSize(n)).toBe(size);
      const { state }: any = start(game, n, quiet);
      const s: State = state();
      for (const seat of s.order) expect(s.players[seat].hand).toHaveLength(size);
      // 91 tiles in a double-twelve set, the engine in the middle.
      expect(n * size + s.boneyard.length).toBe(90);
      const all = [...s.boneyard, ...s.order.flatMap((x) => s.players[x].hand)].map(([a, b]) => `${Math.min(a, b)}|${Math.max(a, b)}`);
      expect(new Set(all).size).toBe(90);
      expect(all).not.toContain("12|12");
    }
  });

  it("counts the engine down from double twelve, a round at a time", () => {
    expect([1, 2, 13].map(engineOf)).toEqual([12, 11, 0]);
    const { state }: any = start(game, 3, quiet);
    expect(state().engine).toBe(12);
    expect(Object.keys(state().trains).sort()).toEqual(["0", "1", "2", "m"]);
  });
});

describe("a turn", () => {
  it("plays on your own train, the Mexican train or a marked one, and nowhere else", () => {
    const { rt, state }: any = start(game, 3, quiet);
    rt.state = position(state(), { hands: { 0: [[12, 5], [12, 3], [12, 1], [4, 4]] }, markers: ["2"], turn: 0 });
    expect(legalMoves(state(), 0, state().players[0].hand).map((m) => m.train).sort()).toEqual(["0", "0", "0", "2", "2", "2", "m", "m", "m"]);
    expect(rt.submit(0, play([12, 5], "1"), "human")).toMatchObject({ ok: false, reason: "That train isn't open to you." });
    expect(rt.submit(0, play([4, 4], "0"), "human")).toMatchObject({ ok: false, reason: "That tile doesn't match the 12 at the end of the train." });
    expect(rt.submit(1, play([12, 5], "0"), "human")).toMatchObject({ ok: false, reason: expect.stringMatching(/turn/) });
    rt.submit(0, play([5, 12], "m"), "human");
    expect(state().trains.m.tiles).toEqual([[12, 5]]); // turned so 12 meets the engine
    expect(openEnd(state().trains.m, 12)).toBe(5);
    expect(state().turn).toBe(state().order[1]); // around the table: south, east, north, west
  });

  it("refuses a draw while a tile fits, and after drawing a tile that doesn't fit, passes with a marker", () => {
    const { rt, state }: any = start(game, 2, quiet);
    rt.state = position(state(), { hands: { 0: [[12, 5], [1, 1]], 1: [[1, 2]] }, turn: 0, boneyard: [[3, 4], [12, 6]] });
    expect(rt.submit(0, { name: "draw" }, "human")).toMatchObject({ ok: false, reason: "You can play a tile, so you can't draw." });
    rt.submit(0, play([12, 5], "0"), "human");
    rt.submit(1, { name: "draw" }, "human");
    expect(state().players[1].hand).toHaveLength(2);
    expect(state().trains["1"].marker).toBe(true);
    expect(state().turn).toBe(0);
  });

  it("a drawn tile that fits must be played", () => {
    const { rt, state }: any = start(game, 2, quiet);
    rt.state = position(state(), { hands: { 0: [[1, 2]] }, turn: 0, boneyard: [[12, 6], [3, 4]] });
    rt.submit(0, { name: "draw" }, "human");
    expect(state().turn).toBe(0);
    expect(rt.submit(0, { name: "draw" }, "human")).toMatchObject({ ok: false, reason: expect.any(String) });
    rt.submit(0, play([12, 6], "0"), "human");
    expect(state().turn).toBe(1);
  });

  it("playing on your own train takes your marker off it", () => {
    const { rt, state }: any = start(game, 2, quiet);
    rt.state = position(state(), { hands: { 0: [[12, 5], [1, 1]] }, markers: ["0"], turn: 0 });
    rt.submit(0, play([12, 5], "0"), "human");
    expect(state().trains["0"].marker).toBe(false);
  });
});

describe("doubles", () => {
  it("its player plays again, and the double must be covered before anything else", () => {
    const { rt, state }: any = start(game, 2, quiet);
    rt.state = position(state(), { hands: { 0: [[12, 7], [7, 7], [7, 3], [12, 1]] }, turn: 0, trains: { "0": [[12, 7]] } });
    rt.submit(0, play([7, 7], "0"), "human");
    expect(state().turn).toBe(0);
    expect(state().pending).toBe("0");
    expect(rt.submit(0, play([12, 1], "m"), "human")).toMatchObject({ ok: false, reason: "Cover the double first." });
    rt.submit(0, play([7, 3], "0"), "human");
    expect(state().pending).toBe(null);
    expect(state().turn).toBe(1);
  });

  it("a double nobody can cover passes round the table, each player drawing and taking a marker", () => {
    const { rt, state }: any = start(game, 2, quiet);
    rt.state = position(state(), { hands: { 0: [[7, 7], [1, 2]], 1: [[3, 4]] }, trains: { "0": [[12, 7]] }, turn: 0, boneyard: [[5, 6], [8, 9]] });
    rt.submit(0, play([7, 7], "0"), "human");
    rt.submit(0, { name: "draw" }, "human"); // 5|6 doesn't cover it
    expect(state().trains["0"].marker).toBe(true);
    expect(state().turn).toBe(1);
    expect(legalMoves(state(), 1, [[12, 3]]).length).toBe(0); // only the double may be played on
    rt.submit(1, { name: "draw" }, "human");
    expect(state().trains["1"].marker).toBe(true);
  });
});

describe("the end of a round", () => {
  it("ends when someone plays their last tile; everyone scores the pips in their hand", () => {
    const { rt, state }: any = start(game, 2, { ...quiet, rounds: 2 });
    rt.state = position(state(), { hands: { 0: [[12, 5]], 1: [[6, 6], [0, 3]] }, turn: 0 });
    rt.submit(0, play([12, 5], "0"), "human");
    expect(state().phase).toBe("roundOver");
    expect(state().results[0]).toMatchObject({ round: 1, engine: 12, out: 0, scores: { 0: 0, 1: 15 } });
    expect(state().players[1].total).toBe(15);
  });

  it("is blocked when nothing is left to draw and nobody can play", () => {
    const { rt, state }: any = start(game, 2, { ...quiet, rounds: 1 });
    rt.state = position(state(), { hands: { 0: [[12, 5], [1, 2]], 1: [[3, 4]] }, turn: 0, boneyard: [] });
    rt.submit(0, play([12, 5], "0"), "human");
    expect(state().phase).toBe("over");
    expect(state().results[0].out).toBe(null);
    expect(state().winners).toEqual([0]);
  });

  it("deals the next round from the next lower double when the pause is over", () => {
    const { rt, clock, state }: any = start(game, 2, { ...quiet, rounds: 3, roundSeconds: 5 });
    rt.state = position(state(), { hands: { 0: [[12, 5]] }, turn: 0 });
    rt.submit(0, play([12, 5], "0"), "human");
    clock.advance();
    expect(state().round).toBe(2);
    expect(state().engine).toBe(11);
    expect(state().turn).toBe(state().order[1]); // turns start one seat further each round
  });

  it("with Double blank counts 50 points, a double blank left in a hand scores 50", () => {
    expect(pips([[0, 0], [1, 2]])).toBe(3);
    expect(pips([[0, 0], [1, 2]], true)).toBe(53);
    const { rt, state }: any = start(game, 2, { ...quiet, blank50: true, rounds: 1 });
    rt.state = position(state(), { hands: { 0: [[12, 5]], 1: [[0, 0], [1, 1]] }, turn: 0 });
    rt.submit(0, play([12, 5], "0"), "human");
    expect(state().players[1].total).toBe(52);
  });
});

describe("the opening run", () => {
  it("in your first turn of a round, tiles on your own train keep the turn until Done", () => {
    const { rt, state }: any = start(game, 2, { turnSeconds: 0, openingRun: true });
    rt.state = position(state(), { hands: { 0: [[12, 5], [5, 3], [3, 9], [9, 1], [12, 1]], 1: [[12, 8], [2, 2]] }, turn: 0 });
    rt.submit(0, play([12, 5], "0"), "human");
    expect(state().turn).toBe(0);
    expect(rt.view(0).inRun).toBe(true);
    // During the run only your own train counts.
    expect(rt.submit(0, play([12, 1], "m"), "human")).toMatchObject({ ok: false, reason: "That train isn't open to you." });
    rt.submit(0, play([5, 3], "0"), "human");
    rt.submit(0, { name: "done" }, "human");
    expect(state().turn).toBe(1);
    expect(state().trains["0"].tiles).toHaveLength(2);
    // Once a round: on their next turn a tile on their own train ends the turn, though 9|1 would fit after it.
    rt.submit(1, play([12, 8], "1"), "human");
    rt.submit(0, play([3, 9], "0"), "human");
    expect(state().turn).toBe(1);
  });

  it("ends by itself when nothing more fits your train; a first tile elsewhere is a normal turn", () => {
    const { rt, state }: any = start(game, 2, { turnSeconds: 0, openingRun: true });
    rt.state = position(state(), { hands: { 0: [[12, 5], [1, 2], [12, 4]], 1: [[12, 9], [9, 8]] }, turn: 0 });
    rt.submit(0, play([12, 5], "0"), "human");
    expect(state().turn).toBe(1);
    rt.submit(1, play([12, 9], "m"), "human");
    expect(state().turn).toBe(0);
  });

  it("Done is refused outside a run", () => {
    const { rt }: any = start(game, 2, { turnSeconds: 0, openingRun: true });
    expect(rt.submit(rt.state.turn, { name: "done" }, "human")).toMatchObject({ ok: false, reason: expect.stringMatching(/opening run/) });
  });
});

describe("privacy", () => {
  it("a phone sees only its own tiles, and the board sees no hand and no boneyard", () => {
    const { rt, state }: any = start(game, 4, quiet);
    const s = state();
    for (const seat of s.order) {
      const v = JSON.stringify(rt.view(seat));
      // Every tile is unique and no train has a tile yet, so another player's tile must not appear anywhere.
      for (const other of s.order.filter((x: number) => x !== seat)) for (const t of s.players[other].hand) expect(v).not.toContain(JSON.stringify(t));
      expect(rt.view(seat).hand).toEqual(s.players[seat].hand);
      expect(v).not.toContain('"boneyard":[');
    }
    const board = rt.boardView() as any;
    expect(JSON.stringify(board)).not.toContain('"hand"');
    expect(typeof board.boneyard).toBe("number");
    expect(board.players[0]).toEqual({ seat: board.players[0].seat, name: expect.any(String), tiles: 15, total: 0, roundScores: [] });
  });
});

describe("the turn timer", () => {
  it("plays a tile that fits for a slow player, or draws, or ends their run", () => {
    const { rt, clock, state }: any = start(game, 2, { turnSeconds: 10, openingRun: true });
    rt.state = position(state(), { hands: { 0: [[12, 5], [1, 2]], 1: [[3, 4]] }, turn: 0, boneyard: [[8, 9], [6, 7]] });
    rt.submit(0, play([12, 5], "0"), "human"); // the run goes on; nothing more fits, so it ends at once
    expect(state().turn).toBe(1);
    clock.advance(); // player 1 can't play: the table draws for them, and they pass
    expect(state().players[1].hand).toHaveLength(2);
    expect(state().turn).toBe(0);
  });
});

describe("seats changing hands", () => {
  it("keeps the hand and score, and uses the new name", () => {
    const { rt, state }: any = start(game, 3, quiet);
    const hand = state().players[1].hand;
    rt.seatChanged({ seat: 1, playerId: "x", name: "Zoe", kind: "ai", edge: "north" });
    expect(state().players[1]).toMatchObject({ name: "Zoe", hand });
  });
});

describe("the AI", () => {
  it("waits when it isn't its turn, draws when nothing fits and covers a double", () => {
    const { rt, state }: any = start(game, 2, quiet);
    const off = state().order.find((x: number) => x !== state().turn)!;
    expect(chooseMove(rt.view(off), "planner")).toBe(null);
    rt.state = position(state(), { hands: { 0: [[1, 2]] }, turn: 0 });
    expect(chooseMove(rt.view(0), "planner")).toEqual({ name: "draw" });
    rt.state = position(state(), { hands: { 0: [[7, 3], [12, 1]] }, trains: { "0": [[12, 7], [7, 7]] }, pending: "0", turn: 0 });
    expect(chooseMove(rt.view(0), "steady")).toEqual({ name: "play", payload: { tile: [7, 3], train: "0" } });
  });

  it("the planner keeps its longest chain for its own train", () => {
    expect(longestChain([[12, 5], [5, 3], [3, 9], [12, 1]], 12).length).toBe(3);
    const { rt, state }: any = start(game, 2, quiet);
    rt.state = position(state(), { hands: { 0: [[12, 5], [5, 3], [3, 9], [12, 1]] }, turn: 0 });
    // 12|5 starts its chain of three on its own train; the steady style would rather play heavy tiles first.
    expect((chooseMove(rt.view(0), "planner") as any).payload).toEqual({ tile: [12, 5], train: "0" });
  });
});

describe("whole games", () => {
  it("finish and replay exactly at every player count, with both AI styles and both options", () => {
    for (let n = 2; n <= 8; n++) {
      const { rt, clock }: any = start(game, n, { turnSeconds: 0, rounds: 4, openingRun: n % 2 === 0, blank50: n % 3 === 0 }, n * 7);
      playOut(rt, clock, n % 2 ? "steady" : "planner");
      expect(rt.over, `${n} players`).toBeTruthy();
      expect(replaysExactly(game, rt), `${n} players`).toBe(true);
    }
  });

  it("sums up: the winner with the fewest points, a table and awards", () => {
    const { rt, clock }: any = start(game, 4, { turnSeconds: 0, rounds: 3 }, 5);
    playOut(rt, clock);
    const sum = game.def.isOver(rt.state) as any;
    expect(sum.text).toMatch(/wins? with \d+ points? after three rounds\./);
    expect(sum.table.columns[0]).toBe("Player");
    expect(sum.table.rows.map((r: any[]) => r[1])).toEqual([...sum.table.rows.map((r: any[]) => r[1])].sort((a, b) => a - b));
    expect(sum.highlights.trainLengths).toHaveLength(3);
    for (const a of sum.awards) expect(a.seats.length).toBeLessThan(4);
  });

  it("describes every step for the Game Viewer", () => {
    const { rt, clock }: any = start(game, 3, { turnSeconds: 0, rounds: 1 }, 3);
    playOut(rt, clock);
    const text = (rt.log as any[]).filter((r) => r.t === "intent").length;
    expect(text).toBeGreaterThan(10);
    const d = game.def.describe!({ kind: "intent", seat: 0, intent: { name: "draw" }, by: "human", accepted: true, events: [{ name: "drew", data: { seat: 0 } }], names: { 0: "Ann" }, before: rt.state, after: rt.state } as any);
    expect(d?.text).toBe("draws a tile.");
  });
});

// ---------- the board's layout ----------

/** Seat positions as the platform's board kit places them (board-kit.js, seatPositions). */
function seatAtFor(n: number) {
  const edges = seats(n).map((s) => s.edge!);
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
  return (seat: number) => pos[seat];
}

describe("the board's layout", () => {
  it("keeps every tile inside the play area, trains apart, and the scale within its bounds, all through real games", () => {
    for (const n of [2, 4, 6, 8]) {
      const { rt, clock }: any = start(game, n, { turnSeconds: 0, rounds: 13 }, 100 + n);
      const seatAt = seatAtFor(n);
      let checked = 0;
      for (let guard = 0; !rt.over && guard < 40000; guard++) {
        const st = rt.state as State;
        if (st.phase !== "playing") {
          clock.advance();
          continue;
        }
        if (guard % 7 === 0) {
          const view = rt.boardView() as any;
          const lay = layout(view.trains, seatAt);
          expect(lay.scale).toBeGreaterThanOrEqual(MIN_SCALE);
          expect(lay.scale).toBeLessThanOrEqual(MAX_SCALE);
          const h = HALF * lay.scale;
          const all: { x: number; y: number; id: string }[] = [];
          for (const t of view.trains) {
            const L = lay.trains[t.id];
            expect(L.shown.length, `train ${t.id} with ${t.tiles.length} tiles`).toBe(L.placed.length);
            for (const p of L.placed) {
              expect(p.x).toBeGreaterThanOrEqual(FIELD.x0 - 1);
              expect(p.x).toBeLessThanOrEqual(FIELD.x1 + 1);
              expect(p.y).toBeGreaterThanOrEqual(FIELD.y0 - 1);
              expect(p.y).toBeLessThanOrEqual(FIELD.y1 + 1);
              all.push({ ...p, id: t.id });
            }
          }
          // Tiles of different trains never sit on top of each other.
          for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (all[i].id !== all[j].id) expect(Math.hypot(all[i].x - all[j].x, all[i].y - all[j].y)).toBeGreaterThan(h * 0.9);
          checked++;
        }
        rt.submit(st.turn, chooseMove(rt.view(st.turn), "planner")!, "ai");
      }
      expect(checked).toBeGreaterThan(50);
    }
  });

  it("makes tiles bigger with fewer tiles on the board, and never bigger than the cap", () => {
    const seatAt = seatAtFor(4);
    const empty = ["0", "1", "2", "3"].map((id) => ({ id, owner: Number(id), tiles: [] })).concat([{ id: "m", owner: null as any, tiles: [] }]);
    expect(layout(empty, seatAt).scale).toBe(MAX_SCALE);
    expect(layout(empty, seatAt, 0.8).scale).toBe(0.8);
  });
});

describe("tile faces", () => {
  it("turns digits upright whichever way a tile lies (E-022)", () => {
    // A tile in a row running right to left lies at 180°: its digits turn 180° back.
    expect(tileSvg(3, 12, 38, { faces: "numbers", upright: -180 })).toContain('transform="rotate(180)"');
    // Lying the board's way, no turn; a double laid across turns its digits back by its own quarter turn.
    expect(tileSvg(3, 12, 38, { faces: "numbers", upright: 0 })).not.toContain("rotate(");
    expect(tileSvg(5, 5, 38, { faces: "numbers", upright: 0 })).toContain('transform="rotate(270)"');
    // Pips are symmetric and never turn.
    expect(tileSvg(3, 12, 38, { faces: "colour", upright: -180 })).not.toContain("rotate(");
  });
});
