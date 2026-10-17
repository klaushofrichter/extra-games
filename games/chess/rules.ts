// Chess for two players on Game Table. The board draws the game and takes the moves (a tap on a piece, a tap on its
// square); the phones show the clocks, the moves so far, and offer a draw or resignation. AI players play at an
// approximate Elo rating. A player who leaves during the game is replaced by the engine, the "stand-in", which plays
// on in their colour until someone takes the empty seat again.
//
// Clocks use the game time (`ctx.now()`, games-service D-126): each move charges the mover the time since their turn
// began, then adds the increment; a timer per turn makes the flag fall. A pause on the table stops both.
import { count, defineGame, type GameContext, type StepInfo } from "@game-table/sdk";
import { BLACK, F_CAPTURE, F_CASTLE, Position, WHITE, moveFlags, moveFrom, movePromo, moveTo, sqName, uci } from "./chess.ts";
import { ELO_MAX, ELO_MIN, Engine, level, pickMove } from "./engine.ts";

export const TIME_CONTROLS = ["no clock", "1+0", "3+2", "5+3", "10+0", "10+5", "15+10", "30+0"] as const;
/** How long the stand-in waits before moving, so a move on the board can be followed. */
const STAND_IN_MS = 900;
/** The stand-in plays inside the rules, so it must be quick and deterministic: a node budget, no clock. */
const STAND_IN_NODES = 60_000;

export type Color = 0 | 1;
export type Reason = "checkmate" | "resignation" | "time" | "stalemate" | "repetition" | "fifty" | "material" | "agreement" | "timeVsMaterial" | "abandoned";

export interface ClockState {
  base: number;
  inc: number;
  /** Time left by colour (white, black) when that colour's turn last began or ended. */
  left: [number, number];
  /** Game time when the running clock started. */
  since: number;
}

export interface State {
  fen: string;
  /** Position keys since the last pawn move or capture, the current one last (threefold repetition). */
  keys: string[];
  /** Seat by colour: [white, black]. */
  seats: [number, number];
  names: Record<number, string>;
  sans: string[];
  ucis: string[];
  /** Clock left by the mover after each move (ms), for the move list; null without a clock. */
  times: (number | null)[];
  clock: ClockState | null;
  /** A clock was asked for but this table's software has no game time (games-service before D-126). */
  clockMissing: boolean;
  timeControl: string;
  /** The seat that offered a draw, until it is answered or the other side moves. */
  drawOffer: number | null;
  /** Seats the engine plays because their player left. */
  standIn: number[];
  standInElo: number;
  result: null | { winner: Color | null; reason: Reason; by?: number };
}

const colorOf = (s: State, seat: number): Color | null => (s.seats[WHITE] === seat ? WHITE : s.seats[BLACK] === seat ? BLACK : null);
const turnOf = (fen: string): Color => (fen.split(" ")[1] === "b" ? BLACK : WHITE);
const COLOR_NAME = ["White", "Black"];

/** Parse "10+5" into base and increment in ms; null for no clock. */
export function parseTimeControl(tc: unknown): { base: number; inc: number } | null {
  const m = /^(\d+)\+(\d+)$/.exec(String(tc));
  return m ? { base: Number(m[1]) * 60_000, inc: Number(m[2]) * 1000 } : null;
}

/** A position with its game history, so repetitions count in the search too. */
export function positionOf(fen: string, keys: string[] = []): Position {
  const p = Position.fromFen(fen);
  for (const k of keys.slice(0, -1)) {
    const q = Position.fromFen(`${k} 0 1`);
    p.hist.push(q.hashLo, q.hashHi);
  }
  return p;
}

function seatName(s: State, seat: number) {
  return s.names[seat] ?? COLOR_NAME[colorOf(s, seat) ?? 0];
}

/** The move number and dots for the next move in the list: "12." or "12…". */
function moveLabel(sans: number) {
  return `${Math.floor(sans / 2) + 1}${sans % 2 ? "…" : "."}`;
}

function startFlag(s: State, ctx: GameContext) {
  if (!s.clock || s.result) return;
  ctx.setTimer("flag", Math.max(0, s.clock.left[turnOf(s.fen)]));
}

/** If the side to move is played by the stand-in, let it move shortly. */
function scheduleStandIn(s: State, ctx: GameContext) {
  if (s.result) return;
  if (s.standIn.includes(s.seats[turnOf(s.fen)])) ctx.setTimer("standin", STAND_IN_MS);
}

/** The game time now, or 0 on a table without it (then there is no clock either). */
const now = (ctx: GameContext) => (typeof ctx.now === "function" ? ctx.now() : 0);

/** End by the flag: the side to move loses, unless the other side couldn't mate at all. */
function flagFalls(s: State, color: Color): State["result"] {
  const p = Position.fromFen(s.fen);
  return p.hasMatingMaterial((color ^ 1) as Color) ? { winner: (color ^ 1) as Color, reason: "time" } : { winner: null, reason: "timeVsMaterial" };
}

/** Apply a legal move for the side to move: board, clock, history, draw rules. */
function play(s: State, m: number, ctx: GameContext, by: "player" | "standin"): { state: State; events: { name: string; data?: unknown }[] } {
  const color = turnOf(s.fen);
  const seat = s.seats[color];
  const events: { name: string; data?: unknown }[] = [];
  let clock = s.clock;
  let time: number | null = null;
  if (clock) {
    const t = now(ctx);
    const left = clock.left[color] - (t - clock.since);
    if (left <= 0) {
      // The flag fell before the move came in: the move doesn't count.
      const result = flagFalls(s, color);
      events.push({ name: "over", data: result });
      return { state: { ...s, result, clock: { ...clock, left: setLeft(clock.left, color, 0), since: t } }, events };
    }
    time = left + clock.inc;
    clock = { ...clock, left: setLeft(clock.left, color, time), since: t };
  }
  const p = Position.fromFen(s.fen);
  const legal = p.legal();
  const san = p.san(m, legal);
  const flags = moveFlags(m);
  const capturedPiece = flags & F_CAPTURE ? (flags & 2 ? 1 : p.board[moveTo(m)] & 7) : 0;
  p.make(m);
  const fen = p.fen();
  const key = p.key();
  const irreversible = p.halfmove === 0;
  const keys = irreversible ? [key] : [...s.keys, key];
  let result: State["result"] = null;
  const replies = p.legal();
  if (!replies.length) result = p.inCheck() ? { winner: color, reason: "checkmate" } : { winner: null, reason: "stalemate" };
  else if (keys.filter((k) => k === key).length >= 3) result = { winner: null, reason: "repetition" };
  else if (p.halfmove >= 100) result = { winner: null, reason: "fifty" };
  else if (p.insufficientMaterial()) result = { winner: null, reason: "material" };
  // Moving answers the other side's draw offer with no; your own offer stands for the other side to answer.
  const declined = s.drawOffer !== null && s.drawOffer !== seat;
  const next: State = {
    ...s,
    fen,
    keys,
    sans: [...s.sans, san],
    ucis: [...s.ucis, uci(m)],
    times: [...s.times, time],
    clock,
    drawOffer: declined ? null : s.drawOffer,
    result,
  };
  events.push({
    name: "moved",
    data: {
      seat,
      color,
      uci: uci(m),
      san,
      from: sqName(moveFrom(m)),
      to: sqName(moveTo(m)),
      capture: capturedPiece ? " pnbrqk"[capturedPiece] : null,
      castle: !!(flags & F_CASTLE),
      promotion: movePromo(m) ? " pnbrqk"[movePromo(m)] : null,
      check: san.endsWith("+"),
      mate: san.endsWith("#"),
      standIn: by === "standin",
    },
  });
  if (declined) events.push({ name: "drawDeclined", data: { by: seat } });
  if (result) events.push({ name: "over", data: result });
  else {
    startFlag(next, ctx);
    scheduleStandIn(next, ctx);
  }
  return { state: next, events };
}

function setLeft(left: [number, number], color: Color, v: number): [number, number] {
  return color === WHITE ? [v, left[1]] : [left[0], v];
}

/** The stand-in's (deterministic) move for the side to move. */
const rulesEngine = new Engine();
function standInMove(s: State, ctx: GameContext): number {
  rulesEngine.reset();
  const p = positionOf(s.fen, s.keys);
  return pickMove(p, { elo: s.standInElo, random: ctx.random, maxNodes: STAND_IN_NODES, engine: rulesEngine }).move;
}

const REASON_TEXT: Record<Reason, string> = {
  checkmate: "by checkmate",
  resignation: "by resignation",
  time: "on time",
  stalemate: "by stalemate",
  repetition: "by threefold repetition",
  fifty: "by the fifty-move rule",
  material: "as neither side can mate",
  agreement: "by agreement",
  timeVsMaterial: "as the flag fell but the other side can't mate",
  abandoned: "as nobody is left to play",
};

/** Captured pieces by the colour that lost them: what is missing from the starting set (promotions aside). */
function captured(p: Position): { white: string; black: string } {
  const start = { p: 8, n: 2, b: 2, r: 2, q: 1 } as Record<string, number>;
  const have: Record<string, number> = {};
  for (const [, ch] of Object.entries(p.pieces())) have[ch] = (have[ch] ?? 0) + 1;
  const missing = (upper: boolean) =>
    ["q", "r", "b", "n", "p"].map((t) => (upper ? t.toUpperCase() : t).repeat(Math.max(0, start[t] - (have[upper ? t.toUpperCase() : t] ?? 0)))).join("");
  return { white: missing(true), black: missing(false) };
}

/** Everything both the board and the phones may see: chess has no secrets. */
function publicView(s: State) {
  const p = Position.fromFen(s.fen);
  const turn = turnOf(s.fen);
  const legal = s.result ? [] : p.legal();
  const check = !s.result || s.result.reason === "checkmate" ? (p.inCheck() ? sqName(p.kings[turn]) : null) : null;
  const last = s.ucis.at(-1);
  return {
    fen: s.fen,
    keys: s.keys,
    pieces: p.pieces(),
    turn,
    turnSeat: s.result ? null : s.seats[turn],
    seats: s.seats,
    names: s.names,
    legal: legal.map(uci),
    last: last ? { from: last.slice(0, 2), to: last.slice(2, 4) } : null,
    check,
    sans: s.sans,
    times: s.times,
    moveCount: s.sans.length,
    clock: s.clock ? { base: s.clock.base, inc: s.clock.inc, left: s.clock.left, running: s.result ? null : turn } : null,
    clockMissing: s.clockMissing,
    timeControl: s.timeControl,
    drawOffer: s.drawOffer,
    standIn: s.standIn,
    standInElo: s.standInElo,
    captured: captured(p),
    result: s.result ? { ...s.result, text: resultText(s) } : null,
  };
}

function resultText(s: State): string {
  const r = s.result!;
  const moves = count(Math.ceil(s.sans.length / 2), "move");
  if (r.winner === null) return `Draw ${REASON_TEXT[r.reason]} after ${moves}.`;
  const w = seatName(s, s.seats[r.winner]);
  if (r.reason === "resignation") return `${seatName(s, s.seats[r.winner ^ 1])} resigns: ${w} wins with ${COLOR_NAME[r.winner].toLowerCase()} after ${moves}.`;
  return `${w} wins with ${COLOR_NAME[r.winner].toLowerCase()} ${REASON_TEXT[r.reason]} after ${moves}.`;
}

export type View = ReturnType<typeof publicView> & { seat: number; color: Color | null; myTurn: boolean };

/** A move from an intent: { uci: "e2e4" } or { from: "e2", to: "e4", promotion?: "q" }. */
function moveFromPayload(p: Position, payload: unknown): number | null {
  const o = (payload ?? {}) as { uci?: unknown; from?: unknown; to?: unknown; promotion?: unknown };
  const text = typeof o.uci === "string" ? o.uci : typeof o.from === "string" && typeof o.to === "string" ? `${o.from}${o.to}${typeof o.promotion === "string" ? o.promotion : ""}` : null;
  return text === null ? null : p.findUci(text);
}

// ---------- AI ----------
const aiEngine = new Engine();

function aiElo(options: Record<string, unknown>) {
  const e = Number(options?.elo);
  return Number.isFinite(e) ? Math.max(ELO_MIN, Math.min(ELO_MAX, e)) : 1200;
}

/** How long the AI may think about this move (ms): its level's time, but no more than the clock can spare. */
export function thinkBudget(v: View, levelMs: number): number {
  if (!v.clock || v.color === null) return levelMs;
  const left = v.clock.left[v.color];
  return Math.max(100, Math.min(levelMs, left / 30 + v.clock.inc * 0.75));
}

export default defineGame<State>({
  setup(ctx, settings) {
    const seats = [...ctx.seats].sort((a, b) => a.seat - b.seat);
    const south = seats.find((x) => x.edge === "south") ?? seats[0];
    const north = seats.find((x) => x !== south) ?? seats[1] ?? seats[0];
    const choice = String(settings.whiteSeat ?? "south");
    const whiteFirst = choice === "south" ? true : choice === "north" ? false : ctx.random() < 0.5;
    const white = whiteFirst ? south : north;
    const black = whiteFirst ? north : south;
    const tc = parseTimeControl(settings.timeControl);
    const hasTime = typeof ctx.now === "function";
    const p = Position.fromFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    const s: State = {
      fen: p.fen(),
      keys: [p.key()],
      seats: [white.seat, black.seat],
      names: Object.fromEntries(seats.map((x) => [x.seat, x.name])),
      sans: [],
      ucis: [],
      times: [],
      clock: tc && hasTime ? { ...tc, left: [tc.base, tc.base], since: now(ctx) } : null,
      clockMissing: !!tc && !hasTime,
      timeControl: String(settings.timeControl ?? "no clock"),
      drawOffer: null,
      standIn: [],
      standInElo: Math.max(ELO_MIN, Math.min(ELO_MAX, Number(settings.standInElo) || 1200)),
      result: null,
    };
    startFlag(s, ctx);
    return s;
  },

  onIntent(s, seat, intent, ctx) {
    if (s.result) return { reject: "The game is over" };
    const color = colorOf(s, seat);
    if (color === null) return { reject: "You are not playing in this game" };
    const other = s.seats[color ^ 1];
    switch (intent.name) {
      case "move": {
        if (turnOf(s.fen) !== color) return { reject: "It's not your turn" };
        const p = Position.fromFen(s.fen);
        const m = moveFromPayload(p, intent.payload);
        if (m === null) return { reject: "That move isn't legal" };
        return play(s, m, ctx, "player");
      }
      case "resign": {
        const result = { winner: (color ^ 1) as Color, reason: "resignation" as const, by: seat };
        return { state: { ...s, result }, events: [{ name: "over", data: result }] };
      }
      case "offerDraw": {
        if (s.drawOffer === other) return agree(s, seat); // both want it
        if (s.drawOffer === seat) return { reject: "You already offered a draw" };
        if (s.sans.length < 2) return { reject: "A draw can be offered once both sides have moved" };
        return { state: { ...s, drawOffer: seat }, events: [{ name: "drawOffered", data: { by: seat } }] };
      }
      case "acceptDraw":
        if (s.drawOffer !== other) return { reject: "There is no draw offer to accept" };
        return agree(s, seat);
      case "declineDraw":
        if (s.drawOffer !== other) return { reject: "There is no draw offer to decline" };
        return { state: { ...s, drawOffer: null }, events: [{ name: "drawDeclined", data: { by: seat } }] };
      default:
        return { reject: `Unknown action ${intent.name}` };
    }
  },

  onTimer(s, id, ctx) {
    if (s.result) return { state: s };
    const color = turnOf(s.fen);
    if (id === "flag" && s.clock) {
      // The timer may be late or early by a hair; trust the game time.
      const left = s.clock.left[color] - (now(ctx) - s.clock.since);
      if (left > 0) {
        ctx.setTimer("flag", left);
        return { state: s };
      }
      const result = flagFalls(s, color);
      const clock = { ...s.clock, left: setLeft(s.clock.left, color, 0), since: now(ctx) };
      return { state: { ...s, clock, result }, events: [{ name: "flag", data: { seat: s.seats[color] } }, { name: "over", data: result }] };
    }
    if (id === "standin" && s.standIn.includes(s.seats[color])) {
      const m = standInMove(s, ctx);
      if (!m) return { state: s };
      return play(s, m, ctx, "standin");
    }
    return { state: s };
  },

  onSeatLeft(s, seat, ctx) {
    if (s.result || colorOf(s, seat) === null) return { state: s };
    // Nobody left to play against: the stand-in would only play itself (or an AI).
    if (!ctx.seats.some((x) => x.kind === "human")) return { end: { text: `${seatName(s, seat)} left and nobody is left to play: the game ends after ${count(Math.ceil(s.sans.length / 2), "move")}.` } };
    const next: State = { ...s, standIn: [...s.standIn.filter((x) => x !== seat), seat], drawOffer: s.drawOffer === seat ? null : s.drawOffer };
    scheduleStandIn(next, ctx);
    return { state: next, events: [{ name: "standIn", data: { seat } }] };
  },

  onSeatJoined(s, seat, ctx) {
    if (!s.standIn.includes(seat.seat) || s.result) return { state: s };
    // Someone sat down in the empty seat: they take over from the stand-in.
    const next: State = { ...s, standIn: s.standIn.filter((x) => x !== seat.seat), names: { ...s.names, [seat.seat]: seat.name } };
    if (s.seats[turnOf(s.fen)] === seat.seat) ctx.clearTimer("standin");
    return { state: next, events: [{ name: "takenOver", data: { seat: seat.seat, name: seat.name } }] };
  },

  view(s, seat) {
    const v = publicView(s);
    const color = colorOf(s, seat);
    return { ...v, seat, color, myTurn: color !== null && v.turnSeat === seat };
  },

  boardView(s) {
    return publicView(s);
  },

  isOver(s) {
    if (!s.result) return null;
    const r = s.result;
    const moves = Math.ceil(s.sans.length / 2);
    const rows = s.seats.map((seat, c) => [seatName(s, seat), COLOR_NAME[c], r.winner === null ? "½" : r.winner === c ? "1" : "0", s.clock ? clockText(s.clock.left[c]) : "–"]);
    return {
      text: resultText(s),
      highlights: { winner: r.winner === null ? null : s.seats[r.winner], reason: r.reason, moves, pgnMoves: s.sans.join(" ") },
      table: { columns: ["Player", "Colour", "Score", "Clock"], rows },
    };
  },

  ai(view, seat, ctx, options) {
    const v = view as View;
    if (v.result || v.color === null) return null;
    const elo = aiElo(options);
    const opponent = v.seats[v.color ^ 1];
    if (v.drawOffer === opponent) {
      // Take a draw unless clearly better.
      const r = aiEngine.search(positionOf(v.fen, v.keys), { depth: 4, nodes: 30_000 });
      return { name: r.score <= 30 ? "acceptDraw" : "declineDraw" };
    }
    if (!v.myTurn) return null;
    const budget = Math.min(thinkBudget(v, level(elo).thinkMs), Math.max(100, ctx.deadline - Date.now() - 1500));
    const r = pickMove(positionOf(v.fen, v.keys), { elo, random: ctx.random, until: Date.now() + budget, signal: ctx.signal, engine: aiEngine });
    return r.move ? { name: "move", payload: { uci: uci(r.move) } } : null;
  },

  aiFallback(view, _seat, ctx, options) {
    const v = view as View;
    if (v.result || !v.myTurn) return null;
    const r = pickMove(positionOf(v.fen, v.keys), { elo: Math.min(aiElo(options), 1200), random: ctx.random, maxNodes: 20_000 });
    return r.move ? { name: "move", payload: { uci: uci(r.move) } } : null;
  },

  describe(step: StepInfo<State>) {
    const before = step.before;
    const after = step.after;
    const label = moveLabel(before.sans.length);
    const san = after.sans.length > before.sans.length ? after.sans.at(-1)! : null;
    const time = san ? after.times.at(-1) : null;
    const columns = { san: san ? `${label} ${san}` : null, clock: time === null || time === undefined ? null : clockText(time) };
    const ending = !before.result && after.result ? ` ${resultText(after)}` : "";
    if (step.kind === "intent") {
      const name = step.intent?.name;
      if (!step.accepted) return { text: `${name} refused: ${step.reason ?? "?"}`, columns };
      if (name === "move") return { text: `${label} ${san ?? "(no move: the flag had fallen)"}${ending}`, columns, details: { fen: after.fen, uci: after.ucis.at(-1) } };
      if (name === "resign") return { text: `Resigns.${ending}`, columns };
      if (name === "offerDraw") return { text: after.result ? `Offers a draw too.${ending}` : "Offers a draw.", columns };
      if (name === "acceptDraw") return { text: `Accepts the draw.${ending}`, columns };
      if (name === "declineDraw") return { text: "Declines the draw.", columns };
    }
    if (step.kind === "timer" && step.timer === "standin" && san) {
      const seat = before.seats[turnOf(before.fen)];
      return { text: `Stand-in plays ${label} ${san}${ending}`, columns, steps: [{ seat, text: `${label} ${san}`, auto: true }], details: { fen: after.fen } };
    }
    if (step.kind === "timer" && step.timer === "flag" && after.result) return { text: `The flag falls.${ending}`, columns };
    if (step.kind === "seatLeft" && after.standIn.length > before.standIn.length) return { text: `Left: the stand-in (Elo ${after.standInElo}) plays on.`, columns };
    if (step.kind === "seatJoined" && after.standIn.length < before.standIn.length) return { text: "Takes over from the stand-in.", columns };
    return null;
  },
});

function agree(s: State, _seat: number) {
  const result = { winner: null, reason: "agreement" as const };
  return { state: { ...s, drawOffer: null, result }, events: [{ name: "over", data: result }] };
}

/** "4:05", or "0:09.3" under ten seconds. */
export function clockText(ms: number): string {
  const t = Math.max(0, ms);
  if (t < 10_000) return `0:0${(Math.floor(t / 100) / 10).toFixed(1)}`;
  const s = Math.floor(t / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}
