// Backgammon board: the board in the middle of the table with White's home at White's right hand (White sits south),
// the bar in the middle and the borne-off checkers in the tray at the right. At each player's right hand a panel faces
// them: their score and pip count, what to do now, Roll, Undo and Done, and the last turns. Moves are made here: tap a
// checker, then where it goes (the points it can reach light up; one die or several in a row); tap the dice to roll.
// Doubling, taking and passing stay on the phones.
//
// Static and moving parts are separate layers (the points are drawn once; checkers have their own layer), and a move
// plays as one animation per checker, so the board stays smooth on a 4K table (see game-table-board-animations).
import { W, H, esc, html, playerColor, playSound, remainingMs, seatPlates, useStyles } from "/shared/board-kit.js";
import { COLOR_NAME, ROLL_MS, checkerSound, cubeSound, diceState, dieHtml, hitSound, offSound, ownNumber, rollSound, winSound } from "/games/backgammon/assets/bg-ui.js";

// ----- geometry (1920 × 1080 surface, White south) -----
const FX = 440; // frame
const FY = 150;
const FW = 1040;
const FH = 780;
const RIM = 18;
const X0 = FX + RIM; // inner left
const Y0 = FY + RIM; // inner top
const Y1 = FY + FH - RIM; // inner bottom
const PW = 72; // point width
const D = 64; // checker diameter
const BAR_X = X0 + 6 * PW; // bar's left edge
const BAR_W = 64;
const RQ_X = BAR_X + BAR_W; // right quarter's left edge
const TRAY_X = RQ_X + 6 * PW;
const TRAY_W = FX + FW - RIM - TRAY_X;
const MID = (Y0 + Y1) / 2;
const POINT_H = 320;
const BAR_CX = BAR_X + BAR_W / 2;
const TRAY_CX = TRAY_X + TRAY_W / 2;
const MOVE_MS = 260;

/** Where a point's checkers stand when White sits south: column centre and row. */
function pointCol(p) {
  if (p <= 6) return { x: TRAY_X - (p - 0.5) * PW, bottom: true };
  if (p <= 12) return { x: BAR_X - (p - 6.5) * PW, bottom: true };
  if (p <= 18) return { x: X0 + (p - 12.5) * PW, bottom: false };
  return { x: RQ_X + (p - 18.5) * PW, bottom: false };
}
const stepFor = (n, room) => (n <= 1 ? D : Math.min(D, (room - D) / (n - 1)));

export function mount(root, ctx) {
  useStyles("/games/backgammon/board.css");
  const box = html(`<div class="bg-board">
    <svg class="bg-static" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"></svg>
    <div class="bg-marks"></div><div class="bg-checkers"></div><div class="bg-zones"></div>
    <div class="bg-dice"></div><div class="bg-cube" hidden></div>
    <div class="bg-panel" data-color="0"></div><div class="bg-panel" data-color="1"></div>
    <div class="bg-between" hidden></div></div>`);
  root.appendChild(box);
  const $ = (s) => box.querySelector(s);
  const staticSvg = $(".bg-static");
  const marks = $(".bg-marks");
  const checkers = $(".bg-checkers");
  const diceBox = $(".bg-dice");
  const cube = $(".bg-cube");
  const zones = $(".bg-zones");
  const between = $(".bg-between");
  let info = null;
  let view = null; // the latest view
  let shown = null; // the board as drawn now (it trails `view` while moves play)
  let selected = null; // the spot of a picked-up checker
  let sending = false;
  let gone = false;
  const queue = [];
  let playing = null; // the promise of the queue being played
  const drawn = new Map();
  const put = (el, markup) => {
    if (drawn.get(el) === markup) return;
    drawn.set(el, markup);
    el.innerHTML = markup;
  };

  // ----- orientation: White's home at White's right; turned over if White sits north -----
  const edgeOf = (color) => info?.seatEdges?.[view?.seats?.[color]] ?? (color === 0 ? "south" : "north");
  const flipped = () => edgeOf(0) === "north";
  const at = (x, y) => (flipped() ? { x: W - x, y: H - y } : { x, y });
  const southColor = () => (flipped() ? 1 : 0);

  /** Centre of checker `k` (0 = against the edge) of `n` on a spot, for a colour. */
  function slot(spot, color, k, n) {
    if (spot === "bar") {
      // White's bar checkers above the middle (they come in at the top), Black's below; the ends stay free for the cube.
      const room = MID - 62 - (Y0 + 70);
      const step = stepFor(n, room + D);
      const y = color === 0 ? MID - 62 - k * step : MID + 62 + k * step;
      return at(BAR_CX, y);
    }
    if (spot === "off") {
      const y = color === 0 ? Y1 - 10 - k * 15 : Y0 + 10 + k * 15;
      return at(TRAY_CX, y);
    }
    const c = pointCol(spot);
    const step = stepFor(n, POINT_H);
    return at(c.x, c.bottom ? Y1 - D / 2 - k * step : Y0 + D / 2 + k * step);
  }

  /** How many checkers of which colour stand on a spot of a board. */
  function stackOf(b, spot, color) {
    if (spot === "bar") return { n: b.bar[color], color };
    if (spot === "off") return { n: b.off[color], color };
    const v = b.pts[spot];
    return { n: Math.abs(v), color: v > 0 ? 0 : 1 };
  }

  // ----- the static board: frame, points, bar, tray, numbers -----
  function drawStatic() {
    const key = `${flipped()}`;
    if (drawn.get(staticSvg) === key) return;
    drawn.set(staticSvg, key);
    const rect = (x, y, w, h, extra = "") => {
      const a = at(x, y);
      const b = at(x + w, y + h);
      return `<rect x="${Math.min(a.x, b.x)}" y="${Math.min(a.y, b.y)}" width="${w}" height="${h}" ${extra}/>`;
    };
    let s = `<defs><linearGradient id="bgw" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5a3b22"/><stop offset="1" stop-color="#2f1f12"/></linearGradient></defs>`;
    s += `<rect x="${FX}" y="${FY}" width="${FW}" height="${FH}" rx="16" fill="url(#bgw)" class="bg-frame"/>`;
    s += rect(X0, Y0, 6 * PW, Y1 - Y0, 'fill="#1f5244"');
    s += rect(RQ_X, Y0, 6 * PW, Y1 - Y0, 'fill="#1f5244"');
    s += rect(BAR_X, Y0, BAR_W, Y1 - Y0, 'fill="#3d2816"');
    s += rect(TRAY_X + 4, Y0, TRAY_W - 8, Y1 - Y0, 'fill="#173b31" rx="6"');
    for (let p = 1; p <= 24; p++) {
      const c = pointCol(p);
      const base = c.bottom ? Y1 : Y0;
      const tip = c.bottom ? Y1 - POINT_H : Y0 + POINT_H;
      const a = at(c.x - PW / 2 + 2, base);
      const b = at(c.x + PW / 2 - 2, base);
      const t = at(c.x, tip);
      s += `<polygon points="${a.x},${a.y} ${b.x},${b.y} ${t.x},${t.y}" fill="${p % 2 ? "#d9c08f" : "#9c4a33"}" class="bg-point"/>`;
    }
    // Point numbers: each row in the numbering of the player sitting at it, facing them.
    for (let p = 1; p <= 24; p++) {
      const c = pointCol(p);
      const y = c.bottom ? Y1 + RIM / 2 + 1 : Y0 - RIM / 2 - 1;
      const pos = at(c.x, y);
      const southRow = c.bottom !== flipped();
      // The south player counts from their home: White's numbers, or Black's when Black sits south.
      const num = southRow ? (southColor() === 0 ? p : 25 - p) : southColor() === 0 ? 25 - p : p;
      s += `<text x="${pos.x}" y="${pos.y}" class="bg-num" transform="rotate(${southRow ? 0 : 180} ${pos.x} ${pos.y})">${num}</text>`;
    }
    staticSvg.innerHTML = s;
  }

  // ----- the checkers -----
  function checkerHtml(color, x, y, cls = "", attrs = "") {
    const seat = view?.seats?.[color];
    return `<div class="bg-ck ${color ? "b" : "w"} ${cls}" style="left:${x - D / 2}px;top:${y - D / 2}px;--ring:${playerColor(info, seat)}" ${attrs}></div>`;
  }
  function offHtml(color, x, y) {
    return `<div class="bg-off ${color ? "b" : "w"}" style="left:${x - 28}px;top:${y - 6}px"></div>`;
  }

  /** The spots the side to move can take a checker from right now, if this board may move for them. */
  function movableFrom() {
    if (!mayMove()) return new Set();
    return new Set(view.targets.map((t) => String(t.from)));
  }
  function mayMove() {
    return !!view && view.phase === "move" && !view.result && !info?.over && !!ctx?.act && (info.controlSeats ?? []).includes(view.turnSeat) && !sending && !playing;
  }

  function drawCheckers(b) {
    const movable = movableFrom();
    let m = "";
    for (let p = 1; p <= 24; p++) {
      const { n, color } = stackOf(b, p, 0);
      for (let k = 0; k < n; k++) {
        const { x, y } = slot(p, color, k, n);
        const top = k === n - 1;
        const cls = top && movable.has(String(p)) ? (String(p) === String(selected) ? "movable lifted" : "movable") : "";
        m += checkerHtml(color, x, y, cls, `data-spot="${p}" data-k="${k}"`);
      }
      // A tall stack shows its count on the top checker.
      if (n > 5) {
        const { x, y } = slot(p, color, n - 1, n);
        m += `<div class="bg-count ${color ? "b" : "w"}" style="left:${x}px;top:${y}px">${n}</div>`;
      }
    }
    for (const color of [0, 1]) {
      const n = b.bar[color];
      for (let k = 0; k < n; k++) {
        const { x, y } = slot("bar", color, k, n);
        const top = k === n - 1;
        const cls = top && movable.has("bar") && view.turn === color ? (selected === "bar" ? "movable lifted" : "movable") : "";
        m += checkerHtml(color, x, y, cls, `data-spot="bar" data-color="${color}" data-k="${k}"`);
      }
      for (let k = 0; k < b.off[color]; k++) {
        const { x, y } = slot("off", color, k, b.off[color]);
        m += offHtml(color, x, y);
      }
    }
    put(checkers, m);
  }

  /** Where a picked-up checker can go: a ring where it would land. */
  function drawMarks() {
    let m = "";
    if (selected !== null && view?.phase === "move") {
      const c = view.turn;
      for (const t of view.targets.filter((x) => String(x.from) === String(selected))) {
        if (t.to === "off") {
          const a = at(TRAY_X + 4, c === 0 ? MID + 8 : Y0);
          const b2 = at(TRAY_X + TRAY_W - 4, c === 0 ? Y1 : MID - 8);
          m += `<div class="bg-target off" data-steps="${t.steps}" style="left:${Math.min(a.x, b2.x)}px;top:${Math.min(a.y, b2.y)}px;width:${TRAY_W - 8}px;height:${Math.abs(b2.y - a.y)}px"></div>`;
          continue;
        }
        const st = stackOf(shown, t.to, c);
        const own = st.color === c ? st.n : 0;
        const { x, y } = slot(t.to, c, own, own + 1);
        m += `<div class="bg-target ${t.steps > 1 ? "far" : ""}" data-steps="${t.steps}" style="left:${x - D / 2}px;top:${y - D / 2}px"></div>`;
      }
    }
    put(marks, m);
  }

  /** Tap zones: every point column, the bar and the tray. */
  function drawZones() {
    let z = "";
    for (let p = 1; p <= 24; p++) {
      const c = pointCol(p);
      const a = at(c.x - PW / 2, c.bottom ? MID : Y0);
      const b = at(c.x + PW / 2, c.bottom ? Y1 : MID);
      z += `<div class="bg-zone" data-zone="${p}" style="left:${Math.min(a.x, b.x)}px;top:${Math.min(a.y, b.y)}px;width:${PW}px;height:${Math.abs(b.y - a.y)}px"></div>`;
    }
    const bar1 = at(BAR_X, Y0);
    const bar2 = at(BAR_X + BAR_W, Y1);
    z += `<div class="bg-zone" data-zone="bar" style="left:${Math.min(bar1.x, bar2.x)}px;top:${Y0}px;width:${BAR_W}px;height:${Y1 - Y0}px"></div>`;
    const t1 = at(TRAY_X, Y0);
    const t2 = at(TRAY_X + TRAY_W, Y1);
    z += `<div class="bg-zone" data-zone="off" style="left:${Math.min(t1.x, t2.x)}px;top:${Y0}px;width:${TRAY_W}px;height:${Y1 - Y0}px"></div>`;
    put(zones, z);
  }

  // ----- dice and cube -----
  /** The mover's dice lie in the half at their right hand. */
  function diceAt(color) {
    const south = edgeOf(color) !== "north";
    return { x: south ? (RQ_X + TRAY_X) / 2 : (X0 + BAR_X) / 2, y: MID, rot: south ? 0 : 180 };
  }
  function drawDice() {
    const v = view;
    if (!v || v.phase === "gameOver" || v.phase === "over") return put(diceBox, "");
    const where = diceAt(v.turn);
    const rollHere = v.phase === "roll" && !v.result && !info.over && ctx?.act && (info.controlSeats ?? []).includes(v.turnSeat);
    let inner;
    if (v.phase === "roll" || v.phase === "double") {
      inner = rollHere
        ? `<button type="button" class="bg-roll" data-roll aria-label="Roll the dice">${dieHtml(0, { size: 56, cls: "blank" })}${dieHtml(0, { size: 56, cls: "blank" })}<span>Tap to roll</span></button>`
        : `<div class="bg-wait">${v.phase === "double" ? "" : `${esc(nameOf(v.turn))} to roll`}</div>`;
    } else {
      const ds = diceState(v.dice, v.remaining, v.phase);
      const size = ds.length > 2 ? 50 : 60;
      inner = `<div class="bg-dice-row">${ds.map((d) => dieHtml(d.n, { size, used: d.used })).join("")}</div>`;
      if (v.opening) inner += `<div class="bg-opening">Opening roll: White ${v.opening[0]}, Black ${v.opening[1]}</div>`;
      if (v.blocked) inner += `<div class="bg-opening">No move possible</div>`;
    }
    put(diceBox, `<div class="bg-dice-at" style="left:${where.x}px;top:${where.y}px;transform:translate(-50%,-50%) rotate(${where.rot}deg)">${inner}</div>`);
  }

  function drawCube() {
    const v = view;
    if (!v?.cube?.enabled || v.phase === "over" || v.phase === "gameOver") return void (cube.hidden = true);
    cube.hidden = false;
    let x = BAR_CX;
    let y = MID;
    let rot = 0;
    if (v.cube.owner !== null && v.phase !== "double") {
      const south = edgeOf(v.cube.owner) !== "north";
      y = south ? Y1 - 34 : Y0 + 34;
      rot = south ? 0 : 180;
    } else if (v.phase === "double") {
      // Offered: it stands before the player who has to answer.
      const south = edgeOf(v.turn ^ 1) !== "north";
      y = south ? Y1 - 34 : Y0 + 34;
      rot = south ? 0 : 180;
    } else rot = info?.rotation ?? 0;
    const value = v.phase === "double" ? v.cube.value * 2 : v.cube.value;
    const label = v.match.crawford ? "<small>Crawford</small>" : value === 1 ? "64" : String(value);
    cube.className = `bg-cube ${v.phase === "double" ? "offered" : ""} ${v.match.crawford ? "crawford" : ""}`;
    cube.style.left = `${x}px`;
    cube.style.top = `${y}px`;
    cube.style.transform = `translate(-50%,-50%) rotate(${rot}deg)`;
    put(cube, label);
  }

  // ----- panels: one per colour, at that player's right hand, facing them -----
  const nameOf = (color) => view.names[view.seats[color]] ?? COLOR_NAME[color];
  function panelHtml(color) {
    const v = view;
    const seat = v.seats[color];
    const away = v.standIn.includes(seat);
    const ai = (info.players ?? []).find((p) => p.seat === seat)?.kind === "ai";
    const control = !!ctx?.act && (info.controlSeats ?? []).includes(seat) && !v.result && !info.over;
    const mine = v.turn === color;
    let status = "";
    if (v.result) status = `<b>${esc(v.result.text)}</b>`;
    else if (info.over) status = "<b>The match has ended</b>";
    else if (v.phase === "gameOver") status = esc(gameLine(v.lastGame));
    else if (v.phase === "double") status = mine ? `You double to ${v.cube.value * 2}: waiting for ${esc(nameOf(color ^ 1))}` : `<b class="bg-alert">${esc(nameOf(color ^ 1))} doubles to ${v.cube.value * 2}</b>: take or pass on your phone`;
    else if (!mine) status = `<span class="muted">${esc(nameOf(color ^ 1))} ${v.phase === "roll" ? "to roll" : "is moving"}${v.standIn.includes(v.seats[color ^ 1]) ? " (stand-in)" : ""}</span>`;
    else if (away) status = "The stand-in is playing…";
    else if (ai) status = v.phase === "roll" ? "Rolling…" : "Thinking…";
    else if (v.phase === "roll") status = v.canDouble ? "Your roll: tap the dice, or double on your phone" : "Your roll: tap the dice";
    else if (v.blocked) status = "No move possible: the turn passes";
    else if (v.canDone) status = "<b>All moved: tap Done</b>";
    else status = `Move: ${v.remaining.join(" and ")}${v.legal.some((m) => m.from === "bar") ? " (from the bar first)" : ""}`;
    const showButtons = control && mine && (v.phase === "roll" || v.phase === "move") && !away;
    const buttons = showButtons
      ? `<div class="bg-btns">
          ${v.phase === "roll" ? `<button type="button" class="primary" data-act="roll" ${sending ? "disabled" : ""}>Roll</button>` : ""}
          ${v.phase === "move" ? `<button type="button" data-act="undo" ${v.canUndo && !sending ? "" : "disabled"}>Undo</button><button type="button" class="primary" data-act="done" ${v.canDone && !sending ? "" : "disabled"}>Done</button>` : ""}
        </div>`
      : "";
    const turnLine = mine && v.phase === "move" && v.turnMoves && v.turnMoves !== "(no move)" ? `<div class="bg-now">${esc(v.turnMoves)}</div>` : "";
    const recent = v.plays.slice(-4).map((p) => `<div class="${p.color === color ? "me" : ""}"><span class="dd">${p.dice[0]}-${p.dice[1]}</span> ${esc(p.color === color ? "You" : nameOf(p.color))}: ${esc(p.text)}</div>`).join("");
    const len = v.match.length;
    return `<div class="bg-who"><span class="bg-dot" style="background:${playerColor(info, seat)}"></span>
        <span class="bg-name">${esc(nameOf(color))}</span><span class="bg-color ${color ? "b" : "w"}">${COLOR_NAME[color]}</span></div>
      ${away ? `<div class="bg-standin">The stand-in plays for ${esc(nameOf(color))}</div>` : ""}
      <div class="bg-score"><span><b>${v.match.score[color]}</b> <small>of ${len} point${len === 1 ? "" : "s"}</small></span><span><b>${v.pips[color]}</b> <small>pips</small></span>${v.cube.enabled && v.cube.owner === color ? `<span class="bg-mycube">cube ${v.cube.value}</span>` : ""}</div>
      <div class="bg-status">${status}</div>${turnLine}${buttons}
      <div class="bg-recent">${recent || `<span class="muted">Game ${v.match.game}${v.match.crawford ? " (Crawford: no cube)" : ""}</span>`}</div>`;
  }
  function placePanels() {
    for (const el of box.querySelectorAll(".bg-panel")) {
      const south = edgeOf(Number(el.dataset.color)) !== "north";
      el.style.left = `${south ? W - 225 : 225}px`;
      el.style.top = `${south ? H - 370 : 370}px`;
      el.style.transform = `translate(-50%,-50%) rotate(${south ? 0 : 180}deg)`;
    }
  }
  function drawPanels() {
    for (const el of box.querySelectorAll(".bg-panel")) {
      const color = Number(el.dataset.color);
      el.classList.toggle("active", !view.result && !info.over && (view.phase === "double" ? view.turn !== color : view.turn === color) && view.phase !== "gameOver");
      put(el, panelHtml(color));
    }
  }

  function gameLine(g) {
    if (!g) return "";
    const kind = { single: "", gammon: " with a gammon", backgammon: " with a backgammon", pass: ": the double was passed" }[g.kind];
    return `${nameOf(g.winner)} wins game ${g.game}${kind}, ${g.points} point${g.points === 1 ? "" : "s"}.`;
  }

  /** Between games: who won it, the score, and Next game (skips the wait). */
  function drawBetween() {
    const v = view;
    // Only once the board has shown the last moves: it may still be playing them.
    const show = v.phase === "gameOver" && !info.over && !playing && !queue.length;
    between.hidden = !show;
    if (!show) return;
    const left = remainingMs(info, "next");
    const canSkip = !!ctx?.skipTimer && info.boardControl !== false && left !== null;
    between.style.transform = `translate(-50%,-50%) rotate(${info.rotation ?? 0}deg)`;
    put(between, `<div class="bg-between-title">${esc(gameLine(v.lastGame))}</div>
      <div class="bg-between-score">${esc(nameOf(0))} ${v.match.score[0]} – ${v.match.score[1]} ${esc(nameOf(1))} <small>· match to ${v.match.length}</small></div>
      ${v.match.crawford ? `<div class="muted">The next game is the Crawford game: no doubling.</div>` : ""}
      ${canSkip ? `<button type="button" class="primary" data-next>Next game</button>` : `<div class="muted">The next game starts in a moment</div>`}`);
  }

  function draw() {
    drawStatic();
    drawZones();
    drawCheckers(shown);
    drawMarks();
    drawDice();
    drawCube();
    placePanels();
    drawPanels();
    drawBetween();
    seatPlates(root, info, (seat) => {
      const c = view.seats.indexOf(seat);
      if (c < 0) return "watching";
      return `${COLOR_NAME[c]} · ${view.match.score[c]} pt${view.match.score[c] === 1 ? "" : "s"}`;
    }, { active: view.result || info.over ? undefined : view.actorSeat ?? undefined });
  }

  // ----- moves played as animations, one after the other -----
  const boardOf = (v) => ({ pts: v.points.slice(), bar: [v.bar[0], v.bar[1]], off: [v.off[0], v.off[1]] });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function fly(el, from, to, ms) {
    if (!el) return Promise.resolve();
    el.classList.add("moving");
    const a = el.animate([{ transform: `translate(${from.x - to.x}px,${from.y - to.y}px)` }, { transform: "none" }], { duration: ms, easing: "cubic-bezier(.3,.7,.3,1)" });
    // A timer bounds the wait: a window in the background (or a stalled frame clock) may never finish the animation,
    // and the queue must still move on.
    return Promise.race([a.finished.catch(() => {}), wait(ms + 60)]).then(() => {
      a.finish?.();
      el.classList.remove("moving");
    });
  }

  /** Plays one "moved" event on the drawn board: the checker flies to its spot, a hit one to the bar. */
  async function playMove(e) {
    const b = shown;
    const c = e.color;
    const src = stackOf(b, e.from, c);
    const fromXY = slot(e.from, c, src.n - 1, src.n);
    let hitFrom = null;
    if (e.from === "bar") b.bar[c]--;
    else b.pts[e.from] -= c === 0 ? 1 : -1;
    if (e.to === "off") b.off[c]++;
    else {
      const v = b.pts[e.to];
      if ((c === 0 && v === -1) || (c === 1 && v === 1)) {
        hitFrom = slot(e.to, c ^ 1, 0, 1);
        b.pts[e.to] = 0;
        b.bar[c ^ 1]++;
      }
      b.pts[e.to] += c === 0 ? 1 : -1;
    }
    drawCheckers(b);
    const dst = stackOf(b, e.to, c);
    const toXY = slot(e.to, c, dst.n - 1, dst.n);
    const el = e.to === "off" ? null : checkers.querySelector(`.bg-ck[data-spot="${e.to}"][data-k="${dst.n - 1}"]`);
    const runs = [fly(el, fromXY, toXY, MOVE_MS)];
    if (hitFrom) {
      const n = b.bar[c ^ 1];
      const hitEl = checkers.querySelector(`.bg-ck[data-spot="bar"][data-color="${c ^ 1}"][data-k="${n - 1}"]`);
      runs.push(fly(hitEl, hitFrom, slot("bar", c ^ 1, n - 1, n), MOVE_MS + 220));
    }
    playSound(info, e.hit ? "bg-hit" : e.to === "off" ? "bg-off" : "bg-move", e.hit ? hitSound : e.to === "off" ? offSound : checkerSound);
    await Promise.all(runs);
  }

  function sounds(events) {
    for (const e of events) {
      if (e.name === "rolled" || e.name === "opening") playSound(info, "bg-roll", rollSound);
      if (e.name === "doubled" || e.name === "took") playSound(info, e.name === "doubled" ? "bg-double" : "bg-take", cubeSound);
      if (e.name === "gameWon" || e.name === "matchWon") playSound(info, "bg-win", winSound);
    }
  }

  function play() {
    if (playing) return playing;
    playing = (async () => {
      // Yield first: a queue with nothing to animate (an Undo) would otherwise run to its end, and clear `playing`,
      // before `playing` is even set.
      await null;
      box.dataset.busy = "1"; // for the browser checks: moves are still being shown
      while (queue.length && !gone) {
        const { v, events } = queue.shift();
        try {
        const moves = events.filter((e) => e.name === "moved").map((e) => e.data);
        const restart = events.some((e) => e.name === "opening" || e.name === "undone");
        if (events.some((e) => e.name === "rolled" || e.name === "opening")) {
          sounds(events.filter((e) => e.name === "rolled" || e.name === "opening"));
          await wait(ROLL_MS / 2); // the dice land before the first checker moves
          diceBox.classList.add("rolling");
          setTimeout(() => diceBox.classList.remove("rolling"), ROLL_MS);
        }
        if (!restart && shown && moves.length) {
          for (const [k, m] of moves.entries()) {
            if (k) await wait(90);
            await playMove(m);
          }
        }
        } catch (err) {
          console.error("backgammon board:", err); // never leave the queue stuck: show the latest board instead
        }
        shown = boardOf(v);
        sounds(events.filter((e) => e.name !== "rolled" && e.name !== "opening"));
        drawCheckers(shown);
        drawMarks();
      }
      playing = null;
      delete box.dataset.busy;
      if (view && !gone) draw(); // the moves may now be made here again
    })();
    return playing;
  }

  // ----- touch -----
  async function act(name, payload) {
    if (sending || !view) return;
    sending = true;
    selected = null;
    draw();
    const r = await ctx.act(view.turnSeat, name, payload);
    sending = false;
    if (gone || !view) return;
    if (!r.ok) draw();
  }

  box.addEventListener("pointerdown", (e) => {
    if (!view) return;
    const next = e.target.closest("[data-next]");
    if (next) {
      e.preventDefault();
      next.disabled = true;
      return void ctx.skipTimer?.("next");
    }
    const btn = e.target.closest("[data-act]");
    if (btn) {
      e.preventDefault();
      if (!btn.disabled) act(btn.dataset.act);
      return;
    }
    if (e.target.closest("[data-roll]")) {
      e.preventDefault();
      return void act("roll");
    }
    if (!mayMove()) return;
    // The zone under the finger: a point's half of the board, the bar or the tray.
    const spot = e.target.closest("[data-zone]")?.dataset.zone ?? null;
    if (spot === null) {
      if (selected !== null) {
        selected = null;
        drawCheckers(shown);
        drawMarks();
      }
      return;
    }
    const norm = (x) => (x === "bar" || x === "off" ? x : Number(x));
    const s = norm(spot);
    if (selected !== null && s !== selected) {
      const t = view.targets.find((x) => String(x.from) === String(selected) && String(x.to) === String(s));
      if (t) return void act("move", { from: selected, to: s });
    }
    const can = view.targets.some((x) => String(x.from) === String(s));
    selected = can && s !== selected ? s : null;
    drawCheckers(shown);
    drawMarks();
  });

  return {
    update(v, events, i) {
      info = i;
      if (view && (v.phase !== view.phase || v.turn !== view.turn || v.remaining.length !== view.remaining.length)) selected = null;
      const first = !view;
      view = v;
      if (first || !shown) shown = boardOf(v);
      if (selected !== null && !v.targets.some((x) => String(x.from) === String(selected))) selected = null;
      if (!first) queue.push({ v, events });
      draw();
      if (first) {
        // A board that comes up as the match starts still shows the opening roll.
        if (v.opening && v.plays.length === 0) sounds([{ name: "opening" }]);
        return;
      }
      play();
    },
    /** Resolves once every move sent so far has been shown (games-service D-134, D-137). */
    whenIdle() {
      return playing ?? Promise.resolve();
    },
    destroy() {
      gone = true;
    },
  };
}
