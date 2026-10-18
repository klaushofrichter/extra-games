// Backgammon rules: the dice rules (both dice, the larger die, the bar, bearing off), whole turns with Undo and Done,
// hitting, gammons and backgammons, the doubling cube with the Crawford rule, the match, the turn timer, the stand-in,
// the AI's levels, the move list and exact replays on games-service's own runtime.
import { describe, expect, it } from "vitest";
import {
  absolute,
  apply as applySub,
  diceOf,
  legalNow,
  path,
  persp,
  pips,
  playText,
  plays,
  reach,
  startBoard,
  turnRule,
  winKind,
  type Board,
  type Color,
  type Sub,
} from "../games/backgammon/bg.ts";
import { choosePlay, evaluate, shouldDouble, shouldTake } from "../games/backgammon/ai.ts";
import def, { aiIntent, canDouble, NEXT_MS, type State, type View } from "../games/backgammon/rules.ts";
import { loadGame, replaysExactly, seats, start } from "./harness.ts";

/** A board from absolute points: white and black counts by point, and the bar and borne-off counts. */
function board(white: Record<number, number>, black: Record<number, number>, o: { bar?: [number, number]; off?: [number, number] } = {}): Board {
  const pts = new Array(25).fill(0);
  for (const [p, n] of Object.entries(white)) pts[Number(p)] += n;
  for (const [p, n] of Object.entries(black)) pts[Number(p)] -= n;
  const bar = o.bar ?? [0, 0];
  const count = (c: Color) => Object.values(c ? black : white).reduce((a, b) => a + b, 0) + bar[c];
  const off: [number, number] = o.off ?? [15 - count(0), 15 - count(1)];
  return { pts, bar, off };
}

/** A single move by hand, from and to in the mover's numbering. */
function apply1(p: ReturnType<typeof persp>, from: number, to: number) {
  return applySub(p, { from, to, die: from - to, hit: p.o[to] === 1 });
}
const texts = (subs: Sub[]) => subs.map((s) => `${s.from}/${s.to}`).sort();

/** A context for calling the rules directly: dice come from a script, timers are recorded. */
function fakeCtx(dice: number[] = []) {
  const timers = new Map<string, number>();
  let t = 0;
  return {
    timers,
    dice,
    random: () => 0.5,
    randomInt: (min: number, max: number) => {
      const d = dice.shift();
      if (d === undefined) return min;
      if (d < min || d > max) throw new Error(`scripted ${d} outside ${min}..${max}`);
      return d;
    },
    setTimer: (id: string, ms: number) => void timers.set(id, ms),
    clearTimer: (id: string) => void timers.delete(id),
    now: () => (t += 10),
    seats: seats(2),
  };
}

/** A match set up by the rules, with the opening roll scripted (white's die, then black's). */
function newMatch(settings: Record<string, unknown> = {}, opening = [3, 1]) {
  const ctx = fakeCtx([...opening]);
  const s = def.setup(ctx as never, { matchLength: 3, cube: true, turnSeconds: 0, ...settings });
  return { s, ctx };
}
function step(s: State, seat: number, name: string, payload?: unknown, ctx = fakeCtx()) {
  const r = def.onIntent(s, seat, { name, payload }, ctx as never);
  if ("reject" in r) throw new Error(`${name} refused: ${r.reject}`);
  return { s: r.state, events: r.events ?? [] };
}
function refuse(s: State, seat: number, name: string, payload?: unknown) {
  const r = def.onIntent(s, seat, { name, payload }, fakeCtx() as never);
  expect("reject" in r, name).toBe(true);
  return (r as { reject: string }).reject;
}
/** A state in the middle of a game: this board, `turn` to roll. */
function at(b: Board, turn: Color, more: Partial<State> = {}): State {
  const { s } = newMatch();
  return { ...s, board: b, turn, phase: "roll", dice: null, remaining: [], played: 0, turnMoves: [], undo: [], opening: null, plays: [], ...more };
}

describe("positions and moves", () => {
  it("sets up 15 checkers each, 167 pips, and both views agree", () => {
    const b = startBoard();
    expect(b.pts.filter((v) => v > 0).reduce((a, v) => a + v, 0)).toBe(15);
    expect(b.pts.filter((v) => v < 0).reduce((a, v) => a - v, 0)).toBe(15);
    expect(pips(persp(b, 0))).toBe(167);
    expect(pips(persp(b, 1))).toBe(167);
    for (const c of [0, 1] as Color[]) expect(absolute(persp(b, c), c)).toEqual(b);
  });

  it("opening 3-1 can make the 5-point, among 16 distinct plays; 6-6 has 11", () => {
    const p = persp(startBoard(), 0);
    const ps = plays(p, diceOf(3, 1));
    expect(ps).toHaveLength(16);
    expect(ps.map((x) => playText(x.moves))).toContain("8/5 6/5");
    expect(plays(p, diceOf(6, 6))).toHaveLength(11);
    // Black is the same game from the other side.
    expect(plays(persp(startBoard(), 1), diceOf(3, 1))).toHaveLength(16);
  });

  it("must play both dice when it can: a 6 that only works after the 1 is still forced", () => {
    // White: one checker on 8, the rest on 3. Black holds the 2-point, so 8/2 and 3/2 are blocked.
    const p = persp(board({ 8: 1, 3: 14 }, { 2: 2, 24: 13 }), 0);
    const rule = turnRule(p, [6, 1]);
    expect(rule.max).toBe(2);
    // The 6 can only be played as 7/1 after 8/7, so the 1 must go first, from 8.
    expect(texts(legalNow(p, [6, 1], rule, 0))).toEqual(["8/7"]);
    const after = apply1(p, 8, 7);
    expect(texts(legalNow(after, [6], rule, 1))).toEqual(["7/1"]);
  });

  it("with only one die playable, it must be the larger one", () => {
    // White on 13 alone (the rest borne off); Black holds the 5-point, where 13/8/5 and 13/10/5 would both land.
    const p = persp(board({ 13: 1 }, { 5: 2, 24: 13 }), 0);
    const rule = turnRule(p, [5, 3]);
    expect(rule).toEqual({ max: 1, larger: 5 });
    expect(texts(legalNow(p, [5, 3], rule, 0))).toEqual(["13/8"]);
  });

  it("a checker on the bar comes in first; a closed board means no move at all", () => {
    const p = persp(board({ 13: 14 }, { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 24: 5 }, { bar: [1, 0] }), 0);
    // White enters in Black's home (its 19–24): a 6 enters on its 19, Black's 6-point, which is open.
    // Only coming in is offered, never a move from the 13.
    expect(texts(legalNow(p, [6, 5], turnRule(p, [6, 5]), 0))).toEqual(["25/19", "25/20"]);
    const closed = persp(board({ 13: 14 }, { 19: 2, 20: 2, 21: 2, 22: 2, 23: 2, 24: 2, 1: 3 }, { bar: [1, 0] }), 0);
    expect(turnRule(closed, [6, 5]).max).toBe(0);
    expect(plays(closed, [6, 5])).toEqual([{ moves: [], pos: closed }]);
  });

  it("bears off exactly, or with a larger die from the highest point only, and not with a checker outside", () => {
    const p = persp(board({ 5: 1, 3: 2 }, { 24: 15 }), 0);
    const rule = turnRule(p, [6, 2]);
    // 6 bears off the 5 (the highest); 2 moves 5/3 or 3/1, or bears nothing off.
    expect(texts(legalNow(p, [6, 2], rule, 0))).toEqual(["3/1", "5/0", "5/3"]);
    const q = persp(board({ 5: 1, 3: 2 }, { 24: 15 }), 0);
    expect(texts(legalNow(q, [4], turnRule(q, [4]), 0))).toEqual(["5/1"]); // 4 can't bear off the 3 while the 5 is there
    const out = persp(board({ 7: 1, 3: 2 }, { 24: 15 }), 0);
    expect(legalNow(out, [3], turnRule(out, [3]), 0).some((s) => s.to === 0)).toBe(false);
  });

  it("finds a checker's way over several dice, through open points only, and the spots it can reach", () => {
    const p = persp(startBoard(), 0);
    const rule = turnRule(p, [6, 5]);
    expect(path(p, [6, 5], rule, 0, 24, 13)?.map((s) => s.die)).toHaveLength(2); // lover's leap
    const r = reach(p, [6, 5], rule, 0, 24);
    expect([...r.entries()].sort()).toEqual([[13, 2], [18, 1]]); // 24/19 lands on Black's 6-point: blocked, so only 24/18/13
    // Black's 6-point (White's 19) is closed, so 24 → 13 must go by the 6 first.
    expect(path(p, [6, 5], rule, 0, 24, 13)!.map((s) => s.to)).toEqual([18, 13]);
  });

  it("writes plays in notation: joined steps, hits, repeats", () => {
    const sub = (from: number, to: number, hit = false): Sub => ({ from, to, die: from - to, hit });
    expect(playText([sub(13, 7), sub(13, 7), sub(13, 10), sub(10, 7)])).toBe("13/7(3)");
    expect(playText([sub(24, 18), sub(18, 13)])).toBe("24/13");
    expect(playText([sub(13, 7, true), sub(7, 5)])).toBe("13/7*/5");
    expect(playText([{ from: 25, to: 22, die: 3, hit: false }, { from: 6, to: 0, die: 6, hit: false }])).toBe("bar/22 6/off");
    expect(playText([])).toBe("(no move)");
  });

  it("counts gammons and backgammons", () => {
    expect(winKind(persp(board({}, { 24: 14 }, { off: [15, 1] }), 0))).toBe(1);
    expect(winKind(persp(board({}, { 24: 15 }, { off: [15, 0] }), 0))).toBe(2);
    expect(winKind(persp(board({}, { 2: 1, 24: 14 }, { off: [15, 0] }), 0))).toBe(3); // Black still in White's home
    expect(winKind(persp(board({}, { 24: 14 }, { bar: [0, 1], off: [15, 0] }), 0))).toBe(3);
  });
});

describe("a turn", () => {
  it("opens with the higher die moving, both numbers", () => {
    const { s } = newMatch({}, [6, 6, 2, 5]); // a tie is rolled again
    expect(s.opening).toEqual([2, 5]);
    expect(s.turn).toBe(1);
    expect(s.phase).toBe("move");
    expect(s.remaining.sort()).toEqual([2, 5]);
  });

  it("move, undo, move again, done; refusals say why", () => {
    let { s } = newMatch(); // White 3, Black 1: White plays 3-1
    const w = s.seats[0];
    const b = s.seats[1];
    expect(refuse(s, b, "move", { from: 1, to: 2 })).toMatch(/not your turn/);
    expect(refuse(s, w, "roll")).toMatch(/rolled already/);
    expect(refuse(s, w, "done")).toMatch(/Play your dice first/);
    expect(refuse(s, w, "move", { from: 8, to: 2 })).toMatch(/isn't legal/); // 8/2 needs a 6
    ({ s } = step(s, w, "move", { from: 8, to: 5 }));
    expect(s.remaining).toEqual([1]);
    ({ s } = step(s, w, "undo"));
    expect(s.board).toEqual(startBoard());
    expect(s.remaining.sort()).toEqual([1, 3]);
    ({ s } = step(s, w, "move", { from: 8, to: 5 }));
    ({ s } = step(s, w, "move", { from: 6, to: 5 }));
    expect(s.board.pts[5]).toBe(2);
    expect(refuse(s, w, "move", { from: 6, to: 5 })).toMatch(/tap Done/);
    const d = step(s, w, "done");
    expect(d.s).toMatchObject({ phase: "roll", turn: 1 });
    expect(d.s.plays.at(-1)).toMatchObject({ color: 0, dice: [3, 1], text: "8/5 6/5", opening: true });
    expect(refuse(d.s, b, "move", { from: 1, to: 2 })).toBe("Roll first");
  });

  it("a move over two dice in one tap, and a hit sends the checker to the bar", () => {
    let { s } = newMatch({}, [6, 5]);
    const w = s.seats[0];
    ({ s } = step(s, w, "move", { from: 24, to: 13 }));
    expect(s.turnMoves).toHaveLength(2);
    expect(s.played).toBe(2);
    // Now a hit: Black blot on White's 9 (abs 9), White rolls 4-2 from 13.
    s = at(board({ 13: 5, 6: 5, 8: 5 }, { 9: 1, 19: 14 }), 0);
    const ctx = fakeCtx([4, 2]);
    ({ s } = step(s, w, "roll", undefined, ctx));
    const r = step(s, w, "move", { from: 13, to: 9 });
    expect(r.s.board.bar[1]).toBe(1);
    expect(r.s.board.pts[9]).toBe(1);
    expect(r.s.stats[0].hits).toBe(1);
    expect(r.events).toContainEqual({ name: "moved", data: { color: 0, from: 13, to: 9, die: 4, hit: true, auto: false } });
  });

  it("with no legal move the turn passes by itself after a moment", () => {
    let s = at(board({ 13: 14 }, { 19: 2, 20: 2, 21: 2, 22: 2, 23: 2, 24: 2, 1: 3 }, { bar: [1, 0] }), 0);
    const ctx = fakeCtx([6, 5]);
    ({ s } = step(s, s.seats[0], "roll", undefined, ctx));
    expect(s.rule.max).toBe(0);
    expect(ctx.timers.has("pass")).toBe(true);
    const r = def.onTimer!(s, "pass", fakeCtx() as never);
    expect("state" in r && r.state).toMatchObject({ phase: "roll", turn: 1 });
  });

  it("bearing off the last checker ends the game at once, as a gammon when the other side has none off", () => {
    let s = at(board({ 2: 1 }, { 24: 15 }), 0, { cube: { enabled: true, value: 2, owner: 0 } });
    ({ s } = step(s, s.seats[0], "roll", undefined, fakeCtx([4, 3])));
    const r = step(s, s.seats[0], "move", { from: 2, to: "off" });
    expect(r.s.games.at(-1)).toMatchObject({ winner: 0, kind: "gammon", points: 4, cube: 2 });
    // Four points in a match to three: the score stops at three and the match is won.
    expect(r.s.match.score).toEqual([3, 0]);
    expect(r.s.phase).toBe("over");
  });
});

describe("the doubling cube and the match", () => {
  it("double, take: the cube doubles and changes sides; only its owner may double again", () => {
    let s = at(startBoard(), 0);
    const [w, b] = s.seats;
    expect(canDouble(s)).toBe(true);
    expect(refuse(s, b, "double")).toMatch(/only on your turn/);
    ({ s } = step(s, w, "double"));
    expect(s.phase).toBe("double");
    expect(refuse(s, w, "roll")).toMatch(/Wait for the answer/);
    expect(refuse(s, w, "take")).toMatch(/no double to answer/);
    ({ s } = step(s, b, "take"));
    expect(s.cube).toMatchObject({ value: 2, owner: 1 });
    expect(s).toMatchObject({ phase: "roll", turn: 0 });
    expect(refuse(s, w, "double")).toMatch(/other side/);
    expect(canDouble({ ...s, turn: 1 })).toBe(true);
  });

  it("pass: the doubler wins the game at the cube's value before the double", () => {
    let s = at(startBoard(), 0, { cube: { enabled: true, value: 2, owner: 0 } });
    ({ s } = step(s, s.seats[0], "double"));
    const r = step(s, s.seats[1], "pass");
    expect(r.s.games.at(-1)).toMatchObject({ winner: 0, points: 2, kind: "pass" });
    expect(r.s.match.score).toEqual([2, 0]);
  });

  it("the Crawford game has no cube; after it, doubling is back; a dead cube is not offered", () => {
    // White wins a game to reach 2 of 3: the next game is the Crawford game.
    let s = at(board({ 1: 1 }, { 24: 14 }, { off: [14, 1] }), 0);
    ({ s } = step(s, s.seats[0], "roll", undefined, fakeCtx([1, 2])));
    let r = step(s, s.seats[0], "move", { from: 1, to: "off" });
    expect(r.s.match).toMatchObject({ score: [1, 0], crawford: false });
    s = { ...r.s, match: { ...r.s.match, score: [1, 0] } };
    s = at(board({ 1: 1 }, { 24: 14 }, { off: [14, 1] }), 0, { match: s.match });
    ({ s } = step(s, s.seats[0], "roll", undefined, fakeCtx([1, 2])));
    r = step(s, s.seats[0], "move", { from: 1, to: "off" });
    expect(r.s.match).toMatchObject({ score: [2, 0], crawford: true });
    // The next game starts after the pause; the board may skip it.
    const ctx = fakeCtx([4, 2]);
    expect(def.onTimer!(r.s, "next", ctx as never)).toMatchObject({ state: { phase: "move", match: { game: r.s.match.game + 1, crawford: true } } });
    const crawford = at(startBoard(), 1, { match: { ...r.s.match, game: 3 } });
    expect(canDouble(crawford)).toBe(false);
    expect(refuse(crawford, crawford.seats[1], "double")).toMatch(/Crawford/);
    // After the Crawford game: Black (trailing) may double, White (at 2 of 3) has a dead cube.
    const post = at(startBoard(), 1, { match: { ...r.s.match, crawford: false, postCrawford: true } });
    expect(canDouble(post)).toBe(true);
    expect(canDouble({ ...post, turn: 0 })).toBe(false);
  });

  it("the match ends when a player reaches the points, with the result, the table and awards", () => {
    let s = at(board({ 1: 1 }, { 24: 14 }, { off: [14, 1] }), 0, { match: { length: 3, score: [2, 1], game: 4, crawford: false, postCrawford: true } });
    s = { ...s, stats: [{ hits: 3, doubles: 2, pipsRolled: 300, rolls: 30, entered: 1, gamesWon: 2, gammons: 0, cubes: 1 }, { hits: 1, doubles: 2, pipsRolled: 280, rolls: 29, entered: 3, gamesWon: 1, gammons: 0, cubes: 0 }] };
    ({ s } = step(s, s.seats[0], "roll", undefined, fakeCtx([1, 2])));
    const r = step(s, s.seats[0], "move", { from: 1, to: "off" });
    expect(r.s.phase).toBe("over");
    expect(r.events.map((e) => e.name)).toEqual(["moved", "gameWon", "matchWon"]);
    const sum = def.isOver(r.s)!;
    expect(sum.text).toBe("Ann wins the match 3–1 after one game.");
    // Four columns, so the table fits the phones' summary at 320 px.
    expect(sum.table!.columns).toEqual(["Player", "Points", "Games", "Hits"]);
    expect(sum.table!.rows[0]).toEqual(["Ann", 3, 3, 3]);
    const ids = (sum as { awards: { id: string; seats: number[] }[] }).awards.map((a) => a.id);
    expect(ids).toContain("hitman");
    expect(ids).toContain("comeback");
    expect(ids).not.toContain("doubles"); // a tie is no award
    expect(refuse(r.s, s.seats[1], "roll")).toMatch(/match is over/);
  });

  it("a one-point match has no cube to offer and ends after one game", () => {
    const { s } = newMatch({ matchLength: 1 }, [2, 1]);
    expect(canDouble({ ...s, phase: "roll" })).toBe(false);
  });
});

describe("timers, the stand-in and the AI", () => {
  it("the turn timer plays the whole turn for a slow player", () => {
    const { s } = newMatch({ turnSeconds: 30 }, [6, 1]);
    const ctx = fakeCtx();
    const r = def.onTimer!(s, "turn", ctx as never) as { state: State; events: { name: string }[] };
    expect(r.state).toMatchObject({ phase: "roll", turn: 1 });
    expect(r.state.plays.at(-1)!.text).toBe("13/7 8/7"); // the evaluation makes the bar-point with 6-1
    expect(r.events[0].name).toBe("timeout");
    expect(ctx.timers.has("turn")).toBe(true); // the next player's turn has its own limit
  });

  it("the stand-in plays a player who left, step by step, until someone takes the seat", () => {
    let { s } = newMatch({}, [3, 1]);
    const ctx = fakeCtx([2, 2]);
    let r = def.onSeatLeft!(s, s.seats[0], ctx as never) as { state: State };
    s = r.state;
    expect(s.standIn).toEqual([s.seats[0]]);
    expect(ctx.timers.has("standin")).toBe(true);
    for (let k = 0; k < 3 && s.turn === 0; k++) s = (def.onTimer!(s, "standin", ctx as never) as { state: State }).state;
    expect(s.turn).toBe(1);
    expect(s.plays[0].text).toBe("8/5 6/5");
    r = def.onSeatJoined!(s, { seat: s.seats[0], playerId: "x", name: "Zoe", kind: "human" }, ctx as never) as { state: State };
    expect(r.state.standIn).toEqual([]);
    expect(r.state.names[s.seats[0]]).toBe("Zoe");
  });

  it("the AI moves one checker at a time, then ends its turn; it takes a fair double and passes a lost one", () => {
    const { s } = newMatch({}, [6, 1]);
    const view = (st: State, seat: number) => def.view(st, seat) as View;
    const first = aiIntent(view(s, s.seats[0]), "average", () => 0.5);
    expect(first).toMatchObject({ name: "move", payload: { die: expect.any(Number) } });
    expect(aiIntent(view(s, s.seats[1]), "average", () => 0.5)).toBeNull();
    const lost = at(board({ 1: 2 }, { 1: 0, 24: 0, 13: 13, 6: 2 }, { off: [13, 0] }), 0);
    const p = persp(lost.board, 1);
    expect(shouldTake(p, "average", { need: [3, 3], value: 1, freeDrop: false })).toBe(false);
    expect(shouldTake(p, "beginner", { need: [3, 3], value: 1, freeDrop: false })).toBe(true);
    expect(shouldTake(persp(startBoard(), 1), "average", { need: [3, 3], value: 1, freeDrop: false })).toBe(true);
    expect(shouldDouble(persp(startBoard(), 0), "average", { need: [3, 3], value: 1, freeDrop: false })).toBe(false);
    expect(shouldDouble(persp(startBoard(), 0), "average", { need: [3, 1], value: 1, freeDrop: true })).toBe(true);
  });

  it("the evaluation prefers safe points to blots, and the levels choose legal plays", () => {
    const p = persp(startBoard(), 0);
    const make = plays(p, diceOf(3, 1)).find((x) => playText(x.moves) === "8/5 6/5")!;
    const loose = plays(p, diceOf(3, 1)).find((x) => playText(x.moves) === "13/10 6/5")!;
    expect(evaluate(make.pos)).toBeGreaterThan(evaluate(loose.pos));
    for (const level of ["beginner", "average", "strong"] as const) {
      const c = choosePlay(p, diceOf(4, 2), level, () => 0.3);
      expect(plays(p, diceOf(4, 2)).some((x) => playText(x.moves) === playText(c.play.moves)), level).toBe(true);
    }
  });
});

describe("on the runtime", () => {
  it("a whole match of AI players finishes and replays exactly, with a move list", async () => {
    const game = await loadGame("backgammon");
    const { rt, clock } = start(game, 2, { matchLength: 3 }, 5, { seats: seats(2, "ai"), aiOptions: { 0: { level: "average" }, 1: { level: "beginner" } } });
    let seed = 1;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 6000 && !rt.over; k++) {
      const st = rt.state as State;
      const who = st.phase === "double" ? st.seats[st.turn ^ 1] : st.phase === "roll" || st.phase === "move" ? st.seats[st.turn] : null;
      const intent = who === null ? null : rt.aiIntent(who, rng);
      if (intent) expect(rt.submit(who!, intent, "ai")).toEqual({ ok: true });
      else clock.advance(); // the pause between games, or a turn with no move
    }
    expect(rt.over).toBe(true);
    expect(replaysExactly(game, rt)).toBe(true);
    const st = rt.state as State;
    expect(Math.max(...st.match.score)).toBe(3);
    // Every turn of the last game is in the list, in notation.
    expect(st.plays.length).toBeGreaterThan(5);
    for (const p of st.plays) expect(p.text).toMatch(/^(\(no move\)|((bar|\d+)(\/(\d+|off)\*?)+(\(\d\))? ?)+)$/);
  });

  it("describes steps for the Game Viewer", () => {
    let { s } = newMatch({}, [3, 1]);
    const w = s.seats[0];
    const before = s;
    ({ s } = step(s, w, "move", { from: 8, to: 5 }));
    const d = def.describe!({ kind: "intent", seat: w, intent: { name: "move", payload: { from: 8, to: 5 } }, accepted: true, events: [], names: {}, before, after: s } as never);
    expect(d).toMatchObject({ text: "moves 8/5", columns: { dice: "3-1", score: "0–0" } });
  });
});
