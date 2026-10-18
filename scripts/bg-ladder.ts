// Backgammon strength check: AI-only matches between two levels through the host's simulation loop.
// Usage: node scripts/bg-ladder.ts <levelA> <levelB> [games] [matchLength]
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadGames } from "../.games-service/apps/table-host/src/games.ts";
import { LogStore } from "../.games-service/apps/table-host/src/logs.ts";
import { runSimulation } from "../.games-service/apps/table-host/src/simulation.ts";

const [a = "average", b = "beginner", n = "40", len = "1"] = process.argv.slice(2);
const games = await loadGames(join(import.meta.dirname, "..", "games"));
const g = games.get("backgammon")!;
const tmp = await mkdtemp(join(tmpdir(), "bg-ladder-"));
const logs = new LogStore(tmp);
const t0 = Date.now();
// Half the matches each way round, so neither level always plays white.
const wins: Record<string, number> = { [a]: 0, [b]: 0 };
let points: Record<string, number> = { [a]: 0, [b]: 0 };
for (const flip of [false, true]) {
  const opts = flip ? [{ level: b }, { level: a }] : [{ level: a }, { level: b }];
  const r = await runSimulation(g, { players: 2, games: Math.ceil(Number(n) / 2), seed: flip ? 99 : 7, aiOptions: opts, settings: { matchLength: Number(len) } } as never, logs, "ladder");
  const { games: recs } = await LogStore.unzip((await logs.read(r.logId))!);
  for (const log of recs) {
    const end = log.at(-1) as any;
    const w = end.summary.highlights.winner as number;
    wins[opts[w].level]++;
    const sc = end.summary.highlights.score as number[];
    points[opts[0].level] += sc[0];
    points[opts[1].level] += sc[1];
  }
}
console.log(`${a} vs ${b}: matches ${wins[a]}–${wins[b]}, points ${points[a]}–${points[b]}, ${Date.now() - t0} ms`);
await rm(tmp, { recursive: true, force: true });
