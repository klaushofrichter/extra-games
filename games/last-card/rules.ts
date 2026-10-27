// Last Card (E-023): the shedding card game of colours and numbers, for 2 to 8 players, built on games-service's sling
// (D-189): players push a card off the top of their phone and it flies onto the pile. Match the top card's colour or
// its number or symbol; Skip, Reverse and Draw Two hit the next player, a Wild picks the colour, a Wild Draw Four does
// both. Whoever plays their last card first wins the round and scores what the others still hold; the first to the
// target wins the game. When a player is down to one card, the board calls it for them: "Last card!".
import { count, defineGame, leastAward, list, mostAward, type GameAward, type GameContext, type SeatInfo, type StepInfo } from "@game-table/sdk";
import { shuffle } from "@game-table/sdk/cards";

export const COLORS = ["r", "y", "g", "b"] as const;
export type Color = (typeof COLORS)[number];
export type Kind = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "skip" | "rev" | "+2" | "wild" | "+4";
export interface Card {
  id: number;
  /** "w" for the wild cards. */
  c: Color | "w";
  k: Kind;
}
/** A card on the discard pile, with the colour it set and how it lies (picked when it landed, so the pile looks thrown). */
export interface Discard extends Card {
  color: Color;
  angle: number;
  dx: number;
  dy: number;
  seat: number | null;
}

interface Player {
  seat: number;
  name: string;
  hand: Card[];
  total: number;
  played: number;
  actions: number;
  wilds: number;
  drawn: number;
  forced: number;
  out: number;
  lastCalls: number;
  /** Times this player changed the colour to play (another colour by number or symbol, or a wild calling a new one). */
  changes: number;
  /** The most points won in one round. */
  bestRound: number;
  /** The most cards held during a round this player went on to win. */
  comeback: number;
  /** The most cards held at once. */
  maxHand: number;
}
export interface RoundResult {
  round: number;
  out: number;
  scores: Record<number, number>;
}
export interface State {
  target: number;
  turnMs: number;
  roundMs: number;
  order: number[];
  players: Record<number, Player>;
  round: number;
  phase: "playing" | "roundOver" | "over";
  turn: number;
  dir: 1 | -1;
  color: Color;
  drawPile: Card[];
  discard: Discard[];
  /** The player on turn drew a card this turn: they may play only that card, or keep it. */
  drewId: number | null;
  results: RoundResult[];
  winners: number[];
  /** The most cards each seat has held in this round (for Comeback). */
  roundMax: Record<number, number>;
}

const HAND = 7;
const PILE_SHOWN = 8;
const NAMES: Record<Color, string> = { r: "red", y: "yellow", g: "green", b: "blue" };
const KIND_NAMES: Partial<Record<Kind, string>> = { skip: "Skip", rev: "Reverse", "+2": "Draw Two", wild: "Wild", "+4": "Wild Draw Four" };

/** A card in words: "red 7", "blue Skip", "Wild". */
export const cardName = (c: Pick<Card, "c" | "k">) => (c.c === "w" ? KIND_NAMES[c.k]! : `${NAMES[c.c]} ${KIND_NAMES[c.k] ?? c.k}`);
export const colorName = (c: Color) => NAMES[c];

/** What a card left in a hand scores for the winner of the round: its number, 20 for an action, 50 for a wild. */
export const points = (c: Pick<Card, "k">) => (c.k === "wild" || c.k === "+4" ? 50 : c.k === "skip" || c.k === "rev" || c.k === "+2" ? 20 : Number(c.k));

/** The 108 cards: per colour one 0, two of 1–9, Skip, Reverse and Draw Two; four Wilds and four Wild Draw Fours. */
export function fullDeck(): Card[] {
  const cards: Card[] = [];
  let id = 1;
  for (const c of COLORS) {
    cards.push({ id: id++, c, k: "0" });
    for (const k of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "skip", "rev", "+2"] as Kind[]) for (let n = 0; n < 2; n++) cards.push({ id: id++, c, k });
  }
  for (let n = 0; n < 4; n++) cards.push({ id: id++, c: "w", k: "wild" }, { id: id++, c: "w", k: "+4" });
  return cards;
}

/** May `card` go on a pile whose top is `top` and whose colour is `color`? */
export const fits = (card: Pick<Card, "c" | "k">, top: Pick<Card, "k"> | null, color: Color) => card.c === "w" || card.c === color || (!!top && top.k === card.k && top.k !== "wild" && top.k !== "+4");

const EDGE_ORDER = ["south", "east", "north", "west"] as const;
/** Seats in playing order around the table (the same order as Mexican Train's). */
export function tableOrder(seats: SeatInfo[]): number[] {
  const rank = (s: SeatInfo) => (s.edge ? EDGE_ORDER.indexOf(s.edge) : 0);
  return [...seats].sort((a, b) => rank(a) - rank(b) || a.seat - b.seat).map((s) => s.seat);
}

const step = (s: State, from: number, n = 1) => {
  const i = s.order.indexOf(from);
  const len = s.order.length;
  return s.order[(((i + s.dir * n) % len) + len) % len];
};
const top = (s: State) => s.discard.at(-1) ?? null;

/** The cards the player on turn may play now (ids). */
export function playable(s: Pick<State, "turn" | "players" | "discard" | "color" | "drewId" | "phase">, seat: number): number[] {
  if (s.phase !== "playing" || s.turn !== seat) return [];
  const t = s.discard.at(-1) ?? null;
  return s.players[seat].hand.filter((c) => (s.drewId === null || c.id === s.drewId) && fits(c, t, s.color)).map((c) => c.id);
}

type Events = { name: string; data?: unknown }[];

/** After a hand grew: the most cards held, in the game and in this round. */
function held(s: State, seat: number) {
  const n = s.players[seat].hand.length;
  if (n > s.players[seat].maxHand) s.players[seat] = { ...s.players[seat], maxHand: n };
  if (n > (s.roundMax[seat] ?? 0)) s.roundMax = { ...s.roundMax, [seat]: n };
}

function armTurn(s: State, ctx: GameContext) {
  ctx.clearTimer("turn");
  if (s.turnMs > 0 && s.phase === "playing") ctx.setTimer("turn", s.turnMs);
}

/** Take n cards from the draw pile, turning the discards (all but the top card) over into it when it runs out. */
function take(s: State, n: number, ctx: GameContext, events: Events): Card[] {
  const got: Card[] = [];
  for (let i = 0; i < n; i++) {
    if (!s.drawPile.length && s.discard.length > 1) {
      const keep = s.discard.at(-1)!;
      const back = s.discard.slice(0, -1).map(({ id, c, k }) => ({ id, c, k }));
      s.drawPile = shuffle(back, ctx.random);
      s.discard = [keep];
      events.push({ name: "reshuffled", data: { cards: s.drawPile.length } });
    }
    const card = s.drawPile.pop();
    if (!card) break;
    got.push(card);
  }
  return got;
}

function deal(s0: State, round: number, ctx: GameContext): State {
  const s: State = { ...s0, round, phase: "playing", dir: 1, drewId: null, players: { ...s0.players } };
  s.drawPile = shuffle(fullDeck(), ctx.random);
  for (const seat of s.order) s.players[seat] = { ...s.players[seat], hand: s.drawPile.splice(-HAND) };
  // The first card of the pile is a number: action cards and wilds go back into the pile.
  let first = s.drawPile.pop()!;
  while (first.c === "w" || !/^\d$/.test(first.k)) {
    s.drawPile.splice(ctx.randomInt(0, s.drawPile.length), 0, first);
    first = s.drawPile.pop()!;
  }
  s.discard = [{ ...first, color: first.c as Color, angle: ctx.randomInt(-12, 12), dx: 0, dy: 0, seat: null }];
  s.color = first.c as Color;
  s.turn = s.order[(round - 1) % s.order.length];
  s.roundMax = Object.fromEntries(s.order.map((x) => [x, HAND]));
  for (const x of s.order) held(s, x);
  return s;
}

function endRound(s: State, out: number, ctx: GameContext, events: Events): State {
  ctx.clearTimer("turn");
  const scores: Record<number, number> = {};
  let won = 0;
  for (const seat of s.order) {
    scores[seat] = 0;
    if (seat !== out) won += s.players[seat].hand.reduce((n, c) => n + points(c), 0);
  }
  scores[out] = won;
  const p = s.players[out];
  const players = {
    ...s.players,
    [out]: { ...p, total: p.total + won, out: p.out + 1, bestRound: Math.max(p.bestRound, won), comeback: Math.max(p.comeback, s.roundMax[out] ?? 0) },
  };
  const results = [...s.results, { round: s.round, out, scores }];
  const next: State = { ...s, players, results, drewId: null };
  const best = Math.max(...s.order.map((seat) => players[seat].total));
  if (best >= s.target) {
    const winners = s.order.filter((seat) => players[seat].total === best);
    events.push({ name: "roundOver", data: { round: s.round, out, scores } }, { name: "won", data: { winners } });
    return { ...next, phase: "over", winners };
  }
  events.push({ name: "roundOver", data: { round: s.round, out, scores } });
  ctx.setTimer("next", Math.max(1000, s.roundMs));
  return { ...next, phase: "roundOver" };
}

/** The turn moves on: to the next player, or past them (`skip`). */
function advance(s: State, ctx: GameContext, skip = false): State {
  const next = { ...s, turn: step(s, s.turn, skip ? 2 : 1), drewId: null };
  armTurn(next, ctx);
  return next;
}

function play(s0: State, seat: number, id: number, chosen: unknown, ctx: GameContext, auto = false): { state: State; events: Events } | { reject: string } {
  if (s0.phase !== "playing") return { reject: "The round is over" };
  if (s0.turn !== seat) return { reject: "Wait for your turn" };
  const p = s0.players[seat];
  const card = p.hand.find((c) => c.id === id);
  if (!card) return { reject: "That card is not in your hand" };
  if (s0.drewId !== null && id !== s0.drewId) return { reject: "Play the card you drew, or keep it" };
  if (!fits(card, top(s0), s0.color)) return { reject: `That card doesn't match: play ${colorName(s0.color)} or ${top(s0)?.k ?? "a wild card"}` };
  let color = card.c as Color;
  if (card.c === "w") {
    if (!COLORS.includes(chosen as Color)) return { reject: "Pick a colour for the wild card" };
    color = chosen as Color;
  }
  const s: State = { ...s0, players: { ...s0.players }, drawPile: [...s0.drawPile], discard: [...s0.discard] };
  const hand = p.hand.filter((c) => c.id !== id);
  const action = card.k === "skip" || card.k === "rev" || card.k === "+2" || card.k === "+4";
  const changed = color !== s0.color;
  s.players[seat] = { ...p, hand, played: p.played + 1, actions: p.actions + (action ? 1 : 0), wilds: p.wilds + (card.c === "w" ? 1 : 0), lastCalls: p.lastCalls + (hand.length === 1 ? 1 : 0), changes: p.changes + (changed ? 1 : 0) };
  const landed: Discard = { ...card, color, angle: ctx.randomInt(-28, 28), dx: ctx.randomInt(-22, 22), dy: ctx.randomInt(-22, 22), seat };
  s.discard = [...s.discard, landed].slice(-60); // older cards stay for reshuffling; the board shows the last few
  s.color = color;
  s.drewId = null;
  const events: Events = [{ name: "played", data: { seat, card: landed, auto } }];
  if (hand.length === 1) events.push({ name: "lastCard", data: { seat } });

  // What the card does to the next player.
  let skip = false;
  if (card.k === "rev") {
    s.dir = (s.dir * -1) as 1 | -1;
    events.push({ name: "reversed", data: { dir: s.dir } });
    if (s.order.length === 2) skip = true;
  } else if (card.k === "skip") {
    skip = true;
    events.push({ name: "skipped", data: { seat: step(s, seat) } });
  } else if (card.k === "+2" || card.k === "+4") {
    const victim = step(s, seat);
    const n = card.k === "+2" ? 2 : 4;
    const got = take(s, n, ctx, events);
    const v = s.players[victim];
    s.players[victim] = { ...v, hand: [...v.hand, ...got], drawn: v.drawn + got.length, forced: v.forced + got.length };
    held(s, victim);
    events.push({ name: "drew", data: { seat: victim, n: got.length, forced: true } });
    skip = true;
  }
  if (!hand.length) return { state: endRound(s, seat, ctx, events), events };
  return { state: advance(s, ctx, skip), events };
}

function draw(s0: State, seat: number, ctx: GameContext, auto = false): { state: State; events: Events } | { reject: string } {
  if (s0.phase !== "playing") return { reject: "The round is over" };
  if (s0.turn !== seat) return { reject: "Wait for your turn" };
  if (s0.drewId !== null) return { reject: "You drew already: play that card or keep it" };
  const s: State = { ...s0, players: { ...s0.players }, drawPile: [...s0.drawPile], discard: [...s0.discard] };
  const events: Events = [];
  const [card] = take(s, 1, ctx, events);
  const p = s.players[seat];
  if (!card) {
    events.push({ name: "passed", data: { seat, empty: true } });
    return { state: advance(s, ctx), events };
  }
  s.players[seat] = { ...p, hand: [...p.hand, card], drawn: p.drawn + 1 };
  held(s, seat);
  events.push({ name: "drew", data: { seat, n: 1, auto } });
  // A card that can't be played ends the turn at once; one that can waits for Play or Keep.
  if (!fits(card, top(s), s.color)) {
    events.push({ name: "passed", data: { seat } });
    return { state: advance(s, ctx), events };
  }
  s.drewId = card.id;
  armTurn(s, ctx);
  return { state: s, events };
}

// ---------- AI ----------

export interface SeatView {
  seat: number;
  hand: Card[];
  playable: number[];
  canDraw: boolean;
  canKeep: boolean;
  color: Color;
  top: Discard | null;
  next: number;
  counts: Record<number, number>;
  phase: State["phase"];
  myTurn: boolean;
}

/** The AI's move: hit a nearly finished next player hard, keep wilds for later, play the colour it holds most of. */
export function chooseMove(v: SeatView): { name: string; payload: unknown } | null {
  if (!v.myTurn || v.phase !== "playing") return null;
  const cards = v.hand.filter((c) => v.playable.includes(c.id));
  if (!cards.length) return v.canKeep ? { name: "keep", payload: null } : v.canDraw ? { name: "draw", payload: null } : null;
  const held = (c: Color) => v.hand.filter((x) => x.c === c).length;
  const best = [...COLORS].sort((a, b) => held(b) - held(a))[0];
  const danger = (v.counts[v.next] ?? 7) <= 2;
  const score = (c: Card) => {
    let n = 0;
    if (c.c === "w") n -= 30; // keep wilds
    if (danger && (c.k === "+2" || c.k === "+4" || c.k === "skip")) n += 60;
    if (c.k === "+4") n -= danger ? 0 : 20;
    if (c.c !== "w") n += held(c.c) * 3;
    if (/^\d$/.test(c.k)) n += Number(c.k) * 0.5; // shed high numbers
    else n += 4;
    return n;
  };
  const pick = cards.reduce((a, b) => (score(b) > score(a) ? b : a));
  return { name: "play", payload: { id: pick.id, ...(pick.c === "w" ? { color: best } : {}) } };
}

function viewFor(s: State, seat: number): SeatView & Record<string, unknown> {
  const me = s.players[seat];
  const myTurn = s.phase === "playing" && s.turn === seat;
  return {
    seat,
    hand: me?.hand ?? [],
    playable: me ? playable(s, seat) : [],
    canDraw: myTurn && s.drewId === null,
    canKeep: myTurn && s.drewId !== null,
    drewId: myTurn ? s.drewId : null,
    color: s.color,
    top: top(s),
    next: step(s, s.turn),
    dir: s.dir,
    turn: s.turn,
    counts: Object.fromEntries(s.order.map((x) => [x, s.players[x].hand.length])),
    totals: Object.fromEntries(s.order.map((x) => [x, s.players[x].total])),
    names: Object.fromEntries(s.order.map((x) => [x, s.players[x].name])),
    order: s.order,
    round: s.round,
    target: s.target,
    phase: s.phase,
    last: s.results.at(-1) ?? null,
    winners: s.winners,
    myTurn,
  };
}

function publicView(s: State) {
  return {
    order: s.order,
    turn: s.turn,
    dir: s.dir,
    color: s.color,
    pile: s.discard.slice(-PILE_SHOWN),
    drawPile: s.drawPile.length,
    counts: Object.fromEntries(s.order.map((x) => [x, s.players[x].hand.length])),
    totals: Object.fromEntries(s.order.map((x) => [x, s.players[x].total])),
    names: Object.fromEntries(s.order.map((x) => [x, s.players[x].name])),
    round: s.round,
    target: s.target,
    phase: s.phase,
    last: s.results.at(-1) ?? null,
    winners: s.winners,
    drew: s.drewId !== null,
    /** The pause after a round, for the board's countdown bar. */
    roundMs: Math.max(1000, s.roundMs),
  };
}

export default defineGame<State>({
  setup(ctx, settings) {
    const order = tableOrder(ctx.seats);
    const players: Record<number, Player> = {};
    for (const x of ctx.seats) players[x.seat] = { seat: x.seat, name: x.name, hand: [], total: 0, played: 0, actions: 0, wilds: 0, drawn: 0, forced: 0, out: 0, lastCalls: 0, changes: 0, bestRound: 0, comeback: 0, maxHand: 0 };
    const base: State = {
      target: Number(settings.target ?? 200),
      turnMs: Number(settings.turnSeconds ?? 30) * 1000,
      roundMs: Number(settings.roundSeconds ?? 12) * 1000,
      order,
      players,
      round: 0,
      phase: "playing",
      turn: order[0],
      dir: 1,
      color: "r",
      drawPile: [],
      discard: [],
      drewId: null,
      results: [],
      winners: [],
      roundMax: {},
    };
    const s = deal(base, 1, ctx);
    armTurn(s, ctx);
    return s;
  },

  onIntent(s, seat, intent, ctx) {
    if (s.phase === "over") return { reject: "The game is over" };
    const p = (intent.payload ?? {}) as { id?: unknown; color?: unknown };
    if (intent.name === "play") return play(s, seat, Number(p.id), p.color, ctx);
    if (intent.name === "draw") return draw(s, seat, ctx);
    if (intent.name === "keep") {
      if (s.phase !== "playing" || s.turn !== seat) return { reject: "Wait for your turn" };
      if (s.drewId === null) return { reject: "Draw a card first" };
      const events: Events = [{ name: "passed", data: { seat, kept: true } }];
      return { state: advance(s, ctx), events };
    }
    return { reject: `unknown move ${intent.name}` };
  },

  onTimer(s, id, ctx) {
    if (id === "turn" && s.phase === "playing") {
      // Out of time: the table plays what the AI would, or draws (and keeps).
      const seat = s.turn;
      if (s.drewId !== null) return { state: advance(s, ctx), events: [{ name: "passed", data: { seat, kept: true, auto: true } }] };
      const m = chooseMove(viewFor(s, seat));
      if (m?.name === "play") {
        const r = play(s, seat, (m.payload as { id: number }).id, (m.payload as { color?: Color }).color, ctx, true);
        if ("state" in r) return r;
      }
      const r = draw(s, seat, ctx, true);
      if (!("state" in r)) return { state: s };
      if (r.state.drewId !== null) return { state: advance(r.state, ctx), events: [...r.events, { name: "passed", data: { seat, kept: true, auto: true } }] };
      return r;
    }
    if (id === "next" && s.phase === "roundOver") {
      const next = deal(s, s.round + 1, ctx);
      armTurn(next, ctx);
      return { state: next, events: [{ name: "round", data: { round: next.round, starter: next.turn } }] };
    }
    return { state: s };
  },

  // Another player took over the seat (games-service D-159): the hand and score stay, the name changes.
  onSeatChanged(s, seat) {
    const p = s.players[seat.seat];
    return p ? { state: { ...s, players: { ...s.players, [seat.seat]: { ...p, name: seat.name } } } } : { state: s };
  },

  view: (s, seat) => viewFor(s, seat),
  boardView: (s) => publicView(s),

  isOver(s) {
    if (s.phase !== "over") return null;
    const ranking = [...s.order].sort((a, b) => s.players[b].total - s.players[a].total);
    const names = s.winners.map((x) => s.players[x].name);
    const best = s.players[ranking[0]].total;
    const scores = (f: (p: Player) => number) => s.order.map((seat) => ({ seat, score: f(s.players[seat]) }));
    const awards = [
      mostAward({ id: "out-first", icon: "🏁", title: "Out First", blurb: "Played their last card first the most rounds." }, scores((p) => p.out), (n) => count(n, "round")),
      mostAward({ id: "troublemaker", icon: "😈", title: "Troublemaker", blurb: "Played the most Skips, Reverses and Draw cards." }, scores((p) => p.actions), (n) => count(n, "action card")),
      mostAward({ id: "wild-one", icon: "🌈", title: "Wild One", blurb: "Played the most wild cards." }, scores((p) => p.wilds), (n) => count(n, "wild card")),
      mostAward({ id: "piled-on", icon: "📚", title: "Piled On", blurb: "Was made to draw the most cards by others." }, scores((p) => p.forced), (n) => count(n, "card")),
      mostAward({ id: "last-card", icon: "☝️", title: "Last Card!", blurb: "Got down to one card the most often." }, scores((p) => p.lastCalls), (n) => count(n, "time")),
      mostAward({ id: "chameleon", icon: "🦎", title: "Chameleon", blurb: "Changed the colour to play most often." }, scores((p) => p.changes), (n) => count(n, "time")),
      mostAward({ id: "big-haul", icon: "💰", title: "Big Haul", blurb: "Scored the most points in a single round." }, scores((p) => p.bestRound), (n) => count(n, "point")),
      mostAward({ id: "comeback", icon: "🔄", title: "Comeback", blurb: "Won a round after holding the most cards in it." }, scores((p) => p.comeback), (n) => `from ${count(n, "card")}`),
      mostAward({ id: "hoarder", icon: "🗃️", title: "Hoarder", blurb: "Held the most cards at once." }, scores((p) => p.maxHand), (n) => count(n, "card")),
      leastAward({ id: "light-fingers", icon: "🪶", title: "Light Fingers", blurb: "Drew the fewest cards." }, scores((p) => p.drawn), (n) => count(n, "card")),
    ].filter((a): a is GameAward => a !== null);
    return {
      text: `${list(names)} ${names.length === 1 ? "wins" : "win"} with ${count(best, "point")} after ${count(s.results.length, "round")}.`,
      highlights: { winners: names, rounds: s.results.length, totals: Object.fromEntries(s.order.map((x) => [s.players[x].name, s.players[x].total])) },
      table: {
        columns: ["Player", "Points", "Rounds won", "Cards played", "Action cards", "Cards drawn"],
        rows: ranking.map((x) => {
          const p = s.players[x];
          return [p.name, p.total, p.out, p.played, p.actions, p.drawn];
        }),
      },
      awards,
    };
  },

  ai(view) {
    return chooseMove(view as unknown as SeatView);
  },

  // The Game Viewer's line for a step.
  describe(step: StepInfo<State>) {
    const a = step.after;
    const columns = { round: a.round, top: a.discard.at(-1) ? cardName(a.discard.at(-1)!) : "" };
    if (step.kind === "intent" && !step.accepted) return { text: `${step.intent?.name} refused: ${step.reason ?? "?"}`, columns };
    if (step.kind === "intent" && step.intent?.name === "play") return { text: `plays ${columns.top}${a.discard.at(-1)?.c === "w" ? ` and picks ${colorName(a.color)}` : ""}`, columns };
    if (step.kind === "intent" && step.intent?.name === "draw") return { text: "draws a card", columns };
    if (step.kind === "intent" && step.intent?.name === "keep") return { text: "keeps the card", columns };
    if (step.kind === "timer") return { text: step.timer === "next" ? `Round ${a.round} is dealt` : "Out of time: the table moves for them", columns };
    return null;
  },
});
