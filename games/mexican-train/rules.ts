// Mexican Train dominoes with a double-twelve set. Each round starts from a double in the middle (the engine:
// double twelve, then eleven, and so on down). Every player builds a train of matching tiles from it toward their own
// seat; one more train, the Mexican train, belongs to everyone. On a turn a player plays one tile on their own train,
// the Mexican train or any train with a marker. A player who can't play draws one tile; if that doesn't help either,
// they pass and a marker goes on their train, opening it to the others. A double must be covered before anyone plays
// anywhere else, and its player plays again. A round ends when someone plays their last tile, or when nobody can play
// and nothing is left to draw; everyone scores the pips left in their hand. The lowest total after the last round wins.
// Two options, chosen when the game is started: the opening run (in a player's first turn of a round, tiles played on
// their own train keep the turn until they tap Done) and the double blank counting 50 points.
//
// Rules are pure and replayable (D-032 in games-service): all randomness goes through ctx.
import { count, defineGame, list, mostAward, type GameAward, type GameContext, type SeatInfo, type StepInfo } from "@game-table/sdk";

/** A tile as [low, high]. */
export type Tile = [number, number];
/** A tile on a train as [the end it joins with, the end it leaves open]. */
export type Placed = [number, number];

export const HIGH = 12;
export const MEXICAN = "m";

export interface Train {
  /** The seat whose train this is, or null for the Mexican train. */
  owner: number | null;
  tiles: Placed[];
  /** Open to everyone: its owner passed and hasn't played on it since. The Mexican train is always open. */
  marker: boolean;
}

interface Player {
  seat: number;
  name: string;
  hand: Tile[];
  total: number;
  roundScores: number[];
  played: number;
  /** Tiles played on other players' trains and the Mexican train. */
  elsewhere: number;
  doubles: number;
  draws: number;
  passes: number;
  /** Rounds this player ended by playing their last tile. */
  out: number;
  /** The most tiles their own train held at the end of a round. */
  longest: number;
}

export interface RoundResult {
  round: number;
  engine: number;
  /** The seat that played its last tile, or null when the round was blocked. */
  out: number | null;
  scores: Record<number, number>;
  /** Tiles on each train at the end of the round, by train id (a seat number, or "m"). */
  lengths: Record<string, number>;
}

export interface State {
  rounds: number;
  /** In a player's first turn of a round, tiles on their own train keep the turn (the opening run). */
  openingRun: boolean;
  /** The double blank left in a hand scores 50 points. */
  blank50: boolean;
  /** Seats whose first turn of this round hasn't ended yet. */
  opening: Record<number, boolean>;
  /** Tiles the player on turn has played this turn (for the opening run). */
  turnPlays: number;
  turnMs: number;
  roundMs: number;
  /** Seats in the order turns pass around the table. */
  order: number[];
  players: Record<number, Player>;
  round: number;
  engine: number;
  phase: "playing" | "roundOver" | "over";
  turn: number;
  /** The player on turn has drawn this turn. */
  drew: boolean;
  /** The train whose last tile is a double nobody has covered yet; while set, every play goes there. */
  pending: string | null;
  trains: Record<string, Train>;
  boneyard: Tile[];
  results: RoundResult[];
  winners: number[];
}

export interface Move {
  tile: Tile;
  train: string;
}

const EDGE_ORDER = ["south", "east", "north", "west"] as const;

/** Turns pass around the table, as in Liar's Dice: each edge left to right, edges south, east, north, west. */
export function tableOrder(seats: SeatInfo[]): number[] {
  const rank = (s: SeatInfo) => (s.edge ? EDGE_ORDER.indexOf(s.edge) : 0);
  return [...seats].sort((a, b) => rank(a) - rank(b) || a.seat - b.seat).map((s) => s.seat);
}

/** Tiles in each hand at the start of a round: 15 for two to four players, 12 for five or six, 10 for seven or eight. */
export const handSize = (players: number) => (players <= 4 ? 15 : players <= 6 ? 12 : 10);

/** The engine of a round: double twelve first, then one lower each round. */
export const engineOf = (round: number) => HIGH + 1 - round;

export const pips = (hand: readonly Tile[], blank50 = false) => hand.reduce((n, [a, b]) => n + (blank50 && a === 0 && b === 0 ? 50 : a + b), 0);
export const isDouble = (t: readonly number[]) => t[0] === t[1];
export const sameTile = (a: readonly number[], b: readonly number[]) => (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);

/** The number a train's next tile must match. */
export const openEnd = (train: Train, engine: number) => (train.tiles.length ? train.tiles[train.tiles.length - 1][1] : engine);

/** The player on turn is in their opening run: they played on their own train in their first turn of the round. */
export const inRun = (s: Partial<Pick<State, "openingRun" | "opening" | "turnPlays" | "turn">>, seat: number) =>
  !!s.openingRun && !!s.opening?.[seat] && (s.turnPlays ?? 0) > 0 && s.turn === seat;

/**
 * Trains `seat` may play on now: only the uncovered double's while there is one; only its own during its opening run;
 * else its own, the Mexican and marked ones.
 */
export function playable(s: Pick<State, "trains" | "pending"> & Partial<State>, seat: number): string[] {
  if (s.pending) return [s.pending];
  if (inRun(s, seat)) return [String(seat)];
  return Object.entries(s.trains)
    .filter(([, t]) => t.owner === seat || t.owner === null || t.marker)
    .map(([id]) => id);
}

/** Every legal play for `seat`: each tile in its hand that matches the end of a train it may play on. */
export function legalMoves(s: Pick<State, "trains" | "pending" | "engine"> & Partial<State>, seat: number, hand: readonly Tile[]): Move[] {
  const moves: Move[] = [];
  for (const id of playable(s, seat)) {
    const end = openEnd(s.trains[id], s.engine);
    for (const t of hand) if (t[0] === end || t[1] === end) moves.push({ tile: [t[0], t[1]], train: id });
  }
  return moves;
}

/** A double-twelve set without the engine, shuffled with the game's random numbers. */
function shuffledSet(engine: number, random: () => number): Tile[] {
  const tiles: Tile[] = [];
  for (let a = 0; a <= HIGH; a++) for (let b = a; b <= HIGH; b++) if (!(a === engine && b === engine)) tiles.push([a, b]);
  for (let i = tiles.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }
  return tiles;
}

const sortHand = (hand: Tile[]) => [...hand].sort((a, b) => a[1] - b[1] || a[0] - b[0]);

/** Deal a round: fresh trains, the hands, and the rest as the boneyard. Turns start one seat further each round. */
function deal(s: State, round: number, ctx: GameContext): State {
  const engine = engineOf(round);
  const set = shuffledSet(engine, ctx.random);
  const size = handSize(s.order.length);
  const players = { ...s.players };
  s.order.forEach((seat, i) => {
    players[seat] = { ...players[seat], hand: sortHand(set.slice(i * size, (i + 1) * size)) };
  });
  const trains: Record<string, Train> = { [MEXICAN]: { owner: null, tiles: [], marker: true } };
  for (const seat of s.order) trains[String(seat)] = { owner: seat, tiles: [], marker: false };
  const next: State = {
    ...s,
    players,
    round,
    engine,
    phase: "playing",
    turn: s.order[(round - 1) % s.order.length],
    drew: false,
    pending: null,
    opening: Object.fromEntries(s.order.map((seat) => [seat, true])),
    turnPlays: 0,
    trains,
    boneyard: set.slice(s.order.length * size),
  };
  return next;
}

function armTurn(s: State, ctx: GameContext) {
  ctx.clearTimer("turn");
  if (s.turnMs > 0 && s.phase === "playing") ctx.setTimer("turn", s.turnMs);
}

const nextSeat = (s: State, seat: number) => s.order[(s.order.indexOf(seat) + 1) % s.order.length];
const anyoneCanPlay = (s: State) => s.order.some((seat) => legalMoves(s, seat, s.players[seat].hand).length > 0);

type Events = { name: string; data?: unknown }[];

/** A pass: the marker goes on the player's own train. */
function pass(s: State, seat: number, events: Events): State {
  const own = String(seat);
  const p = s.players[seat];
  events.push({ name: "passed", data: { seat } });
  return {
    ...s,
    players: { ...s.players, [seat]: { ...p, passes: p.passes + 1 } },
    trains: { ...s.trains, [own]: { ...s.trains[own], marker: true } },
  };
}

/**
 * The turn goes on to the next player. With nothing left to draw, a player who can't play passes at once; when
 * nobody can play any more, the round is over (blocked).
 */
function advance(s: State, ctx: GameContext, events: Events): State {
  // Whoever's turn ends, their first turn of the round is over.
  let next: State = { ...s, turn: nextSeat(s, s.turn), drew: false, turnPlays: 0, opening: { ...s.opening, [s.turn]: false } };
  if (!next.boneyard.length) {
    if (!anyoneCanPlay(next)) return endRound(next, null, ctx, events);
    while (!legalMoves(next, next.turn, next.players[next.turn].hand).length) {
      next = pass(next, next.turn, events);
      next = { ...next, turn: nextSeat(next, next.turn), opening: { ...next.opening, [next.turn]: false } };
    }
  }
  armTurn(next, ctx);
  return next;
}

function endRound(s: State, out: number | null, ctx: GameContext, events: Events): State {
  ctx.clearTimer("turn");
  const players = { ...s.players };
  const scores: Record<number, number> = {};
  for (const seat of s.order) {
    const p = players[seat];
    const score = pips(p.hand, s.blank50);
    scores[seat] = score;
    players[seat] = {
      ...p,
      total: p.total + score,
      roundScores: [...p.roundScores, score],
      out: p.out + (seat === out ? 1 : 0),
      longest: Math.max(p.longest, s.trains[String(seat)].tiles.length),
    };
  }
  const lengths = Object.fromEntries(Object.entries(s.trains).map(([id, t]) => [id, t.tiles.length]));
  const result: RoundResult = { round: s.round, engine: s.engine, out, scores, lengths };
  const last = s.round >= s.rounds;
  const next: State = { ...s, players, phase: last ? "over" : "roundOver", turn: -1, drew: false, pending: null, results: [...s.results, result] };
  events.push({ name: "roundOver", data: { round: s.round, out, scores } });
  if (last) {
    const best = Math.min(...s.order.map((seat) => players[seat].total));
    const winners = s.order.filter((seat) => players[seat].total === best);
    events.push({ name: "won", data: { seats: winners } });
    return { ...next, winners };
  }
  ctx.setTimer("next", s.roundMs);
  return next;
}

/** Play `tile` on `train` for `seat` (already checked as legal). */
function play(s: State, seat: number, tile: Tile, train: string, ctx: GameContext, auto = false) {
  const p = s.players[seat];
  const t = s.trains[train];
  const end = openEnd(t, s.engine);
  const placed: Placed = tile[0] === end ? [tile[0], tile[1]] : [tile[1], tile[0]];
  const hand = p.hand.filter((h) => !sameTile(h, tile));
  const double = isDouble(tile);
  const players = {
    ...s.players,
    [seat]: { ...p, hand, played: p.played + 1, doubles: p.doubles + (double ? 1 : 0), elsewhere: p.elsewhere + (t.owner === seat ? 0 : 1) },
  };
  // Playing on your own train takes your marker off it.
  const trains = { ...s.trains, [train]: { ...t, tiles: [...t.tiles, placed], marker: t.owner === seat ? false : t.marker } };
  const events: Events = [{ name: "played", data: { seat, tile: placed, train, auto } }];
  let next: State = { ...s, players, trains, pending: double ? train : null, turnPlays: s.turnPlays + 1 };
  if (!hand.length) return { state: endRound(next, seat, ctx, events), events };
  // The opening run: in their first turn of the round, a player who plays on their own train goes on while they can.
  if (!double && s.openingRun && s.opening[seat] && t.owner === seat) {
    if (legalMoves(next, seat, hand).length) {
      armTurn(next, ctx);
      return { state: next, events };
    }
    return { state: advance(next, ctx, events), events };
  }
  if (double) {
    // A double: the same player plays again, and the double must be covered first.
    next = { ...next, drew: false };
    if (!legalMoves(next, seat, hand).length && !next.boneyard.length) {
      next = pass(next, seat, events);
      next = advance(next, ctx, events);
    } else armTurn(next, ctx);
    return { state: next, events };
  }
  return { state: advance(next, ctx, events), events };
}

/** Draw one tile. If it doesn't help, the player passes and the turn goes on. */
function draw(s: State, seat: number, ctx: GameContext, auto = false) {
  const p = s.players[seat];
  const tile = s.boneyard[0];
  const hand = sortHand([...p.hand, tile]);
  let next: State = { ...s, boneyard: s.boneyard.slice(1), drew: true, players: { ...s.players, [seat]: { ...p, hand, draws: p.draws + 1 } } };
  const events: Events = [{ name: "drew", data: { seat, auto, left: next.boneyard.length } }];
  if (legalMoves(next, seat, hand).length) {
    armTurn(next, ctx);
    return { state: next, events };
  }
  next = pass(next, seat, events);
  return { state: advance(next, ctx, events), events };
}

export default defineGame<State>({
  setup(ctx, settings) {
    const order = tableOrder(ctx.seats);
    const players: Record<number, Player> = {};
    for (const s of ctx.seats) {
      players[s.seat] = { seat: s.seat, name: s.name, hand: [], total: 0, roundScores: [], played: 0, elsewhere: 0, doubles: 0, draws: 0, passes: 0, out: 0, longest: 0 };
    }
    const base: State = {
      rounds: Math.min(HIGH + 1, Math.max(1, Number(settings.rounds ?? HIGH + 1))),
      openingRun: settings.openingRun !== false,
      blank50: settings.blank50 === true,
      opening: {},
      turnPlays: 0,
      turnMs: Number(settings.turnSeconds ?? 60) * 1000,
      roundMs: Number(settings.roundSeconds ?? 10) * 1000,
      order,
      players,
      round: 0,
      engine: HIGH,
      phase: "playing",
      turn: order[0],
      drew: false,
      pending: null,
      trains: {},
      boneyard: [],
      results: [],
      winners: [],
    };
    const state = deal(base, 1, ctx);
    armTurn(state, ctx);
    return state;
  },

  onIntent(s, seat, intent, ctx) {
    if (s.phase === "over") return { reject: "The game is over." };
    if (s.phase !== "playing") return { reject: "Wait for the next round." };
    const p = s.players[seat];
    if (!p) return { reject: "You have no seat in this game." };
    if (s.turn !== seat) return { reject: `It's ${s.players[s.turn].name}'s turn.` };
    const moves = legalMoves(s, seat, p.hand);
    if (intent.name === "play") {
      const pl = (intent.payload ?? {}) as { tile?: unknown; train?: unknown };
      const tile = pl.tile;
      if (!Array.isArray(tile) || tile.length !== 2 || !tile.every((n) => Number.isInteger(n) && n >= 0 && n <= HIGH)) return { reject: "Pick a tile to play." };
      const train = String(pl.train ?? "");
      if (!s.trains[train]) return { reject: "Pick a train to play on." };
      if (!p.hand.some((h) => sameTile(h, tile))) return { reject: "That tile isn't in your hand." };
      if (s.pending && train !== s.pending) return { reject: "Cover the double first." };
      if (!playable(s, seat).includes(train)) return { reject: "That train isn't open to you." };
      const end = openEnd(s.trains[train], s.engine);
      if (tile[0] !== end && tile[1] !== end) return { reject: `That tile doesn't match the ${end} at the end of the train.` };
      return play(s, seat, [Math.min(tile[0], tile[1]), Math.max(tile[0], tile[1])], train, ctx);
    }
    if (intent.name === "done") {
      if (!inRun(s, seat)) return { reject: "Only during your opening run can you end your turn without playing." };
      if (s.pending) return { reject: "Cover the double first." };
      const events: Events = [{ name: "done", data: { seat } }];
      return { state: advance(s, ctx, events), events };
    }
    if (intent.name === "draw") {
      if (moves.length) return { reject: "You can play a tile, so you can't draw." };
      if (s.drew) return { reject: "You have drawn already this turn." };
      if (!s.boneyard.length) return { reject: "Nothing is left to draw." };
      return draw(s, seat, ctx);
    }
    return { reject: `Unknown intent ${intent.name}.` };
  },

  onTimer(s, id, ctx) {
    if (id === "turn" && s.phase === "playing") {
      // Out of time: the table plays the tile the steady AI would, or draws.
      const seat = s.turn;
      const moves = legalMoves(s, seat, s.players[seat].hand);
      if (moves.length) {
        const m = chooseMove(viewFor(s, seat), "steady");
        if (m && m.name === "play") return play(s, seat, m.payload.tile, m.payload.train, ctx, true);
      }
      if (inRun(s, seat) && !s.pending) {
        const events: Events = [{ name: "done", data: { seat, auto: true } }];
        return { state: advance(s, ctx, events), events };
      }
      if (!s.drew && s.boneyard.length) return draw(s, seat, ctx, true);
      return { state: s };
    }
    if (id === "next" && s.phase === "roundOver") {
      const next = deal(s, s.round + 1, ctx);
      armTurn(next, ctx);
      return { state: next, events: [{ name: "round", data: { round: next.round, engine: next.engine, starter: next.turn } }] };
    }
    return { state: s };
  },

  // Another player took over the seat (games-service D-159): the hand and score stay, the name changes.
  onSeatChanged(s, seat) {
    const p = s.players[seat.seat];
    return p ? { state: { ...s, players: { ...s.players, [seat.seat]: { ...p, name: seat.name } } } } : { state: s };
  },

  view(s, seat) {
    return viewFor(s, seat);
  },

  boardView(s) {
    return publicView(s);
  },

  isOver(s) {
    if (s.phase !== "over") return null;
    const ranking = [...s.order].sort((a, b) => s.players[a].total - s.players[b].total);
    const best = s.players[ranking[0]].total;
    const names = s.winners.map((seat) => s.players[seat].name);
    const rounds = count(s.results.length, "round");
    const scores = (f: (p: Player) => number) => s.order.map((seat) => ({ seat, score: f(s.players[seat]) }));
    const awards = [
      mostAward({ id: "longest-train", icon: "🚂", title: "Longest Train", blurb: "Built the longest train of their own in a round." }, scores((p) => p.longest), (n) => count(n, "tile")),
      mostAward({ id: "domino", icon: "🏁", title: "Domino!", blurb: "Played their last tile first the most rounds." }, scores((p) => p.out), (n) => count(n, "round")),
      mostAward({ id: "double-trouble", icon: "🎲", title: "Double Trouble", blurb: "Played the most doubles." }, scores((p) => p.doubles), (n) => count(n, "double")),
      mostAward({ id: "helper", icon: "🤝", title: "Good Neighbour", blurb: "Played the most tiles on other trains." }, scores((p) => p.elsewhere), (n) => count(n, "tile")),
      mostAward({ id: "digger", icon: "⛏️", title: "Boneyard Digger", blurb: "Drew the most tiles." }, scores((p) => p.draws), (n) => count(n, "tile")),
    ].filter((a): a is GameAward => a !== null);
    return {
      text: `${list(names)} ${names.length === 1 ? "wins" : "win"} with ${count(best, "point")} after ${rounds}.`,
      highlights: {
        winners: names,
        rounds: s.results.length,
        totals: Object.fromEntries(s.order.map((seat) => [s.players[seat].name, s.players[seat].total])),
        // Tiles on each train at the end of every round (seat trains and "m"), for measuring the board's layout.
        trainLengths: s.results.map((r) => r.lengths),
      },
      table: {
        columns: ["Player", "Points", "Rounds out", "Tiles played", "Longest train", "Draws"],
        rows: ranking.map((seat) => {
          const p = s.players[seat];
          return [p.name, p.total, p.out, p.played, p.longest, p.draws];
        }),
      },
      awards,
    };
  },

  ai(view, seat, ctx, options) {
    return chooseMove(view as SeatView, options.style === "steady" ? "steady" : "planner");
  },

  describe(step: StepInfo<State>) {
    const { before: b, after: a } = step;
    const name = (seat: number) => step.names[seat] ?? a.players[seat]?.name ?? "?";
    const trainName = (id: string, seat: number) => (id === MEXICAN ? "the Mexican train" : Number(id) === seat ? "their own train" : `${name(Number(id))}'s train`);
    const columns = { round: a.round, engine: `${a.engine}|${a.engine}` };
    if (step.kind === "intent" && !step.accepted) return { text: `${step.intent?.name} refused: ${step.reason ?? "?"}`, columns };
    const lines: string[] = [];
    for (const e of step.events ?? []) {
      const d = (e.data ?? {}) as any;
      if (e.name === "played") lines.push(`${d.seat === b.turn ? "" : `${name(d.seat)} `}plays ${d.tile[0]}|${d.tile[1]} on ${trainName(d.train, d.seat)}${isDouble(d.tile) ? " (a double)" : ""}`);
      if (e.name === "drew") lines.push(`draws a tile`);
      if (e.name === "done") lines.push(`ends their opening run`);
      if (e.name === "passed") lines.push(`${d.seat === b.turn ? "" : `${name(d.seat)} `}passes; a marker goes on their train`);
      if (e.name === "roundOver") lines.push(d.out !== null ? `${name(d.out)} is out: round ${d.round} is over` : `nobody can play: round ${d.round} is over`);
      if (e.name === "round") lines.push(`Round ${d.round} starts from the double ${d.engine}; ${name(d.starter)} begins`);
    }
    if (!lines.length) return null;
    const text = lines.join("; ") + ".";
    return step.kind === "timer" && b.phase === "playing" ? { text: `Out of time: the table ${text}`, columns } : { text, columns };
  },
});

/** What everyone may see: the trains, how many tiles each player holds, and the scores. Hands stay hidden. */
function publicView(s: State) {
  return {
    phase: s.phase,
    round: s.round,
    rounds: s.rounds,
    openingRun: s.openingRun,
    blank50: s.blank50,
    engine: s.engine,
    turn: s.turn,
    pending: s.pending,
    turnMs: s.turnMs,
    roundMs: s.roundMs,
    boneyard: s.boneyard.length,
    trains: Object.entries(s.trains).map(([id, t]) => ({ id, owner: t.owner, tiles: t.tiles, marker: t.marker, end: openEnd(t, s.engine) })),
    players: s.order.map((seat) => {
      const p = s.players[seat];
      return { seat, name: p.name, tiles: p.hand.length, total: p.total, roundScores: p.roundScores };
    }),
    last: s.results.at(-1) ?? null,
    winners: s.winners,
  };
}

export type SeatView = ReturnType<typeof publicView> & { seat: number; hand: Tile[]; moves: Move[]; canDraw: boolean; canDone: boolean; inRun: boolean; myTurn: boolean };

function viewFor(s: State, seat: number): SeatView {
  const p = s.players[seat];
  const myTurn = s.phase === "playing" && s.turn === seat;
  const hand = p ? p.hand : [];
  const moves = myTurn ? legalMoves(s, seat, hand) : [];
  const run = myTurn && inRun(s, seat);
  return { ...publicView(s), seat, hand, moves, canDraw: myTurn && !moves.length && !s.drew && s.boneyard.length > 0, canDone: run && !s.pending, inRun: run, myTurn };
}

/**
 * The longest chain of tiles from `hand` that can follow `end`, as the tiles in order. A depth-first search with a
 * budget, which is plenty for fifteen tiles.
 */
export function longestChain(hand: readonly Tile[], end: number, budget = 4000): Tile[] {
  let best: Tile[] = [];
  let steps = 0;
  const used = new Array(hand.length).fill(false);
  const path: Tile[] = [];
  const walk = (at: number) => {
    if (++steps > budget) return;
    if (path.length > best.length) best = [...path];
    for (let i = 0; i < hand.length; i++) {
      if (used[i]) continue;
      const [a, b] = hand[i];
      if (a !== at && b !== at) continue;
      used[i] = true;
      path.push(hand[i]);
      walk(a === at ? b : a);
      path.pop();
      used[i] = false;
    }
  };
  walk(end);
  return best;
}

/**
 * An AI player's move from its own view. Both styles cover a double when they must and draw when they can't play.
 * The planner keeps the longest chain it can build on its own train for itself: it plays the chain's next tile there,
 * and sends tiles outside the chain to the Mexican train and open trains, heaviest first, so a round it doesn't win
 * costs fewer points. The steady style plays on its own train when it can, else the heaviest tile anywhere.
 */
export type AiMove = { name: "play"; payload: Move } | { name: "draw" } | null;

export function chooseMove(v: SeatView, style: "planner" | "steady"): AiMove {
  if (!v.myTurn) return null;
  if (!v.moves.length) return v.canDraw ? { name: "draw" } : null;
  const own = String(v.seat);
  const ownTrain = v.trains.find((t) => t.id === own)!;
  const chain = style === "planner" ? longestChain(v.hand, ownTrain.end) : [];
  const inChain = (t: Tile) => chain.some((c) => sameTile(c, t));
  // Can the player cover this double right away with something else in hand?
  const coverable = (m: Move) => {
    if (!isDouble(m.tile)) return true;
    const rest = v.hand.filter((h) => !sameTile(h, m.tile));
    return rest.some((h) => h[0] === m.tile[0] || h[1] === m.tile[0]);
  };
  let best: { m: Move; score: number } | null = null;
  for (const m of v.moves) {
    const weight = m.tile[0] + m.tile[1];
    let score: number;
    if (style === "planner") {
      if (m.train === own) score = chain.length && sameTile(chain[0], m.tile) ? 60 + chain.length : 20 + weight / 2;
      else score = inChain(m.tile) ? weight / 4 : 40 + weight;
      // Playing on its own train takes its marker off, which keeps others from using it.
      if (m.train === own && ownTrain.marker) score += 15;
    } else {
      score = (m.train === own ? 50 : 0) + weight;
    }
    // A double you can't cover next leaves your train open to the whole table.
    if (isDouble(m.tile)) score += coverable(m) ? 10 : -30;
    if (!best || score > best.score) best = { m, score };
  }
  return { name: "play", payload: { tile: best!.m.tile, train: best!.m.train } };
}
