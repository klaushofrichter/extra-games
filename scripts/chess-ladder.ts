// Chess strength check: matches between the engine's Elo levels, or against Stockfish limited to an Elo, to see that
// the numbers in the AI settings mean roughly what they say. Each pairing plays every opening twice, colours swapped.
//
//   node scripts/chess-ladder.ts 600:400 1000:800 [--rounds 2]          level against level
//   SF_CLI=path/to/stockfish/scripts/cli.js node scripts/chess-ladder.ts 1600:sf1500
//                                                                          against Stockfish with UCI_Elo 1500
//
// Stockfish is not part of this repository (GPL); install it anywhere (`npm i stockfish` in a scratch folder) and point
// SF_CLI at its cli.js. The engine plays with its node budget only, which is what limits it in a real game too (its
// time budget is larger at every level unless the clock is short).
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Position, START_FEN, uci } from "../games/chess/chess.ts";
import { Engine, pickMove } from "../games/chess/engine.ts";

const OPENINGS = [
  "e2e4 e7e5 g1f3 b8c6",
  "e2e4 c7c5 g1f3 d7d6",
  "e2e4 e7e6 d2d4 d7d5",
  "e2e4 c7c6 d2d4 d7d5",
  "d2d4 d7d5 c2c4 e7e6",
  "d2d4 g8f6 c2c4 g7g6",
  "d2d4 g8f6 c2c4 e7e6",
  "c2c4 e7e5 b1c3 g8f6",
  "g1f3 d7d5 g2g3 g8f6",
  "e2e4 d7d5 e4d5 d8d5",
];

type Player = { name: string; move(p: Position, moves: string[]): Promise<string> };

let seed = 12345;
const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function engineLevel(elo: number): Player {
  const engine = new Engine();
  return {
    name: String(elo),
    async move(p) {
      return uci(pickMove(p, { elo, random, engine }).move);
    },
  };
}

class Stockfish implements Player {
  name: string;
  private proc: ChildProcessWithoutNullStreams;
  private buf = "";
  private waiters: ((line: string) => boolean)[] = [];
  constructor(elo: number) {
    this.name = `sf${elo}`;
    const cli = process.env.SF_CLI;
    if (!cli) throw new Error("set SF_CLI to Stockfish's cli.js");
    this.proc = spawn(process.execPath, [cli]);
    this.proc.stdout.on("data", (d) => {
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        this.waiters = this.waiters.filter((w) => !w(line));
      }
    });
    this.send(`uci\nsetoption name Threads value 1\nsetoption name UCI_LimitStrength value true\nsetoption name UCI_Elo value ${elo}\nisready`);
  }
  private send(s: string) {
    this.proc.stdin.write(`${s}\n`);
  }
  private wait(prefix: string): Promise<string> {
    return new Promise((res) => this.waiters.push((line) => (line.startsWith(prefix) ? (res(line), true) : false)));
  }
  async move(_p: Position, moves: string[]) {
    this.send(`position startpos${moves.length ? ` moves ${moves.join(" ")}` : ""}\ngo movetime ${Number(process.env.SF_MS ?? 200)}`);
    return (await this.wait("bestmove")).split(" ")[1];
  }
  newGame() {
    this.send("ucinewgame\nisready");
  }
  quit() {
    this.send("quit");
  }
}

function player(spec: string): Player {
  return spec.startsWith("sf") ? new Stockfish(Number(spec.slice(2))) : engineLevel(Number(spec));
}

/** 1 white wins, 0 black wins, 0.5 draw. */
async function playGame(white: Player, black: Player, opening: string): Promise<number> {
  const p = Position.fromFen(START_FEN);
  const moves: string[] = [];
  const keys: string[] = [p.key()];
  for (const u of opening.split(" ")) {
    p.make(p.findUci(u)!);
    moves.push(u);
    keys.push(p.key());
  }
  for (const s of [white, black]) (s as Stockfish).newGame?.();
  for (let ply = 0; ply < 300; ply++) {
    const legal = p.legal();
    if (!legal.length) return p.inCheck() ? (p.turn === 0 ? 0 : 1) : 0.5;
    if (p.halfmove >= 100 || p.insufficientMaterial() || keys.filter((k) => k === keys.at(-1)).length >= 3) return 0.5;
    const side = p.turn === 0 ? white : black;
    const u = await side.move(p, moves);
    const m = p.findUci(u, legal);
    if (m === null) throw new Error(`${side.name} played an illegal move ${u}`);
    p.make(m);
    moves.push(u);
    keys.push(p.key());
  }
  return 0.5;
}

const args = process.argv.slice(2);
const rounds = Number(args[args.indexOf("--rounds") + 1]) || 1;
for (const pair of args.filter((a) => a.includes(":"))) {
  const [a, b] = pair.split(":").map(player);
  let score = 0;
  let games = 0;
  const t0 = Date.now();
  for (let r = 0; r < rounds; r++)
    for (const o of OPENINGS) {
      score += await playGame(a, b, o);
      score += 1 - (await playGame(b, a, o));
      games += 2;
    }
  const s = score / games;
  const diff = s <= 0 ? -800 : s >= 1 ? 800 : Math.round(-400 * Math.log10(1 / s - 1));
  console.log(`${a.name} vs ${b.name}: ${score}/${games} (${Math.round(s * 100)} %), ${diff >= 0 ? "+" : ""}${diff} Elo for ${a.name}, ${Math.round((Date.now() - t0) / 1000)} s`);
  for (const x of [a, b]) (x as Stockfish).quit?.();
}
