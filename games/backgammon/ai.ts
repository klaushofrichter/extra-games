// Backgammon AI: a hand-made evaluation of positions, used at three strengths.
//
// `evaluate(p)` scores a position for the side that has just moved (its opponent is to roll) on a logistic scale:
// winChance(score) = 1 / (1 + e^-score). It knows the race (pip counts, who is on roll), blots and how many of the
// opponent's 36 rolls hit them, made points (the 5- and 6-point most), primes that hold checkers behind them, anchors,
// checkers on the bar and stacks.
//
//   beginner  the evaluation with a lot of noise: plays legal, often loose moves; never doubles, always takes
//   average   the best play by the evaluation; doubles and takes by its estimate of the position
//   strong    the best few plays by the evaluation, each looked at over all 21 replies of the opponent (1-ply)
import { contact, diceOf, flip, oppPips, pips, plays, type Persp, type Play } from "./bg.ts";

export type Level = "beginner" | "average" | "strong";
export const LEVELS: Level[] = ["beginner", "average", "strong"];

/** The 21 different rolls and their weight out of 36. */
export const ROLLS: { a: number; b: number; w: number }[] = [];
for (let a = 1; a <= 6; a++) for (let b = a; b <= 6; b++) ROLLS.push({ a, b, w: a === b ? 1 : 2 });

export const winChance = (score: number) => 1 / (1 + Math.exp(-score));

// How much a made point is worth by where it is (own numbering): the 5-, 6- and bar-point most; anchors deep in the
// opponent's board (18–21) hold a game together.
const POINT = [0, 0.15, 0.3, 0.5, 0.75, 0.95, 0.9, 0.75, 0.45, 0.3, 0.2, 0.15, 0.1, 0.08, 0.05, 0.05, 0.05, 0.1, 0.35, 0.3, 0.5, 0.45, 0.25, 0.15, 0.1];

/** How many of the opponent's 36 rolls hit a blot on own point `i` (opponent checkers move up the own numbering). */
function shots(p: Persp, i: number): number {
  // Distances from opponent checkers (and their bar, which enters as if from point 0) to the blot.
  const dist: number[] = [];
  if (p.o[0]) dist.push(i);
  for (let j = 1; j < i; j++) if (p.o[j]) dist.push(i - j);
  if (!dist.length) return 0;
  const blocked = (from: number, step: number) => from + step < i && p.m[from + step] >= 2;
  let n = 0;
  for (let a = 1; a <= 6; a++)
    for (let b = 1; b <= 6; b++) {
      let hit = false;
      for (const d of dist) {
        const from = i - d;
        if (a === b) {
          // A double moves up to four times its number, each landing spot open.
          for (let k = 1; k <= 4 && !hit; k++) {
            if (blocked(from, a * (k - 1)) && k > 1) break;
            if (a * k === d) hit = true;
          }
        } else if (d === a || d === b || (d === a + b && (!blocked(from, a) || !blocked(from, b)))) hit = true;
        if (hit) break;
      }
      if (hit) n++;
    }
  return n;
}

// Weights tuned in AI-only duels against an earlier version of this evaluation (about 60 % of games won).
const BACK = 0.35; // a checker left in the opponent's board
const BUILDER = 0.05; // a spare in the outfield (7–11)
const PIP = 0.014; // a pip of lead while the checkers still have to pass
const BLOT = 0.5; // a blot, by the share of rolls that hit it

/** The longest run of own made points and where it starts (lowest point). */
function prime(m: number[]): { len: number; low: number } {
  let best = { len: 0, low: 0 };
  let run = 0;
  for (let i = 1; i <= 24; i++) {
    run = m[i] >= 2 ? run + 1 : 0;
    if (run > best.len) best = { len: run, low: i - run + 1 };
  }
  return best;
}

/** Points made, prime and stacks: what a side's checkers build, the same measure for both sides. */
function structure(m: number[], o: number[]): number {
  let s = 0;
  for (let i = 1; i <= 24; i++) {
    if (m[i] >= 2) s += POINT[i];
    if (m[i] > 3) s -= 0.06 * (m[i] - 3);
  }
  // Checkers left back in the opponent's board are hard to bring home, the more so behind its made points.
  let theirBoard = 0;
  for (let i = 19; i <= 24; i++) if (o[i] >= 2) theirBoard++;
  let back = 0;
  for (let i = 19; i <= 24; i++) back += m[i];
  s -= back * BACK * (1 + theirBoard / 3);
  // Spare checkers in the outfield are builders for the next points at home.
  for (let i = 7; i <= 11; i++) s += Math.min(m[i], 2) * BUILDER;
  const pr = prime(m);
  if (pr.len >= 3) {
    // A prime is worth most with opponent checkers behind it.
    let behind = o[0];
    for (let j = 1; j < pr.low; j++) behind += o[j];
    if (behind) s += 0.25 * (pr.len - 2) ** 1.4;
  }
  return s;
}

/** The score of a position for the side that just moved (`p.m`); the opponent (`p.o`) is to roll. */
export function evaluate(p: Persp): number {
  if (p.m[0] === 15) return 12;
  if (p.o[25] === 15) return -12;
  const me = pips(p);
  const them = oppPips(p);
  if (!contact(p)) {
    // A race: the side on roll is worth about 4 pips; about 8 % ahead wins some 70 %.
    const lead = them - me - 4;
    let s = (10.6 * lead) / Math.max(me, 12);
    // Wasted pips in the bear-off: gaps on the low points and checkers piled high.
    for (let i = 1; i <= 6; i++) if (p.m[i] > 2) s -= 0.02 * (p.m[i] - 2) * i;
    return s + 0.02 * (p.m[0] - p.o[25]);
  }
  let s = PIP * (them - me);
  s += structure(p.m, p.o);
  // The opponent's structure, seen from their side.
  const f = flip(p);
  s -= structure(f.m, f.o);
  // Own blots: the opponent rolls next. Being hit costs the pips back to the bar, and more against a strong board.
  let theirBoard = 0;
  for (let i = 19; i <= 24; i++) if (p.o[i] >= 2) theirBoard++;
  for (let i = 1; i <= 24; i++)
    if (p.m[i] === 1) {
      const n = shots(p, i);
      if (n) s -= BLOT * (n / 36) * (0.35 + (25 - i) / 30) * (1 + theirBoard / 4);
    }
  // Their blots in my home and outfield are targets for my next roll.
  for (let i = 1; i <= 12; i++) if (p.o[i] === 1) s += 0.08;
  let myBoard = 0;
  for (let i = 1; i <= 6; i++) if (p.m[i] >= 2) myBoard++;
  s += p.o[0] * (0.45 + myBoard * 0.12);
  s -= p.m[25] * (0.45 + theirBoard * 0.12);
  s += 0.03 * (p.m[0] - p.o[25]);
  return s;
}

/** A play chosen for a roll, with its score for the side that played it. */
export interface Choice {
  play: Play;
  score: number;
}

/** The chance to win after the opponent's best reply to each of their rolls, averaged: how good `p` (just moved) really is. */
function onePly(p: Persp): number {
  const them = flip(p);
  let sum = 0;
  for (const r of ROLLS) {
    let best = -Infinity;
    for (const q of plays(them, diceOf(r.a, r.b))) best = Math.max(best, evaluate(q.pos));
    sum += r.w * (1 - winChance(best));
  }
  return sum / 36;
}

/** The best play for these dice at a level. `random` gives the beginner its noise. */
export function choosePlay(p: Persp, dice: number[], level: Level, random: () => number): Choice {
  const options = plays(p, dice);
  const scored = options.map((play) => ({ play, score: evaluate(play.pos) }));
  if (level === "beginner") {
    const noisy = scored.map((c) => ({ ...c, n: c.score + gauss(random) * 0.9 }));
    noisy.sort((a, b) => b.n - a.n);
    return noisy[0];
  }
  scored.sort((a, b) => b.score - a.score);
  if (level === "average" || scored.length === 1) return scored[0];
  const top = scored.slice(0, 8).map((c) => ({ play: c.play, score: onePly(c.play.pos) }));
  top.sort((a, b) => b.score - a.score);
  return top[0];
}

function gauss(random: () => number) {
  const u = Math.max(1e-9, random());
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** The chance the side to roll in `p` wins, by its best play over all 21 rolls (average) or the static score. */
export function chanceOnRoll(p: Persp, level: Level): number {
  if (level === "beginner") return winChance(-evaluate(flip(p)));
  let sum = 0;
  for (const r of ROLLS) {
    let best = -Infinity;
    for (const q of plays(p, diceOf(r.a, r.b))) best = Math.max(best, evaluate(q.pos));
    sum += r.w * winChance(best);
  }
  return sum / 36;
}

export interface CubeSituation {
  /** Points each side needs to win the match, own first. */
  need: [number, number];
  value: number;
  /** The opponent stands one point from the match after the Crawford game: double at once. */
  freeDrop: boolean;
}

/** Should the side to roll double? */
export function shouldDouble(p: Persp, level: Level, cube: CubeSituation): boolean {
  if (level === "beginner") return false;
  // A cube that already wins the match is dead for the doubler.
  if (cube.need[0] <= cube.value) return false;
  if (cube.freeDrop) return true;
  const w = chanceOnRoll(p, level);
  // Double from about 68 %, but not when so far ahead that playing on for more is better.
  return w >= 0.68 && w <= 0.9;
}

/** Should the side offered the cube take it? `p` is from the taker's side, the doubler to roll. */
export function shouldTake(p: Persp, level: Level, cube: CubeSituation): boolean {
  if (level === "beginner") return true;
  // Dropping loses the match anyway: take.
  if (cube.need[1] <= cube.value) return true;
  const theirs = chanceOnRoll(flip(p), level);
  return 1 - theirs >= 0.24;
}
