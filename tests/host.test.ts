// The games on a real games-service Table Host: lobby, phones over WebSocket, the board control API, simulations,
// logs and the files the host serves. This is how a table runs them once the console has given them to it.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { testHost, until, type Deck } from "../.games-service/tests/helpers.ts";
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

/** Seat players, choose the game with quick timers, everyone ready, start. */
async function begin(decks: Deck[], ai = 0, settings: Record<string, unknown> = { turnSeconds: 0, revealSeconds: 2 }) {
  for (let k = 0; k < ai; k++) await t.ok("POST", "/ai", {});
  await t.ok("POST", "/game/select", { gameId: "liars-dice", settings });
  for (const d of decks) await d.request("lobby", "ready", { ready: true });
  await t.ok("POST", "/game/start");
}

describe("on a table host", () => {
  it("is listed with its manifest's facts and can be chosen", async () => {
    const games = await t.ok("GET", "/games");
    const g = games.find((x: { id: string }) => x.id === "liars-dice");
    expect(g).toMatchObject({ name: "Liar's Dice", players: [2, 3, 4, 5, 6], ai: true, simulation: true, seatLayouts: [2, 4, 6] });
    expect(g.settings.map((s: { key: string }) => s.key)).toEqual(["startDice", "onesWild", "turnSeconds", "revealSeconds"]);
    expect(g.aiOptions[0]).toMatchObject({ key: "style", values: ["cautious", "bold"] });
  });

  it("serves the board, phone and asset files, but never the rules or manifest", async () => {
    for (const f of ["board.js", "board.css", "deck.js", "assets/dice.js"]) {
      const r = await fetch(`${t.base}/games/liars-dice/${f}`);
      expect(r.status, f).toBe(200);
      expect(await r.text()).not.toContain("defineGame");
    }
    for (const f of ["rules.ts", "manifest.json", "assets/../rules.ts"]) expect((await fetch(`${t.base}/games/liars-dice/${f}`)).status, f).toBe(404);
  });

  it("refuses settings outside the manifest's ranges", async () => {
    await t.joinDeck("Ann");
    await t.ok("POST", "/ai", {});
    for (const settings of [{ startDice: 9 }, { startDice: 1 }, { turnSeconds: 500 }, { revealSeconds: 0 }]) {
      expect((await t.api("POST", "/game/select", { gameId: "liars-dice", settings })).status, JSON.stringify(settings)).toBe(400);
    }
  });

  it("needs two players", async () => {
    await t.joinDeck("Ann");
    await t.ok("POST", "/game/select", { gameId: "liars-dice" });
    expect((await t.ok("GET", "/state")).game.needs[0]).toMatch(/needs 1 more player/);
  });

  it("two phones play a round: each sees only its own cup, the bid goes round, a call reveals all", async () => {
    const a = await t.joinDeck("Ann");
    const b = await t.joinDeck("Ben");
    await begin([a, b]);
    const va = (await a.waitView((v) => Array.isArray(v.view.myDice) && v.view.myDice.length === 5)).view;
    const vb = (await b.waitView((v) => Array.isArray(v.view.myDice) && v.view.myDice.length === 5)).view;
    // Nothing in a phone's messages carries the other cup before the call.
    const before = JSON.stringify(a.messages);
    const state = t.host.table.runtime!.state as any;
    expect(va.myDice).toEqual(state.players[va.seat].dice);
    expect(vb.myDice).toEqual(state.players[vb.seat].dice);
    // Every cup in Ann's messages is her own. (Not "Ben's cup is absent": two cups can be the same dice, and did once in CI.)
    const cups = [...before.matchAll(/"myDice":(\[[\d,]*\])/g)].map((m) => m[1]);
    expect(cups.length).toBeGreaterThan(0);
    for (const cup of cups) expect(cup).toBe(JSON.stringify(va.myDice));
    const first = va.myTurn ? a : b;
    const second = first === a ? b : a;
    expect((await first.request("game", "intent", { name: "bid", payload: { quantity: 1, face: 2 } })).type).toBe("ack");
    // Out of turn is refused with a reason a phone can show.
    const no = await first.request("game", "intent", { name: "bid", payload: { quantity: 2, face: 2 } });
    expect(no.type).toBe("reject");
    expect(no.payload.message ?? no.payload.reason).toMatch(/turn/);
    await second.waitView((v) => v.view.myTurn);
    expect((await second.request("game", "intent", { name: "liar" })).type).toBe("ack");
    const reveal = (await a.waitView((v) => v.view.reveal)).view.reveal;
    expect(Object.keys(reveal.cups).sort()).toEqual([String(va.seat), String(vb.seat)].sort());
    // The board shows the same reveal.
    const board = await t.ok("GET", "/game/board");
    expect(JSON.stringify(board)).toContain(JSON.stringify(reveal.cups));
  });

  it("a human against AI players finishes a whole game, and the log replays", async () => {
    const a = await t.joinDeck("Ann");
    await begin([a], 2, { turnSeconds: 0, revealSeconds: 2, startDice: 2 });
    // Ann plays a simple, legal strategy: call any bid, open with one two.
    const play = async () => {
      while (t.host.table.phase === "active") {
        const v = (await a.waitView((x) => x.over || x.view.myTurn || x.view.out || x.view.phase === "over")) as any;
        if (v.over || v.view.out || v.view.phase === "over") return;
        await a.request("game", "intent", v.view.bid ? { name: "liar" } : { name: "bid", payload: { quantity: 1, face: 2 } });
        await a.waitView((x) => !x.view.myTurn || x.over);
      }
    };
    await play();
    await until(() => t.host.table.phase === "finished", 30000);
    const summary = t.host.table.state().summary!;
    expect(summary.text).toMatch(/wins with (one die|two dice) left after/);
    const game = await loadGame("liars-dice");
    const log = await until(async () => ((await t.ok("GET", "/logs")) as { id: string }[]).find((l) => l.id.includes("liars-dice")), 10000);
    const { meta, games } = await LogStore.unzip((await t.api("GET", `/logs/${log.id}.zip`)).body as Buffer);
    expect(meta).toMatchObject({ gameId: "liars-dice", gameVersion: game.manifest.version, simulation: false });
    const end = games[0].at(-1) as any;
    expect(replay(game.manifest, game.def, games[0])).toBe(end.stateHash);
  }, 60000);

  it("a running game keeps its players (games-service D-159): exchanged for an AI, the seat plays on under the AI's name", async () => {
    const a = await t.joinDeck("Ann");
    const b = await t.joinDeck("Ben");
    await begin([a, b]);
    await a.waitView((v) => v.view.phase === "bidding");
    const ben = t.host.table.state().players.find((p) => p.name === "Ben")!;
    expect((await t.api("DELETE", `/players/${ben.id}`)).status).toBe(409);
    await t.ok("POST", "/exchange", { seat: ben.seat, kind: "ai" });
    expect((t.host.table.runtime!.state as any).players[ben.seat!].name).toBe("Ben (AI)");
    expect(t.host.table.phase).toBe("active");
  });

  it("runs AI-only simulations for every player count and style, all replaying exactly", async () => {
    const game = await loadGame("liars-dice");
    for (const players of [2, 3, 4, 5, 6]) {
      const r = await t.ok("POST", "/simulation", { gameId: "liars-dice", players, games: 5, seed: players, aiOptions: Array.from({ length: players }, (_, i) => ({ style: i % 2 ? "bold" : "cautious" })) });
      expect(r.games).toHaveLength(5);
      for (const g of r.games) expect(g.reason).toBe("finished");
      const { games } = await LogStore.unzip((await t.api("GET", `/logs/${r.logId}.zip`)).body as Buffer);
      for (const log of games) expect(replay(game.manifest, game.def, log)).toBe((log.at(-1) as any).stateHash);
    }
  }, 60000);

  it("the turn timer acts for a player who doesn't, and phones see its deadline", async () => {
    const a = await t.joinDeck("Ann");
    const b = await t.joinDeck("Ben");
    await begin([a, b], 0, { turnSeconds: 30, revealSeconds: 2 });
    const msg = (await a.waitView((v) => v.view.phase === "bidding")) as any;
    expect(msg.timers.turn - msg.now).toBeGreaterThan(25_000);
    expect(msg.timers.turn - msg.now).toBeLessThanOrEqual(30_000);
    const rt = t.host.table.runtime!;
    const events: { name: string; data: any }[] = [];
    rt.onChange((_k, e) => events.push(...(e as any)));
    rt.fireTimer("turn"); // the opener sat still: the table bids for them
    rt.fireTimer("turn"); // and the next one too: with a bid in front of them, the table calls it
    expect(events.map((e) => [e.name, e.data.auto])).toEqual([["bid", true], ["called", true]]);
  });
});
