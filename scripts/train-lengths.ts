// Mexican Train: how long do the trains get? Runs AI-only games per player count through games-service's simulation
// loop (as scripts/soak.ts does) and reports, from every round's end, the tiles on the players' own trains, on the
// Mexican train, the longest train of the round and all tiles on the board. The board's layout is sized from this.
// Usage: node scripts/train-lengths.ts [gamesPerPlayerCount] [--json out.json]
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadGames } from "../.games-service/apps/table-host/src/games.ts";
import { LogStore } from "../.games-service/apps/table-host/src/logs.ts";
import { runSimulation } from "../.games-service/apps/table-host/src/simulation.ts";

const perCount = Number(process.argv[2] ?? 200);
const jsonOut = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : null;
const game = (await loadGames(join(import.meta.dirname, "..", "games"))).get("mexican-train");
if (!game) throw new Error("mexican-train did not load");
const logs = new LogStore(await mkdtemp(join(tmpdir(), "train-lengths-")));

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const summary = (xs: number[]) => ({ mean: +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1), p50: pct(xs, 50), p90: pct(xs, 90), p99: pct(xs, 99), max: Math.max(...xs) });
const out: Record<number, unknown> = {};

console.log("players  rounds  | own train: mean p50 p90 p99 max | Mexican: mean p90 p99 max | longest in round: p50 p90 p99 max | board total: p99 max");
for (let players = 2; players <= 8; players++) {
  // Half the seats play each style, so both AIs' habits are in the numbers.
  const aiOptions = Array.from({ length: players }, (_, i) => ({ style: i % 2 ? "steady" : "planner" }));
  const r = await runSimulation(game, { players, games: perCount, seed: players * 101, aiOptions }, logs, "lengths");
  const { games: recs } = await LogStore.unzip((await logs.read(r.logId))!);
  const own: number[] = [];
  const mexican: number[] = [];
  const longest: number[] = [];
  const total: number[] = [];
  for (const log of recs) {
    const rounds = ((log.at(-1) as any).summary?.highlights?.trainLengths ?? []) as Record<string, number>[];
    for (const lengths of rounds) {
      const entries = Object.entries(lengths);
      for (const [id, n] of entries) (id === "m" ? mexican : own).push(n);
      longest.push(Math.max(...entries.map(([, n]) => n)));
      total.push(entries.reduce((a, [, n]) => a + n, 0));
    }
  }
  const o = summary(own), m = summary(mexican), l = summary(longest), t = summary(total);
  out[players] = { rounds: longest.length, own: o, mexican: m, longest: l, total: t };
  console.log(`${String(players).padStart(7)}  ${String(longest.length).padStart(6)}  | ${[o.mean, o.p50, o.p90, o.p99, o.max].map((x) => String(x).padStart(4)).join(" ")}           | ${[m.mean, m.p90, m.p99, m.max].map((x) => String(x).padStart(4)).join(" ")}        | ${[l.p50, l.p90, l.p99, l.max].map((x) => String(x).padStart(4)).join(" ")}                  | ${String(t.p99).padStart(4)} ${String(t.max).padStart(4)}`);
}
if (jsonOut) await writeFile(jsonOut, JSON.stringify(out, null, 2));
