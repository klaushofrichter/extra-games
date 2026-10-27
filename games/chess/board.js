// Chess board: the 8 × 8 board in the middle of the table, White's first rank toward White's seat, all pieces standing
// up toward the edge the board faces (the turn-around button turns them). At each player's right hand a panel faces them: their clock, what they have
// captured, the last moves and what is going on (check, a draw offer). Moves are made here: tap a piece of
// yours, then its square, or drag it there; a promotion asks which piece. The phones only show clocks and moves and offer a draw or
// resignation.
import { W, H, ROT, esc, html, ping, playerColor, playSound, remainingMs, seatPlates, useStyles } from "/shared/board-kit.js";
import { badSound, clockLeft, clockText, materialEdge, movePairs, moveSound, pieceSvg, sourceTag } from "/games/chess/assets/pieces.js";

const S = 92; // square size
const LEFT = (W - 8 * S) / 2;
const TOP = (H - 8 * S) / 2;
const FILES = "abcdefgh";

export function mount(root, ctx) {
  useStyles("/games/chess/board.css");
  const box = html(`<div class="ch-board">
    <div class="ch-frame" style="left:${LEFT - 22}px;top:${TOP - 22}px;width:${8 * S + 44}px;height:${8 * S + 44}px"></div>
    <div class="ch-squares"></div><div class="ch-marks"></div><div class="ch-coords"></div><div class="ch-pieces"></div>
    <div class="ch-panel" data-color="0"></div><div class="ch-panel" data-color="1"></div>
    <div class="ch-promo" hidden></div></div>`);
  root.appendChild(box);
  const squares = box.querySelector(".ch-squares");
  const pieces = box.querySelector(".ch-pieces");
  const marks = box.querySelector(".ch-marks");
  const coords = box.querySelector(".ch-coords");
  const promo = box.querySelector(".ch-promo");
  let info = null;
  let view = null;
  let selected = null; // square name of the picked-up piece
  let sending = false;
  let gone = false;
  // Layers are redrawn only when their markup changes, so a move's animation isn't cut short by the next update.
  const drawn = new Map();
  const put = (el, markup) => {
    if (drawn.get(el) === markup) return;
    drawn.set(el, markup);
    el.innerHTML = markup;
  };

  // ----- geometry: where a square sits on the table, which way each colour's pieces face -----
  const edgeOf = (color) => info?.seatEdges?.[view?.seats?.[color]] ?? (color === 0 ? "south" : "north");
  const whiteAtSouth = () => edgeOf(0) !== "north";
  function sqXY(name) {
    const f = FILES.indexOf(name[0]);
    const r = Number(name[1]) - 1;
    return whiteAtSouth() ? { x: LEFT + f * S, y: TOP + (7 - r) * S } : { x: LEFT + (7 - f) * S, y: TOP + r * S };
  }
  const faceOf = (color) => ROT[edgeOf(color)] ?? 0;
  // All pieces stand the same way: toward the edge the board faces (the turn-around button flips it; a remote
  // player's copy faces them).
  const pieceFacing = () => info?.rotation ?? 0;
  const colorOfPiece = (ch) => (ch === ch.toUpperCase() ? 0 : 1);

  function drawSquares() {
    let sq = "";
    for (let r = 1; r <= 8; r++)
      for (let f = 0; f < 8; f++) {
        const name = FILES[f] + r;
        const { x, y } = sqXY(name);
        sq += `<div class="ch-sq ${(f + r) % 2 ? "dark" : "light"}" data-sq="${name}" style="left:${x}px;top:${y}px;width:${S}px;height:${S}px"></div>`;
      }
    put(squares, sq);
    // File letters along both long edges, rank numbers along both short ones, each facing the nearer player.
    let c = "";
    for (let f = 0; f < 8; f++) {
      const bottom = sqXY(FILES[f] + (whiteAtSouth() ? 1 : 8));
      const top = sqXY(FILES[f] + (whiteAtSouth() ? 8 : 1));
      c += `<span style="left:${bottom.x + S / 2}px;top:${TOP + 8 * S + 11}px">${FILES[f]}</span>`;
      c += `<span style="left:${top.x + S / 2}px;top:${TOP - 11}px;transform:translate(-50%,-50%) rotate(180deg)">${FILES[f]}</span>`;
    }
    for (let r = 1; r <= 8; r++) {
      const at = sqXY(`a${r}`);
      const h = sqXY(`h${r}`);
      c += `<span style="left:${Math.min(at.x, h.x) - 11}px;top:${at.y + S / 2}px">${r}</span>`;
      c += `<span style="left:${Math.max(at.x, h.x) + S + 11}px;top:${at.y + S / 2}px;transform:translate(-50%,-50%) rotate(180deg)">${r}</span>`;
    }
    put(coords, c);
  }

  function mySeatToMove() {
    if (!view || view.result || info?.over || view.turnSeat === null || !ctx?.act) return false;
    return (info.controlSeats ?? []).includes(view.turnSeat);
  }

  const targetsFrom = (from) => view.legal.filter((u) => u.startsWith(from));

  function drawPieces() {
    put(pieces, Object.entries(view.pieces)
      .map(([sq, ch]) => {
        const { x, y } = sqXY(sq);
        const c = colorOfPiece(ch);
        const movable = mySeatToMove() && c === view.turn && targetsFrom(sq).length > 0;
        // A dropped piece stays where it was let go until its move comes back, then slides on from there.
        const held = dropAt?.from === sq ? `;transform:translate(${dropAt.shift.x}px,${dropAt.shift.y}px)` : "";
        return `<div class="ch-pc ${movable ? "movable" : ""} ${sq === selected ? "lifted" : ""}" data-sq="${sq}" style="left:${x}px;top:${y}px;width:${S}px;height:${S}px${held}">
          <div style="transform:rotate(${pieceFacing()}deg)">${pieceSvg(ch, S - 10)}</div></div>`;
      })
      .join(""));
  }

  function drawMarks() {
    let m = "";
    const mark = (sq, cls) => {
      const { x, y } = sqXY(sq);
      m += `<div class="ch-mark ${cls}" data-sq="${sq}" style="left:${x}px;top:${y}px;width:${S}px;height:${S}px"></div>`;
    };
    if (view.last) {
      mark(view.last.from, "last");
      mark(view.last.to, "last");
    }
    if (view.check) mark(view.check, "check");
    if (selected) {
      mark(selected, "sel");
      const seen = new Set();
      for (const u of targetsFrom(selected)) {
        const to = u.slice(2, 4);
        if (seen.has(to)) continue;
        seen.add(to);
        mark(to, view.pieces[to] ? "target take" : "target");
      }
    }
    put(marks, m);
  }

  // ----- the panels: one per colour, at that player's right hand, facing them -----
  const ENGINE_NAME = { own: "Own engine", stockfish: "Stockfish", lichess: "Lichess cloud", tablebase: "Lichess tablebase" };
  /** An evaluation from White's side: "+0.46", "−1.20", "#3" (White mates in 3), "#−3". */
  const evalText = (e) => ("mate" in e ? `#${e.mate < 0 ? "−" : ""}${Math.abs(e.mate)}` : `${e.cp < 0 ? "−" : "+"}${(Math.abs(e.cp) / 100).toFixed(2)}`);
  /** Which engine made an AI player's last move (E-041), with its depth, and its evaluation when the setting is on. */
  function engineLine(note) {
    if (!note) return "";
    const parts = [ENGINE_NAME[note.engine] ?? ""];
    if (note.depth) parts.push(`depth ${note.depth}`);
    if (view.showEval && note.eval) parts.push(`<b title="From White's side">${evalText(note.eval)}</b>`);
    return `<div class="ch-engine">${parts.join(" · ")}</div>`;
  }

  function panelHtml(color) {
    const v = view;
    const seat = v.seats[color];
    const name = v.names[seat] ?? (color ? "Black" : "White");
    const away = v.standIn.includes(seat);
    const ai = (info.players ?? []).find((p) => p.seat === seat)?.kind === "ai";
    const thinking = ai || (info.aiThinking ?? []).some((a) => a.seat === seat);
    const left = clockLeft(v, info, color, remainingMs);
    const running = v.clock && v.clock.running === color && !info.over;
    const low = left !== null && left < 20_000;
    const edge = materialEdge(v.captured, color);
    const took = (color === 0 ? v.captured.black : v.captured.white).split("").map((ch) => pieceSvg(ch, 30)).join("");
    let status = "";
    if (v.result) status = `<b>${esc(v.result.text)}</b>`;
    else if (info.over) status = "<b>The game has ended</b>"; // ended by the table (End game), without a result of its own
    else if (v.turn === color) status = v.check ? `<b class="ch-alert">Check!</b> ${away ? "The stand-in" : "You"} to move` : away ? "The stand-in is moving…" : thinking ? "Thinking…" : "Your move";
    else {
      const mover = v.seats[color ^ 1];
      status = `<span class="muted">${v.standIn.includes(mover) ? `The stand-in for ${esc(v.names[mover] ?? "")}` : esc(v.names[mover] ?? "")} to move</span>`;
    }
    const offer = v.drawOffer === null || v.result ? "" : v.drawOffer === seat ? `<div class="ch-offer">You offered a draw</div>` : `<div class="ch-offer">${esc(v.names[v.drawOffer] ?? "")} offers a draw: answer on your phone</div>`;
    const pairs = movePairs(v.sans, v.engines).slice(-4);
    const moves = pairs.length
      ? pairs.map((p) => `<span class="n">${p.n}.</span><span>${esc(p.w)}${sourceTag(p.we)}</span><span>${esc(p.b)}${sourceTag(p.be)}</span>`).join("")
      : `<span class="muted" style="grid-column:1/-1">No moves yet</span>`;
    return `<div class="ch-who"><span class="ch-dot" style="background:${playerColor(info, seat)}"></span>
        <span class="ch-name">${esc(name)}</span><span class="ch-color ${color ? "b" : "w"}">${color ? "Black" : "White"}</span></div>
      ${away ? `<div class="ch-standin">Stand-in (Elo ${esc(v.standInElo ?? "")}) plays for ${esc(name)}</div>` : ""}
      <div class="ch-clock ${running ? "running" : ""} ${low ? "low" : ""}">${left === null ? (v.clockMissing ? "<small>no clock on this table</small>" : "<small>no clock</small>") : clockText(left)}</div>
      <div class="ch-status">${status}</div>${ai ? engineLine(v.notes?.[seat]) : ""}${offer}
      <div class="ch-took">${took}${edge > 0 ? `<span class="ch-edge">+${edge}</span>` : ""}</div>
      <div class="ch-moves">${moves}</div>`;
  }

  function placePanels() {
    for (const el of box.querySelectorAll(".ch-panel")) {
      const color = Number(el.dataset.color);
      const edge = edgeOf(color);
      // South: bottom right of the table; north: top left, turned to face north.
      const south = edge !== "north";
      const cx = south ? W - 270 : 270;
      const cy = south ? H - 300 : 300;
      el.style.left = `${cx}px`;
      el.style.top = `${cy}px`;
      el.style.transform = `translate(-50%,-50%) rotate(${south ? 0 : 180}deg)`;
    }
  }

  function drawPanels() {
    for (const el of box.querySelectorAll(".ch-panel")) {
      const color = Number(el.dataset.color);
      // The frame of the player to move takes their lobby colour, as their seat plate does (not the brass of the board).
      el.style.setProperty("--pc", playerColor(info, view.seats?.[color]));
      el.classList.toggle("active", !view.result && !info.over && view.turn === color);
      put(el, panelHtml(color));
    }
  }

  // Only the clocks change between messages: redraw them often, the rest on updates.
  const tick = setInterval(() => {
    if (!view?.clock || view.result || info?.over) return;
    for (const el of box.querySelectorAll(".ch-panel")) {
      const color = Number(el.dataset.color);
      const left = clockLeft(view, info, color, remainingMs);
      const c = el.querySelector(".ch-clock");
      if (!c || left === null) continue;
      c.textContent = clockText(left);
      c.classList.toggle("low", left < 20_000);
    }
  }, 100);

  function draw() {
    drawSquares();
    drawPieces();
    drawMarks();
    placePanels();
    drawPanels();
    seatPlates(root, info, (seat) => {
      const c = view.seats.indexOf(seat);
      if (c < 0) return "watching";
      return c ? "Black" : "White";
    }, { active: view.result || info.over ? undefined : view.turnSeat });
  }

  // ----- moving by touch -----
  function showPromotion(from, to) {
    const color = view.turn;
    const { x, y } = sqXY(to);
    const letters = ["q", "r", "b", "n"].map((t) => (color === 0 ? t.toUpperCase() : t));
    promo.innerHTML = letters.map((ch) => `<button type="button" data-promo="${ch.toLowerCase()}" aria-label="Promote to ${ch}">${pieceSvg(ch, 70)}</button>`).join("");
    promo.hidden = false;
    // Over the promotion square, facing the player who moves.
    promo.style.left = `${x + S / 2}px`;
    promo.style.top = `${y + S / 2}px`;
    promo.style.transform = `translate(-50%,-50%) rotate(${faceOf(color)}deg)`;
    promo.dataset.from = from;
    promo.dataset.to = to;
  }

  async function send(u) {
    sending = true;
    selected = null;
    promo.hidden = true;
    const r = await ctx.act(view.turnSeat, "move", { uci: u });
    sending = false;
    if (gone || !view) return;
    if (!r.ok) draw();
  }

  box.addEventListener("pointerdown", (e) => {
    if (sending || !view) return;
    const pb = e.target.closest("[data-promo]");
    if (pb) {
      e.preventDefault();
      return void send(promo.dataset.from + promo.dataset.to + pb.dataset.promo);
    }
    if (!promo.hidden) {
      promo.hidden = true; // tapping beside the choice cancels it
      selected = null;
      return void draw();
    }
    if (!mySeatToMove()) return;
    const el = e.target.closest("[data-sq]");
    if (!el) {
      if (selected) {
        selected = null;
        drawPieces();
        drawMarks();
      }
      return;
    }
    const sq = el.dataset.sq;
    const ch = view.pieces[sq];
    if (selected && sq !== selected) {
      const options = targetsFrom(selected).filter((u) => u.slice(2, 4) === sq);
      if (options.length === 1) return void send(options[0]);
      if (options.length > 1) return void showPromotion(selected, sq);
    }
    const mine = ch && colorOfPiece(ch) === view.turn && targetsFrom(sq).length > 0;
    selected = mine && sq !== selected ? sq : null;
    drawPieces();
    drawMarks();
    if (mine) startDrag(e, sq);
  });

  // ----- drag and drop (E-035): a piece that may move follows the finger; dropped on a lit square it moves, anywhere
  // else it slides back with a "not a good move" sound. A tap without moving stays a tap (pick up, then tap a square).
  let drag = null; // { id, from, el, start, startClient, moved }
  let dropAt = null; // where a dropped piece lies, so its move starts there instead of sliding from its square again
  /** A pointer's position in the board's own 1920 × 1080 coordinates, whatever the platform's turning and scaling. */
  function toSurface(e) {
    const r = box.getBoundingClientRect();
    const deg = ((info?.rotation ?? 0) % 360 + 360) % 360;
    const a = (deg * Math.PI) / 180;
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const scale = r.width / (deg % 180 === 0 ? W : H);
    return { x: W / 2 + (dx * Math.cos(a) + dy * Math.sin(a)) / scale, y: H / 2 + (-dx * Math.sin(a) + dy * Math.cos(a)) / scale };
  }
  const pieceAt = (sq) => pieces.querySelector(`.ch-pc[data-sq="${sq}"]`);
  function startDrag(e, from) {
    e.preventDefault(); // no text selection or native drag, which would cancel this one
    drag = { id: e.pointerId, from, el: pieceAt(from), start: toSurface(e), startClient: { x: e.clientX, y: e.clientY }, moved: false };
    try {
      box.setPointerCapture(e.pointerId);
    } catch {
      /* a synthetic event */
    }
  }
  function snapBack(el) {
    if (!el?.isConnected) return;
    const from = el.style.transform || "none";
    el.style.transform = "";
    el.classList.remove("dragging");
    el.animate([{ transform: from }, { transform: "none" }], { duration: 220, easing: "cubic-bezier(.3,.7,.3,1)" });
  }
  box.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.startClient.x, e.clientY - drag.startClient.y) < 8) return;
      drag.moved = true;
      selected = drag.from; // its squares light up while it is carried
      drawPieces();
      drawMarks();
      drag.el = pieceAt(drag.from);
      if (!drag.el) return void (drag = null);
    }
    if (!drag.el.isConnected) drag.el = pieceAt(drag.from); // an update redrew the pieces
    const p = toSurface(e);
    drag.el?.style.setProperty("transform", `translate(${p.x - drag.start.x}px,${p.y - drag.start.y}px)`);
    drag.el?.classList.add("dragging");
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (!d.moved) return; // a tap: handled on pointerdown
    const p = toSurface(e);
    const to = e.type === "pointercancel" ? null : document.elementsFromPoint(e.clientX, e.clientY).find((x) => x.classList.contains("ch-sq"))?.dataset.sq ?? null;
    if (to === d.from) return snapBack(d.el); // put back where it was: no attempt
    const options = to && mySeatToMove() && !sending ? targetsFrom(d.from).filter((u) => u.slice(2, 4) === to) : [];
    if (options.length !== 1) {
      snapBack(d.el);
      if (options.length > 1) return showPromotion(d.from, to); // which piece, as for a tap
      playSound(info, "ch-bad", badSound);
      selected = null;
      drawPieces();
      drawMarks();
      return;
    }
    const o = sqXY(d.from);
    const shift = { x: p.x - d.start.x, y: p.y - d.start.y };
    dropAt = { from: d.from, to, shift, xy: { x: o.x + shift.x, y: o.y + shift.y } };
    const moveCount = view.moveCount;
    send(options[0]).then(() => {
      if (dropAt?.from !== d.from || view?.moveCount !== moveCount) return;
      dropAt = null; // refused: the held piece slides back to its square
      snapBack(pieceAt(d.from));
    });
  };
  box.addEventListener("pointerup", endDrag);
  box.addEventListener("pointercancel", endDrag);

  // ----- animation and sound for a move -----
  function animate(ev) {
    const el = pieces.querySelector(`.ch-pc[data-sq="${ev.to}"]`);
    if (!el) return;
    // A dropped piece settles from where it was let go, not from its old square.
    const a = dropAt && dropAt.from === ev.from && dropAt.to === ev.to ? dropAt.xy : sqXY(ev.from);
    dropAt = null;
    const b = sqXY(ev.to);
    el.animate([{ transform: `translate(${a.x - b.x}px,${a.y - b.y}px)` }, { transform: "none" }], { duration: 260, easing: "cubic-bezier(.3,.7,.3,1)" });
    if (ev.castle) {
      const rank = ev.to[1];
      const [rf, rt] = ev.to[0] === "g" ? ["h", "f"] : ["a", "d"];
      const rook = pieces.querySelector(`.ch-pc[data-sq="${rt}${rank}"]`);
      const ra = sqXY(rf + rank);
      const rb = sqXY(rt + rank);
      rook?.animate([{ transform: `translate(${ra.x - rb.x}px,${ra.y - rb.y}px)` }, { transform: "none" }], { duration: 260, delay: 120, easing: "ease-out", fill: "backwards" });
    }
  }

  return {
    update(v, events, i) {
      info = i;
      if (view && v.moveCount !== view.moveCount) {
        selected = null;
        promo.hidden = true;
      }
      view = v;
      if (selected && !targetsFrom(selected).length) selected = null;
      draw();
      for (const e of events) {
        if (e.name === "moved") {
          animate(e.data);
          playSound(info, "ch-move", moveSound(!!e.data.capture));
          if (e.data.check || e.data.mate) playSound(info, "ch-check", (c, t, o) => ping(c, o, t + 0.12, { freq: 1500, gain: 0.18, decay: 0.3 }));
        }
        if (e.name === "over") playSound(info, "ch-over", (c, t, o) => [0, 0.16, 0.32].forEach((d, k) => ping(c, o, t + 0.3 + d, { freq: [880, 1100, 1320][k], gain: 0.2, decay: 0.6 })));
        if (e.name === "drawOffered") playSound(info, "ch-offer", (c, t, o) => ping(c, o, t, { freq: 1200, gain: 0.15, decay: 0.3 }));
      }
    },
    destroy() {
      gone = true;
      clearInterval(tick);
    },
  };
}
