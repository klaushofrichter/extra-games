// Chess: the move generator against known perft counts, notation, every way a game ends, the clocks on game time,
// draw offers, the stand-in of logs from before games-service D-159, the AI's strength levels, and exact replays.
import { describe, expect, it } from "vitest";
import { Position, START_FEN, perft, uci } from "../games/chess/chess.ts";
import { Engine, level, pickMove } from "../games/chess/engine.ts";
import { clockText, parseTimeControl, positionOf, thinkBudget, type State } from "../games/chess/rules.ts";
import { GameRuntime, VirtualClock, loadGame, replay, seats, settingsWithDefaults, type Game, type SeatInfo } from "./harness.ts";

const game = await loadGame("chess");

/** A clock the test moves by hand; timers only fire when asked. */
class HandClock {
  t = 0;
  private v = new VirtualClock();
  now() {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number) {
    return this.v.setTimeout(fn, ms);
  }
  clearTimeout(h: unknown) {
    this.v.clearTimeout(h);
  }
}

function begin(settings: Record<string, unknown> = {}, o: { seats?: SeatInfo[]; seed?: number } = {}) {
  const clock = new HandClock();
  const rt = new GameRuntime(game.manifest, game.def, o.seed ?? 1, settingsWithDefaults(game.manifest, { whiteSeat: "south", timeControl: "no clock", ...settings }), o.seats ?? seats(2), clock);
  const s = () => rt.state as State;
  const white = () => s().seats[0];
  const black = () => s().seats[1];
  const mv = (u: string, seat = s().seats[s().fen.split(" ")[1] === "b" ? 1 : 0]) => rt.submit(seat, { name: "move", payload: { uci: u } }, "human");
  const line = (moves: string) => moves.split(/\s+/).filter(Boolean).forEach((u) => expect(mv(u), u).toEqual({ ok: true }));
  return { rt, clock, s, white, black, mv, line };
}

function endHash(g: Game, rt: GameRuntime) {
  if (!rt.over) rt.finish("terminated", null);
  return replay(g.manifest, g.def, rt.log) === (rt.log.at(-1) as { stateHash: string }).stateHash;
}

describe("move generation", () => {
  it("matches the standard perft counts", () => {
    expect(perft(Position.fromFen(START_FEN), 4)).toBe(197281);
    expect(perft(Position.fromFen("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1"), 3)).toBe(97862);
    expect(perft(Position.fromFen("8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1"), 4)).toBe(43238);
    expect(perft(Position.fromFen("r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1"), 3)).toBe(9467);
    expect(perft(Position.fromFen("rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8"), 3)).toBe(62379);
  });

  it("make and unmake leave the position, FEN and hash as they were", () => {
    const p = Position.fromFen("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1");
    const fen = p.fen();
    const hash = [p.hashLo, p.hashHi];
    for (const m of p.legal()) {
      p.make(m);
      const after = Position.fromFen(p.fen());
      expect([p.hashLo, p.hashHi], uci(m)).toEqual([after.hashLo, after.hashHi]); // incremental = from scratch
      p.unmake();
    }
    expect(p.fen()).toBe(fen);
    expect([p.hashLo, p.hashHi]).toEqual(hash);
  });

  it("writes standard notation: captures, castling, promotion, disambiguation, check and mate", () => {
    const san = (fen: string, u: string) => {
      const p = Position.fromFen(fen);
      return p.san(p.findUci(u)!);
    };
    expect(san(START_FEN, "g1f3")).toBe("Nf3");
    expect(san("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "e1g1")).toBe("O-O");
    expect(san("r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1", "e8c8")).toBe("O-O-O");
    expect(san("8/P6k/8/8/8/8/8/K7 w - - 0 1", "a7a8q")).toBe("a8=Q");
    expect(san("8/P6k/8/8/8/8/8/K7 w - - 0 1", "a7a8n")).toBe("a8=N");
    expect(san("k7/8/8/8/8/8/8/1N1K1N2 w - - 0 1", "b1d2")).toBe("Nbd2");
    expect(san("k7/8/8/8/8/1N6/8/1N1K4 w - - 0 1", "b1d2")).toBe("N1d2");
    expect(san("rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2", "e4d5")).toBe("exd5");
    expect(san("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", "a1a8")).toBe("Ra8#");
    expect(san("6k1/8/8/8/8/8/8/R5K1 w - - 0 1", "a1a8")).toBe("Ra8+");
    expect(san("rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3", "e5f6")).toBe("exf6");
  });

  it("keeps an en-passant square only when a capture there is possible", () => {
    const p = Position.fromFen(START_FEN);
    p.make(p.findUci("e2e4")!);
    expect(p.fen()).toBe("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1");
    expect(Position.fromFen("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1").fen()).toContain(" - 0 1");
  });
});

describe("a game", () => {
  it("White plays from the seat the settings say, or a random one", () => {
    expect(begin({ whiteSeat: "south" }).s().seats).toEqual([0, 1]);
    expect(begin({ whiteSeat: "north" }).s().seats).toEqual([1, 0]);
    const random = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => begin({ whiteSeat: "random" }, { seed }).s().seats[0]));
    expect(random).toEqual(new Set([0, 1]));
  });

  it("refuses moves out of turn, illegal moves and moves from people not playing", () => {
    const g = begin();
    expect(g.rt.submit(g.black(), { name: "move", payload: { uci: "e7e5" } }, "human")).toEqual({ ok: false, reason: "It's not your turn" });
    expect(g.mv("e2e5")).toEqual({ ok: false, reason: "That move isn't legal" });
    expect(g.mv("e1e2")).toEqual({ ok: false, reason: "That move isn't legal" });
    expect(g.rt.submit(g.white(), { name: "move", payload: "nonsense" }, "human").ok).toBe(false);
    expect(g.rt.submit(5, { name: "move", payload: { uci: "e2e4" } }, "human")).toEqual({ ok: false, reason: "You are not playing in this game" });
    expect(g.rt.submit(g.white(), { name: "move", payload: { from: "e2", to: "e4" } }, "board")).toEqual({ ok: true });
  });

  it("checkmate ends the game with a natural summary and replays exactly", () => {
    const g = begin({}, { seats: [{ seat: 0, playerId: "a", name: "Ann", kind: "human", edge: "south" }, { seat: 1, playerId: "b", name: "Ben", kind: "human", edge: "north" }] });
    g.line("f2f3 e7e5 g2g4 d8h4");
    expect(g.rt.over).toBe(true);
    expect(g.rt.summary!.text).toBe("Ben wins with black by checkmate after two moves.");
    expect(g.rt.summary!.highlights).toMatchObject({ winner: 1, reason: "checkmate", moves: 2, pgnMoves: "f3 e5 g4 Qh4#" });
    // Score, clock, then the statistics window's counts (D-136): captures, material, pawn moves, checks.
    expect(g.rt.summary!.table!.rows).toEqual([["Ann", "White", "0", "–", 0, 0, 2, 0], ["Ben", "Black", "1", "–", 0, 0, 1, 1]]);
    // Fool's mate: White pushed more pawns; Black's queen gave the one check.
    const [white, black] = (g.rt.state as { seats: [number, number] }).seats;
    expect(g.rt.summary!.awards!.map((a) => [a.id, a.seats])).toEqual([["pawn-rush", [white]], ["marathon", [black]], ["check", [black]]]);
    expect(endHash(game, g.rt)).toBe(true);
  });

  it("promotion to any piece, castling both ways, en passant", () => {
    const g = begin();
    g.line("e2e4 a7a6 e4e5 d7d5 e5d6 a6a5 d6c7 a5a4 c7b8n");
    expect(g.s().sans.slice(-5)).toEqual(["exd6", "a5", "dxc7", "a4", "cxb8=N"]);
    expect((g.rt.boardView() as any).pieces.b8).toBe("N");
    g.line("a8a7 g1f3 a7a6 f1e2 a6a7 e1g1");
    expect(g.s().sans.at(-1)).toBe("O-O");
    expect((g.rt.boardView() as any).pieces).toMatchObject({ g1: "K", f1: "R" });
  });

  it("stalemate, threefold repetition and too little material are draws", () => {
    // Threefold: the knights go out and back twice.
    const g = begin();
    g.line("g1f3 g8f6 f3g1 f6g8 g1f3 g8f6 f3g1 f6g8");
    expect(g.rt.summary!.text).toMatch(/^Draw by threefold repetition after four moves\.$/);
    // Stalemate and bare kings, from positions set up directly.
    const stale = begin();
    stale.rt.state = { ...stale.s(), fen: "7k/8/6QK/8/8/8/8/8 w - - 0 60", keys: ["7k/8/6QK/8/8/8/8/8 w - -"] };
    stale.mv("g6f7");
    expect(stale.rt.summary!.text).toMatch(/^Draw by stalemate/);
    const bare = begin();
    bare.rt.state = { ...bare.s(), fen: "8/8/8/7k/3q4/4K3/8/8 w - - 0 60", keys: ["8/8/8/7k/3q4/4K3/8/8 w - -"] };
    bare.mv("e3d4");
    expect(bare.rt.summary!.text).toMatch(/^Draw as neither side can mate/);
    const fifty = begin();
    fifty.rt.state = { ...fifty.s(), fen: "8/8/8/4k3/8/4K3/8/R7 w - - 99 80", keys: ["8/8/8/4k3/8/4K3/8/R7 w - -"] };
    fifty.mv("a1a2");
    expect(fifty.rt.summary!.text).toMatch(/^Draw by the fifty-move rule/);
  });

  it("resignation, and draws by offer: accepted, declined, or declined by moving", () => {
    const r = begin();
    r.line("e2e4 e7e5");
    expect(r.rt.submit(r.black(), { name: "resign" }, "human").ok).toBe(true);
    expect(r.rt.summary!.text).toMatch(/^Ben resigns: Ann wins with white after one move\.$/);

    const d = begin();
    expect(d.rt.submit(d.white(), { name: "offerDraw" }, "human")).toMatchObject({ ok: false });
    d.line("e2e4 e7e5");
    expect(d.rt.submit(d.white(), { name: "offerDraw" }, "human").ok).toBe(true);
    expect(d.rt.submit(d.white(), { name: "acceptDraw" }, "human")).toMatchObject({ ok: false });
    expect(d.rt.submit(d.black(), { name: "declineDraw" }, "human").ok).toBe(true);
    expect(d.s().drawOffer).toBeNull();
    d.line("g1f3");
    expect(d.rt.submit(d.black(), { name: "offerDraw" }, "human").ok).toBe(true);
    d.line("b8c6"); // Black moves on with their own offer standing
    expect(d.s().drawOffer).toBe(d.black());
    d.line("f1c4"); // White moving answers it with no
    expect(d.s().drawOffer).toBeNull();
    expect(d.rt.submit(d.black(), { name: "offerDraw" }, "human").ok).toBe(true);
    expect(d.rt.submit(d.white(), { name: "acceptDraw" }, "human").ok).toBe(true);
    expect(d.rt.summary!.text).toBe("Draw by agreement after three moves.");
    expect(endHash(game, d.rt)).toBe(true);
  });
});

describe("clocks", () => {
  it("parses every time control the settings offer", () => {
    const values = game.manifest.settings.find((x) => x.key === "timeControl")!.values!;
    expect(values.filter((v) => parseTimeControl(v) === null)).toEqual(["no clock"]);
    expect(parseTimeControl("15+10")).toEqual({ base: 900_000, inc: 10_000 });
    expect(clockText(65_000)).toBe("1:05");
    expect(clockText(3_725_000)).toBe("1:02:05");
    expect(clockText(9_340)).toBe("0:09.3");
  });

  it("charges each move's thinking time, adds the increment, and leaves pauses out", () => {
    const g = begin({ timeControl: "3+2" });
    expect(g.s().clock).toMatchObject({ base: 180_000, inc: 2000, left: [180_000, 180_000] });
    expect(g.rt.timerDeadlines()).toEqual({ flag: 180_000 });
    g.clock.t = 5_000;
    g.line("e2e4");
    expect(g.s().clock!.left).toEqual([177_000, 180_000]);
    g.clock.t = 12_000;
    g.rt.pause("cloud");
    g.clock.t = 600_000; // ten minutes away: nobody's clock runs
    g.rt.resume("cloud");
    g.clock.t = 601_000;
    g.line("e7e5");
    expect(g.s().clock!.left).toEqual([177_000, 174_000]); // 7 s + 1 s thinking, +2 s
    expect(g.s().times).toEqual([177_000, 174_000]);
    expect(endHash(game, g.rt)).toBe(true);
  });

  it("the flag falls: the side to move loses, or draws when the other side can't mate", () => {
    const g = begin({ timeControl: "1+0" });
    g.clock.t = 60_000;
    g.rt.fireTimer("flag");
    expect(g.rt.summary!.text).toBe("Ben wins with black on time after no moves.");
    const lone = begin({ timeControl: "1+0" });
    lone.rt.state = { ...lone.s(), fen: "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1", keys: ["4k3/8/8/8/8/8/4P3/4K3 w - -"] };
    lone.clock.t = 60_000;
    lone.rt.fireTimer("flag");
    expect(lone.rt.summary!.text).toMatch(/^Draw as the flag fell but the other side can't mate/);
  });

  it("a timer that fires early waits for the time really left; a move after the flag doesn't count", () => {
    const g = begin({ timeControl: "1+0" });
    g.clock.t = 30_000;
    g.rt.fireTimer("flag");
    expect(g.rt.over).toBe(false);
    g.clock.t = 61_000;
    expect(g.mv("e2e4").ok).toBe(true); // the step runs, and finds White out of time
    expect(g.s().sans).toEqual([]);
    expect(g.rt.summary!.highlights).toMatchObject({ reason: "time", winner: 1 });
  });

  it("the AI thinks for at most a share of its clock", () => {
    const v = { clock: { left: [60_000, 60_000], inc: 0 }, color: 0 } as any;
    expect(thinkBudget(v, 5000)).toBe(2000);
    expect(thinkBudget({ ...v, clock: { left: [600_000, 0], inc: 5000 } }, 5000)).toBe(5000);
    expect(thinkBudget({ ...v, clock: { left: [1000, 0], inc: 0 } }, 5000)).toBe(100);
    expect(thinkBudget({ ...v, clock: null }, 1234)).toBe(1234);
  });
});

describe("a player who leaves (logs from before games-service D-159, E-016)", () => {
  it("is replaced by the stand-in, which plays the same moves in a replay", () => {
    const g = begin({ standInElo: 800 }, { seed: 7 });
    g.line("e2e4");
    g.rt.seatLeft(g.black());
    expect(g.s().standIn).toEqual([1]);
    expect(g.rt.timerDeadlines()).toHaveProperty("standin");
    g.rt.fireTimer("standin");
    expect(g.s().sans).toHaveLength(2);
    g.line("d2d4");
    g.rt.fireTimer("standin");
    expect(g.s().sans).toHaveLength(4);
    expect(endHash(game, g.rt)).toBe(true);
  });

  it("someone who sits down takes over from the stand-in", () => {
    const g = begin();
    g.rt.seatLeft(g.white());
    expect(g.rt.timerDeadlines()).toHaveProperty("standin");
    g.rt.seatJoined({ seat: 0, playerId: "z", name: "Zoe", kind: "human", edge: "south" });
    expect(g.s().standIn).toEqual([]);
    expect(g.rt.timerDeadlines()).not.toHaveProperty("standin");
    expect(g.s().names[0]).toBe("Zoe");
    expect(g.mv("d2d4").ok).toBe(true);
  });

  it("against an AI player too, the stand-in takes the seat and the game plays on (E-010)", () => {
    const g = begin({}, { seats: [{ seat: 0, playerId: "a", name: "Ann", kind: "human", edge: "south" }, { seat: 1, playerId: "b", name: "Mia (AI)", kind: "ai", edge: "north" }] });
    g.line("e2e4 e7e5");
    g.rt.seatLeft(0);
    expect(g.rt.over).toBe(false);
    expect(g.s().standIn).toEqual([0]);
    g.rt.fireTimer("standin");
    expect(g.s().sans).toHaveLength(3);
    expect(endHash(game, g.rt)).toBe(true);
  });

  it("the Game Viewer describes moves, the stand-in's moves and the end", () => {
    const g = begin({ timeControl: "5+3" });
    g.clock.t = 2000;
    g.line("e2e4");
    g.rt.seatLeft(1);
    g.rt.fireTimer("standin");
    const log = g.rt.log;
    const step = (i: number) => {
      const r = log[i] as any;
      return { kind: r.t === "intent" ? "intent" : r.t, seat: r.seat ?? null, intent: r.intent, timer: r.id, accepted: r.accepted ?? true, events: r.events ?? [], names: {} };
    };
    // Rebuild states by replaying prefixes.
    const at = (n: number) => {
      const rt = new GameRuntime(game.manifest, game.def, 1, (log[0] as any).settings, (log[0] as any).seats, new VirtualClock(), { replay: true });
      for (const r of log.slice(1, n)) {
        rt.setReplayTime((r as any).gt);
        if (r.t === "intent") rt.submit(r.seat, r.intent, r.by);
        else if (r.t === "timer") rt.fireTimer(r.id);
        else if (r.t === "seatLeft") rt.seatLeft(r.seat);
      }
      return rt.state as State;
    };
    const d1 = game.def.describe!({ ...step(1), before: at(1), after: at(2) } as any)!;
    expect(d1).toMatchObject({ text: "1. e4", columns: { san: "1. e4", clock: "5:01" } });
    const d2 = game.def.describe!({ ...step(2), kind: "seatLeft", before: at(2), after: at(3) } as any)!;
    expect(d2.text).toMatch(/stand-in \(Elo 1200\) plays on/);
    const d3 = game.def.describe!({ ...step(3), before: at(3), after: at(4) } as any)!;
    expect(d3.text).toMatch(/^Stand-in plays 1… \S+/);
    expect(d3.steps).toEqual([{ seat: 1, text: expect.stringMatching(/^1… /), auto: true }]);
  });
});

describe("the AI", () => {
  const view = (fen: string, extra: Record<string, unknown> = {}) => ({ ...(game.def.view as any)({ ...begin().s(), fen, keys: [fen.split(" ").slice(0, 4).join(" ")], ...extra }, 0) });
  const ctx = () => ({ random: Math.random, randomInt: (a: number, b: number) => a, signal: new AbortController().signal, deadline: Date.now() + 20_000 });

  it("takes a mate in one at every level, and plays only legal moves", async () => {
    for (const elo of [400, 400, 400, 400, 400, 1200, 2200]) {
      const v = view("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1");
      expect(await game.def.ai!(v, 0, ctx(), { elo }), String(elo)).toEqual({ name: "move", payload: { uci: "a1a8" } });
    }
  });

  it("waits when it is not its turn, and answers a draw offer by how it stands", async () => {
    expect(await game.def.ai!(view(START_FEN.replace(" w ", " b ")), 0, ctx(), { elo: 1200 })).toBeNull();
    // Even: accepts. A queen up: declines.
    expect(await game.def.ai!(view(START_FEN, { drawOffer: 1 }), 0, ctx(), { elo: 1200 })).toEqual({ name: "acceptDraw" });
    expect(await game.def.ai!(view("rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", { drawOffer: 1 }), 0, ctx(), { elo: 1200 })).toEqual({ name: "declineDraw" });
  });

  it("has a quick fallback move", () => {
    const r = game.def.aiFallback!(view(START_FEN), 0, { random: Math.random, randomInt: (a: number) => a }, { elo: 2200 }) as any;
    expect(Position.fromFen(START_FEN).findUci(r.payload.uci)).not.toBeNull();
  });

  it("gets stronger with its Elo: levels search deeper and wander less", () => {
    const lv = [400, 800, 1200, 1600, 2000, 2200].map(level);
    for (let i = 1; i < lv.length; i++) {
      expect(lv[i].nodes).toBeGreaterThan(lv[i - 1].nodes);
      expect(lv[i].noise).toBeLessThanOrEqual(lv[i - 1].noise);
      expect(lv[i].blunder).toBeLessThanOrEqual(lv[i - 1].blunder);
    }
    expect(lv.at(-1)).toMatchObject({ noise: 0, blunder: 0 });
  });

  it("a deterministic search (no clock) picks the same move for the same random numbers", () => {
    const rng = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const p = () => positionOf("r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3");
    const a = pickMove(p(), { elo: 1400, random: rng(3), engine: new Engine() });
    const e = new Engine();
    pickMove(p(), { elo: 2000, random: rng(9), engine: e }); // a different search before, sharing its tables
    e.reset();
    const b = pickMove(p(), { elo: 1400, random: rng(3), engine: e });
    expect(uci(b.move)).toBe(uci(a.move));
  });

  it("a stronger level beats a much weaker one", () => {
    let strong = 0;
    for (let g = 0; g < 4; g++) {
      const p = Position.fromFen(START_FEN);
      const seen: string[] = [];
      let seed = 1000 + g;
      const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let ply = 0; ply < 200; ply++) {
        const legal = p.legal();
        if (!legal.length || p.halfmove >= 100 || p.insufficientMaterial() || p.repetitions() >= 2) break;
        const strongTurn = (ply % 2 === 0) === (g % 2 === 0);
        const m = pickMove(p, { elo: strongTurn ? 1800 : 400, random: r, maxNodes: 20_000 }).move;
        seen.push(uci(m));
        p.make(m);
      }
      if (!p.legal().length && p.inCheck()) {
        const loserIsWhite = p.turn === 0;
        const strongIsWhite = g % 2 === 0;
        if (loserIsWhite !== strongIsWhite) strong++;
      }
    }
    expect(strong).toBeGreaterThanOrEqual(3);
  }, 60_000);
});
