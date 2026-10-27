// Backgammon AI against AI, through the game's own rules (E-039): single cubeless games (points per game, gammons
// counting) or matches to 7 with the cube. Colours alternate; seeded, so a run can be repeated.
//   A="wildbg expert" B=strong N=400 node scripts/backgammon-tournament.ts
//   A="wildbg expert" B=strong N=60 MODE=cube node scripts/backgammon-tournament.ts
import { registerSdkHook } from "../.games-service/apps/table-host/src/games.ts";

registerSdkHook();
const { createRng } = await import("../.games-service/packages/sdk/src/index.ts");
const { aiIntent, intentWith } = await import("../games/backgammon/rules.ts");
const { wildbgBrain, WILDBG_LEVELS } = await import("../games/backgammon/wildbg/brain.ts");
const { loadGame, start } = await import("../tests/harness.ts");
type View = Parameters<typeof aiIntent>[0];

const game = await loadGame("backgammon");
const [A, B, N, mode] = [process.env.A!, process.env.B!, Number(process.env.N ?? 40), process.env.MODE ?? "cubeless"];
const seatsAI = [0, 1].map((i) => ({ seat: i, playerId: `p${i}`, name: `S${i}`, kind: "ai" as const, edge: i ? "north" : "south" })) as any;
let pointsA = 0, gamesA = 0, gamesTotal = 0, passes = 0, gammons = 0;
const t0 = Date.now();
for (let m = 0; m < N; m++) {
  const settings = mode === "cubeless" ? { matchLength: 1, cube: false, turnSeconds: 0 } : { matchLength: 7, cube: true, turnSeconds: 0 };
  const { rt, clock } = start(game, 2, settings, 1000 + m, { seats: seatsAI });
  // Seat 0 plays White (south). A sits in seat 0 in even matches, seat 1 in odd ones.
  const levelOf = (seat: number) => ((seat === 0) === (m % 2 === 0) ? A : B);
  const rng = createRng(77 + m);
  const brains: Record<string, any> = {};
  for (const l of [A, B]) if ((WILDBG_LEVELS as readonly string[]).includes(l)) brains[l] = await wildbgBrain(l as any, rng);
  for (let guard = 0; !rt.over && guard < 100000; guard++) {
    let acted = false;
    for (const seat of [0, 1]) {
      const l = levelOf(seat);
      const v = rt.view(seat) as View;
      const it = brains[l] ? intentWith(v, brains[l]) : aiIntent(v, l as any, rng);
      if (it) {
        if (rt.submit(seat, it as any, "ai").ok) acted = true;
        break;
      }
    }
    if (!acted) clock.advance();
  }
  const s = rt.state as any;
  const aColor = s.seats.indexOf(m % 2 === 0 ? 0 : 1);
  if (mode === "cubeless") {
    const g = s.games[0];
    gamesTotal++;
    if (g.winner === aColor) (gamesA++, (pointsA += g.points));
    else pointsA -= g.points;
    if (g.points > 1) gammons++;
  } else {
    gamesTotal++;
    if (s.match.score[aColor] > s.match.score[aColor ^ 1]) gamesA++;
    for (const g of s.games) if (g.kind === "pass") passes++;
  }
}
const secs = ((Date.now() - t0) / 1000).toFixed(0);
if (mode === "cubeless") console.log(`${A} vs ${B}: ${gamesTotal} games, ${A} won ${gamesA} (${((100 * gamesA) / gamesTotal).toFixed(0)} %), ${(pointsA / gamesTotal).toFixed(3)} points per game for ${A}; ${gammons} gammons or more; ${secs} s`);
else console.log(`${A} vs ${B}: ${gamesTotal} matches to 7, ${A} won ${gamesA} (${((100 * gamesA) / gamesTotal).toFixed(0)} %); ${passes} games ended by a passed double; ${secs} s`);
