// wildbg in TypeScript (E-039): the neural-network backgammon engine by Carsten Wenderdel,
// https://github.com/carsten-wenderdel/wildbg, ported from its Rust source (crates/engine: inputs.rs, position.rs,
// evaluator.rs, probabilities.rs; crates/logic: cube.rs). wildbg's code is licensed under Apache-2.0 or MIT, at your
// option; this port is used under the MIT licence (see LICENSE in this folder). The networks (contact.ts, race.ts) are
// wildbg's trained nets, CC0-1.0. Only the AI uses this: the rules never do, so games replay without it.
import { type Persp, type Play, flip, plays, winKind } from "../bg.ts";

/** Win normal, gammon, backgammon; lose normal, gammon, backgammon: for the side to move, adding up to 1. */
export type Probs = [number, number, number, number, number, number];

interface Net {
  inputs: number;
  /** Per layer: weights [out × in] row-major, then the biases. */
  layers: { w: Float32Array; b: Float32Array; out: number; inn: number }[];
  hidden: (x: number) => number;
}

const SIZES = [300, 250, 200, 6];
const hardSigmoid = (x: number) => (x <= -3 ? 0 : x >= 3 ? 1 : x / 6 + 0.5);
const relu = (x: number) => (x > 0 ? x : 0);

function decode(b64: string, inputs: number, hidden: (x: number) => number): Net {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const all = new Float32Array(bytes.buffer);
  const layers: Net["layers"] = [];
  let at = 0;
  let inn = inputs;
  for (const out of SIZES) {
    const w = all.subarray(at, (at += out * inn));
    const b = all.subarray(at, (at += out));
    layers.push({ w, b, out, inn });
    inn = out;
  }
  if (at !== all.length) throw new Error(`wildbg net: ${all.length} numbers, expected ${at}`);
  return { inputs, layers, hidden };
}

export interface Nets {
  contact: Net;
  race: Net;
}
let loaded: Promise<Nets> | null = null;
/** The two networks, read once, when a wildbg level first plays (about 1.5 MB). */
export function loadNets(): Promise<Nets> {
  return (loaded ??= Promise.all([import("./contact.ts"), import("./race.ts")]).then(([c, r]) => ({
    contact: decode(c.default, 202, hardSigmoid),
    race: decode(r.default, 186, relu),
  })));
}

// ----- inputs: the position as wildbg sees it, from the side to move -----

/** wildbg's pips: index 1–24 the mover's points (own checkers positive, the opponent's negative), 25 the mover's bar,
 *  0 the opponent's bar (negative). */
function pipsOf(p: Persp): number[] {
  const pips = new Array(26).fill(0);
  for (let i = 1; i <= 24; i++) pips[i] = p.m[i] - p.o[i];
  pips[25] = p.m[25];
  pips[0] = -p.o[0];
  return pips;
}

/** Four inputs for one point from one side: 1 checker, 2 checkers, 3 or more, and how many over 3. */
function td(n: number, out: Float64Array, at: number) {
  if (n <= 0) return;
  if (n === 1) out[at] = 1;
  else if (n === 2) out[at + 1] = 1;
  else (out[at + 2] = 1), (out[at + 3] = n - 3);
}

/** Contact: some checkers still have to pass each other (wildbg's GamePhase::Contact). */
export function isContact(p: Persp): boolean {
  const pips = pipsOf(p);
  let lastOwn = -1;
  for (let i = 25; i >= 0; i--) if (pips[i] > 0) (lastOwn = i), (i = -1);
  let firstTheirs = 26;
  for (let i = 0; i <= 25; i++) if (pips[i] < 0) (firstTheirs = i), (i = 26);
  return lastOwn > firstTheirs;
}

export function contactInputs(p: Persp): Float64Array {
  const pips = pipsOf(p);
  const x = new Float64Array(202);
  x[0] = p.m[0];
  x[1] = p.o[25];
  td(pips[25], x, 2);
  for (let i = 0; i < 24; i++) td(pips[1 + i], x, 6 + 4 * i);
  for (let i = 0; i < 25; i++) td(-pips[i], x, 102 + 4 * i);
  return x;
}

export function raceInputs(p: Persp): Float64Array {
  const pips = pipsOf(p);
  const x = new Float64Array(186);
  x[0] = p.m[0];
  x[1] = p.o[25];
  for (let i = 0; i < 23; i++) td(pips[1 + i], x, 2 + 4 * i);
  for (let i = 0; i < 23; i++) td(-pips[2 + i], x, 94 + 4 * i);
  return x;
}

function forward(net: Net, input: Float64Array): Probs {
  let x = input;
  for (let l = 0; l < net.layers.length; l++) {
    const { w, b, out, inn } = net.layers[l];
    const y = new Float64Array(out);
    for (let j = 0; j < out; j++) {
      let s = b[j];
      const row = j * inn;
      for (let i = 0; i < inn; i++) s += w[row + i] * x[i];
      y[j] = l < net.layers.length - 1 ? net.hidden(s) : s;
    }
    x = y;
  }
  let max = -Infinity;
  for (const v of x) max = Math.max(max, v);
  let sum = 0;
  const e = Array.from(x, (v) => ((v = Math.exp(v - max)), (sum += v), v));
  return e.map((v) => v / sum) as Probs;
}

/** The side to move's chances in `p` (wildbg's CompositeEvaluator::eval). */
export function evaluate(nets: Nets, p: Persp): Probs {
  if (p.o[25] === 15) {
    // The opponent bore off their last checker: lost, as a gammon or backgammon by where the mover's checkers are.
    const k = winKind(flip(p));
    return [0, 0, 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0, k === 3 ? 1 : 0];
  }
  return isContact(p) ? forward(nets.contact, contactInputs(p)) : forward(nets.race, raceInputs(p));
}

export const switchSides = (q: Probs): Probs => [q[3], q[4], q[5], q[0], q[1], q[2]];
/** Cubeless equity: points won on average for one point at stake. */
export const equity = (q: Probs) => q[0] - q[3] + 2 * (q[1] - q[4]) + 3 * (q[2] - q[5]);
export const winChance = (q: Probs) => q[0] + q[1] + q[2];

/** Our chances after a play, which leaves the opponent to move. */
function after(nets: Nets, pos: Persp): Probs {
  if (pos.m[0] === 15) {
    const k = winKind(pos);
    return [k === 1 ? 1 : 0, k === 2 ? 1 : 0, k === 3 ? 1 : 0, 0, 0, 0];
  }
  return switchSides(evaluate(nets, flip(pos)));
}

export interface Ranked {
  play: Play;
  probs: Probs;
  equity: number;
}

/** Every play for these dice, best first by equity after it (wildbg's best_position_by_equity, 0-ply). */
export function rankPlays(nets: Nets, p: Persp, dice: number[]): Ranked[] {
  const out = plays(p, dice).map((play) => {
    const probs = after(nets, play.pos);
    return { play, probs, equity: equity(probs) };
  });
  // Ties keep the order the plays were found in, so the choice is the same everywhere.
  return out.sort((a, b) => b.equity - a.equity);
}

const ROLLS21: { a: number; b: number; w: number }[] = [];
for (let a = 1; a <= 6; a++) for (let b = a; b <= 6; b++) ROLLS21.push({ a, b, w: a === b ? 1 : 2 });
const diceFor = (a: number, b: number) => (a === b ? [a, a, a, a] : [a, b]);

/** Our equity after a play, looking one roll further: the opponent answers each of the 21 rolls with their best. */
export function onePly(nets: Nets, pos: Persp): number {
  if (pos.m[0] === 15) return equity(after(nets, pos));
  const them = flip(pos);
  let sum = 0;
  for (const r of ROLLS21) {
    let worst = Infinity;
    for (const reply of plays(them, diceFor(r.a, r.b))) worst = Math.min(worst, ourAfterReply(nets, reply.pos));
    sum += r.w * worst;
  }
  return sum / 36;
}

/** Our equity, to move, after the opponent's reply `reply` (from their side). */
function ourAfterReply(nets: Nets, reply: Persp): number {
  if (reply.m[0] === 15) return -equity(after(nets, reply));
  return equity(evaluate(nets, flip(reply)));
}

// ----- the cube (wildbg's crates/logic/src/cube.rs: Janowski's money formulas, cube efficiency 2/3) -----

const CUBE_EFFICIENCY = 2 / 3;

export interface CubeView {
  double: boolean;
  take: boolean;
}

/** For the side to roll with these chances: should they double, and should the other side take? */
export function cubeDecision(q: Probs): CubeView {
  const x = CUBE_EFFICIENCY;
  const p = winChance(q);
  const lose = 1 - p;
  const w = p > 0 ? (q[0] + 2 * q[1] + 3 * q[2]) / p : 0;
  const l = lose > 0 ? (q[3] + 2 * q[4] + 3 * q[5]) / lose : 0;
  const common = p * (w + l + 0.5 * x) - l;
  const noDouble = (4 / (4 - x)) * (common - 0.25 * x);
  const doubleTake = 2 * (common - 0.5 * x);
  return { double: Math.min(doubleTake, 1) > noDouble, take: doubleTake < 1 };
}
