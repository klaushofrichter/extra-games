// Backgammon on a real games-service Table Host: the lobby, rolling and moving from the board and the phones, the cube
// on the phones only, Next game from the board, an AI player in its worker thread, a player exchanged during the match,
// simulations, and logs that replay exactly.
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

async function begin(decks: Deck[], settings: Record<string, unknown> = { matchLength: 1 }) {
  await t.ok("POST", "/game/select", { gameId: "backgammon", settings });
  for (const d of decks) await d.request("lobby", "ready", { ready: true });
  await t.ok("POST", "/game/start");
}

/** The mover's first legal move in the view. */
const firstMove = (v: any) => ({ from: v.legal[0].from, to: v.legal[0].to, die: v.legal[0].die });

describe("backgammon on a table host", () => {
  it("is listed with its manifest's facts and serves only the board's and phones' files", async () => {
    const g = (await t.ok("GET", "/games")).find((x: { id: string }) => x.id === "backgammon");
    expect(g).toMatchObject({ name: "Backgammon", players: [2], ai: true, simulation: true, seatLayouts: [2] });
    expect(g.settings.map((s: { key: string }) => s.key)).toEqual(["matchLength", "cube", "turnSeconds", "undo", "autoRoll"]);
    expect(g.aiOptions[0]).toMatchObject({ key: "level", values: ["beginner", "average", "strong", "wildbg club", "wildbg expert", "wildbg master"] });
    for (const f of ["board.js", "board.css", "deck.js", "assets/bg-ui.js", "assets/board.svg", "how-to-play.md"]) expect((await fetch(`${t.base}/games/backgammon/${f}`)).status, f).toBe(200);
    for (const f of ["rules.ts", "bg.ts", "ai.ts", "manifest.json", "wildbg/engine.ts", "wildbg/contact.ts"]) expect((await fetch(`${t.base}/games/backgammon/${f}`)).status, f).toBe(404);
  });

  it("two players: moves from the board and a phone, Undo and Done, the cube on the board and the phones, an exact replay", async () => {
    const a = await t.joinDeck("Ann");
    const b = await t.joinDeck("Ben");
    await begin([a, b], { matchLength: 3 });
    const ann = player("Ann");
    const ben = player("Ben");
    expect(state().seats).toEqual([ann.seat, ben.seat]); // Ann sits south and plays White
    const mover = state().turn === 0 ? { deck: a, p: ann } : { deck: b, p: ben };
    const other = mover.deck === a ? { deck: b, p: ben } : { deck: a, p: ann };
    const board = await Deck.connect(t.base, { role: "board", key: "test-key" } as never);
    try {
      // The opening roll is played: one move from the board, taken back, then all of it from the board.
      const v = (await mover.deck.waitView((x) => x.view.phase === "move" && x.view.myTurn)).view;
      expect((await board.request("game", "intent", { playerId: mover.p.id, name: "move", payload: firstMove(v) })).type).toBe("ack");
      expect((await board.request("game", "intent", { playerId: mover.p.id, name: "undo" })).type).toBe("ack");
      expect((await board.request("game", "intent", { playerId: other.p.id, name: "move", payload: firstMove(v) })).payload.reason).toBe("It's not your turn");
      for (let k = 0; k < 4; k++) {
        const lv = t.host.table.runtime!.view(mover.p.seat!) as any;
        if (!lv.legal.length) break;
        expect((await board.request("game", "intent", { playerId: mover.p.id, name: "move", payload: firstMove(lv) })).type).toBe("ack");
      }
      expect((await board.request("game", "intent", { playerId: mover.p.id, name: "done" })).type).toBe("ack");
      // The other player doubles from the board (E-026), and the board answers for the player it was offered to: the
      // doubler cannot take their own double.
      expect(state()).toMatchObject({ phase: "roll", turn: state().seats.indexOf(other.p.seat) });
      expect((await board.request("game", "intent", { playerId: other.p.id, name: "double" })).type).toBe("ack");
      expect(state().phase).toBe("double");
      await board.request("game", "intent", { playerId: other.p.id, name: "take" });
      expect(state()).toMatchObject({ phase: "double", cube: { value: 1 } });
      expect((await board.request("game", "intent", { playerId: mover.p.id, name: "take" })).type).toBe("ack");
    } finally {
      board.close();
    }
    expect(state().cube).toMatchObject({ value: 2, owner: state().seats.indexOf(mover.p.seat) });
    expect((await other.deck.request("game", "intent", { name: "roll" })).type).toBe("ack");
    const ov = (await other.deck.waitView((x) => x.view.phase === "move" && x.view.myTurn)).view;
    if (ov.legal.length) expect((await other.deck.request("game", "intent", { name: "move", payload: firstMove(ov) })).type).toBe("ack");
    // The table ends the match from the lobby.
    await t.ok("POST", "/game/end");
    await until(() => t.host.table.phase === "finished");
    const game = await loadGame("backgammon");
    const log = await until(async () => ((await t.ok("GET", "/logs")) as { id: string }[]).find((l) => l.id.includes("backgammon")), 10000);
    const { games } = await LogStore.unzip((await t.api("GET", `/logs/${log.id}.zip`)).body as Buffer);
    expect(replay(game.manifest, game.def, games[0])).toBe((games[0].at(-1) as any).stateHash);
    const intents = games[0].filter((r: any) => r.t === "intent");
    expect(intents.filter((r: any) => r.by === "board").map((r: any) => r.intent.name)).toContain("undo");
  }, 30000);

  it("an AI player answers from its worker thread; Next game on the board skips the pause between games", async () => {
    const a = await t.joinDeck("Ann");
    await t.ok("POST", "/ai", {});
    const ai = t.host.table.state().players.find((p) => p.kind === "ai")!;
    await t.ok("POST", `/players/${ai.id}/ai-options`, { options: { level: "beginner" } });
    await begin([a], { matchLength: 3 });
    // Ann plays her turns from the phone with the first legal move each time, the AI the rest.
    const ann = player("Ann");
    const deadline = Date.now() + 25000;
    while (state().games.length === 0 && Date.now() < deadline) {
      const v: any = t.host.table.runtime!.view(ann.seat!);
      if (v.phase === "roll" && v.myTurn) await a.request("game", "intent", { name: "roll" });
      else if (v.phase === "double" && v.myTurn) await a.request("game", "intent", { name: "take" });
      else if (v.phase === "move" && v.myTurn) await a.request("game", "intent", v.legal.length ? { name: "move", payload: firstMove(v) } : { name: "done" });
      else await new Promise((r) => setTimeout(r, 20));
    }
    expect(state().games.length).toBe(1);
    const aiMoves = t.host.table.runtime!.log.filter((r: any) => r.t === "intent" && r.by === "ai") as any[];
    expect(aiMoves.length).toBeGreaterThan(3);
    expect(aiMoves.at(-1)).toMatchObject({ accepted: true, ai: { worker: true } });
    if (state().phase === "gameOver") {
      await t.ok("POST", "/game/skip-timer", { id: "next" });
      expect(state()).toMatchObject({ phase: "move", match: { game: 2 } });
    }
  }, 40000);

  it("a running match keeps its players (games-service D-159): exchanged for someone at the table, they play Black on", async () => {
    const a = await t.joinDeck("Ann");
    const b = await t.joinDeck("Ben");
    await begin([a, b], { matchLength: 3 });
    const ben = player("Ben");
    expect((await t.api("DELETE", `/players/${ben.id}`)).status).toBe(409);
    const r = await t.ok("POST", "/exchange", { seat: ben.seat, kind: "local" });
    const c = await Deck.connect(t.base, { joinToken: r.url.split("/").pop(), name: "Cleo" });
    const cv = (await c.waitView((x) => x.view.color === 1)).view;
    expect(cv.standIn).toEqual([]);
    expect(cv.names[ben.seat!]).toBe("Cleo");
    c.close();
  }, 30000);

  it("runs AI-only simulations at each strength, every match finishing and replaying exactly", async () => {
    const game = await loadGame("backgammon");
    const r = await t.ok("POST", "/simulation", { gameId: "backgammon", players: 2, games: 3, seed: 5, settings: { matchLength: 3 }, aiOptions: [{ level: "beginner" }, { level: "average" }] });
    expect(r.games).toHaveLength(3);
    for (const g of r.games) expect(g.reason).toBe("finished");
    const { games } = await LogStore.unzip((await t.api("GET", `/logs/${r.logId}.zip`)).body as Buffer);
    for (const log of games) expect(replay(game.manifest, game.def, log)).toBe((log.at(-1) as any).stateHash);
    const s = await t.ok("POST", "/simulation", { gameId: "backgammon", players: 2, games: 1, seed: 9, settings: { matchLength: 1 }, aiOptions: [{ level: "strong" }, { level: "average" }] });
    expect(s.games[0].reason).toBe("finished");
  }, 120000);
});
