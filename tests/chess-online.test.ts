// Engines on the internet for the chess AI (E-040): Stockfish at stockfish.online and the Lichess cloud, with the
// game's own engine when they are slow, fail, or answer with a move that isn't legal. The network is a stand-in here.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import manifest from "../games/chess/manifest.json" with { type: "json" };
import { START_FEN } from "../games/chess/chess.ts";
import { ENGINES, depthFor, moveIn, resetOnline } from "../games/chess/online.ts";
import def, { onlineMove } from "../games/chess/rules.ts";

const view = (fen: string, keys = [fen.split(" ").slice(0, 4).join(" ")]) => ({ fen, keys, myTurn: true, color: 0, seats: [0, 1], drawOffer: null, clock: null, result: null });
const ctx = () => ({ random: Math.random, randomInt: (a: number) => a, signal: new AbortController().signal, deadline: Date.now() + 20_000 });
const ask = (v: unknown, engine: string, elo = 1200) => Promise.resolve(def.ai!(v as never, 0, ctx() as never, { engine, elo }));

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

  it("reads each service's answer", () => {
    expect(moveIn("stockfish", { success: true, evaluation: 0.3, mate: null, bestmove: "bestmove e2e4 ponder e7e5", continuation: "e2e4 e7e5" })).toBe("e2e4");
    expect(moveIn("stockfish", { success: true, bestmove: "bestmove e7e8q" })).toBe("e7e8q");
    expect(moveIn("stockfish", { success: false, data: "Invalid FEN" })).toBeNull();
    expect(moveIn("stockfish", { success: true, bestmove: "bestmove (none)" })).toBeNull();
    expect(moveIn("lichess", { fen: START_FEN, depth: 40, pvs: [{ moves: "e2e4 c7c5 g1f3", cp: 30 }] })).toBe("e2e4");
    expect(moveIn("lichess", { error: "Not found" })).toBeNull();
    expect(moveIn("lichess", null)).toBeNull();
  });

  it("asks Stockfish at a depth that follows the Elo, and plays its move", async () => {
    net.mockResolvedValue(json({ success: true, bestmove: "bestmove d2d4 ponder g8f6" }));
    expect(await ask(view(START_FEN), STOCKFISH, 2200)).toEqual({ name: "move", payload: { uci: "d2d4" } });
    const url = new URL(String(net.mock.calls[0][0]));
    expect(url.host).toBe("stockfish.online");
    expect(url.searchParams.get("fen")).toBe(START_FEN);
    expect(url.searchParams.get("depth")).toBe("15");
    expect([depthFor(400), depthFor(1300), depthFor(2200)]).toEqual([1, 8, 15]);
  });

  it("plays the Lichess cloud's move, castling written as the king taking its rook too", async () => {
    net.mockResolvedValue(json({ pvs: [{ moves: "e1h1 b8c6", cp: 20 }] }));
    const fen = "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4";
    expect(await ask(view(fen), LICHESS)).toEqual({ name: "move", payload: { uci: "e1g1" } });
    expect(new URL(String(net.mock.calls[0][0])).pathname).toBe("/api/cloud-eval");
  });

  it("plays with its own engine when the service fails, is slow, or answers wrongly", async () => {
    const mate = view("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1"); // the own engine finds a1a8
    const own = { name: "move", payload: { uci: "a1a8" } };
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
      await vi.advanceTimersByTimeAsync(4000);
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
    expect(await ask(mate, STOCKFISH)).toEqual({ name: "move", payload: { uci: "a1a8" } }); // the other service still plays
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

  it("never asks the network for the own engine", async () => {
    await ask(view(START_FEN), ENGINES[0]);
    await ask(view(START_FEN), "");
    expect(net).not.toHaveBeenCalled();
  });
});
