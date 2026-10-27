// wildbg as a Backgammon AI player (E-039): three strengths of the same networks. Club plays its best by the networks
// with some noise, Expert plays its best, Master looks one roll ahead among its five best plays. The cube follows
// wildbg's money-game rule (Janowski, cube efficiency 2/3) on the networks' chances, with the match-score cases the
// game's own AI also knows: a cube that would win the match is dead, and a free drop is doubled at once.
import { type Persp, type Sub, flip } from "../bg.ts";
import type { CubeSituation } from "../ai.ts";
import { type Nets, cubeDecision, evaluate, loadNets, onePly, rankPlays } from "./engine.ts";

export const WILDBG_LEVELS = ["wildbg club", "wildbg expert", "wildbg master"] as const;
export type WildbgLevel = (typeof WILDBG_LEVELS)[number];

/** Club's noise on each play's equity: enough to miss close plays, rarely a clear one. */
const CLUB_NOISE = 0.06;
/** Master looks one roll ahead among this many of the best plays. */
const MASTER_TOP = 5;

function gauss(random: () => number) {
  const u = Math.max(1e-9, random());
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** The best play's moves at a level. */
export function wildbgPlay(nets: Nets, p: Persp, dice: number[], level: WildbgLevel, random: () => number): Sub[] {
  const ranked = rankPlays(nets, p, dice);
  if (ranked.length === 1) return ranked[0].play.moves;
  if (level === "wildbg club") {
    const noisy = ranked.map((r) => ({ r, n: r.equity + gauss(random) * CLUB_NOISE }));
    noisy.sort((a, b) => b.n - a.n);
    return noisy[0].r.play.moves;
  }
  if (level === "wildbg expert") return ranked[0].play.moves;
  const deeper = ranked.slice(0, MASTER_TOP).map((r) => ({ r, e: onePly(nets, r.play.pos) }));
  deeper.sort((a, b) => b.e - a.e);
  return deeper[0].r.play.moves;
}

/** Double now? `p` from the side to roll. */
export function wildbgDouble(nets: Nets, p: Persp, cube: CubeSituation): boolean {
  if (cube.need[0] <= cube.value) return false; // the cube already wins the match: dead for the doubler
  if (cube.freeDrop) return true;
  return cubeDecision(evaluate(nets, p)).double;
}

/** Take? `p` from the taker's side, the doubler to roll. */
export function wildbgTake(nets: Nets, p: Persp, cube: CubeSituation): boolean {
  if (cube.need[1] <= cube.value) return true; // dropping loses the match anyway
  return cubeDecision(evaluate(nets, flip(p))).take;
}

/** An AI player at a wildbg level, once the networks are loaded. */
export async function wildbgBrain(level: WildbgLevel, random: () => number) {
  const nets = await loadNets();
  return {
    double: (p: Persp, cube: CubeSituation) => wildbgDouble(nets, p, cube),
    take: (p: Persp, cube: CubeSituation) => wildbgTake(nets, p, cube),
    play: (p: Persp, dice: number[]) => wildbgPlay(nets, p, dice, level, random),
  };
}
