// The wildbg port (E-039): the same chances and the same best plays as wildbg's Rust engine, its cube rule, and its
// strengths playing a whole match through the rules. Reference values from wildbg's nets branch (commit 8c42b06),
// printed by its engine for these positions (pips: own checkers positive, the opponent's negative, 25 own bar, 0 theirs).
import { describe, expect, it } from "vitest";
import { createRng } from "../.games-service/packages/sdk/src/index.ts";
import { diceOf, flip, type Persp } from "../games/backgammon/bg.ts";
import def, { type View } from "../games/backgammon/rules.ts";
import { WILDBG_LEVELS } from "../games/backgammon/wildbg/brain.ts";
import { cubeDecision, evaluate, loadNets, rankPlays, type Probs } from "../games/backgammon/wildbg/engine.ts";
import { loadGame, replaysExactly, start } from "./harness.ts";

const fromPips = (s: string): Persp => {
  const pips = s.split(" ").map(Number);
  const m = new Array(26).fill(0);
  const o = new Array(26).fill(0);
  for (let i = 1; i <= 24; i++) (m[i] = Math.max(0, pips[i])), (o[i] = Math.max(0, -pips[i]));
  m[25] = pips[25];
  o[0] = -pips[0];
  m[0] = 15 - m.slice(1).reduce((a, b) => a + b, 0);
  o[25] = 15 - o.slice(0, 25).reduce((a, b) => a + b, 0);
  return { m, o };
};
const toPips = (p: Persp) => [-p.o[0], ...Array.from({ length: 24 }, (_, i) => p.m[i + 1] - p.o[i + 1]), p.m[25]].join(" ");

const REFERENCE: { pips: string; probs: Probs; best?: Record<string, string> }[] = [
  {
    pips: "0 -2 0 0 0 0 5 0 3 0 0 0 -5 5 0 0 0 -3 0 -5 0 0 0 0 2 0",
    probs: [0.38713053, 0.15152277, 0.0061922953, 0.3426262, 0.10825668, 0.004271545],
    best: {
      "3-1": "0 -2 0 0 0 0 5 0 3 0 0 0 -5 5 0 0 0 -2 0 -4 -2 0 0 0 2 0",
      "6-6": "0 0 0 0 0 0 5 -2 3 0 0 0 -3 5 0 0 0 -3 -2 -5 0 0 0 0 2 0",
      "5-2": "0 -1 0 -1 0 0 5 0 3 0 0 0 -4 5 0 0 0 -4 0 -5 0 0 0 0 2 0",
    },
  },
  {
    pips: "0 1 0 0 2 2 2 -2 2 0 0 0 0 4 0 0 -2 -2 -3 -4 0 -1 0 -1 2 0",
    probs: [0.30436644, 0.13843149, 0.004804312, 0.39092693, 0.15350747, 0.007963348],
    best: {
      "3-1": "0 0 -1 0 -1 0 4 3 2 2 0 0 -4 0 0 0 0 -2 2 -2 -2 -2 0 0 -1 2",
      "6-6": "0 -2 1 0 1 0 4 3 2 2 0 0 -4 0 0 0 0 0 2 -2 -2 -2 0 -2 -1 0",
      "5-2": "0 -1 1 -1 1 0 4 3 2 2 0 0 -3 0 0 0 0 -3 2 -2 -2 -2 0 0 -1 0",
    },
  },
  {
    pips: "0 4 3 1 2 2 2 0 0 0 0 0 0 0 0 0 0 0 -3 0 0 -1 -2 -4 -5 0",
    probs: [0.9110085, 0.0000008434759, 3.4209475e-14, 0.08899062, 8.650104e-15, 9.27875e-16],
  },
  {
    pips: "0 6 4 0 1 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -1 -3 0",
    probs: [0.000025955522, 3.1642245e-18, 3.6259006e-21, 0.999974, 2.503711e-13, 3.7216667e-15],
  },
];

describe("wildbg in TypeScript (E-039)", () => {
  it("gives the Rust engine's chances, for contact positions and races", async () => {
    const nets = await loadNets();
    for (const r of REFERENCE) {
      const q = evaluate(nets, fromPips(r.pips));
      for (let k = 0; k < 6; k++) expect(Math.abs(q[k] - r.probs[k]), `${r.pips} [${k}]`).toBeLessThan(1e-5);
    }
  });

  it("chooses the Rust engine's best plays", async () => {
    const nets = await loadNets();
    for (const r of REFERENCE.filter((x) => x.best))
      for (const [dice, expected] of Object.entries(r.best!)) {
        const [a, b] = dice.split("-").map(Number);
        const best = rankPlays(nets, fromPips(r.pips), diceOf(a, b))[0];
        expect(toPips(flip(best.play.pos)), `${r.pips} ${dice}`).toBe(expected); // as wildbg returns it: the other side to move
      }
  });

  it("doubles and takes by Janowski's money formulas: wildbg's own cases", () => {
    const plain = (win: number): Probs => [win, 0, 0, 1 - win, 0, 0];
    expect(cubeDecision(plain(0.5))).toEqual({ double: false, take: true });
    expect(cubeDecision(plain(0.55))).toEqual({ double: false, take: true }); // too early
    expect(cubeDecision(plain(0.7))).toEqual({ double: true, take: true });
    expect(cubeDecision(plain(0.85))).toEqual({ double: true, take: false }); // a double the other side passes
    // Many gammons: too good to double, playing on is worth more than a passed double.
    expect(cubeDecision([0.15, 0.55, 0.2, 0.1, 0, 0]).double).toBe(false);
  });

  it("plays a whole match at each strength through the rules, which replays exactly", async () => {
    const game = await loadGame("backgammon");
    for (const level of WILDBG_LEVELS) {
      const ai = [0, 1].map((i) => ({ seat: i, playerId: `p${i}`, name: `W${i}`, kind: "ai" as const, edge: i ? "north" : "south" }));
      const { rt, clock } = start(game, 2, { matchLength: 1, cube: true, turnSeconds: 0 }, 5, { seats: ai as never });
      const rng = createRng(11);
      const ctx = { random: rng, randomInt: (a: number, b: number) => a + Math.floor(rng() * (b - a + 1)), signal: new AbortController().signal, deadline: Date.now() + 60_000 };
      for (let guard = 0; !rt.over && guard < 5000; guard++) {
        let acted = false;
        for (const seat of [0, 1]) {
          const answer = def.ai!(rt.view(seat) as View, seat, ctx, { level });
          const intent = await answer; // wildbg's levels answer with a promise
          if (intent) {
            expect(rt.submit(seat, intent as never, "ai"), `${level}: ${JSON.stringify(intent)}`).toMatchObject({ ok: true });
            acted = true;
            break;
          }
        }
        if (!acted) clock.advance();
      }
      expect(rt.over, level).toBe(true);
      expect(replaysExactly(game, rt), level).toBe(true);
    }
  }, 120_000);
});
