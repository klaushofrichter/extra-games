// Backgammon for two players on Game Table, played as a match to a number of points with the doubling cube and the
// Crawford rule. The board draws the game and takes the moves (tap a checker, then where it goes; tap the dice to
// roll); the phones roll, double, take or pass, undo and end the turn, and list the moves. AI players play at three
// strengths. Who plays a seat may change during the match (the board exchanges players, games-service D-159): the colour,
// the score and the cube stay with the seat, only the name changes. The stand-in (a player who left, replaced by the
// rules' own AI) is kept only so that logs from before D-159 still replay: the platform no longer takes a player away.
//
// A turn: roll (or double first), move the dice one checker at a time (each move can be taken back until the turn
// ends), then Done. With no legal move the turn passes by itself after a moment. Bearing off the last checker ends
// the game at once. Undo is one setting for the match (E-032): all moves of the turn, or none, and then the turn ends
// by itself once the dice are played. Roll for me is each player's own: their dice are rolled as their turn begins, or
// after a short pause in which they can still double, when they could (E-031, E-032). Both are lobby settings and
// change during the match.
import { count, defineGame, type GameContext, type StepInfo } from "@game-table/sdk";
import {
  absolute,
  apply,
  cloneBoard,
  diceOf,
  fromSpot,
  legalNow,
  path,
  persp,
  pips,
  playText,
  reach,
  startBoard,
  toSpot,
  turnRule,
  winKind,
  type Board,
  type Color,
  type Spot,
  type Sub,
  type TurnRule,
} from "./bg.ts";
import { LEVELS, choosePlay, shouldDouble, shouldTake, type CubeSituation, type Level } from "./ai.ts";

/** How long a turn with no legal move stays on the board before it passes (the dice tumble for 1.3 s of it, E-031). */
const PASS_MS = 2600;
/** The stand-in's pause before each of its steps, so the board can be followed. */
const STAND_IN_MS = 800;
/** Roll for me, when the player could double first: the pause in which they still can (E-032). */
export const AUTO_ROLL_MS = 3000;
/** Between the games of a match; the board can skip it ("Next game"). */
export const NEXT_MS = 9000;
/** The cube stops here. */
const CUBE_MAX = 64;
/** The longest match the settings offer (E-015). */
const MATCH_MAX = 100;

export type Kind = "single" | "gammon" | "backgammon" | "pass";

export interface GameRecord {
  game: number;
  winner: Color;
  points: number;
  kind: Kind;
  cube: number;
  /** The match score after this game, by colour. */
  score: [number, number];
}

export interface SideStats {
  hits: number;
  doubles: number;
  pipsRolled: number;
  rolls: number;
  entered: number;
  gamesWon: number;
  gammons: number;
  cubes: number;
}

/** A player's own options (E-031): taking moves back, and rolling for them. */
export interface Options {
  /** "all": every move of the turn can be taken back until Done; "none": no Undo, and the turn ends by itself. */
  undo: "all" | "none";
  /** Roll for the player as their turn begins, when they could not double first. */
  autoRoll: boolean;
}
const DEFAULT_OPTIONS: Options = { undo: "all", autoRoll: false };

export interface TurnPlay {
  color: Color;
  dice: [number, number];
  text: string;
  opening?: boolean;
}

export interface State {
  /** Seat by colour: [white, black]. */
  seats: [number, number];
  names: Record<number, string>;
  board: Board;
  phase: "roll" | "move" | "double" | "gameOver" | "over";
  turn: Color;
  /** The roll being played (or just played): white's and black's die for the opening roll. */
  dice: [number, number] | null;
  remaining: number[];
  rule: TurnRule;
  /** Dice used this turn. */
  played: number;
  /** This turn's moves so far, in the mover's numbering. */
  turnMoves: Sub[];
  /** What each move of this turn changed, for Undo: the board and dice before it, and how many moves it made. */
  undo: { board: Board; remaining: number[]; played: number; moves: number }[];
  /** The opening roll of this game: white's die and black's die. */
  opening: [number, number] | null;
  cube: { enabled: boolean; value: number; owner: Color | null };
  match: { length: number; score: [number, number]; game: number; crawford: boolean; postCrawford: boolean };
  /** This game's turns, oldest first. */
  plays: TurnPlay[];
  games: GameRecord[];
  stats: [SideStats, SideStats];
  turnMs: number;
  /** Seats the stand-in plays because their player left (only in logs from before games-service D-159). */
  standIn: number[];
  /** Each colour's options (E-031); missing in logs from before, which played as the defaults. */
  options?: [Options, Options];
  result: null | { winner: Color; reason: "match" };
}

const COLOR_NAME = ["White", "Black"];
const colorOf = (s: State, seat: number): Color | null => (s.seats[0] === seat ? 0 : s.seats[1] === seat ? 1 : null);
const seatName = (s: State, c: Color) => s.names[s.seats[c]] ?? COLOR_NAME[c];
const emptyStats = (): SideStats => ({ hits: 0, doubles: 0, pipsRolled: 0, rolls: 0, entered: 0, gamesWon: 0, gammons: 0, cubes: 0 });
/** Both sides' statistics, copied so a step can change them. */
const copyStats = (s: State) => s.stats.map((x) => ({ ...x })) as [SideStats, SideStats];
const NO_RULE: TurnRule = { max: 0, larger: null };
const optionsOf = (s: State, c: Color): Options => s.options?.[c] ?? DEFAULT_OPTIONS;

type Ev = { name: string; data?: unknown };
type Out = { state: State; events: Ev[] };

/** Who has to act now: the mover, or the player answering a double. */
export function actor(s: State): Color | null {
  if (s.phase === "roll" || s.phase === "move") return s.turn;
  if (s.phase === "double") return (s.turn ^ 1) as Color;
  return null;
}

/** May the side on roll offer the cube now? */
export function canDouble(s: State): boolean {
  const c = s.cube;
  if (s.phase !== "roll" || !c.enabled || s.match.crawford || c.value >= CUBE_MAX) return false;
  if (c.owner !== null && c.owner !== s.turn) return false;
  // A cube that would already win the match is dead: doubling it changes nothing.
  return s.match.score[s.turn] + c.value < s.match.length;
}

function legal(s: State): Sub[] {
  if (s.phase !== "move") return [];
  return legalNow(persp(s.board, s.turn), s.remaining, s.rule, s.played);
}

function arm(s: State, ctx: GameContext) {
  ctx.clearTimer("turn");
  ctx.clearTimer("standin");
  const who = actor(s);
  if (who === null) return;
  if (s.standIn.includes(s.seats[who])) ctx.setTimer("standin", STAND_IN_MS);
  else if (s.turnMs > 0 && !(s.phase === "move" && s.rule.max === 0)) ctx.setTimer("turn", s.turnMs);
}

/** The turn's moves begin with these dice; with none possible, it passes after a moment. */
function beginMoves(s: State, ctx: GameContext): State {
  const remaining = diceOf(s.dice![0], s.dice![1]);
  const rule = turnRule(persp(s.board, s.turn), remaining);
  const next: State = { ...s, phase: "move", remaining, rule, played: 0, turnMoves: [], undo: [] };
  if (rule.max === 0) ctx.setTimer("pass", PASS_MS);
  arm(next, ctx);
  return next;
}

/** A new game of the match: the checkers set up, the cube in the middle, and the opening roll decides who starts. */
function startGame(s: State, ctx: GameContext): Out {
  let w = 0;
  let b = 0;
  let rerolls = 0;
  do {
    w = ctx.randomInt(1, 6);
    b = ctx.randomInt(1, 6);
    if (w === b) rerolls++;
  } while (w === b);
  const turn: Color = w > b ? 0 : 1;
  const stats = copyStats(s);
  stats[turn].rolls++;
  stats[turn].pipsRolled += w + b;
  const base: State = {
    ...s,
    board: startBoard(),
    turn,
    dice: [w, b],
    opening: [w, b],
    cube: { ...s.cube, value: 1, owner: null },
    plays: [],
    stats,
  };
  const next = beginMoves(base, ctx);
  return { state: next, events: [{ name: "opening", data: { game: s.match.game, white: w, black: b, starts: turn, rerolls } }] };
}

function roll(s: State, ctx: GameContext): Out {
  ctx.clearTimer("autoroll");
  const a = ctx.randomInt(1, 6);
  const b = ctx.randomInt(1, 6);
  const stats = copyStats(s);
  const st = stats[s.turn];
  st.rolls++;
  st.pipsRolled += a === b ? 4 * a : a + b;
  if (a === b) st.doubles++;
  const next = beginMoves({ ...s, dice: [a, b], opening: null, stats }, ctx);
  const events: Ev[] = [{ name: "rolled", data: { color: s.turn, dice: [a, b] } }];
  if (next.rule.max === 0) events.push({ name: "blocked", data: { color: s.turn } });
  return { state: next, events };
}

/** Moves one checker along `subs` (one die each), for the side to move. */
function move(s: State, subs: Sub[], ctx: GameContext, by: "player" | "auto"): Out {
  const c = s.turn;
  let p = persp(s.board, c);
  let remaining = s.remaining;
  const stats = copyStats(s);
  const events: Ev[] = [];
  for (const sub of subs) {
    p = apply(p, sub);
    const i = remaining.indexOf(sub.die);
    remaining = [...remaining.slice(0, i), ...remaining.slice(i + 1)];
    if (sub.hit) stats[c].hits++;
    if (sub.from === 25) stats[c].entered++;
    events.push({ name: "moved", data: { color: c, from: toSpot(sub.from, c), to: toSpot(sub.to, c), die: sub.die, hit: sub.hit, auto: by === "auto" } });
  }
  const next: State = {
    ...s,
    board: absolute(p, c),
    remaining,
    played: s.played + subs.length,
    turnMoves: [...s.turnMoves, ...subs],
    undo: [...s.undo, { board: s.board, remaining: s.remaining, played: s.played, moves: subs.length }],
    stats,
  };
  if (p.m[0] === 15) {
    ctx.clearTimer("turn");
    ctx.clearTimer("standin");
    const kind = winKind(p);
    const ended = endGame(record(next), c, kind * s.cube.value, kind === 1 ? "single" : kind === 2 ? "gammon" : "backgammon", ctx);
    return { state: ended.state, events: [...events, ...ended.events] };
  }
  // The stand-in goes on step by step; a person ends the turn with Done, or without Undo it ends by itself (E-031).
  if (next.standIn.includes(next.seats[c])) arm(next, ctx);
  else if (by === "player" && optionsOf(next, c).undo === "none" && !legal(next).length) {
    const end = endTurn(next, ctx);
    return { state: end.state, events: [...events, ...end.events] };
  }
  return { state: next, events };
}

/** This turn's play into the game's list. */
function record(s: State): State {
  if (!s.dice) return s;
  return { ...s, plays: [...s.plays, { color: s.turn, dice: s.dice, text: playText(s.turnMoves), ...(s.opening ? { opening: true } : {}) }] };
}

function endTurn(s: State, ctx: GameContext): Out {
  ctx.clearTimer("pass");
  const done = record(s);
  const turn = (s.turn ^ 1) as Color;
  const next: State = { ...done, turn, phase: "roll", remaining: [], rule: NO_RULE, played: 0, turnMoves: [], undo: [], opening: null };
  arm(next, ctx);
  return autoRoll({ state: next, events: [{ name: "turn", data: { color: turn } }] }, ctx);
}

/**
 * Rolls for the side on roll when their option says so (E-031). When they could double first, the roll waits
 * AUTO_ROLL_MS ("autoroll" timer), so the choice to double stays theirs (E-032). Not for a stand-in, which rolls on
 * its own timer.
 */
function autoRoll(out: Out, ctx: GameContext): Out {
  const s = out.state;
  if (s.phase !== "roll" || !optionsOf(s, s.turn).autoRoll || s.standIn.includes(s.seats[s.turn])) return out;
  if (canDouble(s)) {
    ctx.setTimer("autoroll", AUTO_ROLL_MS);
    return out;
  }
  return rolledFor(out, roll(s, ctx));
}
/** A roll made by Roll for me: its "rolled" event says so. */
function rolledFor(out: Out, r: Out): Out {
  return { state: r.state, events: [...out.events, ...r.events.map((e) => (e.name === "rolled" ? { ...e, data: { ...(e.data as object), auto: true } } : e))] };
}

function endGame(s: State, winner: Color, points: number, kind: Kind, ctx: GameContext): Out {
  ctx.clearTimer("autoroll");
  ctx.clearTimer("turn");
  ctx.clearTimer("standin");
  ctx.clearTimer("pass");
  const score: [number, number] = [s.match.score[0], s.match.score[1]];
  score[winner] = Math.min(s.match.length, score[winner] + points);
  const stats = copyStats(s);
  stats[winner].gamesWon++;
  if (kind === "gammon" || kind === "backgammon") stats[winner].gammons++;
  const rec: GameRecord = { game: s.match.game, winner, points, kind, cube: s.cube.value, score };
  const events: Ev[] = [{ name: "gameWon", data: rec }];
  if (score[winner] >= s.match.length) {
    const state: State = { ...s, phase: "over", remaining: [], rule: NO_RULE, played: 0, undo: [], match: { ...s.match, score }, games: [...s.games, rec], stats, result: { winner, reason: "match" } };
    events.push({ name: "matchWon", data: { winner, score } });
    return { state, events };
  }
  // The Crawford rule: the first game after a player reaches match point is played without the cube.
  const wasCrawford = s.match.crawford;
  const crawford = !wasCrawford && !s.match.postCrawford && s.cube.enabled && s.match.length > 1 && (score[0] === s.match.length - 1 || score[1] === s.match.length - 1);
  const state: State = {
    ...s,
    phase: "gameOver",
    remaining: [],
    rule: NO_RULE,
    played: 0,
    undo: [],
    match: { ...s.match, score, crawford, postCrawford: s.match.postCrawford || wasCrawford },
    games: [...s.games, rec],
    stats,
  };
  ctx.setTimer("next", NEXT_MS);
  return { state, events };
}

function cubeSituation(s: State, me: Color): CubeSituation {
  const need: [number, number] = [s.match.length - s.match.score[me], s.match.length - s.match.score[me ^ 1]];
  return { need, value: s.cube.value, freeDrop: s.match.postCrawford && need[1] === 1 && need[0] > 1 };
}

/**
 * One step for a side the rules play themselves: the stand-in, or the turn timer for a slow player. The timer takes a
 * double for the player and never doubles for them (E-013): a slow player must not lose a game by it.
 */
function autoStep(s: State, ctx: GameContext, whole: boolean): Out {
  const who = actor(s);
  if (who === null) return { state: s, events: [] };
  const level: Level = "average";
  const standIn = s.standIn.includes(s.seats[who]);
  if (s.phase === "double") {
    const take = !standIn || shouldTake(persp(s.board, who), level, cubeSituation(s, who));
    return take ? takeCube(s) : passCube(s, ctx);
  }
  if (s.phase === "roll") {
    if (standIn && canDouble(s) && shouldDouble(persp(s.board, who), level, cubeSituation(s, who))) return offer(s, ctx);
    const r = roll(s, ctx);
    if (!whole || r.state.phase !== "move") return r;
    const rest = autoStep(r.state, ctx, true);
    return { state: rest.state, events: [...r.events, ...rest.events] };
  }
  if (s.phase === "move") {
    if (!legal(s).length) return endTurn(s, ctx);
    const plan = choosePlay(persp(s.board, s.turn), s.remaining, level, ctx.random).play.moves;
    const m = move(s, whole ? plan : plan.slice(0, 1), ctx, "auto");
    if (!whole || m.state.phase !== "move") return m;
    const end = endTurn(m.state, ctx);
    return { state: end.state, events: [...m.events, ...end.events] };
  }
  return { state: s, events: [] };
}

function offer(s: State, ctx: GameContext): Out {
  ctx.clearTimer("autoroll");
  const stats = copyStats(s);
  stats[s.turn].cubes++;
  const next: State = { ...s, phase: "double", stats };
  arm(next, ctx);
  return { state: next, events: [{ name: "doubled", data: { by: s.turn, value: s.cube.value * 2 } }] };
}

function takeCube(s: State): Out {
  const taker = (s.turn ^ 1) as Color;
  const next: State = { ...s, phase: "roll", cube: { ...s.cube, value: s.cube.value * 2, owner: taker } };
  return { state: next, events: [{ name: "took", data: { by: taker, value: next.cube.value } }] };
}

function passCube(s: State, ctx: GameContext): Out {
  const r = endGame(s, s.turn, s.cube.value, "pass", ctx);
  return { state: r.state, events: [{ name: "passed", data: { by: s.turn ^ 1, value: s.cube.value } }, ...r.events] };
}

/**
 * A player changes their own options (E-031), at any time: { undo?: "all" | "none", autoRoll?: boolean }. Turning
 * Undo off in the middle of a turn whose dice are all played ends it, as it would have ended by itself; turning
 * auto-roll on while it is their roll rolls for them.
 */
function setOptions(s: State, color: Color, payload: unknown, ctx: GameContext): Out | { reject: string } {
  const o = (payload ?? {}) as { undo?: unknown; autoRoll?: unknown };
  if (o.undo !== undefined && o.undo !== "all" && o.undo !== "none") return { reject: "Undo is all or none" };
  if (o.autoRoll !== undefined && typeof o.autoRoll !== "boolean") return { reject: "Auto-roll is on or off" };
  const mine: Options = { ...optionsOf(s, color), ...(o.undo !== undefined ? { undo: o.undo } : {}), ...(o.autoRoll !== undefined ? { autoRoll: o.autoRoll } : {}) };
  const options: [Options, Options] = [optionsOf(s, 0), optionsOf(s, 1)];
  options[color] = mine;
  const next: State = { ...s, options };
  const out: Out = { state: next, events: [{ name: "options", data: { color, ...mine } }] };
  if (o.autoRoll === false && s.turn === color) ctx.clearTimer("autoroll");
  if (s.result || s.turn !== color || s.standIn.includes(s.seats[color])) return out;
  return autoRoll(endIfDone(out, ctx), ctx);
}

/** Undo turned off after the last move of a turn: it ends, as it would have ended by itself. */
function endIfDone(out: Out, ctx: GameContext): Out {
  const s = out.state;
  if (s.phase !== "move" || optionsOf(s, s.turn).undo !== "none" || s.rule.max === 0 || legal(s).length) return out;
  const end = endTurn(s, ctx);
  return { state: end.state, events: [...out.events, ...end.events] };
}

/**
 * Undo for the whole match (E-032): { undo: "all" | "none" }, from either player, at any time. (The "options" intent
 * still takes a player's own undo, so logs from E-031 replay as they were played.)
 */
function setUndo(s: State, payload: unknown, ctx: GameContext): Out | { reject: string } {
  const undo = (payload as { undo?: unknown } | null)?.undo;
  if (undo !== "all" && undo !== "none") return { reject: "Undo is all or none" };
  const options: [Options, Options] = [{ ...optionsOf(s, 0), undo }, { ...optionsOf(s, 1), undo }];
  const out: Out = { state: { ...s, options }, events: [{ name: "undoMode", data: { undo } }] };
  return s.result ? out : endIfDone(out, ctx);
}

/** A move from an intent: { from, to, die? } in absolute spots (1–24, "bar", "off"). */
function subsFromPayload(s: State, payload: unknown): Sub[] | string {
  const o = (payload ?? {}) as { from?: unknown; to?: unknown; die?: unknown };
  const from = fromSpot(o.from, s.turn);
  const to = fromSpot(o.to, s.turn);
  if (from === null || to === null || from === 0 || to === 25) return "Say where the checker comes from and where it goes";
  const p = persp(s.board, s.turn);
  if (o.die !== undefined) {
    const one = legal(s).find((x) => x.from === from && x.to === to && x.die === Number(o.die));
    return one ? [one] : "That move isn't legal";
  }
  const steps = path(p, s.remaining, s.rule, s.played, from, to);
  return steps ?? "That move isn't legal";
}

// ---------- what the board and the phones see ----------
function publicView(s: State) {
  const lg = legal(s);
  const c = s.turn;
  const p = persp(s.board, c);
  const targets: { from: Spot; to: Spot; steps: number }[] = [];
  if (s.phase === "move")
    for (const from of new Set(lg.map((x) => x.from)))
      for (const [to, steps] of reach(p, s.remaining, s.rule, s.played, from)) targets.push({ from: toSpot(from, c), to: toSpot(to, c), steps });
  const who = actor(s);
  return {
    phase: s.phase,
    turn: c,
    turnSeat: s.phase === "roll" || s.phase === "move" ? s.seats[c] : null,
    actorSeat: who === null ? null : s.seats[who],
    seats: s.seats,
    names: s.names,
    points: s.board.pts,
    bar: s.board.bar,
    off: s.board.off,
    pips: [pips(persp(s.board, 0)), pips(persp(s.board, 1))],
    dice: s.dice,
    remaining: s.remaining,
    opening: s.opening,
    legal: lg.map((x) => ({ from: toSpot(x.from, c), to: toSpot(x.to, c), die: x.die, hit: x.hit })),
    targets,
    blocked: s.phase === "move" && s.rule.max === 0,
    canUndo: s.phase === "move" && s.undo.length > 0 && optionsOf(s, c).undo === "all",
    canDone: s.phase === "move" && s.rule.max > 0 && lg.length === 0,
    canDouble: canDouble(s),
    cube: s.cube,
    match: s.match,
    turnMoves: s.phase === "move" ? playText(s.turnMoves) : "",
    plays: s.plays,
    games: s.games,
    lastGame: s.games.at(-1) ?? null,
    standIn: s.standIn,
    options: [optionsOf(s, 0), optionsOf(s, 1)],
    /** Undo for the match (E-032); "mixed" only in a match from before, where each player had their own. */
    undoMode: optionsOf(s, 0).undo === optionsOf(s, 1).undo ? optionsOf(s, 0).undo : "mixed",
    turnMs: s.turnMs,
    result: s.result ? { ...s.result, text: resultText(s) } : null,
  };
}

export type View = ReturnType<typeof publicView> & { seat: number; color: Color | null; myTurn: boolean };

const KIND_TEXT: Record<Kind, string> = { single: "", gammon: " with a gammon", backgammon: " with a backgammon", pass: " as the cube was passed" };
export const pointsText = (n: number) => count(n, "point");

export function gameText(s: State, g: GameRecord): string {
  return `${seatName(s, g.winner)} wins game ${g.game}${KIND_TEXT[g.kind]}: ${pointsText(g.points)}.`;
}

function resultText(s: State): string {
  const w = s.result!.winner;
  const [a, b] = [s.match.score[w], s.match.score[w ^ 1]];
  if (s.match.length === 1) {
    const g = s.games.at(-1)!;
    return `${seatName(s, w)} wins${KIND_TEXT[g.kind]}.`;
  }
  return `${seatName(s, w)} wins the match ${a}–${b} after ${count(s.games.length, "game")}.`;
}

// ---------- awards (games-service D-140; kept here so the game runs on tables before it) ----------
interface Award {
  id: string;
  icon: string;
  title: string;
  blurb: string;
  seats: number[];
  value?: string;
}
function most(id: string, icon: string, title: string, blurb: string, s: State, score: (st: SideStats) => number, value: (n: number) => string): Award | null {
  const v = s.stats.map(score);
  const best = Math.max(...v);
  if (best <= 0 || v[0] === v[1]) return null;
  const c = v.indexOf(best);
  return { id, icon, title, blurb, seats: [s.seats[c]], value: value(best) };
}

function aiLevel(options: Record<string, unknown>): Level {
  return LEVELS.includes(options?.level as Level) ? (options.level as Level) : "average";
}

/** The AI's intent for a view, at a level. */
export function aiIntent(v: View, level: Level, random: () => number) {
  if (v.result || v.color === null) return null;
  const me = v.color;
  const board: Board = { pts: v.points, bar: v.bar, off: v.off };
  const situation: CubeSituation = {
    need: [v.match.length - v.match.score[me], v.match.length - v.match.score[me ^ 1]],
    value: v.cube.value,
    freeDrop: v.match.postCrawford && v.match.length - v.match.score[me ^ 1] === 1 && v.match.length - v.match.score[me] > 1,
  };
  if (v.phase === "double" && v.actorSeat === v.seat) return { name: shouldTake(persp(board, me), level, situation) ? "take" : "pass" };
  if (!v.myTurn) return null;
  if (v.phase === "roll") return { name: v.canDouble && shouldDouble(persp(board, me), level, situation) ? "double" : "roll" };
  if (v.phase === "move") {
    if (!v.legal.length) return { name: "done" };
    const first = choosePlay(persp(board, me), v.remaining, level, random).play.moves[0];
    if (!first) return { name: "done" };
    return { name: "move", payload: { from: toSpot(first.from, me), to: toSpot(first.to, me), die: first.die } };
  }
  return null;
}

export default defineGame<State>({
  setup(ctx, settings) {
    const seats = [...ctx.seats].sort((a, b) => a.seat - b.seat);
    const south = seats.find((x) => x.edge === "south") ?? seats[0];
    const north = seats.find((x) => x !== south) ?? seats[1] ?? seats[0];
    const length = Math.max(1, Math.min(MATCH_MAX, Math.round(Number(settings.matchLength ?? 3)) || 3));
    const base: State = {
      seats: [south.seat, north.seat],
      names: Object.fromEntries(seats.map((x) => [x.seat, x.name])),
      board: startBoard(),
      phase: "roll",
      turn: 0,
      dice: null,
      remaining: [],
      rule: NO_RULE,
      played: 0,
      turnMoves: [],
      undo: [],
      opening: null,
      cube: { enabled: settings.cube !== false, value: 1, owner: null },
      match: { length, score: [0, 0], game: 1, crawford: false, postCrawford: false },
      plays: [],
      games: [],
      stats: [emptyStats(), emptyStats()],
      turnMs: Math.max(0, Number(settings.turnSeconds ?? 0)) * 1000,
      standIn: [],
      // Stored only when the lobby changed them, so the state of a game with the defaults (and of every log from
      // before E-031) stays the same, and so does its replay hash.
      ...(settings.undo === "none" || settings.autoRoll === true
        ? { options: [0, 1].map(() => ({ undo: settings.undo === "none" ? "none" : "all", autoRoll: settings.autoRoll === true })) as [Options, Options] }
        : {}),
      result: null,
    };
    return startGame(base, ctx).state;
  },

  onIntent(s, seat, intent, ctx) {
    if (s.result) return { reject: "The match is over" };
    const color = colorOf(s, seat);
    if (color === null) return { reject: "You are not playing in this match" };
    if (intent.name === "options") return setOptions(s, color, intent.payload, ctx);
    if (intent.name === "undoMode") return setUndo(s, intent.payload, ctx);
    if (s.phase === "gameOver") return { reject: "The next game starts in a moment" };
    const mover = s.turn === color;
    switch (intent.name) {
      case "roll":
        if (s.phase === "double") return { reject: mover ? "Wait for the answer to your double" : "Take or pass the double first" };
        if (!mover) return { reject: "It's not your turn" };
        if (s.phase !== "roll") return { reject: "You have rolled already" };
        return roll(s, ctx);
      case "double":
        if (!mover || s.phase !== "roll") return { reject: "You can double only on your turn, before you roll" };
        if (!s.cube.enabled) return { reject: "This match is played without the cube" };
        if (s.match.crawford) return { reject: "No doubling in the Crawford game" };
        if (s.cube.owner !== null && s.cube.owner !== color) return { reject: "The cube is on the other side" };
        if (!canDouble(s)) return { reject: "Doubling can't change this match any more" };
        return offer(s, ctx);
      case "withdraw": {
        // The doubler takes an unanswered double back (E-034): a tap on the cube by mistake, or by someone else at the
        // board. The roll is theirs again, the cube as it was.
        if (s.phase !== "double" || !mover) return { reject: "There is no double of yours to withdraw" };
        const stats = copyStats(s);
        stats[color].cubes = Math.max(0, stats[color].cubes - 1);
        const next: State = { ...s, phase: "roll", stats };
        arm(next, ctx);
        return { state: next, events: [{ name: "withdrawn", data: { by: color, value: s.cube.value * 2 } }] };
      }
      case "take":
      case "pass":
        if (s.phase !== "double" || mover) return { reject: "There is no double to answer" };
        if (intent.name === "pass") return passCube(s, ctx);
        {
          const r = takeCube(s);
          arm(r.state, ctx); // the doubler rolls now
          return autoRoll(r, ctx);
        }
      case "move": {
        if (!mover) return { reject: "It's not your turn" };
        if (s.phase === "roll") return { reject: "Roll first" };
        if (s.phase !== "move") return { reject: "Not now" };
        if (s.rule.max === 0) return { reject: "No move is possible with this roll" };
        if (s.played >= s.rule.max) return { reject: "All your dice are played: tap Done" };
        const subs = subsFromPayload(s, intent.payload);
        if (typeof subs === "string") return { reject: subs };
        return move(s, subs, ctx, "player");
      }
      case "undo": {
        if (!mover || s.phase !== "move") return { reject: "Nothing to take back" };
        if (optionsOf(s, color).undo === "none") return { reject: "Undo is off: change it in your options" };
        const last = s.undo.at(-1);
        if (!last) return { reject: "Nothing to take back" };
        const next: State = {
          ...s,
          board: cloneBoard(last.board),
          remaining: last.remaining,
          played: last.played,
          turnMoves: s.turnMoves.slice(0, s.turnMoves.length - last.moves),
          undo: s.undo.slice(0, -1),
        };
        return { state: next, events: [{ name: "undone", data: { color } }] };
      }
      case "done":
        if (!mover || s.phase !== "move") return { reject: "It's not your turn" };
        if (legal(s).length) return { reject: `Play your ${s.remaining.length === 1 ? "other die" : "dice"} first` };
        return endTurn(s, ctx);
      default:
        return { reject: `Unknown action ${intent.name}` };
    }
  },

  onTimer(s, id, ctx) {
    if (s.result) return { state: s };
    if (id === "next" && s.phase === "gameOver") {
      const r = startGame({ ...s, match: { ...s.match, game: s.match.game + 1 } }, ctx);
      return r;
    }
    if (id === "pass" && s.phase === "move" && s.rule.max === 0) return endTurn(s, ctx);
    if (id === "autoroll") {
      if (s.phase !== "roll" || !optionsOf(s, s.turn).autoRoll || s.standIn.includes(s.seats[s.turn])) return { state: s };
      return rolledFor({ state: s, events: [] }, roll(s, ctx));
    }
    if (id === "standin") {
      const who = actor(s);
      if (who === null || !s.standIn.includes(s.seats[who])) return { state: s };
      const r = autoStep(s, ctx, false);
      // Keep the stand-in going while it is still its move (a take leaves the roll to the doubler).
      if (actor(r.state) !== null) arm(r.state, ctx);
      return r;
    }
    if (id === "turn") {
      // The player sat still: the table plays for them, all of it at once.
      const r = autoStep(s, ctx, true);
      if (actor(r.state) !== null && r.state.phase !== "gameOver") arm(r.state, ctx);
      return { state: r.state, events: [{ name: "timeout", data: { color: actor(s) } }, ...r.events] };
    }
    return { state: s };
  },

  // Another player took over the seat (games-service D-159): the colour and the match stay, the name changes.
  onSeatChanged(s, seat) {
    return { state: { ...s, names: { ...s.names, [seat.seat]: seat.name } } };
  },

  // onSeatLeft and onSeatJoined: only replays of logs from before games-service D-159 reach these (E-016, E-019).
  onSeatLeft(s, seat, ctx) {
    if (s.result || colorOf(s, seat) === null) return { state: s };
    const next: State = { ...s, standIn: [...s.standIn.filter((x) => x !== seat), seat] };
    arm(next, ctx);
    return { state: next, events: [{ name: "standIn", data: { seat } }] };
  },

  onSeatJoined(s, seat, ctx) {
    if (!s.standIn.includes(seat.seat) || s.result) return { state: s };
    const next: State = { ...s, standIn: s.standIn.filter((x) => x !== seat.seat), names: { ...s.names, [seat.seat]: seat.name } };
    arm(next, ctx);
    return { state: next, events: [{ name: "takenOver", data: { seat: seat.seat, name: seat.name } }] };
  },

  view(s, seat) {
    const v = publicView(s);
    const color = colorOf(s, seat);
    return { ...v, seat, color, myTurn: color !== null && (v.turnSeat === seat || v.actorSeat === seat) };
  },

  boardView(s) {
    return publicView(s);
  },

  isOver(s) {
    if (!s.result) return null;
    const w = s.result.winner;
    const rows = ([0, 1] as Color[]).map((c) => {
      const st = s.stats[c];
      // Four columns fit a 320 px phone (its headers don't wrap); gammons, doubles and pips rolled are awards instead.
      return [seatName(s, c), s.match.score[c], st.gamesWon, st.hits];
    });
    const awards = [
      most("hitman", "🎯", "Hitman", "Hit the most checkers.", s, (x) => x.hits, (n) => count(n, "hit")),
      most("doubles", "🎲", "Doublets", "Rolled the most doubles.", s, (x) => x.doubles, (n) => count(n, "double")),
      most("roller", "💎", "High Roller", "Rolled the most pips.", s, (x) => x.pipsRolled, (n) => `${n} pips`),
      most("comeback", "🚪", "Back from the Bar", "Came in from the bar most often.", s, (x) => x.entered, (n) => count(n, "time")),
      most("gammon", "🏆", "Gammon Maker", "Won the most gammons.", s, (x) => x.gammons, (n) => count(n, "gammon")),
      most("cube", "🧊", "Cube Handler", "Doubled the most.", s, (x) => x.cubes, (n) => count(n, "double", "doubles")),
    ].filter((a): a is Award => a !== null);
    return {
      text: resultText(s),
      highlights: { winner: s.seats[w], score: s.match.score, games: s.games.length, length: s.match.length, kinds: s.games.map((g) => g.kind) },
      table: { columns: ["Player", "Points", "Games", "Hits"], rows },
      awards,
    };
  },

  ai(view, _seat, ctx, options) {
    return aiIntent(view as View, aiLevel(options), ctx.random);
  },

  aiFallback(view, _seat, ctx) {
    return aiIntent(view as View, "average", ctx.random);
  },

  describe(step: StepInfo<State>) {
    const b = step.before;
    const a = step.after;
    const columns = { dice: a.dice ? `${a.dice[0]}-${a.dice[1]}` : null, score: `${a.match.score[0]}–${a.match.score[1]}` };
    const ending = a.games.length > b.games.length ? ` ${gameText(a, a.games.at(-1)!)}${a.result ? ` ${resultText(a)}` : ""}` : "";
    const added = a.turnMoves.length > b.turnMoves.length ? playText(a.turnMoves.slice(b.turnMoves.length)) : null;
    const finished = a.plays.length > b.plays.length ? a.plays.at(-1)! : null;
    // Rolled for the next player as their turn began (E-031).
    const autoRolled = a.turn !== b.turn && a.phase === "move" && a.dice ? `; ${seatName(a, a.turn)} rolls ${a.dice[0]}-${a.dice[1]} (auto-roll)` : "";
    if (step.kind === "intent") {
      const name = step.intent?.name;
      if (!step.accepted) return { text: `${name} refused: ${step.reason ?? "?"}`, columns };
      if (name === "roll") return { text: `rolls ${a.dice![0]}-${a.dice![1]}${a.rule.max === 0 ? ": no move possible" : ""}`, columns };
      if (name === "move") return { text: `moves ${added ?? finished?.text ?? "?"}${ending}${finished && !ending ? " and the turn ends" : ""}${autoRolled}`, columns };
      if (name === "undo") return { text: "takes back a move", columns };
      if (name === "done") return { text: `ends the turn: ${finished?.text ?? ""}${autoRolled}`, columns };
      if (name === "undoMode") return { text: `Undo for both players: ${a.options?.[0]?.undo === "none" ? "off" : "all moves"}${finished ? `; ends the turn: ${finished.text}` : ""}${autoRolled}`, columns };
      if (name === "options") {
        const c = colorOf(a, step.seat ?? -1);
        const o = c === null ? DEFAULT_OPTIONS : optionsOf(a, c);
        return { text: `options: Undo ${o.undo === "all" ? "all moves" : "off"}, auto-roll ${o.autoRoll ? "on" : "off"}${finished ? `; ends the turn: ${finished.text}` : ""}${autoRolled}`, columns };
      }
      if (name === "double") return { text: `doubles to ${b.cube.value * 2}`, columns };
      if (name === "withdraw") return { text: `withdraws the double to ${b.cube.value * 2}`, columns };
      if (name === "take") return { text: `takes: the cube is at ${a.cube.value}${a.phase === "move" && a.dice ? `; ${seatName(a, a.turn)} rolls ${a.dice[0]}-${a.dice[1]} (auto-roll)` : ""}`, columns };
      if (name === "pass") return { text: `passes the double.${ending}`, columns };
    }
    if (step.kind === "timer") {
      if (step.timer === "next" && a.opening) return { text: `Game ${a.match.game}: opening roll ${a.opening[0]} for White, ${a.opening[1]} for Black; ${seatName(a, a.turn)} starts`, columns };
      if (step.timer === "pass") return { text: `can't move with ${b.dice?.join("-")}: the turn passes`, columns };
      if (step.timer === "autoroll") return { text: `Roll for me: ${seatName(a, a.turn)} rolls ${a.dice?.join("-")}`, columns, steps: [{ seat: a.seats[a.turn], text: `rolls ${a.dice?.join("-")}`, auto: true }] };
      if (step.timer === "standin" || step.timer === "turn") {
        const seat = b.seats[actor(b) ?? b.turn];
        const what = step.timer === "standin" ? "Stand-in" : "Out of time: the table";
        const did = added ?? finished?.text ?? (a.phase === "double" ? `doubles to ${a.cube.value * 2}` : a.cube.value > b.cube.value ? "takes" : a.dice !== b.dice ? `rolls ${a.dice?.join("-")}` : "");
        return { text: `${what} plays: ${did}${ending}`, columns, steps: [{ seat, text: did, auto: true }] };
      }
    }
    if (step.kind === "seatLeft" && a.standIn.length > b.standIn.length) return { text: "Left: the stand-in plays on.", columns };
    if (step.kind === "seatJoined" && a.standIn.length < b.standIn.length) return { text: "Takes over from the stand-in.", columns };
    return null;
  },
});
