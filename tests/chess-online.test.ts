// Engines on the internet for the chess AI (E-040): Stockfish at stockfish.online and the Lichess cloud, with the
// game's own engine when they are slow, fail, or answer with a move that isn't legal; and the note on each AI move of
// the engine that made it, with its evaluation (E-041). The network is a stand-in here, with the services' real answers.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import manifest from "../games/chess/manifest.json" with { type: "json" };
import { START_FEN } from "../games/chess/chess.ts";
import { ENGINES, answerIn, depthFor, depthWithin, resetOnline } from "../games/chess/online.ts";
import def, { onlineMove, ownEval, type State } from "../games/chess/rules.ts";
import { loadGame, replaysExactly, start } from "./harness.ts";

const view = (fen: string, keys = [fen.split(" ").slice(0, 4).join(" ")]) => ({ fen, keys, myTurn: true, color: 0, seats: [0, 1], drawOffer: null, clock: null, result: null });
const ctx = () => ({ random: Math.random, randomInt: (a: number) => a, signal: new AbortController().signal, deadline: Date.now() + 20_000 });
const ask = (v: unknown, engine: string, elo = 1200) => Promise.resolve(def.ai!(v as never, 0, ctx() as never, { engine, elo })) as Promise<{ name: string; payload: Record<string, unknown> } | null>;

const STOCKFISH = ENGINES[1];
const LICHESS = ENGINES[2];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
let net: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetOnline();
  net = vi.fn();
  vi.stubGlobal("fetch", net);
});
afterEach(() => vi.unstubAllGlobals());

describe("the AI's online engines (E-040)", () => {
  it("lists the engines the manifest offers", () => {
    expect(manifest.ai.options.find((o) => o.key === "engine")?.values).toEqual([...ENGINES]);
    expect(manifest.ai.notice.length).toBeLessThanOrEqual(600);
  });

  it("reads each service's answer: the move, the depth and the evaluation from White's side", () => {
    expect(answerIn("stockfish", { success: true, evaluation: 0.46, mate: null, bestmove: "bestmove e7e5 ponder g1f3", continuation: "e7e5 g1f3" })).toEqual({ uci: "e7e5", eval: { cp: 46 } });
    expect(answerIn("stockfish", { success: true, evaluation: null, mate: -3, bestmove: "bestmove e7e8q" })).toEqual({ uci: "e7e8q", eval: { mate: -3 } });
    expect(answerIn("stockfish", { success: false, error: "Invalid FEN" })).toBeNull();
    expect(answerIn("stockfish", { success: false, error: "Depth must be greater than 5" })).toBeNull();
    expect(answerIn("stockfish", { success: true, bestmove: "bestmove (none)" })).toBeNull();
    expect(answerIn("lichess", { fen: START_FEN, knodes: 105848192, depth: 70, pvs: [{ moves: "e7e5 g1f3 b8c6", cp: 18 }] })).toEqual({ uci: "e7e5", depth: 70, eval: { cp: 18 } });
    expect(answerIn("lichess", { depth: 40, pvs: [{ moves: "d8h4", mate: -1 }] })).toEqual({ uci: "d8h4", depth: 40, eval: { mate: -1 } });
    expect(answerIn("lichess", { error: "No cloud evaluation available for that position" })).toBeNull();
    expect(answerIn("lichess", null)).toBeNull();
  });

  it("asks Stockfish as deep as the Elo asks and the time allows, and plays its move", async () => {
    net.mockResolvedValue(json({ success: true, evaluation: 0.2, mate: null, bestmove: "bestmove d2d4 ponder g8f6" }));
    expect(await ask(view(START_FEN), STOCKFISH, 2200)).toEqual({ name: "move", payload: { uci: "d2d4", engine: "stockfish", depth: 15, eval: { cp: 20 } } });
    const url = new URL(String(net.mock.calls[0][0]));
    expect(url.host).toBe("stockfish.online");
    expect(url.searchParams.get("fen")).toBe(START_FEN);
    expect(url.searchParams.get("depth")).toBe("15");
    expect([depthFor(400), depthFor(1300), depthFor(2200)]).toEqual([6, 11, 15]);
    expect([depthWithin(1000), depthWithin(2000), depthWithin(4000), depthWithin(10_000)]).toEqual([0, 7, 9, 15]);
    // A bullet game (1+0, a minute left): about 2 s to spend, so depth 7.
    await ask({ ...view(START_FEN), clock: { base: 60_000, inc: 0, left: [60_000, 60_000], running: 0 } }, STOCKFISH, 2200);
    expect(new URL(String(net.mock.calls[1][0])).searchParams.get("depth")).toBe("7");
  });

  it("plays the Lichess cloud's move, castling written as the king taking its rook too", async () => {
    net.mockResolvedValue(json({ depth: 30, pvs: [{ moves: "e1h1 b8c6", cp: 20 }] }));
    const fen = "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4";
    expect(await ask(view(fen), LICHESS)).toEqual({ name: "move", payload: { uci: "e1g1", engine: "lichess", depth: 30, eval: { cp: 20 } } });
    expect(new URL(String(net.mock.calls[0][0])).pathname).toBe("/api/cloud-eval");
  });

  it("plays with its own engine when the service fails, is slow, or answers wrongly", async () => {
    const mate = view("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1"); // the own engine finds a1a8
    const own = { name: "move", payload: expect.objectContaining({ uci: "a1a8", engine: "own", eval: { mate: 1 } }) };
    net.mockResolvedValueOnce(json({ error: "No cloud evaluation available for that position" }, 404));
    expect(await ask(mate, LICHESS)).toEqual(own);
    net.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await ask(mate, STOCKFISH)).toEqual(own);
    net.mockResolvedValueOnce(json({ success: true, bestmove: "bestmove e2e4" })); // not legal here
    expect(await ask(mate, STOCKFISH)).toEqual(own);
    net.mockResolvedValueOnce(new Response("<html>busy</html>", { status: 200 }));
    expect(await ask(mate, STOCKFISH)).toEqual(own);

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      net.mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(new Error("aborted")))));
      const answer = ask(mate, STOCKFISH);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await answer).toEqual(own);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves a service alone for a minute after it says too many requests", async () => {
    const mate = view("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1");
    net.mockResolvedValue(json({ error: "Too many requests" }, 429));
    await ask(mate, LICHESS);
    await ask(mate, LICHESS);
    expect(net).toHaveBeenCalledTimes(1);
    net.mockResolvedValue(json({ success: true, bestmove: "bestmove a1a8" }));
    expect((await ask(mate, STOCKFISH))!.payload).toMatchObject({ uci: "a1a8", engine: "stockfish" }); // the other service still plays
  });

  it("doesn't let a service repeat the position a third time", () => {
    // Both knights out and back twice: the position after 1. Nf3 was on the board twice already.
    const key = (f: string) => f.split(" ").slice(0, 4).join(" ");
    const round = [START_FEN, "rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq -", "rnbqkb1r/pppppppp/5n2/8/8/5N2/PPPPPPPP/RNBQKB1R w KQkq -", "rnbqkb1r/pppppppp/5n2/8/8/8/PPPPPPPP/RNBQKBNR b KQkq -"].map(key);
    const v = view(START_FEN.replace(" 0 1", " 8 5"), [...round, ...round, key(START_FEN)]) as never;
    expect(onlineMove(v, "g1f3")).toBeNull();
    expect(onlineMove(v, "b1c3")).toBe("b1c3");
    expect(onlineMove(v, "e2e5")).toBeNull();
    expect(onlineMove(v, null)).toBeNull();
  });

  it("never asks the network for the own engine, and says so on its moves", async () => {
    expect((await ask(view(START_FEN), ENGINES[0]))!.payload).toMatchObject({ engine: "own" });
    expect(net).not.toHaveBeenCalled();
  });
});

describe("the note of the engine that made an AI player's move (E-041)", () => {
  it("turns the own engine's score into an evaluation from White's side", () => {
    expect(ownEval(46, 0)).toEqual({ cp: 46 });
    expect(ownEval(46, 1)).toEqual({ cp: -46 });
    expect(ownEval(32000 - 5, 0)).toEqual({ mate: 3 }); // mates in 3 (5 plies)
    expect(ownEval(-(32000 - 4), 1)).toEqual({ mate: 2 }); // Black is mated in 2: White mates
  });

  it("keeps an AI player's note, checked, and ignores one from a person; the setting shows the evaluation", async () => {
    const game = await loadGame("chess");
    const seats = [{ seat: 0, playerId: "a", name: "Ann", kind: "human", edge: "south" }, { seat: 1, playerId: "b", name: "Bot", kind: "ai", edge: "north" }];
    const { rt } = start(game, 2, { timeControl: "no clock", whiteSeat: "south", aiEval: "on" }, 3, { seats: seats as never });
    const state = () => rt.state as State;
    expect(rt.submit(0, { name: "move", payload: { uci: "e2e4", engine: "stockfish", eval: { cp: 900 } } } as never, "human")).toMatchObject({ ok: true });
    expect(state().notes).toEqual({});
    expect(rt.submit(1, { name: "move", payload: { uci: "e7e5", engine: "own", depth: 9, eval: { cp: -12 } } } as never, "ai")).toMatchObject({ ok: true });
    expect(state().notes).toEqual({ 1: { engine: "own", depth: 9, eval: { cp: -12 } } });
    rt.submit(0, { name: "move", payload: { uci: "g1f3" } } as never, "human");
    expect(rt.submit(1, { name: "move", payload: { uci: "b8c6", engine: "lichess", depth: "deep", eval: { cp: "lots", mate: 2.5 } } } as never, "ai")).toMatchObject({ ok: true });
    expect(state().notes).toEqual({ 1: { engine: "lichess" } });
    rt.submit(0, { name: "move", payload: { uci: "f1c4" } } as never, "human");
    rt.submit(1, { name: "move", payload: { uci: "g8f6", engine: "chatgpt" } } as never, "ai");
    expect(state().notes).toEqual({});
    expect((rt.view(0) as { showEval: boolean }).showEval).toBe(true);
    rt.submit(0, { name: "resign" } as never, "human");
    expect(replaysExactly(game, rt)).toBe(true);
    const off = start(game, 2, { timeControl: "no clock" }, 3, { seats: seats as never });
    expect((off.rt.view(0) as { showEval: boolean }).showEval).toBe(false);
  });
});
