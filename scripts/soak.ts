// Soak: many AI-only games per game, player count and play style, through games-service's own simulation loop and
// with `@game-table/sdk` resolved by the host's import hook, exactly as on a table. Checks that every game finishes,
// replays to the same state, and (Liar's Dice) loses exactly one die per round.
// Usage: node scripts/soak.ts [gamesPerConfig]
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadGames } from "../.games-service/apps/table-host/src/games.ts";
import { LogStore } from "../.games-service/apps/table-host/src/logs.ts";
import { replay } from "../.games-service/apps/table-host/src/runtime.ts";
import { runSimulation } from "../.games-service/apps/table-host/src/simulation.ts";
import { allowedPlayerCounts } from "../.games-service/packages/protocol/src/index.ts";

const perConfig = Number(process.argv[2] ?? 100);
const games = await loadGames(join(import.meta.dirname, "..", "games"));
if (!games.size) {
  console.error("no game loaded");
  process.exit(1);
}
const tmp = await mkdtemp(join(tmpdir(), "extra-soak-"));
const logs = new LogStore(tmp);
let failures = 0;

for (const g of games.values()) {
  if (!g.manifest.simulation.supported) continue;
  const option = g.manifest.ai.options[0];
  const styles = option?.values ?? [undefined];
  for (const players of allowedPlayerCounts(g.manifest)) {
    const t0 = Date.now();
    // Seats alternate through the styles, so every style plays against every other.
    const aiOptions = Array.from({ length: players }, (_, i) => (styles[i % styles.length] ? { [option.key]: styles[i % styles.length] } : {}));
    const r = await runSimulation(g, { players, games: perConfig, seed: players * 1000 + 7, aiOptions }, logs, "soak");
    const { games: recs } = await LogStore.unzip((await logs.read(r.logId))!);
    let bad = 0;
    const wins: Record<string, number> = {};
    recs.forEach((log, i) => {
      const end = log.at(-1) as any;
      if (r.games[i].reason !== "finished") bad++;
      if (replay(g.manifest, g.def, log) !== end.stateHash) bad++;
      if (g.manifest.id === "liars-dice") {
        const h = end.summary?.highlights ?? {};
        const rows = end.summary?.table?.rows as [string, number, number][];
        const start = (log[0] as any).settings.startDice as number;
        const left = rows.reduce((a, row) => a + row[1], 0);
        const lost = rows.reduce((a, row) => a + row[2], 0);
        if (left + lost !== players * start || lost !== h.rounds) bad++;
        const seat = (log[0] as any).seats.find((s: any) => s.name === h.winner)?.seat;
        const style = aiOptions[seat]?.[option.key] ?? "default";
        wins[style] = (wins[style] ?? 0) + 1;
      }
    });
    failures += bad;
    const steps = r.games.reduce((a, x) => a + x.steps, 0);
    console.log(`${g.manifest.id.padEnd(11)} ${players} players  ${perConfig} games  ${String(steps).padStart(6)} steps  ${String(Date.now() - t0).padStart(5)} ms  ${bad ? `FAILED ${bad}` : "ok"}  wins ${JSON.stringify(wins)}`);
  }
}
await rm(tmp, { recursive: true, force: true });
console.log(failures ? `\n${failures} problems` : "\nall games finished, replayed exactly and lost one die per round");
process.exit(failures ? 1 : 0);
