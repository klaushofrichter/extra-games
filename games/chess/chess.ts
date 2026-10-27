// Chess rules: a 0x88 board with make/unmake, legal move generation, FEN, SAN and the draw rules. Used by the game's
// rules (one position per move, rebuilt from FEN) and by the engine (millions of make/unmake in a search), so it is
// written for speed: typed arrays, moves as integers, no allocation in the hot paths.
//
// Squares are 0x88 indices: rank * 16 + file, a1 = 0, h1 = 7, a8 = 112. Pieces: type 1..6 (pawn, knight, bishop, rook,
// queen, king), plus 8 for black. Moves: from | to << 7 | promotion type << 14 | flags << 17.

export const WHITE = 0;
export const BLACK = 1;
export const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
export const F_CAPTURE = 1, F_EP = 2, F_CASTLE = 4, F_DOUBLE = 8;
const CASTLE_WK = 1, CASTLE_WQ = 2, CASTLE_BK = 4, CASTLE_BQ = 8;

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export const moveFrom = (m: number) => m & 127;
export const moveTo = (m: number) => (m >> 7) & 127;
export const movePromo = (m: number) => (m >> 14) & 7;
export const moveFlags = (m: number) => m >> 17;
const mk = (from: number, to: number, promo = 0, flags = 0) => from | (to << 7) | (promo << 14) | (flags << 17);

export const sqName = (sq: number) => "abcdefgh"[sq & 7] + String((sq >> 4) + 1);
export function sqParse(s: string): number {
  if (typeof s !== "string" || !/^[a-h][1-8]$/.test(s)) return -1;
  return (s.charCodeAt(1) - 49) * 16 + (s.charCodeAt(0) - 97);
}

const KNIGHT_D = [33, 31, 18, 14, -33, -31, -18, -14];
const KING_D = [1, -1, 16, -16, 17, 15, -17, -15];
const BISHOP_D = [17, 15, -17, -15];
const ROOK_D = [1, -1, 16, -16];
const LETTERS = " pnbrqk";

// Zobrist keys as pairs of 32-bit numbers, from a fixed seed so every process agrees.
const Z = (() => {
  let a = 0x9e3779b9;
  const r = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) | 0;
  };
  const fill = (n: number) => Int32Array.from({ length: n }, r);
  return { pLo: fill(16 * 128), pHi: fill(16 * 128), sideLo: r(), sideHi: r(), cLo: fill(16), cHi: fill(16), epLo: fill(8), epHi: fill(8) };
})();

// Castling rights lost when a piece moves from or to a square.
const CASTLE_MASK = new Int8Array(128).fill(15);
CASTLE_MASK[0] = 15 & ~CASTLE_WQ;
CASTLE_MASK[7] = 15 & ~CASTLE_WK;
CASTLE_MASK[4] = 15 & ~(CASTLE_WK | CASTLE_WQ);
CASTLE_MASK[112] = 15 & ~CASTLE_BQ;
CASTLE_MASK[119] = 15 & ~CASTLE_BK;
CASTLE_MASK[116] = 15 & ~(CASTLE_BK | CASTLE_BQ);

export class Position {
  board = new Int8Array(128);
  turn = WHITE;
  castling = 0;
  ep = -1;
  halfmove = 0;
  fullmove = 1;
  kings = [4, 116];
  hashLo = 0;
  hashHi = 0;
  /** Hashes of earlier positions (game history, then the search path), for repetitions. */
  hist: number[] = [];
  private undo: number[] = [];

  static fromFen(fen: string): Position {
    const p = new Position();
    const parts = String(fen).trim().split(/\s+/);
    if (parts.length < 4) throw new Error(`bad FEN: ${fen}`);
    const rows = parts[0].split("/");
    if (rows.length !== 8) throw new Error(`bad FEN: ${fen}`);
    for (let r = 0; r < 8; r++) {
      let f = 0;
      for (const ch of rows[7 - r]) {
        if (/[1-8]/.test(ch)) f += Number(ch);
        else {
          const t = LETTERS.indexOf(ch.toLowerCase());
          if (t < 1 || f > 7) throw new Error(`bad FEN: ${fen}`);
          const piece = t | (ch === ch.toLowerCase() ? 8 : 0);
          p.board[r * 16 + f] = piece;
          if (t === KING) p.kings[piece >> 3] = r * 16 + f;
          f++;
        }
      }
      if (f !== 8) throw new Error(`bad FEN: ${fen}`);
    }
    p.turn = parts[1] === "b" ? BLACK : WHITE;
    p.castling = (parts[2].includes("K") ? CASTLE_WK : 0) | (parts[2].includes("Q") ? CASTLE_WQ : 0) | (parts[2].includes("k") ? CASTLE_BK : 0) | (parts[2].includes("q") ? CASTLE_BQ : 0);
    p.ep = parts[3] === "-" ? -1 : sqParse(parts[3]);
    if (p.ep >= 0 && !p.epCapturable()) p.ep = -1;
    p.halfmove = Number(parts[4] ?? 0) || 0;
    p.fullmove = Number(parts[5] ?? 1) || 1;
    p.rehash();
    return p;
  }

  rehash() {
    let lo = 0, hi = 0;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) {
        sq += 7;
        continue;
      }
      const pc = this.board[sq];
      if (pc) {
        lo ^= Z.pLo[pc * 128 + sq];
        hi ^= Z.pHi[pc * 128 + sq];
      }
    }
    if (this.turn) {
      lo ^= Z.sideLo;
      hi ^= Z.sideHi;
    }
    lo ^= Z.cLo[this.castling];
    hi ^= Z.cHi[this.castling];
    if (this.ep >= 0) {
      lo ^= Z.epLo[this.ep & 7];
      hi ^= Z.epHi[this.ep & 7];
    }
    this.hashLo = lo;
    this.hashHi = hi;
  }

  /** The position part of the FEN (no move counters): equal for repeated positions. */
  key(): string {
    return this.fen().split(" ").slice(0, 4).join(" ");
  }

  fen(): string {
    const rows: string[] = [];
    for (let r = 7; r >= 0; r--) {
      let row = "";
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const pc = this.board[r * 16 + f];
        if (!pc) empty++;
        else {
          if (empty) row += empty;
          empty = 0;
          const ch = LETTERS[pc & 7];
          row += pc & 8 ? ch : ch.toUpperCase();
        }
      }
      rows.push(row + (empty ? empty : ""));
    }
    const c = this.castling;
    const cs = (c & CASTLE_WK ? "K" : "") + (c & CASTLE_WQ ? "Q" : "") + (c & CASTLE_BK ? "k" : "") + (c & CASTLE_BQ ? "q" : "") || "-";
    // The en-passant square only when a capture there is possible: then equal positions have equal keys.
    const ep = this.ep >= 0 && this.epCapturable() ? sqName(this.ep) : "-";
    return `${rows.join("/")} ${this.turn ? "b" : "w"} ${cs} ${ep} ${this.halfmove} ${this.fullmove}`;
  }

  epCapturable(): boolean {
    const pawn = PAWN | (this.turn << 3);
    const from = this.turn === WHITE ? this.ep - 16 : this.ep + 16;
    for (const d of [-1, 1]) {
      const s = from + d;
      if (!(s & 0x88) && this.board[s] === pawn) return true;
    }
    return false;
  }

  /** Is `sq` attacked by `by`? */
  attacked(sq: number, by: number): boolean {
    const b = this.board;
    const c8 = by << 3;
    // Pawns: a white pawn attacks up (+15, +17), so look down from the square.
    const pd = by === WHITE ? -16 : 16;
    for (const d of [pd - 1, pd + 1]) {
      const s = sq + d;
      if (!(s & 0x88) && b[s] === (PAWN | c8)) return true;
    }
    for (const d of KNIGHT_D) {
      const s = sq + d;
      if (!(s & 0x88) && b[s] === (KNIGHT | c8)) return true;
    }
    for (const d of KING_D) {
      const s = sq + d;
      if (!(s & 0x88) && b[s] === (KING | c8)) return true;
    }
    for (const d of BISHOP_D) {
      let s = sq + d;
      while (!(s & 0x88)) {
        const pc = b[s];
        if (pc) {
          if (pc === (BISHOP | c8) || pc === (QUEEN | c8)) return true;
          break;
        }
        s += d;
      }
    }
    for (const d of ROOK_D) {
      let s = sq + d;
      while (!(s & 0x88)) {
        const pc = b[s];
        if (pc) {
          if (pc === (ROOK | c8) || pc === (QUEEN | c8)) return true;
          break;
        }
        s += d;
      }
    }
    return false;
  }

  inCheck(side = this.turn): boolean {
    return this.attacked(this.kings[side], side ^ 1);
  }

  /** Pseudo-legal moves (may leave the king in check) appended to `out`; `capturesOnly` for quiescence. */
  pseudo(out: number[], capturesOnly = false) {
    const b = this.board;
    const us = this.turn;
    const them = us ^ 1;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) {
        sq += 7;
        continue;
      }
      const pc = b[sq];
      if (!pc || pc >> 3 !== us) continue;
      const t = pc & 7;
      if (t === PAWN) {
        const fwd = us === WHITE ? 16 : -16;
        const rank = sq >> 4;
        const promoRank = us === WHITE ? 6 : 1;
        const startRank = us === WHITE ? 1 : 6;
        const one = sq + fwd;
        if (!(one & 0x88) && !b[one]) {
          if (rank === promoRank) for (const pr of [QUEEN, KNIGHT, ROOK, BISHOP]) out.push(mk(sq, one, pr));
          else if (!capturesOnly) {
            out.push(mk(sq, one));
            const two = one + fwd;
            if (rank === startRank && !b[two]) out.push(mk(sq, two, 0, F_DOUBLE));
          }
        }
        for (const d of [fwd - 1, fwd + 1]) {
          const s = sq + d;
          if (s & 0x88) continue;
          const tgt = b[s];
          if (tgt && tgt >> 3 === them) {
            if (rank === promoRank) for (const pr of [QUEEN, KNIGHT, ROOK, BISHOP]) out.push(mk(sq, s, pr, F_CAPTURE));
            else out.push(mk(sq, s, 0, F_CAPTURE));
          } else if (s === this.ep) out.push(mk(sq, s, 0, F_CAPTURE | F_EP));
        }
      } else if (t === KNIGHT || t === KING) {
        for (const d of t === KNIGHT ? KNIGHT_D : KING_D) {
          const s = sq + d;
          if (s & 0x88) continue;
          const tgt = b[s];
          if (!tgt) {
            if (!capturesOnly) out.push(mk(sq, s));
          } else if (tgt >> 3 === them) out.push(mk(sq, s, 0, F_CAPTURE));
        }
        if (t === KING && !capturesOnly) this.castles(out, sq);
      } else {
        const dirs = t === BISHOP ? BISHOP_D : t === ROOK ? ROOK_D : KING_D;
        for (const d of dirs) {
          let s = sq + d;
          while (!(s & 0x88)) {
            const tgt = b[s];
            if (!tgt) {
              if (!capturesOnly) out.push(mk(sq, s));
            } else {
              if (tgt >> 3 === them) out.push(mk(sq, s, 0, F_CAPTURE));
              break;
            }
            s += d;
          }
        }
      }
    }
  }

  private castles(out: number[], sq: number) {
    const b = this.board;
    const us = this.turn;
    const home = us === WHITE ? 4 : 116;
    if (sq !== home) return;
    const them = us ^ 1;
    const k = us === WHITE ? CASTLE_WK : CASTLE_BK;
    const q = us === WHITE ? CASTLE_WQ : CASTLE_BQ;
    if (this.castling & k && !b[home + 1] && !b[home + 2] && b[home + 3] === (ROOK | (us << 3)))
      if (!this.attacked(home, them) && !this.attacked(home + 1, them) && !this.attacked(home + 2, them)) out.push(mk(home, home + 2, 0, F_CASTLE));
    if (this.castling & q && !b[home - 1] && !b[home - 2] && !b[home - 3] && b[home - 4] === (ROOK | (us << 3)))
      if (!this.attacked(home, them) && !this.attacked(home - 1, them) && !this.attacked(home - 2, them)) out.push(mk(home, home - 2, 0, F_CASTLE));
  }

  /** Legal moves. */
  legal(): number[] {
    const ps: number[] = [];
    this.pseudo(ps);
    const out: number[] = [];
    for (const m of ps) {
      if (this.make(m)) {
        out.push(m);
        this.unmake();
      }
    }
    return out;
  }

  private xorPiece(pc: number, sq: number) {
    this.hashLo ^= Z.pLo[pc * 128 + sq];
    this.hashHi ^= Z.pHi[pc * 128 + sq];
  }

  /** Play a pseudo-legal move; returns false (and takes it back) if it leaves the mover's king in check. */
  make(m: number): boolean {
    const b = this.board;
    const from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 7, flags = m >> 17;
    const pc = b[from];
    const us = this.turn;
    let captured = b[to];
    let capSq = to;
    if (flags & F_EP) {
      capSq = us === WHITE ? to - 16 : to + 16;
      captured = b[capSq];
    }
    this.undo.push(m, captured, this.castling, this.ep, this.halfmove, this.hashLo, this.hashHi);
    this.hist.push(this.hashLo, this.hashHi);
    // hash out the old side state
    this.hashLo ^= Z.cLo[this.castling];
    this.hashHi ^= Z.cHi[this.castling];
    if (this.ep >= 0) {
      this.hashLo ^= Z.epLo[this.ep & 7];
      this.hashHi ^= Z.epHi[this.ep & 7];
    }
    if (captured) {
      b[capSq] = 0;
      this.xorPiece(captured, capSq);
    }
    b[from] = 0;
    this.xorPiece(pc, from);
    const placed = promo ? promo | (us << 3) : pc;
    b[to] = placed;
    this.xorPiece(placed, to);
    if ((pc & 7) === KING) {
      this.kings[us] = to;
      if (flags & F_CASTLE) {
        const rFrom = to > from ? from + 3 : from - 4;
        const rTo = to > from ? from + 1 : from - 1;
        const rook = b[rFrom];
        b[rFrom] = 0;
        b[rTo] = rook;
        this.xorPiece(rook, rFrom);
        this.xorPiece(rook, rTo);
      }
    }
    this.castling &= CASTLE_MASK[from] & CASTLE_MASK[to];
    // An en-passant square only when an enemy pawn could take there, so the hash (and FEN) of equal positions agree.
    this.ep = -1;
    if (flags & F_DOUBLE) {
      const enemyPawn = PAWN | ((us ^ 1) << 3);
      if ((!((to - 1) & 0x88) && b[to - 1] === enemyPawn) || (!((to + 1) & 0x88) && b[to + 1] === enemyPawn)) this.ep = (from + to) >> 1;
    }
    this.halfmove = (pc & 7) === PAWN || captured ? 0 : this.halfmove + 1;
    if (us === BLACK) this.fullmove++;
    this.turn = us ^ 1;
    this.hashLo ^= Z.cLo[this.castling] ^ Z.sideLo;
    this.hashHi ^= Z.cHi[this.castling] ^ Z.sideHi;
    if (this.ep >= 0) {
      this.hashLo ^= Z.epLo[this.ep & 7];
      this.hashHi ^= Z.epHi[this.ep & 7];
    }
    if (this.attacked(this.kings[us], us ^ 1)) {
      this.unmake();
      return false;
    }
    return true;
  }

  unmake() {
    const u = this.undo;
    const hashHi = u.pop()!, hashLo = u.pop()!, halfmove = u.pop()!, ep = u.pop()!, castling = u.pop()!, captured = u.pop()!, m = u.pop()!;
    this.hist.length -= 2;
    const b = this.board;
    const from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 7, flags = m >> 17;
    this.turn ^= 1;
    const us = this.turn;
    if (us === BLACK) this.fullmove--;
    const moved = b[to];
    b[from] = promo ? PAWN | (us << 3) : moved;
    b[to] = 0;
    if (flags & F_EP) b[us === WHITE ? to - 16 : to + 16] = captured;
    else b[to] = captured;
    if ((moved & 7) === KING) {
      this.kings[us] = from;
      if (flags & F_CASTLE) {
        const rFrom = to > from ? from + 3 : from - 4;
        const rTo = to > from ? from + 1 : from - 1;
        b[rFrom] = b[rTo];
        b[rTo] = 0;
      }
    }
    this.castling = castling;
    this.ep = ep;
    this.halfmove = halfmove;
    this.hashLo = hashLo;
    this.hashHi = hashHi;
  }

  /** A pass, for null-move pruning in the search. */
  makeNull() {
    this.undo.push(0, 0, this.castling, this.ep, this.halfmove, this.hashLo, this.hashHi);
    this.hist.push(this.hashLo, this.hashHi);
    if (this.ep >= 0) {
      this.hashLo ^= Z.epLo[this.ep & 7];
      this.hashHi ^= Z.epHi[this.ep & 7];
    }
    this.ep = -1;
    this.turn ^= 1;
    this.hashLo ^= Z.sideLo;
    this.hashHi ^= Z.sideHi;
    this.halfmove++;
  }

  unmakeNull() {
    const u = this.undo;
    this.hashHi = u.pop()!;
    this.hashLo = u.pop()!;
    this.halfmove = u.pop()!;
    this.ep = u.pop()!;
    this.castling = u.pop()!;
    u.length -= 2;
    this.hist.length -= 2;
    this.turn ^= 1;
  }

  /** How often the current position occurred before (hash pairs in `hist`), looking back to the last pawn move or capture. */
  repetitions(): number {
    let n = 0;
    const h = this.hist;
    const stop = Math.max(0, h.length - this.halfmove * 2);
    for (let i = h.length - 4; i >= stop; i -= 4) if (h[i] === this.hashLo && h[i + 1] === this.hashHi) n++;
    return n;
  }

  /** Neither side can mate: K v K, K+minor v K, K+B v K+B with bishops on one colour. */
  insufficientMaterial(): boolean {
    const minors: { t: number; sq: number }[] = [];
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) {
        sq += 7;
        continue;
      }
      const t = this.board[sq] & 7;
      if (!t || t === KING) continue;
      if (t === PAWN || t === ROOK || t === QUEEN) return false;
      minors.push({ t, sq });
    }
    if (minors.length <= 1) return true;
    // Only bishops, all on squares of one colour.
    if (minors.every((m) => m.t === BISHOP)) {
      const col = (sq: number) => ((sq >> 4) + (sq & 7)) & 1;
      return minors.every((m) => col(m.sq) === col(minors[0].sq));
    }
    return false;
  }

  /** Can `side` still mate at all (for a flag fall: losing on time against a lone king is a draw)? */
  hasMatingMaterial(side: number): boolean {
    let minors = 0;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) {
        sq += 7;
        continue;
      }
      const pc = this.board[sq];
      if (!pc || pc >> 3 !== side) continue;
      const t = pc & 7;
      if (t === PAWN || t === ROOK || t === QUEEN) return true;
      if (t === KNIGHT || t === BISHOP) minors++;
    }
    return minors >= 2;
  }

  /** Standard algebraic notation of a legal move, with + or #. */
  san(m: number, legal = this.legal()): string {
    const from = moveFrom(m), to = moveTo(m), promo = movePromo(m), flags = moveFlags(m);
    const pc = this.board[from];
    const t = pc & 7;
    let s: string;
    if (flags & F_CASTLE) s = to > from ? "O-O" : "O-O-O";
    else if (t === PAWN) {
      s = flags & F_CAPTURE ? `${sqName(from)[0]}x${sqName(to)}` : sqName(to);
      if (promo) s += `=${LETTERS[promo].toUpperCase()}`;
    } else {
      const others = legal.filter((o) => o !== m && moveTo(o) === to && this.board[moveFrom(o)] === pc);
      let dis = "";
      if (others.length) {
        const sameFile = others.some((o) => (moveFrom(o) & 7) === (from & 7));
        const sameRank = others.some((o) => moveFrom(o) >> 4 === from >> 4);
        dis = !sameFile ? sqName(from)[0] : !sameRank ? sqName(from)[1] : sqName(from);
      }
      s = LETTERS[t].toUpperCase() + dis + (flags & F_CAPTURE ? "x" : "") + sqName(to);
    }
    this.make(m);
    if (this.inCheck()) s += this.legal().length ? "+" : "#";
    this.unmake();
    return s;
  }

  /** The legal move for "e2e4" / "e7e8q", or null. */
  findUci(uci: string, legal = this.legal()): number | null {
    if (typeof uci !== "string") return null;
    const mt = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(uci.trim().toLowerCase());
    if (!mt) return null;
    const from = sqParse(mt[1]), to = sqParse(mt[2]);
    const promo = mt[3] ? LETTERS.indexOf(mt[3]) : 0;
    return legal.find((m) => moveFrom(m) === from && moveTo(m) === to && movePromo(m) === promo) ?? null;
  }

  /** Piece letters by square name for the UI: { e1: "K", e8: "k", ... }. */
  pieces(): Record<string, string> {
    const out: Record<string, string> = {};
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) {
        sq += 7;
        continue;
      }
      const pc = this.board[sq];
      if (pc) out[sqName(sq)] = pc & 8 ? LETTERS[pc & 7] : LETTERS[pc & 7].toUpperCase();
    }
    return out;
  }
}

export const uci = (m: number) => sqName(moveFrom(m)) + sqName(moveTo(m)) + (movePromo(m) ? LETTERS[movePromo(m)] : "");

/** Count leaf nodes to `depth` (move generator check). */
export function perft(p: Position, depth: number): number {
  if (depth === 0) return 1;
  const ps: number[] = [];
  p.pseudo(ps);
  let n = 0;
  for (const m of ps) {
    if (!p.make(m)) continue;
    n += depth === 1 ? 1 : perft(p, depth - 1);
    p.unmake();
  }
  return n;
}
