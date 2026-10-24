// Chess statistics for the statistics window (games-service D-140), read from the game's moves at the end: every
// piece is followed from its starting square, so "the piece that moved most" is a real piece (the g1 knight), not a
// kind. Pure; nothing is kept in the state while playing.
//
// The award helpers are kept here rather than taken from the SDK, so the game also runs on tables whose games-service
// predates the SDK's mostAward (an extra game must not import names an older host does not export).

interface Award {
  id: string;
  icon: string;
  title: string;
  blurb?: string;
  seats: number[];
  value?: string;
}

const KIND: Record<string, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const START = ["rnbqkbnr", "pppppppp", "", "", "", "", "PPPPPPPP", "RNBQKBNR"]; // rank 8 first

interface Piece {
  id: string; // colour, kind and starting square: "w n g1"
  color: 0 | 1; // white, black
  kind: string; // p n b r q k (a promoted pawn keeps kind "p" for its history, `now` is its new kind)
  now: string;
  from: string;
  moves: number;
  distance: number;
}

export interface SideStats {
  captures: number;
  material: number; // the value of what it took (pawn 1, knight and bishop 3, rook 5, queen 9)
  pawnMoves: number;
  checks: number;
  castled: boolean;
  promotions: number;
}

const file = (sq: string) => sq.charCodeAt(0) - 97;
const rank = (sq: string) => Number(sq[1]) - 1;
const square = (f: number, r: number) => String.fromCharCode(97 + f) + String(r + 1);

/** Follows every piece through the moves (UCI, from the standard start); SANs give the checks. */
export function chessStats(ucis: string[], sans: string[]) {
  const board = new Map<string, Piece>();
  START.forEach((row, i) => {
    [...row].forEach((ch, f) => {
      const color = ch === ch.toUpperCase() ? 0 : 1;
      const sq = square(f, 7 - i);
      const k = ch.toLowerCase();
      board.set(sq, { id: `${color ? "b" : "w"} ${k} ${sq}`, color, kind: k, now: k, from: sq, moves: 0, distance: 0 });
    });
  });
  const pieces = [...board.values()];
  const sides: [SideStats, SideStats] = [0, 1].map(() => ({ captures: 0, material: 0, pawnMoves: 0, checks: 0, castled: false, promotions: 0 })) as [SideStats, SideStats];
  ucis.forEach((u, i) => {
    const from = u.slice(0, 2);
    const to = u.slice(2, 4);
    const promo = u[4];
    const p = board.get(from);
    if (!p) return; // not from the standard start: nothing more to follow
    const side = sides[p.color];
    let taken = board.get(to);
    let takenAt = to;
    if (!taken && p.now === "p" && file(from) !== file(to)) {
      takenAt = square(file(to), rank(from)); // en passant
      taken = board.get(takenAt);
    }
    if (taken) {
      side.captures++;
      side.material += VALUE[taken.now] ?? 0;
      board.delete(takenAt);
    }
    board.delete(from);
    board.set(to, p);
    p.moves++;
    p.distance += Math.max(Math.abs(file(to) - file(from)), Math.abs(rank(to) - rank(from)));
    if (p.now === "p") side.pawnMoves++;
    if (promo) {
      p.now = promo;
      side.promotions++;
    }
    if (p.now === "k" && Math.abs(file(to) - file(from)) === 2) {
      // castling: the rook moves too
      const r = rank(from);
      const [rf, rt] = file(to) > file(from) ? [7, 5] : [0, 3];
      const rook = board.get(square(rf, r));
      if (rook) {
        board.delete(square(rf, r));
        board.set(square(rt, r), rook);
        rook.moves++;
        rook.distance += Math.abs(rt - rf);
      }
      side.castled = true;
    }
    if (/[+#]/.test(sans[i] ?? "")) side.checks++;
  });
  return { sides, pieces };
}

const pieceName = (p: Piece) => `${p.color ? "Black" : "White"}'s ${p.kind === "p" && p.now !== "p" ? `promoted ${KIND[p.now]}` : KIND[p.kind]} from ${p.from}`;
const many = (n: number, one: string, more = `${one}s`) => `${n} ${n === 1 ? one : more}`;

function most(base: Omit<Award, "seats" | "value">, scores: [number, number], seats: [number, number], value: (n: number) => string): Award | null {
  const best = Math.max(...scores);
  if (best <= 0 || scores[0] === scores[1]) return null;
  const c = scores[0] > scores[1] ? 0 : 1;
  return { ...base, seats: [seats[c]], value: value(best) };
}

/** The piece with the highest score; its owner holds the award (none when both sides have such a piece). */
function topPiece(base: Omit<Award, "seats" | "value">, pieces: Piece[], score: (p: Piece) => number, seats: [number, number], value: (p: Piece, n: number) => string): Award | null {
  const best = Math.max(...pieces.map(score));
  if (best <= 0) return null;
  const top = pieces.filter((p) => score(p) === best);
  const colors = new Set(top.map((p) => p.color));
  if (colors.size > 1) return null;
  return { ...base, seats: [seats[top[0].color]], value: value(top[0], best) };
}

/** The statistics window's awards (games-service D-140) and extra table columns. */
export function chessAwards(ucis: string[], sans: string[], seats: [number, number]) {
  const { sides, pieces } = chessStats(ucis, sans);
  const pair = (f: (s: SideStats) => number): [number, number] => [f(sides[0]), f(sides[1])];
  const awards = [
    most({ id: "killer", icon: "💀", title: "Killer", blurb: "Took the most pieces off the board." }, pair((s) => s.captures), seats, (n) => many(n, "piece")),
    most({ id: "pawn-rush", icon: "🏃", title: "Pawn Rush", blurb: "Moved pawns the most." }, pair((s) => s.pawnMoves), seats, (n) => many(n, "pawn move")),
    topPiece({ id: "marathon", icon: "🗺️", title: "Marathon", blurb: "Owned the piece that travelled the farthest." }, pieces, (p) => p.distance, seats, (p, n) => `${pieceName(p)}: ${many(n, "square")}`),
    topPiece({ id: "frequenter", icon: "🔁", title: "Frequenter", blurb: "Owned the piece that moved most often." }, pieces, (p) => p.moves, seats, (p, n) => `${pieceName(p)}: ${many(n, "move")}`),
    most({ id: "treasure", icon: "💎", title: "Treasure Hunter", blurb: "Took the most material (pawn 1, knight and bishop 3, rook 5, queen 9)." }, pair((s) => s.material), seats, (n) => many(n, "point")),
    most({ id: "check", icon: "📣", title: "Check!", blurb: "Gave check most often." }, pair((s) => s.checks), seats, (n) => many(n, "check")),
    most({ id: "crowning", icon: "👑", title: "Crowning", blurb: "Promoted the most pawns." }, pair((s) => s.promotions), seats, (n) => many(n, "promotion")),
    topPiece({ id: "stay-home", icon: "🏠", title: "Homebody", blurb: "Owned the king that stayed put the longest — it never moved." }, pieces.filter((p) => p.kind === "k"), (p) => (p.moves === 0 ? 1 : 0), seats, () => "the king never moved"),
  ].filter((a): a is Award => a !== null);
  return { awards, sides };
}
