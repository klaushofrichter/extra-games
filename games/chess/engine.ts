// The chess engine: alpha-beta with iterative deepening, a transposition table, quiescence, null-move pruning and late
// move reductions, over a tapered material-and-squares evaluation. Its strength is set as an approximate Elo rating
// (see `level`): weaker levels search shallower and fewer nodes, add noise to their move scores and now and then play
// a move they did not choose. With only a node budget (no time limit) a search is deterministic, which the rules rely
// on when the engine stands in for a player who left (replay must reach the same move).
import { BISHOP, F_CAPTURE, KING, KNIGHT, PAWN, Position, QUEEN, ROOK, WHITE, moveFlags, moveFrom, movePromo, moveTo } from "./chess.ts";

// ---------- evaluation ----------
// Piece-square tables, rank 8 first as seen from White, in centipawns; middlegame and endgame values are blended by
// the material left on the board.
// prettier-ignore
const PST_MG: Record<number, number[]> = {
  [PAWN]: [
     0,  0,  0,  0,  0,  0,  0,  0,
    60, 60, 60, 60, 60, 60, 60, 60,
    14, 18, 26, 34, 34, 26, 18, 14,
     6,  8, 14, 26, 26, 14,  8,  6,
     0,  0,  6, 22, 22,  6,  0,  0,
     4, -2, -6,  4,  4, -6, -2,  4,
     4,  8,  8,-18,-18,  8,  8,  4,
     0,  0,  0,  0,  0,  0,  0,  0],
  [KNIGHT]: [
   -50,-38,-28,-28,-28,-28,-38,-50,
   -36,-18,  0,  4,  4,  0,-18,-36,
   -26,  4, 12, 16, 16, 12,  4,-26,
   -26,  6, 16, 22, 22, 16,  6,-26,
   -26,  2, 14, 20, 20, 14,  2,-26,
   -28,  4, 10, 12, 12, 10,  4,-28,
   -36,-18,  0,  4,  4,  0,-18,-36,
   -50,-30,-28,-28,-28,-28,-30,-50],
  [BISHOP]: [
   -18,-10,-10,-10,-10,-10,-10,-18,
   -10,  0,  0,  0,  0,  0,  0,-10,
   -10,  0,  6, 10, 10,  6,  0,-10,
   -10,  6,  6, 10, 10,  6,  6,-10,
   -10,  0, 10, 12, 12, 10,  0,-10,
   -10, 10, 10, 10, 10, 10, 10,-10,
   -10,  8,  0,  0,  0,  0,  8,-10,
   -18,-10,-12,-10,-10,-12,-10,-18],
  [ROOK]: [
     0,  0,  0,  0,  0,  0,  0,  0,
    10, 14, 14, 14, 14, 14, 14, 10,
    -4,  0,  0,  0,  0,  0,  0, -4,
    -4,  0,  0,  0,  0,  0,  0, -4,
    -4,  0,  0,  0,  0,  0,  0, -4,
    -4,  0,  0,  0,  0,  0,  0, -4,
    -4,  0,  0,  0,  0,  0,  0, -4,
    -2,  0,  2,  6,  6,  4,  0, -2],
  [QUEEN]: [
   -18,-10,-10, -4, -4,-10,-10,-18,
   -10,  0,  0,  0,  0,  0,  0,-10,
   -10,  0,  4,  4,  4,  4,  0,-10,
    -4,  0,  4,  4,  4,  4,  0, -4,
    -2,  0,  4,  4,  4,  4,  0, -4,
   -10,  4,  4,  4,  4,  4,  0,-10,
   -10,  0,  4,  0,  0,  0,  0,-10,
   -18,-10,-10, -4, -4,-10,-10,-18],
  [KING]: [
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -20,-30,-30,-40,-40,-30,-30,-20,
   -10,-20,-20,-24,-24,-20,-20,-10,
    16, 16, -6,-10,-10, -6, 16, 16,
    18, 30, 12, -4,  0, 10, 32, 20],
};
// prettier-ignore
const PST_EG: Record<number, number[]> = {
  [PAWN]: [
     0,  0,  0,  0,  0,  0,  0,  0,
    90, 90, 86, 80, 80, 86, 90, 90,
    56, 56, 50, 44, 44, 50, 56, 56,
    30, 28, 24, 20, 20, 24, 28, 30,
    14, 12, 10,  8,  8, 10, 12, 14,
     4,  4,  2,  2,  2,  2,  4,  4,
     0,  0,  0,  0,  0,  0,  0,  0,
     0,  0,  0,  0,  0,  0,  0,  0],
  [KNIGHT]: [
   -40,-30,-20,-20,-20,-20,-30,-40,
   -30,-14, -4,  0,  0, -4,-14,-30,
   -20, -4,  8, 12, 12,  8, -4,-20,
   -20,  0, 12, 18, 18, 12,  0,-20,
   -20,  0, 12, 18, 18, 12,  0,-20,
   -20, -4,  8, 12, 12,  8, -4,-20,
   -30,-14, -4,  0,  0, -4,-14,-30,
   -40,-30,-20,-20,-20,-20,-30,-40],
  [BISHOP]: [
   -14, -8, -8, -6, -6, -8, -8,-14,
    -8,  0,  0,  2,  2,  0,  0, -8,
    -8,  0,  6,  8,  8,  6,  0, -8,
    -6,  2,  8, 12, 12,  8,  2, -6,
    -6,  2,  8, 12, 12,  8,  2, -6,
    -8,  0,  6,  8,  8,  6,  0, -8,
    -8,  0,  0,  2,  2,  0,  0, -8,
   -14, -8, -8, -6, -6, -8, -8,-14],
  [ROOK]: [
     6,  6,  6,  6,  6,  6,  6,  6,
     8,  8,  8,  8,  8,  8,  8,  8,
     2,  2,  2,  2,  2,  2,  2,  2,
     0,  0,  0,  0,  0,  0,  0,  0,
     0,  0,  0,  0,  0,  0,  0,  0,
     0,  0,  0,  0,  0,  0,  0,  0,
     0,  0,  0,  0,  0,  0,  0,  0,
     0,  0,  0,  0,  0,  0,  0,  0],
  [QUEEN]: [
   -16, -8, -8, -4, -4, -8, -8,-16,
    -8,  0,  4,  6,  6,  4,  0, -8,
    -8,  4, 10, 12, 12, 10,  4, -8,
    -4,  6, 12, 16, 16, 12,  6, -4,
    -4,  6, 12, 16, 16, 12,  6, -4,
    -8,  4, 10, 12, 12, 10,  4, -8,
    -8,  0,  4,  6,  6,  4,  0, -8,
   -16, -8, -8, -4, -4, -8, -8,-16],
  [KING]: [
   -50,-30,-24,-20,-20,-24,-30,-50,
   -30,-10,  0,  6,  6,  0,-10,-30,
   -24,  0, 18, 24, 24, 18,  0,-24,
   -20,  6, 24, 32, 32, 24,  6,-20,
   -20,  6, 24, 32, 32, 24,  6,-20,
   -24,  0, 18, 24, 24, 18,  0,-24,
   -30,-10,  0,  6,  6,  0,-10,-30,
   -50,-30,-24,-20,-20,-24,-30,-50],
};
export const VALUE_MG = [0, 100, 320, 330, 500, 950, 0];
export const VALUE_EG = [0, 120, 300, 320, 540, 980, 0];
const PHASE = [0, 0, 1, 1, 2, 4, 0];

// Combined tables, indexed [piece * 128 + sq] for the side that owns the piece (black mirrored), values incl. material.
const MG = new Int16Array(16 * 128);
const EG = new Int16Array(16 * 128);
for (let t = PAWN; t <= KING; t++) {
  for (let r = 0; r < 8; r++)
    for (let f = 0; f < 8; f++) {
      const sq = r * 16 + f;
      const wi = (7 - r) * 8 + f; // white: rank 8 is row 0
      const bi = r * 8 + f; // black: mirrored
      MG[t * 128 + sq] = VALUE_MG[t] + PST_MG[t][wi];
      EG[t * 128 + sq] = VALUE_EG[t] + PST_EG[t][wi];
      MG[(t | 8) * 128 + sq] = VALUE_MG[t] + PST_MG[t][bi];
      EG[(t | 8) * 128 + sq] = VALUE_EG[t] + PST_EG[t][bi];
    }
}

const fileCount = new Int8Array(16); // pawns per file: [0..7] white, [8..15] black

/** Static evaluation in centipawns, from the side to move. */
export function evaluate(p: Position): number {
  const b = p.board;
  let mg = 0, eg = 0, phase = 0;
  let bishopsW = 0, bishopsB = 0;
  fileCount.fill(0);
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) {
      sq += 7;
      continue;
    }
    const pc = b[sq];
    if (!pc) continue;
    const t = pc & 7;
    const s = pc & 8 ? -1 : 1;
    mg += s * MG[pc * 128 + sq];
    eg += s * EG[pc * 128 + sq];
    phase += PHASE[t];
    if (t === PAWN) fileCount[(pc & 8) + (sq & 7)]++;
    else if (t === BISHOP) pc & 8 ? bishopsB++ : bishopsW++;
  }
  // Pawn structure: doubled and isolated pawns cost, passed pawns gain (more in the endgame).
  let pawns = 0, passed = 0;
  for (let f = 0; f < 8; f++) {
    for (const side of [0, 8]) {
      const n = fileCount[side + f];
      if (!n) continue;
      const s = side ? -1 : 1;
      if (n > 1) pawns -= s * 12 * (n - 1);
      const left = f > 0 ? fileCount[side + f - 1] : 0;
      const right = f < 7 ? fileCount[side + f + 1] : 0;
      if (!left && !right) pawns -= s * 12 * n;
    }
  }
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) {
      sq += 7;
      continue;
    }
    const pc = b[sq];
    if ((pc & 7) !== PAWN) continue;
    const white = !(pc & 8);
    const f = sq & 7;
    const enemy = white ? PAWN | 8 : PAWN;
    let free = true;
    const step = white ? 16 : -16;
    for (let s = sq + step; !(s & 0x88) && free; s += step)
      for (const df of [-1, 0, 1]) {
        const x = s + df;
        if (f + df < 0 || f + df > 7) continue;
        if (b[x] === enemy) free = false;
      }
    if (free) {
      const adv = white ? sq >> 4 : 7 - (sq >> 4); // 1..6
      passed += (white ? 1 : -1) * (adv * adv * 3);
    }
  }
  if (bishopsW >= 2) {
    mg += 30;
    eg += 45;
  }
  if (bishopsB >= 2) {
    mg -= 30;
    eg -= 45;
  }
  mg += pawns + (passed >> 1);
  eg += pawns + passed;
  const ph = Math.min(24, phase);
  let score = Math.round((mg * ph + eg * (24 - ph)) / 24);
  score += p.turn === WHITE ? 10 : -10; // the move is worth something
  return p.turn === WHITE ? score : -score;
}

// ---------- search ----------
export const MATE = 32000;
const INF = 1_000_000;
const TT_BITS = 18;
const TT_SIZE = 1 << TT_BITS;
const EXACT = 1, LOWER = 2, UPPER = 3;

export interface SearchLimits {
  /** Deepest iteration. */
  depth: number;
  /** Stop after this many nodes (deterministic). */
  nodes: number;
  /** Stop at this wall-clock time (Date.now()), if given: then not deterministic. */
  until?: number;
  signal?: AbortSignal;
}

export interface SearchResult {
  /** Best move, or 0 when there is none. */
  move: number;
  /** Score in centipawns from the side to move. */
  score: number;
  depth: number;
  nodes: number;
  /** Root moves with their scores at the deepest finished iteration, best first (when `rootScores` was asked). */
  root?: { move: number; score: number }[];
}

class Aborted extends Error {}

export class Engine {
  private ttLo = new Int32Array(TT_SIZE);
  private ttHi = new Int32Array(TT_SIZE);
  private ttMove = new Int32Array(TT_SIZE);
  private ttScore = new Int32Array(TT_SIZE);
  private ttDepth = new Int8Array(TT_SIZE);
  private ttFlag = new Int8Array(TT_SIZE);
  private killers = new Int32Array(128 * 2);
  private history = new Int32Array(16 * 128);
  private nodes = 0;
  private limits: SearchLimits = { depth: 1, nodes: 1 };
  private stopped = false;

  /** Clear what earlier searches learned (a new game). */
  reset() {
    this.ttFlag.fill(0);
    this.killers.fill(0);
    this.history.fill(0);
  }

  search(p: Position, limits: SearchLimits, rootScores = false): SearchResult {
    this.limits = limits;
    this.nodes = 0;
    this.stopped = false;
    this.killers.fill(0);
    for (let i = 0; i < this.history.length; i++) this.history[i] >>= 2;
    const legal = p.legal();
    if (!legal.length) return { move: 0, score: p.inCheck() ? -MATE : 0, depth: 0, nodes: 0 };
    let best: SearchResult = { move: legal[0], score: 0, depth: 0, nodes: 0 };
    let root: { move: number; score: number }[] = legal.map((move) => ({ move, score: 0 }));
    for (let depth = 1; depth <= limits.depth; depth++) {
      try {
        if (rootScores) {
          // Every root move with an exact score (a full window each), for levels that pick among good moves.
          const scored: { move: number; score: number }[] = [];
          for (const { move } of root) {
            p.make(move);
            let s: number;
            try {
              s = -this.negamax(p, depth - 1, -INF, INF, 1, true);
            } finally {
              p.unmake();
            }
            scored.push({ move, score: s });
          }
          scored.sort((a, b) => b.score - a.score);
          root = scored;
          best = { move: root[0].move, score: root[0].score, depth, nodes: this.nodes, root };
        } else {
          this.rootBest = 0;
          const score = this.negamax(p, depth, -INF, INF, 0, true);
          if (this.rootBest && legal.includes(this.rootBest)) best = { move: this.rootBest, score, depth, nodes: this.nodes };
        }
        if (Math.abs(best.score) > MATE - 200) break; // a mate found: deeper won't change it
      } catch (e) {
        if (!(e instanceof Aborted)) throw e;
        break;
      }
      if (this.outOfBudget(true)) break;
    }
    best.nodes = this.nodes;
    return best;
  }

  private outOfBudget(betweenIterations = false): boolean {
    if (this.nodes >= this.limits.nodes) return true;
    // Starting another iteration with less than half the time left rarely finishes it.
    if (this.limits.until !== undefined) {
      const left = this.limits.until - Date.now();
      if (left <= 0 || (betweenIterations && left < (this.limits.until - (this.started ?? 0)) / 2)) return true;
    }
    return !!this.limits.signal?.aborted;
  }
  private started?: number;

  /** Start the clock for `until`'s half-time rule. */
  startClock() {
    this.started = Date.now();
  }

  private check() {
    if ((this.nodes & 1023) === 0 && this.outOfBudget()) {
      this.stopped = true;
      throw new Aborted();
    }
  }

  private rootBest = 0;

  private store(p: Position, depth: number, flag: number, score: number, move: number, ply: number) {
    const i = p.hashLo & (TT_SIZE - 1);
    if (this.ttFlag[i] && this.ttDepth[i] > depth && this.ttLo[i] === p.hashLo) return;
    // Mate scores are stored relative to this node.
    if (score > MATE - 500) score += ply;
    else if (score < -MATE + 500) score -= ply;
    this.ttLo[i] = p.hashLo;
    this.ttHi[i] = p.hashHi;
    this.ttDepth[i] = depth;
    this.ttFlag[i] = flag;
    this.ttScore[i] = score;
    this.ttMove[i] = move;
  }

  /** Order moves: hash move, winning captures (MVV-LVA), promotions, killers, history. */
  private order(p: Position, moves: number[], hashMove: number, ply: number): number[] {
    const b = p.board;
    const scores = new Int32Array(moves.length);
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      let s: number;
      if (m === hashMove) s = 10_000_000;
      else if (moveFlags(m) & F_CAPTURE) {
        const victim = moveFlags(m) & 2 ? PAWN : b[moveTo(m)] & 7;
        s = 1_000_000 + VALUE_MG[victim] * 10 - VALUE_MG[b[moveFrom(m)] & 7] / 10;
      } else if (movePromo(m)) s = 900_000 + movePromo(m);
      else if (m === this.killers[ply * 2]) s = 800_000;
      else if (m === this.killers[ply * 2 + 1]) s = 790_000;
      else s = this.history[b[moveFrom(m)] * 128 + moveTo(m)];
      scores[i] = s;
    }
    const idx = moves.map((_, i) => i).sort((a, c) => scores[c] - scores[a]);
    return idx.map((i) => moves[i]);
  }

  private nonPawnMaterial(p: Position): boolean {
    const us = p.turn << 3;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) {
        sq += 7;
        continue;
      }
      const pc = p.board[sq];
      if (pc && (pc & 8) === us && (pc & 7) !== PAWN && (pc & 7) !== KING) return true;
    }
    return false;
  }

  private negamax(p: Position, depth: number, alpha: number, beta: number, ply: number, allowNull: boolean): number {
    this.nodes++;
    this.check();
    if (ply > 0) {
      if (p.halfmove >= 100 || p.repetitions() > 0) return 0;
      // Mate distance pruning.
      alpha = Math.max(alpha, -MATE + ply);
      beta = Math.min(beta, MATE - ply - 1);
      if (alpha >= beta) return alpha;
    }
    const inCheck = p.inCheck();
    if (inCheck) depth++;
    if (depth <= 0) return this.quiesce(p, alpha, beta, ply, 0);
    if (ply >= 100) return evaluate(p);

    const i = p.hashLo & (TT_SIZE - 1);
    let hashMove = 0;
    if (this.ttFlag[i] && this.ttLo[i] === p.hashLo && this.ttHi[i] === p.hashHi) {
      hashMove = this.ttMove[i];
      if (ply > 0 && this.ttDepth[i] >= depth) {
        let s = this.ttScore[i];
        if (s > MATE - 500) s -= ply;
        else if (s < -MATE + 500) s += ply;
        const f = this.ttFlag[i];
        if (f === EXACT || (f === LOWER && s >= beta) || (f === UPPER && s <= alpha)) return s;
      }
    }

    // Null move: if passing still beats beta, this node is good enough.
    if (allowNull && !inCheck && ply > 0 && depth >= 3 && beta < MATE - 500 && this.nonPawnMaterial(p) && evaluate(p) >= beta) {
      p.makeNull();
      let s: number;
      try {
        s = -this.negamax(p, depth - 3, -beta, -beta + 1, ply + 1, false);
      } finally {
        p.unmakeNull();
      }
      if (s >= beta) return beta;
    }

    const pseudo: number[] = [];
    p.pseudo(pseudo);
    const moves = this.order(p, pseudo, hashMove, ply);
    const alpha0 = alpha;
    let best = -INF;
    let bestMove = 0;
    let played = 0;
    for (const m of moves) {
      if (!p.make(m)) continue;
      played++;
      const quiet = !(moveFlags(m) & F_CAPTURE) && !movePromo(m);
      let s: number;
      try {
        if (played === 1) s = -this.negamax(p, depth - 1, -beta, -alpha, ply + 1, true);
        else {
          // Late quiet moves are searched shallower first; the rest with a null window, again in full if they surprise.
          const reduce = quiet && !inCheck && depth >= 3 && played > 4 && !p.inCheck() ? (played > 12 ? 2 : 1) : 0;
          s = -this.negamax(p, depth - 1 - reduce, -alpha - 1, -alpha, ply + 1, true);
          if (s > alpha && reduce) s = -this.negamax(p, depth - 1, -alpha - 1, -alpha, ply + 1, true);
          if (s > alpha && s < beta) s = -this.negamax(p, depth - 1, -beta, -alpha, ply + 1, true);
        }
      } finally {
        p.unmake();
      }
      if (s > best) {
        best = s;
        bestMove = m;
        if (ply === 0) this.rootBest = m;
      }
      if (s > alpha) {
        alpha = s;
        if (alpha >= beta) {
          if (quiet) {
            if (this.killers[ply * 2] !== m) {
              this.killers[ply * 2 + 1] = this.killers[ply * 2];
              this.killers[ply * 2] = m;
            }
            this.history[p.board[moveFrom(m)] * 128 + moveTo(m)] += depth * depth;
          }
          break;
        }
      }
    }
    if (!played) return inCheck ? -MATE + ply : 0;
    this.store(p, depth, best >= beta ? LOWER : best > alpha0 ? EXACT : UPPER, best, bestMove, ply);
    return best;
  }

  private quiesce(p: Position, alpha: number, beta: number, ply: number, qply: number): number {
    this.nodes++;
    this.check();
    const stand = evaluate(p);
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    if (qply > 12) return stand;
    const pseudo: number[] = [];
    p.pseudo(pseudo, true);
    const moves = this.order(p, pseudo, 0, Math.min(ply, 127));
    for (const m of moves) {
      // Delta pruning: a capture that can't lift the score near alpha is skipped.
      const victim = moveFlags(m) & 2 ? PAWN : p.board[moveTo(m)] & 7;
      if (!movePromo(m) && stand + VALUE_EG[victim] + 200 < alpha) continue;
      if (!p.make(m)) continue;
      let s: number;
      try {
        s = -this.quiesce(p, -beta, -alpha, ply + 1, qply + 1);
      } finally {
        p.unmake();
      }
      if (s >= beta) return s;
      if (s > alpha) alpha = s;
    }
    return alpha;
  }
}

// ---------- strength ----------
export const ELO_MIN = 400;
export const ELO_MAX = 2200;

export interface Level {
  depth: number;
  nodes: number;
  /** Standard deviation of the noise added to root move scores, in centipawns. */
  noise: number;
  /** Chance of playing a random move from the less good half instead. */
  blunder: number;
  /** Longest a move may take, in ms, when the clock allows. */
  thinkMs: number;
}

/**
 * How an approximate Elo rating plays. Anchored by self-play between levels (`scripts/chess-ladder.ts`): about
 * 200 points per step of the ladder means the stronger side scores about three in four. Not a FIDE or online rating.
 */
export function level(elo: number): Level {
  const e = Math.max(ELO_MIN, Math.min(ELO_MAX, Number(elo) || 1200));
  const t = (e - ELO_MIN) / (ELO_MAX - ELO_MIN); // 0..1
  return {
    depth: e >= 2000 ? 64 : Math.max(1, Math.round(1 + 6 * t)),
    nodes: Math.round(2000 * Math.pow(500, t)),
    noise: e >= 2000 ? 0 : Math.round(220 * Math.pow(1 - t, 2.2)),
    blunder: e >= 1800 ? 0 : Math.round(1000 * 0.3 * Math.pow(1 - t, 3)) / 1000,
    thinkMs: Math.round(300 + 4700 * t),
  };
}

/** Draws from a normal distribution with the given random source. */
function gauss(random: () => number): number {
  const u = Math.max(1e-9, random());
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface PickOptions {
  elo: number;
  random: () => number;
  /** Wall-clock limit; leave out for a deterministic choice (node budget only). */
  until?: number;
  signal?: AbortSignal;
  /** At most this many nodes, whatever the level says (the stand-in keeps the table responsive). */
  maxNodes?: number;
  engine?: Engine;
}

/** Choose a move for the position at the given strength. Returns 0 when there is no legal move. */
export function pickMove(p: Position, o: PickOptions): { move: number; score: number; depth: number; nodes: number } {
  const lv = level(o.elo);
  const engine = o.engine ?? new Engine();
  engine.startClock();
  const nodes = Math.min(lv.nodes, o.maxNodes ?? Infinity);
  const legal = p.legal();
  if (!legal.length) return { move: 0, score: 0, depth: 0, nodes: 0 };
  if (legal.length === 1) return { move: legal[0], score: 0, depth: 0, nodes: 0 };
  // Draw the random numbers first, so they don't depend on how the search went.
  const roll = o.random();
  const pickRoll = o.random();
  const noise = legal.map(() => gauss(o.random) * lv.noise);
  const exact = lv.noise > 0 || lv.blunder > 0;
  const r = engine.search(p, { depth: lv.depth, nodes, until: o.until, signal: o.signal }, exact);
  if (!exact || !r.root) return r;
  const order = new Map(legal.map((m, i) => [m, i]));
  if (roll < lv.blunder) {
    // A lapse: one of the worse half of the moves, but never one that walks into a forced mate.
    const pool = r.root.slice(Math.floor(r.root.length / 2)).filter((x) => x.score > -MATE + 500);
    const from = pool.length ? pool : r.root;
    const x = from[Math.floor(pickRoll * from.length)];
    return { move: x.move, score: x.score, depth: r.depth, nodes: r.nodes };
  }
  let best = r.root[0];
  let bestNoisy = -Infinity;
  for (const x of r.root) {
    // Mates stay mates: noise doesn't hide a mate in one, nor make one walk into it.
    const n = Math.abs(x.score) > MATE - 500 ? x.score : x.score + noise[order.get(x.move)!];
    if (n > bestNoisy) {
      bestNoisy = n;
      best = x;
    }
  }
  return { move: best.move, score: best.score, depth: r.depth, nodes: r.nodes };
}
