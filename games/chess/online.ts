// Engines on the internet for the AI (E-040): Stockfish at https://stockfish.online and the cloud evaluations of
// https://lichess.org. Only the AI asks them, in its worker, never the rules: the move is logged, so games replay
// without the network. A service that is slow, answers with an error or with a move that isn't legal here gives no
// move, and the AI plays with the game's own engine instead.

/** The AI's engine choices, as the manifest lists them. */
export const ENGINES = ["own engine", "Stockfish (stockfish.online)", "Lichess cloud"] as const;
export type Service = "stockfish" | "lichess";

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

const HEADERS = { Accept: "application/json", "User-Agent": "extra-games chess (https://github.com/klaushofrichter/extra-games)" };

function urlFor(service: Service, fen: string, elo: number): string {
  const f = encodeURIComponent(fen);
  return service === "stockfish" ? `https://stockfish.online/api/s/v2.php?fen=${f}&depth=${depthFor(elo)}` : `https://lichess.org/api/cloud-eval?fen=${f}&multiPv=1`;
}

/** The move in a service's answer, as UCI ("e2e4", "e7e8q"), or null.
 *  stockfish.online: { success: true, bestmove: "bestmove e2e4 ponder e7e5", ... };
 *  Lichess: { pvs: [{ moves: "e2e4 e7e5 ...", cp }], ... } (a 404 when it has no evaluation for the position). */
export function moveIn(service: Service, body: unknown): string | null {
  const b = (body ?? {}) as { success?: unknown; bestmove?: unknown; pvs?: { moves?: unknown }[] };
  const text = service === "stockfish" ? (b.success === true && typeof b.bestmove === "string" ? b.bestmove.replace(/^bestmove\s+/, "") : "") : typeof b.pvs?.[0]?.moves === "string" ? b.pvs[0].moves : "";
  const m = text.trim().split(/\s+/)[0];
  return /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m ?? "") ? m : null;
}

/** The service's move for this position, or null when it has none in `ms`. */
export async function askOnline(service: Service, fen: string, elo: number, ms: number): Promise<string | null> {
  if ((resting[service] ?? 0) > Date.now()) return null;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), ms);
  try {
    const r = await fetch(urlFor(service, fen, elo), { headers: HEADERS, signal: abort.signal });
    if (r.status === 429) resting[service] = Date.now() + BACK_OFF_MS;
    return r.ok ? moveIn(service, await r.json()) : null;
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
