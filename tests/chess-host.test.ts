// Chess on a real games-service Table Host: the lobby, moves from the board and the phones, an AI player in its worker
// thread, the stand-in for a player who leaves and the player who takes the seat back, simulations, and logs that
// replay exactly.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Deck, testHost, until } from "../.games-service/tests/helpers.ts";
import { LogStore } from "../.games-service/apps/table-host/src/logs.ts";
import { replay } from "../.games-service/apps/table-host/src/runtime.ts";
import { GAMES_DIR, loadGame } from "./harness.ts";

let t: Awaited<ReturnType<typeof testHost>>;
beforeEach(async () => {
  t = await testHost({ gamesDir: GAMES_DIR, aiDelayMs: 1 });
});
afterEach(async () => {
  await t.close();
});

const state = () => t.host.table.runtime!.state as any;
const player = (name: string) => t.host.table.state().players.find((p) => p.name.startsWith(name))!;

async function begin(decks: Deck[], settings: Record<string, unknown> = { timeControl: "no clock", whiteSeat: "south" }) {
  await t.ok("POST", "/game/select", { gameId: "chess", settings });
  for (const d of decks) await d.request("lobby", "ready", { ready: true });
  await t.ok("POST", "/game/start");
}

describe("chess on a table host", () => {
  it("is listed with its manifest's facts and serves only the board's and phones' files", async () => {
    const g = (await t.ok("GET", "/games")).find((x: { id: string }) => x.id === "chess");
    expect(g).toMatchObject({ name: "Chess", players: [2], ai: true, simulation: true, seatLayouts: [2] });
    expect(g.settings.map((s: { key: string }) => s.key)).toEqual(["timeControl", "whiteSeat", "standInElo"]);
    expect(g.aiOptions[0]).toMatchObject({ key: "elo", min: 400, max: 2200 });
    for (const f of ["board.js", "board.css", "deck.js", "assets/pieces.js", "assets/how-to-move.svg", "how-to-play.md"]) expect((await fetch(`${t.base}/games/chess/${f}`)).status, f).toBe(200);
    for (const f of ["rules.ts", "chess.ts", "engine.ts", "manifest.json"]) expect((await fetch(`${t.base}/games/chess/${f}`)).status, f).toBe(404);
  });

  it("two players: moves from the board and from a phone, a draw offer, resignation, an exact replay", async () => {
    const a = await t.joinDeck("Ann");
    const b = await t.joinDeck("Ben");
    await begin([a, b]);
    const ann = player("Ann");
    const ben = player("Ben");
    expect(state().seats[0]).toBe(ann.seat); // Ann sits south and plays white
    const board = await Deck.connect(t.base, { role: "board", key: "test-key" } as never);
    try {
      expect((await board.request("game", "intent", { playerId: ann.id, name: "move", payload: { uci: "e2e4" } })).type).toBe("ack");
      // Ben moves from the board too; the table's board refuses the wrong player's move.
      expect((await board.request("game", "intent", { playerId: ann.id, name: "move", payload: { uci: "d2d4" } })).payload.reason).toBe("It's not your turn");
      expect((await board.request("game", "intent", { playerId: ben.id, name: "move", payload: { uci: "e7e5" } })).type).toBe("ack");
      // Resigning stays on the phone.
      expect((await board.request("game", "intent", { playerId: ben.id, name: "resign" })).payload.status).toBe(403);
    } finally {
      board.close();
    }
    const v = (await a.waitView((x) => x.view.moveCount === 2)).view;
    expect(v).toMatchObject({ color: 0, myTurn: true, sans: ["e4", "e5"], last: { from: "e7", to: "e5" } });
    expect(v.legal).toContain("g1f3");
    expect((await a.request("game", "intent", { name: "offerDraw" })).type).toBe("ack");
    await b.waitView((x) => x.view.drawOffer === ann.seat);
    expect((await b.request("game", "intent", { name: "declineDraw" })).type).toBe("ack");
    expect((await b.request("game", "intent", { name: "resign" })).type).toBe("ack");
    await until(() => t.host.table.phase === "finished");
    expect(t.host.table.state().summary!.text).toBe("Ben resigns: Ann wins with white after one move.");
    const game = await loadGame("chess");
    const log = await until(async () => ((await t.ok("GET", "/logs")) as { id: string }[]).find((l) => l.id.includes("chess")), 10000);
    const { games } = await LogStore.unzip((await t.api("GET", `/logs/${log.id}.zip`)).body as Buffer);
    expect(replay(game.manifest, game.def, games[0])).toBe((games[0].at(-1) as any).stateHash);
  });

  it("an AI player answers from its worker thread at the strength it is set to", async () => {
    const a = await t.joinDeck("Ann");
    await t.ok("POST", "/ai", {});
    const ai = t.host.table.state().players.find((p) => p.kind === "ai")!;
    await t.ok("POST", `/players/${ai.id}/ai-options`, { options: { elo: 800 } }).catch(() => undefined);
    await begin([a]);
    await a.waitView((x) => x.view.myTurn);
    expect((await a.request("game", "intent", { name: "move", payload: { uci: "e2e4" } })).type).toBe("ack");
    const v = (await a.waitView((x) => x.view.moveCount === 2)).view;
    expect(v.myTurn).toBe(true);
    const aiMove = t.host.table.runtime!.log.filter((r: any) => r.t === "intent" && r.by === "ai").at(-1) as any;
    expect(aiMove).toMatchObject({ accepted: true, ai: { worker: true } });
  }, 40000);

  it("a player removed mid-game is replaced by the stand-in; someone who joins takes the seat back", async () => {
    const a = await t.joinDeck("Ann");
    const b = await t.joinDeck("Ben");
    await begin([a, b], { timeControl: "no clock", whiteSeat: "south", standInElo: 600 });
    const ben = player("Ben");
    expect((await a.request("game", "intent", { name: "move", payload: { uci: "d2d4" } })).type).toBe("ack");
    await t.ok("DELETE", `/players/${ben.id}`);
    expect(t.host.table.phase).toBe("active");
    // The stand-in answers for Black after a moment.
    const v = (await a.waitView((x) => x.view.moveCount === 2)).view;
    expect(v.standIn).toEqual([ben.seat]);
    expect((t.host.table.runtime!.log.at(-1) as any)).toMatchObject({ t: "timer", id: "standin" });
    // Cleo joins, sits in the empty seat and plays Black from now on.
    const c = await t.joinDeck("Cleo");
    const cv = (await c.waitView((x) => x.view.color === 1)).view;
    expect(cv.standIn).toEqual([]);
    expect(cv.names[ben.seat!]).toBe("Cleo");
    expect((await a.request("game", "intent", { name: "move", payload: { uci: "c2c4" } })).type).toBe("ack");
    await c.waitView((x) => x.view.myTurn);
    expect((await c.request("game", "intent", { name: "move", payload: { uci: "e7e6" } })).type).toBe("ack");
  }, 30000);

  it("against an AI, a phone that goes away is replaced by the stand-in after the waiting time (E-010)", async () => {
    const a = await t.joinDeck("Klaus");
    await t.ok("POST", "/ai", {});
    await begin([a], { timeControl: "10+5", whiteSeat: "south", standInElo: 400 });
    expect((await a.request("game", "intent", { name: "move", payload: { uci: "e2e4" } })).type).toBe("ack");
    await until(() => state().sans.length === 2);
    a.close(); // the phone sleeps; the waiting time here is 300 ms
    await until(() => state().standIn.length === 1);
    expect(t.host.table.phase).toBe("active");
    await until(() => state().sans.length >= 4, 15000); // the stand-in and the AI play on
    // Someone joining takes White back from the stand-in.
    const b = await t.joinDeck("Zoe");
    await b.waitView((x) => x.view.color === 0 && x.view.standIn.length === 0);
  }, 30000);

  it("the one player at the table sits south against a remote player, and plays without a clock by default (E-011)", async () => {
    await t.ok("POST", "/game/select", { gameId: "chess" });
    const rita = t.host.table.joinRemote("Rita", "sess-rita"); // takes the first seat: south
    const a = await t.joinDeck("Klaus");
    const edge = (name: string) => t.host.table.state().seatEdges[t.host.table.state().players.find((p) => p.name === name)!.seat!];
    expect(edge("Klaus")).toBe("north");
    t.host.table.setReady(rita.playerId, true);
    await a.request("lobby", "ready", { ready: true });
    await t.ok("POST", "/game/start");
    expect(edge("Klaus")).toBe("south");
    expect(edge("Rita")).toBe("north");
    expect(state()).toMatchObject({ clock: null, timeControl: "no clock" });
    expect(state().seats[0]).toBe(t.host.table.state().players.find((p) => p.name === "Klaus")!.seat); // White from south
  });

  it("runs AI-only simulations at different strengths, every game finishing and replaying exactly", async () => {
    const game = await loadGame("chess");
    const r = await t.ok("POST", "/simulation", { gameId: "chess", players: 2, games: 3, seed: 5, settings: { timeControl: "no clock" }, aiOptions: [{ elo: 400 }, { elo: 600 }] });
    expect(r.games).toHaveLength(3);
    for (const g of r.games) expect(g.reason).toBe("finished");
    const { games } = await LogStore.unzip((await t.api("GET", `/logs/${r.logId}.zip`)).body as Buffer);
    for (const log of games) expect(replay(game.manifest, game.def, log)).toBe((log.at(-1) as any).stateHash);
  }, 120000);
});
