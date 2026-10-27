// Engines on the internet for the AI (E-040): Stockfish at https://stockfish.online, and Lichess: the cloud evaluations
// of https://lichess.org and, with 7 pieces or fewer, its endgame tablebase (E-042). Only the AI asks them, in its worker, never the rules: the move is logged, so games replay
// without the network. A service that is slow, answers with an error or with a move that isn't legal here gives no
// move, and the AI plays with the game's own engine instead.

/** The AI's engine choices, as the manifest lists them. */
export const ENGINES = ["own engine", "Stockfish (stockfish.online)", "Lichess cloud"] as const;
export type Service = "stockfish" | "lichess";
/** Where an online move comes from: Lichess's tablebase stands in for its cloud with 7 pieces or fewer. */
export type Source = Service | "tablebase";

/** Pieces on the board, kings included. */
const piecesIn = (fen: string) => (fen.split(" ")[0].match(/[a-z]/gi) ?? []).length;

export function serviceOf(options: Record<string, unknown>): Service | null {
  const e = String(options?.engine ?? "");
  return e === ENGINES[1] ? "stockfish" : e === ENGINES[2] ? "lichess" : null;
}

/** How long the AI waits for a service before it plays with its own engine (ms). */
export const ONLINE_MS = 10_000; // stockfish.online's free queue answered in 1–9 s at depth 15, about 1 s at depth 6
/** After a refusal for too many requests (429), the AI leaves the service alone this long (ms), as Lichess asks. */
const BACK_OFF_MS = 60_000;
const resting: Partial<Record<Service, number>> = {};

/** Stockfish's search depth for an Elo: 6 at 400 to 15 at 2200, the depths stockfish.online accepts. Even 6 is a
 *  strong player: the Elo only makes Stockfish deeper. */
export const depthFor = (elo: number) => Math.max(6, Math.min(15, Math.round(6 + ((elo - 400) / 1800) * 9)));
/** The deepest search stockfish.online likely answers within `ms` (about 1 s at depth 6, up to 9 s at 15): a fast game
 *  gets a shallower, quicker Stockfish instead of one that runs out of time. 0: not even depth 6. */
export const depthWithin = (ms: number) => (ms < 1500 ? 0 : Math.min(15, 5 + Math.floor(ms / 1000)));

const HEADERS = { Accept: "application/json", "User-Agent": "extra-games chess (https://github.com/klaushofrichter/extra-games)" };

function urlFor(source: Source, fen: string, depth: number): string {
  const f = encodeURIComponent(fen);
  if (source === "stockfish") return `https://stockfish.online/api/s/v2.php?fen=${f}&depth=${depth}`;
  return source === "tablebase" ? `https://tablebase.lichess.org/standard?fen=${f}` : `https://lichess.org/api/cloud-eval?fen=${f}&multiPv=1`;
}

/** How a side stands, from White's side: centipawns, or mate in `mate` moves (positive: White mates). */
export type Eval = { cp: number } | { mate: number };

/** A service's move, as UCI ("e2e4", "e7e8q"), with its depth and evaluation when it gives them. */
export interface Answer {
  uci: string;
  source?: Source;
  depth?: number;
  eval?: Eval;
}

const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);

const DRAWN = ["draw", "cursed-win", "blessed-loss"];

/** The tablebase's answer: its moves come best first; `dtm` (plies to mate, up to 6 pieces) is the side to move's,
 *  positive when it wins. */
function tablebaseAnswer(body: unknown, fen: string): Answer | null {
  const b = (body ?? {}) as { category?: unknown; dtm?: unknown; moves?: { uci?: unknown }[] };
  const uci = b.moves?.[0]?.uci;
  if (typeof uci !== "string" || b.category === "unknown" || typeof b.category !== "string") return null;
  const white = fen.split(" ")[1] !== "b" ? 1 : -1;
  const dtm = num(b.dtm);
  const ev: Eval | undefined = DRAWN.includes(b.category) ? { cp: 0 } : dtm ? { mate: white * Math.sign(dtm) * Math.ceil(Math.abs(dtm) / 2) } : undefined;
  return { uci, ...(ev ? { eval: ev } : {}) };
}

/** The answer in a service's reply, or null. Both services give evaluations from White's side.
 *  stockfish.online: { success: true, evaluation: 0.46 (pawns), mate: null | n, bestmove: "bestmove e2e4 ponder e7e5" };
 *  Lichess: { depth, pvs: [{ moves: "e2e4 e7e5 ...", cp } or { moves, mate }] } (a 404 when it has no evaluation);
 *  the tablebase: { category: "win", dtm: 17, moves: [{ uci: "h7h8q", ... }, ...] }. */
export function answerIn(service: Source, body: unknown, fen = ""): Answer | null {
  if (service === "tablebase") return tablebaseAnswer(body, fen);
  const b = (body ?? {}) as { success?: unknown; bestmove?: unknown; evaluation?: unknown; mate?: unknown; depth?: unknown; pvs?: { moves?: unknown; cp?: unknown; mate?: unknown }[] };
  const pv = b.pvs?.[0];
  const text = service === "stockfish" ? (b.success === true && typeof b.bestmove === "string" ? b.bestmove.replace(/^bestmove\s+/, "") : "") : typeof pv?.moves === "string" ? pv.moves : "";
  const uci = text.trim().split(/\s+/)[0];
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci ?? "")) return null;
  const mate = num(service === "stockfish" ? b.mate : pv?.mate);
  const cp = service === "stockfish" ? (num(b.evaluation) === null ? null : Math.round(num(b.evaluation)! * 100)) : num(pv?.cp);
  const ev: Eval | undefined = mate !== null && mate !== 0 ? { mate } : cp !== null ? { cp } : undefined;
  return { uci, ...(num(b.depth) !== null ? { depth: num(b.depth)! } : {}), ...(ev ? { eval: ev } : {}) };
}

/** The service's move for this position, or null when it has none in `ms`. Stockfish searches as deep as the Elo
 *  asks and the time allows; Lichess answers from its tablebase with 7 pieces or fewer, else from its cloud. */
export async function askOnline(service: Service, fen: string, elo: number, ms: number): Promise<Answer | null> {
  const depth = Math.min(depthFor(elo), depthWithin(ms));
  if ((resting[service] ?? 0) > Date.now() || (service === "stockfish" && !depth)) return null;
  const source: Source = service === "lichess" && piecesIn(fen) <= 7 ? "tablebase" : service;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), ms);
  try {
    const r = await fetch(urlFor(source, fen, depth), { headers: HEADERS, signal: abort.signal });
    if (r.status === 429) resting[service] = Date.now() + BACK_OFF_MS;
    if (!r.ok) return null;
    const a = answerIn(source, await r.json(), fen);
    return a && { ...a, source, ...(service === "stockfish" ? { depth } : {}) };
  } catch {
    return null; // offline, a timeout, or an answer that isn't JSON
  } finally {
    clearTimeout(timer);
  }
}

/** Forget the back-offs (tests). */
export const resetOnline = () => {
  for (const k of Object.keys(resting)) delete resting[k as Service];
};
