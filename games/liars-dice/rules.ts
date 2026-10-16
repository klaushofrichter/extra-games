// Liar's Dice: every player rolls a hidden cup of dice. In turn, players raise a bid ("at least 4 fives on the
// table") or call the previous bid a lie. The call reveals every cup: if the bid holds, the caller loses a die,
// otherwise the bidder does. Out of dice, out of the game; the last player with dice wins.
//
// Rules are pure and replayable (D-032 in games-service): all randomness goes through ctx.
import { count, defineGame, list, type GameContext, type SeatInfo } from "@game-table/sdk";

export type Face = 1 | 2 | 3 | 4 | 5 | 6;
export interface Bid {
  seat: number;
  quantity: number;
  face: Face;
}

interface Player {
  seat: number;
  name: string;
  dice: Face[];
  /** Out of dice (or left the table). */
  out: boolean;
  roundsLost: number;
  callsWon: number;
  bids: number;
  /** Round in which the player went out; null while playing. */
  outInRound: number | null;
  /** Left the table (as opposed to losing all their dice). */
  left: boolean;
}

export interface Reveal {
  round: number;
  bid: Bid;
  caller: number;
  /** How many dice showed the bid's face (with wild ones, if they count). */
  matched: number;
  /** True if the bid was right, so the caller lost. */
  bidHeld: boolean;
  loser: number;
  /** Every cup at the moment of the call. */
  cups: Record<number, Face[]>;
  /** The call happened because the turn timer ran out. */
  auto: boolean;
}

export interface State {
  startDice: number;
  onesWild: boolean;
  turnMs: number;
  revealMs: number;
  /** Seats in the order turns pass around the table. */
  order: number[];
  players: Record<number, Player>;
  round: number;
  phase: "bidding" | "reveal" | "over";
  turn: number;
  bid: Bid | null;
  /** Bids of the current round, oldest first. */
  bids: Bid[];
  reveal: Reveal | null;
  winner: number | null;
}

const EDGE_ORDER = ["south", "east", "north", "west"] as const;

/**
 * Turns pass around the table: along each edge left to right as seen from that edge (the seat numbering of
 * games-service D-037), edges in the order south, east, north, west. That keeps passing to the right everywhere.
 */
export function tableOrder(seats: SeatInfo[]): number[] {
  const rank = (s: SeatInfo) => (s.edge ? EDGE_ORDER.indexOf(s.edge) : 0);
  return [...seats].sort((a, b) => rank(a) - rank(b) || a.seat - b.seat).map((s) => s.seat);
}

export const active = (s: State) => s.order.filter((seat) => !s.players[seat].out);
export const totalDice = (s: State) => active(s).reduce((n, seat) => n + s.players[seat].dice.length, 0);

/** The next seat still in the game after `seat` (seat itself if it is the only one left). */
export function nextActive(s: State, seat: number): number {
  const i = s.order.indexOf(seat);
  for (let k = 1; k <= s.order.length; k++) {
    const cand = s.order[(i + k) % s.order.length];
    if (!s.players[cand].out) return cand;
  }
  return seat;
}

/** How many dice count toward a bid on `face`. Wild ones count for every face but one itself. */
export function matches(dice: readonly Face[], face: Face, onesWild: boolean): number {
  return dice.filter((d) => d === face || (onesWild && face !== 1 && d === 1)).length;
}

/** Faces a bid may name: with wild ones, ones can't be bid on (they are already in every count). */
export const biddableFaces = (onesWild: boolean): Face[] => (onesWild ? [2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6]);

/** Is `q × face` a legal next bid after `prev`? A raise is more dice, or as many of a higher face. */
export function isRaise(prev: Pick<Bid, "quantity" | "face"> | null, quantity: number, face: number): boolean {
  if (!prev) return quantity >= 1;
  return quantity > prev.quantity || (quantity === prev.quantity && face > prev.face);
}

/** The smallest legal bid on `face` after `prev`. */
export function minimumFor(prev: Pick<Bid, "quantity" | "face"> | null, face: Face): number {
  if (!prev) return 1;
  return face > prev.face ? prev.quantity : prev.quantity + 1;
}

function roll(ctx: GameContext, n: number): Face[] {
  return Array.from({ length: n }, () => ctx.randomInt(1, 6) as Face).sort((a, b) => a - b);
}

function armTurn(s: State, ctx: GameContext) {
  ctx.clearTimer("turn");
  if (s.turnMs > 0 && s.phase === "bidding") ctx.setTimer("turn", s.turnMs);
}

/** Everyone still in rolls a fresh cup; `starter` opens the bidding. */
function newRound(s: State, starter: number, ctx: GameContext): State {
  const players = { ...s.players };
  for (const seat of active(s)) players[seat] = { ...players[seat], dice: roll(ctx, players[seat].dice.length) };
  const next: State = { ...s, players, round: s.round + 1, phase: "bidding", turn: starter, bid: null, bids: [], reveal: null };
  armTurn(next, ctx);
  return next;
}

function placeBid(s: State, seat: number, quantity: number, face: Face, ctx: GameContext, auto = false) {
  const bid: Bid = { seat, quantity, face };
  const players = { ...s.players, [seat]: { ...s.players[seat], bids: s.players[seat].bids + 1 } };
  const next: State = { ...s, players, bid, bids: [...s.bids, bid], turn: nextActive(s, seat) };
  armTurn(next, ctx);
  return { state: next, events: [{ name: "bid", data: { ...bid, auto } }] };
}

function call(s: State, caller: number, ctx: GameContext, auto = false) {
  const bid = s.bid!;
  ctx.clearTimer("turn");
  const cups: Record<number, Face[]> = {};
  let matched = 0;
  for (const seat of active(s)) {
    cups[seat] = [...s.players[seat].dice];
    matched += matches(cups[seat], bid.face, s.onesWild);
  }
  const bidHeld = matched >= bid.quantity;
  const loser = bidHeld ? caller : bid.seat;
  const winnerOfCall = bidHeld ? bid.seat : caller;
  const lp = s.players[loser];
  const remaining = lp.dice.length - 1;
  const players = {
    ...s.players,
    [loser]: { ...lp, dice: lp.dice.slice(0, remaining), roundsLost: lp.roundsLost + 1, out: remaining === 0, outInRound: remaining === 0 ? s.round : null },
  };
  // The caller "wins" a call when the bid was a lie; a bidder whose bid holds wins it too.
  players[winnerOfCall] = { ...players[winnerOfCall], callsWon: players[winnerOfCall].callsWon + 1 };
  const reveal: Reveal = { round: s.round, bid, caller, matched, bidHeld, loser, cups, auto };
  let next: State = { ...s, players, phase: "reveal", reveal, turn: -1 };
  const left = active(next);
  const events = [{ name: "called", data: { caller, bidder: bid.seat, matched, bidHeld, loser, out: remaining === 0, auto } }];
  if (left.length === 1) {
    next = { ...next, phase: "over", winner: left[0] };
    return { state: next, events: [...events, { name: "won", data: { seat: left[0] } }] };
  }
  ctx.setTimer("next", s.revealMs);
  return { state: next, events };
}

/** What the turn timer does for a player who doesn't act: call if there is a bid, else open with one of
 *  their most common face (always true, so nobody is punished for being slow on the opening bid). */
function autoAct(s: State, ctx: GameContext) {
  const seat = s.turn;
  if (s.bid) return call(s, seat, ctx, true);
  const faces = biddableFaces(s.onesWild);
  const mine = s.players[seat].dice;
  const face = faces.reduce((best, f) => (matches(mine, f, s.onesWild) > matches(mine, best, s.onesWild) ? f : best), faces[faces.length - 1]);
  return placeBid(s, seat, 1, face, ctx, true);
}

export default defineGame<State>({
  setup(ctx, settings) {
    const startDice = Number(settings.startDice ?? 5);
    const order = tableOrder(ctx.seats);
    const players: Record<number, Player> = {};
    for (const s of ctx.seats) players[s.seat] = { seat: s.seat, name: s.name, dice: [], out: false, roundsLost: 0, callsWon: 0, bids: 0, outInRound: null, left: false };
    for (const seat of order) players[seat].dice = roll(ctx, startDice);
    const state: State = {
      startDice,
      onesWild: settings.onesWild !== false,
      turnMs: Number(settings.turnSeconds ?? 45) * 1000,
      revealMs: Number(settings.revealSeconds ?? 6) * 1000,
      order,
      players,
      round: 1,
      phase: "bidding",
      // A random player opens the first round; later rounds are opened by the last loser.
      turn: order[ctx.randomInt(0, order.length - 1)],
      bid: null,
      bids: [],
      reveal: null,
      winner: null,
    };
    armTurn(state, ctx);
    return state;
  },

  onIntent(s, seat, intent, ctx) {
    if (s.phase === "over") return { reject: "the game is over" };
    const me = s.players[seat];
    if (!me || me.out) return { reject: "you are out of dice" };
    if (s.phase !== "bidding") return { reject: "wait for the next round" };
    if (s.turn !== seat) return { reject: `it is ${s.players[s.turn].name}'s turn` };
    if (intent.name === "bid") {
      const p = (intent.payload ?? {}) as { quantity?: unknown; face?: unknown };
      const quantity = Number(p.quantity);
      const face = Number(p.face);
      if (!Number.isInteger(quantity) || !Number.isInteger(face)) return { reject: "a bid needs a whole quantity and face" };
      if (!biddableFaces(s.onesWild).includes(face as Face)) return { reject: s.onesWild && face === 1 ? "ones are wild; bid on 2 to 6" : "the face must be 1 to 6" };
      if (quantity < 1) return { reject: "bid at least one die" };
      if (quantity > totalDice(s)) return { reject: `there are only ${count(totalDice(s), "die", "dice")} on the table` };
      if (!isRaise(s.bid, quantity, face)) return { reject: `raise the bid: more dice, or as many of a higher face than ${s.bid!.quantity} × ${s.bid!.face}` };
      return placeBid(s, seat, quantity, face as Face, ctx);
    }
    if (intent.name === "liar") {
      if (!s.bid) return { reject: "there is no bid to call yet" };
      return call(s, seat, ctx);
    }
    return { reject: `unknown intent ${intent.name}` };
  },

  onTimer(s, id, ctx) {
    if (id === "turn" && s.phase === "bidding") return autoAct(s, ctx);
    if (id === "next" && s.phase === "reveal") {
      const r = s.reveal!;
      // The loser opens the next round; if they just went out, the player after them does.
      const starter = s.players[r.loser].out ? nextActive(s, r.loser) : r.loser;
      return { state: newRound(s, starter, ctx), events: [{ name: "round", data: { round: s.round + 1, starter } }] };
    }
    return { state: s };
  },

  onSeatLeft(s, seat, ctx) {
    const p = s.players[seat];
    if (!p || p.out || s.phase === "over") return { state: s };
    const players = { ...s.players, [seat]: { ...p, out: true, dice: [], outInRound: s.round, left: true } };
    let next: State = { ...s, players };
    const left = active(next);
    if (left.length === 0) return "end";
    if (left.length === 1) {
      ctx.clearTimer("turn");
      ctx.clearTimer("next");
      return { state: { ...next, phase: "over", winner: left[0], turn: -1 }, events: [{ name: "won", data: { seat: left[0] } }] };
    }
    // Mid-round, the round starts over with fresh cups: the bids so far counted the leaver's dice.
    if (s.phase === "bidding") {
      next = { ...next, round: s.round - 1 };
      const starter = s.turn === seat ? nextActive(s, seat) : s.turn;
      return { state: newRound(next, starter, ctx), events: [{ name: "restarted", data: { left: seat } }] };
    }
    return { state: next };
  },

  view(s, seat) {
    const me = s.players[seat];
    return {
      ...publicView(s),
      seat,
      myDice: me && !me.out ? me.dice : [],
      out: !me || me.out,
      myTurn: s.phase === "bidding" && s.turn === seat,
    };
  },

  boardView(s) {
    return publicView(s);
  },

  isOver(s) {
    if (s.phase !== "over" || s.winner === null) return null;
    const w = s.players[s.winner];
    const ranking = [...s.order].sort((a, b) => {
      const pa = s.players[a];
      const pb = s.players[b];
      return pb.dice.length - pa.dice.length || (pb.outInRound ?? Infinity) - (pa.outInRound ?? Infinity);
    });
    // Players who left the table mid-game are out too, but they didn't lose their dice: name only the others.
    const beaten = ranking.filter((x) => x !== s.winner && s.players[x].out && !s.players[x].left).map((x) => s.players[x].name);
    return {
      text: `${w.name} wins with ${count(w.dice.length, "die", "dice")} left after ${count(s.round, "round")}.${beaten.length ? ` ${list(beaten)} ran out of dice.` : ""}`,
      highlights: {
        winner: w.name,
        rounds: s.round,
        diceLeft: w.dice.length,
        ranking: ranking.map((x) => s.players[x].name),
      },
      table: {
        columns: ["Player", "Dice left", "Rounds lost", "Calls won", "Bids"],
        rows: ranking.map((x) => {
          const p = s.players[x];
          return [p.name, p.dice.length, p.roundsLost, p.callsWon, p.bids];
        }),
      },
    };
  },

  ai(view, seat, ctx, options) {
    const v = view as ReturnType<typeof publicView> & { myDice: Face[]; myTurn: boolean };
    if (!v.myTurn) return null;
    return chooseMove(v.myDice, v.bid, v.totalDice, v.onesWild, options.style === "bold" ? "bold" : "cautious", ctx.random);
  },
});

/** What everyone may see. Cups stay hidden except in the reveal after a call. */
function publicView(s: State) {
  return {
    phase: s.phase,
    round: s.round,
    onesWild: s.onesWild,
    startDice: s.startDice,
    turnMs: s.turnMs,
    revealMs: s.revealMs,
    turn: s.turn,
    bid: s.bid,
    bids: s.bids,
    totalDice: totalDice(s),
    players: s.order.map((seat) => {
      const p = s.players[seat];
      return { seat, name: p.name, dice: p.dice.length, out: p.out, roundsLost: p.roundsLost };
    }),
    reveal: s.reveal,
    winner: s.winner,
  };
}

/**
 * The AI's move from its own cup and the public bid. It estimates how many dice of each face are on the table:
 * its own matches plus the expected share of the dice it cannot see. It calls when the bid is further above that
 * estimate than its style tolerates; otherwise it makes the cheapest raise on the face it believes in most.
 * A bold player tolerates more and sometimes pushes a bid by one more die.
 */
export function chooseMove(mine: Face[], bid: Bid | null, total: number, onesWild: boolean, style: "cautious" | "bold", random: () => number) {
  const unseen = total - mine.length;
  const p = onesWild ? 1 / 3 : 1 / 6;
  const expect = (f: Face) => matches(mine, f, onesWild) + unseen * (onesWild && f === 1 ? 1 / 6 : p);
  // How far above its estimate a bid may be before it calls, and before it would rather call than raise.
  const callMargin = style === "bold" ? 1.5 : 0.5;
  const raiseMargin = style === "bold" ? 2.5 : 0.5;
  if (bid && bid.quantity > expect(bid.face) + callMargin) return { name: "liar" };
  let best: { quantity: number; face: Face; score: number } | null = null;
  for (const f of biddableFaces(onesWild)) {
    // Opening: name the face it holds most, a little under its estimate (bold: right at it).
    const q = bid ? minimumFor(bid, f) : Math.max(1, Math.floor(expect(f)) - (style === "bold" ? 0 : 1));
    if (q > total) continue;
    // Ties go to the higher face, which is harder to overbid.
    const score = (bid ? expect(f) - q : matches(mine, f, onesWild)) + f * 0.001;
    if (!best || score > best.score) best = { quantity: q, face: f, score };
  }
  if (!best || (bid && best.score < -raiseMargin)) return bid ? { name: "liar" } : { name: "bid", payload: { quantity: 1, face: biddableFaces(onesWild).at(-1) } };
  let quantity = best.quantity;
  // A bold player sometimes pushes one die further than it needs to.
  if (style === "bold" && random() < 0.25 && quantity + 1 <= total && (!bid || best.score > 0)) quantity++;
  return { name: "bid", payload: { quantity, face: best.face } };
}
