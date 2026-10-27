// Backgammon positions and moves, pure and without the SDK, so the rules, the AI and the tests share them.
//
// The board is kept in absolute points 1–24 with signed counts: White (colour 0) has positive counts and moves from
// 24 down to 1 (home 1–6, bears off below 1); Black (colour 1) has negative counts and moves from 1 up to 24 (home
// 19–24). Move generation works on a position seen by the side to move (`Persp`): its own points numbered 1–24 from
// its home, 25 its bar and 0 its borne-off checkers, so one generator serves both colours.

export type Color = 0 | 1;

export interface Board {
  /** Index 1–24 used; index 0 unused. White positive, Black negative. */
  pts: number[];
  bar: [number, number];
  off: [number, number];
}

/** A position from the mover's side: m[i] own checkers on own point i (25 = bar, 0 = off), o[i] the opponent's on
 *  the mover's point i (1–24), o[0] the opponent's bar, o[25] their borne-off checkers. */
export interface Persp {
  m: number[];
  o: number[];
}

/** One checker moved by one die, in the mover's numbering: from 25 is the bar, to 0 is off. */
export interface Sub {
  from: number;
  to: number;
  die: number;
  hit: boolean;
}

/** An absolute point for the board and the intents: 1–24, or "bar" / "off". */
export type Spot = number | "bar" | "off";

export function startBoard(): Board {
  const pts = new Array(25).fill(0);
  // White: 2 on 24, 5 on 13, 3 on 8, 5 on 6. Black mirrored.
  for (const [p, n] of [[24, 2], [13, 5], [8, 3], [6, 5]] as const) {
    pts[p] += n;
    pts[25 - p] -= n;
  }
  return { pts, bar: [0, 0], off: [0, 0] };
}

export function persp(b: Board, c: Color): Persp {
  const m = new Array(26).fill(0);
  const o = new Array(26).fill(0);
  for (let i = 1; i <= 24; i++) {
    const v = c === 0 ? b.pts[i] : -b.pts[25 - i];
    if (v > 0) m[i] = v;
    else if (v < 0) o[i] = -v;
  }
  m[25] = b.bar[c];
  m[0] = b.off[c];
  o[0] = b.bar[c ^ 1];
  o[25] = b.off[c ^ 1];
  return { m, o };
}

export function absolute(p: Persp, c: Color): Board {
  const pts = new Array(25).fill(0);
  for (let i = 1; i <= 24; i++) {
    if (c === 0) pts[i] = p.m[i] - p.o[i];
    else pts[25 - i] = p.o[i] - p.m[i];
  }
  const bar: [number, number] = c === 0 ? [p.m[25], p.o[0]] : [p.o[0], p.m[25]];
  const off: [number, number] = c === 0 ? [p.m[0], p.o[25]] : [p.o[25], p.m[0]];
  return { pts, bar, off };
}

/** The other side's view of the same position. */
export function flip(p: Persp): Persp {
  const m = new Array(26).fill(0);
  const o = new Array(26).fill(0);
  for (let i = 1; i <= 24; i++) {
    m[i] = p.o[25 - i];
    o[i] = p.m[25 - i];
  }
  m[25] = p.o[0];
  m[0] = p.o[25];
  o[0] = p.m[25];
  o[25] = p.m[0];
  return { m, o };
}

export const clone = (p: Persp): Persp => ({ m: p.m.slice(), o: p.o.slice() });
export const key = (p: Persp) => `${p.m.join(",")}|${p.o.join(",")}`;
export const cloneBoard = (b: Board): Board => ({ pts: b.pts.slice(), bar: [b.bar[0], b.bar[1]], off: [b.off[0], b.off[1]] });

/** Mover's point number to an absolute spot. */
export function toSpot(i: number, c: Color): Spot {
  if (i === 25) return "bar";
  if (i <= 0) return "off";
  return c === 0 ? i : 25 - i;
}
/** An absolute spot to the mover's point number, or null if it is not one. */
export function fromSpot(s: unknown, c: Color): number | null {
  if (s === "bar") return 25;
  if (s === "off") return 0;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1 || n > 24) return null;
  return c === 0 ? n : 25 - n;
}

/** Every own checker is home (points 1–6) or off. */
function allHome(p: Persp): boolean {
  for (let i = 7; i <= 25; i++) if (p.m[i]) return false;
  return true;
}

/** The single moves one die allows. */
export function singles(p: Persp, die: number): Sub[] {
  const out: Sub[] = [];
  const target = (from: number) => {
    const to = from - die;
    if (to >= 1) {
      if (p.o[to] >= 2) return;
      out.push({ from, to, die, hit: p.o[to] === 1 });
      return;
    }
    if (!allHome(p)) return;
    if (to < 0) for (let k = from + 1; k <= 6; k++) if (p.m[k]) return; // a larger die bears off only the highest checker
    out.push({ from, to: 0, die, hit: false });
  };
  if (p.m[25]) {
    target(25);
    return out;
  }
  for (let i = 24; i >= 1; i--) if (p.m[i]) target(i);
  return out;
}

export function apply(p: Persp, s: Sub): Persp {
  const q = clone(p);
  q.m[s.from]--;
  if (s.to >= 1) {
    if (q.o[s.to] === 1) {
      q.o[s.to] = 0;
      q.o[0]++;
    }
    q.m[s.to]++;
  } else q.m[0]++;
  return q;
}

/** The dice a roll gives: two, or four of a double. */
export const diceOf = (a: number, b: number) => (a === b ? [a, a, a, a] : [a, b]);

function without(dice: number[], d: number) {
  const i = dice.indexOf(d);
  return i < 0 ? dice : [...dice.slice(0, i), ...dice.slice(i + 1)];
}
const distinct = (dice: number[]) => [...new Set(dice)];

/** The most dice that can be played from here (stops early once all of them can). */
export function maxPlayable(p: Persp, dice: number[]): number {
  if (!dice.length) return 0;
  let best = 0;
  for (const d of distinct(dice)) {
    for (const s of singles(p, d)) {
      const n = 1 + maxPlayable(apply(p, s), without(dice, d));
      if (n > best) best = n;
      if (best === dice.length) return best;
    }
  }
  return best;
}

/**
 * What a turn must use: `max` dice (as many as can be played), and with two different dice of which only one can be
 * played, the larger if it can be (`larger`).
 */
export interface TurnRule {
  max: number;
  larger: number | null;
}

export function turnRule(p: Persp, dice: number[]): TurnRule {
  const max = maxPlayable(p, dice);
  let larger: number | null = null;
  if (max === 1 && dice.length === 2 && dice[0] !== dice[1]) {
    const hi = Math.max(dice[0], dice[1]);
    if (singles(p, hi).length) larger = hi;
  }
  return { max, larger };
}

/**
 * The single moves allowed now, after `played` dice of the turn: each must leave a way to play the rest the turn must
 * use (`rule.max` in all).
 */
export function legalNow(p: Persp, remaining: number[], rule: TurnRule, played: number): Sub[] {
  const need = rule.max - played;
  if (need <= 0) return [];
  const out: Sub[] = [];
  for (const d of distinct(remaining)) {
    if (played === 0 && rule.larger !== null && d !== rule.larger) continue;
    for (const s of singles(p, d)) if (maxPlayable(apply(p, s), without(remaining, d)) >= need - 1) out.push(s);
  }
  return out;
}

/** A complete play: its moves in order and the position it leads to. */
export interface Play {
  moves: Sub[];
  pos: Persp;
}

/** Every distinct position a whole turn can lead to (one move list each), following the dice rules. */
export function plays(p: Persp, dice: number[]): Play[] {
  const rule = turnRule(p, dice);
  if (rule.max === 0) return [{ moves: [], pos: p }];
  const out = new Map<string, Play>();
  const seen = new Set<string>();
  const walk = (q: Persp, rem: number[], moves: Sub[]) => {
    if (moves.length === rule.max) {
      const k = key(q);
      if (!out.has(k)) out.set(k, { moves, pos: q });
      return;
    }
    const k = `${moves.length}|${rem.join("")}|${key(q)}`;
    if (seen.has(k)) return;
    seen.add(k);
    for (const s of legalNow(q, rem, rule, moves.length)) walk(apply(q, s), without(rem, s.die), [...moves, s]);
  };
  walk(p, dice, []);
  return [...out.values()];
}

/**
 * The moves that take one checker from `from` to `to` now, by one die or several in a row (13/7/1), each step legal;
 * the fewest dice, and among single dice the exact one, else the smallest that works. Null if there is none.
 */
export function path(p: Persp, remaining: number[], rule: TurnRule, played: number, from: number, to: number): Sub[] | null {
  let best: Sub[] | null = null;
  const walk = (q: Persp, rem: number[], at: number, moves: Sub[]) => {
    if (best && moves.length >= best.length) return;
    for (const s of legalNow(q, rem, rule, played + moves.length)) {
      if (s.from !== at) continue;
      const next = [...moves, s];
      if (s.to === to) {
        if (!best || next.length < best.length || (next.length === best.length && better(s, best[0], from, to))) best = next;
        continue;
      }
      if (s.to >= 1) walk(apply(q, s), without(rem, s.die), s.to, next);
    }
  };
  walk(p, remaining, from, []);
  return best;
}
/** Every spot the checker on `from` can reach now, by one die or several in a row, with the fewest dice for each. */
export function reach(p: Persp, remaining: number[], rule: TurnRule, played: number, from: number): Map<number, number> {
  const out = new Map<number, number>();
  const walk = (q: Persp, rem: number[], at: number, steps: number) => {
    for (const s of legalNow(q, rem, rule, played + steps - 1)) {
      if (s.from !== at) continue;
      if (!out.has(s.to) || out.get(s.to)! > steps) out.set(s.to, steps);
      if (s.to >= 1) walk(apply(q, s), without(rem, s.die), s.to, steps + 1);
    }
  };
  walk(p, remaining, from, 1);
  return out;
}

/** Of two single dice that bear the same checker off: the exact one, else the smaller. */
function better(a: Sub, b: Sub, from: number, to: number) {
  if (to !== 0) return a.die < b.die;
  const exact = (s: Sub) => s.die === from;
  if (exact(a) !== exact(b)) return exact(a);
  return a.die < b.die;
}

export const pips = (p: Persp) => {
  let n = 25 * p.m[25];
  for (let i = 1; i <= 24; i++) n += i * p.m[i];
  return n;
};
export const oppPips = (p: Persp) => {
  let n = 25 * p.o[0];
  for (let i = 1; i <= 24; i++) n += (25 - i) * p.o[i];
  return n;
};

/** Do the two sides still have to pass each other? */
export function contact(p: Persp): boolean {
  if (p.m[25] || p.o[0]) return true;
  let myBack = 0;
  for (let i = 24; i >= 1; i--)
    if (p.m[i]) {
      myBack = i;
      break;
    }
  for (let j = 1; j <= 24; j++) if (p.o[j]) return j < myBack;
  return false;
}

/** How a finished game counts for the side that bore off all its checkers (`p` from the winner's side). */
export function winKind(p: Persp): 1 | 2 | 3 {
  if (p.o[25] > 0) return 1;
  if (p.o[0] > 0) return 3;
  for (let i = 1; i <= 6; i++) if (p.o[i]) return 3;
  return 2;
}

/** A turn's moves in notation, joining a checker's steps (13/7/2*) and counting repeats (8/5(2)). */
export function playText(moves: Sub[]): string {
  if (!moves.length) return "(no move)";
  // A move from where an earlier one ended goes on with that checker (the latest such): 13/7*/5. Points it only
  // passed are left out unless it hit there.
  const chains: Sub[][] = [];
  for (const s of moves) {
    const last = chains.findLast((ch) => ch.at(-1)!.to === s.from);
    if (last) last.push(s);
    else chains.push([s]);
  }
  const spot = (n: number) => (n === 25 ? "bar" : n === 0 ? "off" : String(n));
  const texts = chains.map((ch) => {
    let t = spot(ch[0].from);
    ch.forEach((s, k) => {
      if (s.hit || k === ch.length - 1) t += `/${spot(s.to)}${s.hit ? "*" : ""}`;
    });
    return t;
  });
  const counted = new Map<string, number>();
  for (const t of texts) counted.set(t, (counted.get(t) ?? 0) + 1);
  return [...counted].map(([t, n]) => (n > 1 ? `${t}(${n})` : t)).join(" ");
}
