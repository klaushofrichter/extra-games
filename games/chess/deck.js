// Chess phone: moves are made on the board, so the phone shows both clocks, whose move it is, the moves so far, and
// offers a draw or resignation, each after a confirmation dialog.
import { esc, playerColor, remainingMs } from "/shared/board-kit.js";
import { clockLeft, clockText, materialEdge, movePairs, pieceSvg } from "/games/chess/assets/pieces.js";

export function mount(root, ctx) {
  root.innerHTML = `<style>
      .ch-row { display:flex; align-items:center; gap:10px }
      .ch-row .nm { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:1.05em }
      .ch-dot { width:12px; height:12px; border-radius:50%; flex:none; box-shadow:0 0 0 2px rgba(0,0,0,.35) }
      .ch-badge { font-size:.75em; padding:2px 8px; border-radius:99px; flex:none }
      .ch-badge.w { background:#f3ead8; color:#241a10 } .ch-badge.b { background:#2a2420; color:#e2d3b2; border:1px solid #e2d3b2 }
      .ch-clk { font-family:var(--mono); font-weight:600; font-size:1.5em; padding:2px 10px; border-radius:10px; background:rgba(0,0,0,.3); color:var(--ink-soft) }
      .ch-clk.big { font-size:2.6em; display:inline-block; min-width:5ch }
      .ch-clk.run { color:var(--ink); background:rgba(214,169,74,.18) }
      .ch-clk.low { color:var(--ruby,#d2574a) }
      .ch-took { display:flex; align-items:center; min-height:22px; margin-top:4px; flex-wrap:wrap }
      .ch-took svg { margin-right:-5px }
      .ch-took .edge { margin-left:10px; font-size:.8em; color:var(--ink-soft) }
      .ch-status { font-family:var(--display); font-size:1.35em; margin:2px 0 }
      .ch-acts { display:grid; grid-template-columns:1fr 1fr; gap:8px }
      .ch-acts button { min-height:48px }
      .ch-confirm { position:fixed; inset:0; z-index:50; display:grid; place-items:center; padding:16px; background:rgba(0,0,0,.6) }
      .ch-confirm[hidden] { display:none }
      .ch-confirm .box { width:100%; max-width:360px; padding:18px; border-radius:16px; background:var(--felt,#0f2a24); border:2px solid var(--brass,#d6a94a); box-shadow:0 16px 40px rgba(0,0,0,.6) }
      .ch-confirm h3 { margin:0 0 6px; font-family:var(--display); font-size:1.3em }
      .ch-confirm p { margin:0 0 14px; color:var(--ink-soft) }
      .ch-confirm .btns { display:grid; grid-template-columns:1fr 1fr; gap:8px }
      .ch-confirm .btns button { min-height:48px }
      .ch-confirm .danger { background:var(--ruby,#d2574a)!important; border-color:var(--ruby,#d2574a)!important; color:#fff!important; font-weight:700 }
      .ch-moves { display:grid; grid-template-columns:3ch 1fr 1fr; gap:3px 10px; font-family:var(--mono); max-height:40vh; overflow:auto }
      .ch-moves .n { color:var(--ink-faint) }
      .ch-moves .cur { color:var(--brass); font-weight:700 }
    </style>
    <div class="card"><div class="ch-them"></div><div class="ch-took ch-them-took"></div></div>
    <div class="card"><div class="eyebrow ch-head"></div><div class="ch-status"></div><div class="ch-me" style="margin-top:6px"></div>
      <div class="ch-took ch-me-took"></div><div class="muted ch-hint" style="font-size:.8em;margin-top:6px"></div></div>
    <div class="card ch-actcard"><div class="ch-acts"></div></div>
    <div class="card"><div class="eyebrow">Moves</div><div class="ch-moves" style="margin-top:6px"></div></div>
    <div class="ch-confirm" hidden role="dialog" aria-modal="true" aria-labelledby="ch-confirm-title"><div class="box">
      <h3 id="ch-confirm-title"></h3><p></p>
      <div class="btns"><button type="button" data-confirm="no">Cancel</button><button type="button" data-confirm="yes"></button></div></div></div>`;

  let view = null;
  let info = null;
  let busy = false;
  let confirming = null; // the action waiting for the player's confirmation: "offerDraw" or "resign"
  let gone = false;
  const $ = (s) => root.querySelector(s);

  const nameOf = (seat) => view.names[seat] ?? "?";

  function clockHtml(color, big) {
    const left = clockLeft(view, info, color, remainingMs);
    if (left === null) return "";
    const run = view.clock.running === color;
    return `<span class="ch-clk ${big ? "big" : ""} ${run ? "run" : ""} ${left < 20_000 ? "low" : ""}" data-clock="${color}">${clockText(left)}</span>`;
  }

  /** A player's line: colour dot, name, White/Black, and their clock (your own on a line of its own, large). */
  function playerRow(color, big) {
    const seat = view.seats[color];
    const standIn = view.standIn.includes(seat);
    const line = `<div class="ch-row"><span class="ch-dot" style="background:${playerColor(info, seat)}"></span>
      <span class="nm">${esc(nameOf(seat))}${seat === view.seat ? " (you)" : ""}${standIn ? ` <span class="muted">· stand-in</span>` : ""}</span>
      <span class="ch-badge ${color ? "b" : "w"}">${color ? "Black" : "White"}</span>${big ? "" : clockHtml(color, false)}</div>`;
    return big && view.clock ? `${line}<div style="text-align:center;margin-top:8px">${clockHtml(color, true)}</div>` : line;
  }

  function took(color) {
    const lost = color === 0 ? view.captured.black : view.captured.white;
    const edge = materialEdge(view.captured, color);
    return lost.split("").map((ch) => pieceSvg(ch, 22)).join("") + (edge > 0 ? `<span class="edge">+${edge}</span>` : "");
  }

  function drawActions() {
    const v = view;
    const box = $(".ch-acts");
    $(".ch-actcard").hidden = v.result || v.color === null;
    if (v.result || v.color === null) return;
    const opp = v.seats[v.color ^ 1];
    const offered = v.drawOffer === opp;
    const mine = v.drawOffer === v.seat;
    const resign = `<button type="button" class="ch-resign" data-ask="resign" ${busy ? "disabled" : ""}>Resign</button>`;
    box.innerHTML = offered
      ? `<button type="button" class="primary" data-act="acceptDraw" ${busy ? "disabled" : ""}>Accept draw</button><button type="button" data-act="declineDraw" ${busy ? "disabled" : ""}>Decline</button>
         <div class="muted" style="grid-column:1/-1;font-size:.85em">${esc(nameOf(opp))} offers a draw. Moving on the board also declines it.</div>${resign.replace("<button", '<button style="grid-column:1/-1"')}`
      : `<button type="button" data-ask="offerDraw" ${busy || mine || v.moveCount < 2 ? "disabled" : ""}>${mine ? "Draw offered" : "Offer a draw"}</button>${resign}`;
  }

  function draw() {
    const v = view;
    if (v.color === null) {
      $(".ch-head").textContent = "Chess";
      $(".ch-status").textContent = "You're watching";
      $(".ch-them").innerHTML = playerRow(1, false);
      $(".ch-me").innerHTML = playerRow(0, false);
      $(".ch-them-took").innerHTML = took(1);
      $(".ch-me-took").innerHTML = took(0);
    } else {
      $(".ch-them").innerHTML = playerRow(v.color ^ 1, false);
      $(".ch-them-took").innerHTML = took(v.color ^ 1);
      $(".ch-me").innerHTML = playerRow(v.color, true);
      $(".ch-me-took").innerHTML = took(v.color);
      $(".ch-head").textContent = `You play ${v.color ? "black" : "white"}${v.timeControl && v.timeControl !== "no clock" ? ` · ${v.timeControl}` : ""}`;
      const s = $(".ch-status");
      if (v.result) {
        const won = v.result.winner === v.color;
        s.innerHTML = v.result.winner === null ? "Draw" : won ? `<span style="color:var(--brass)">You win!</span>` : "You lose";
      } else if (v.myTurn) s.innerHTML = `<span style="color:var(--brass)">${v.check ? "Check! " : ""}Your move</span>`;
      else {
        const ai = (info.players ?? []).find((p) => p.seat === v.turnSeat)?.kind === "ai" || v.standIn.includes(v.turnSeat);
        s.textContent = ai ? `${nameOf(v.turnSeat)} is thinking…` : `${nameOf(v.turnSeat)} to move`;
      }
    }
    $(".ch-hint").textContent = v.result ? v.result.text : v.clockMissing ? "This table's software is too old for chess clocks: the game is played without." : v.color === null ? "" : "Move on the board: tap a piece, then where it goes.";
    drawActions();
    const pairs = movePairs(v.sans);
    const last = v.sans.length - 1;
    const list = $(".ch-moves");
    list.innerHTML = pairs.length
      ? pairs.map((p, k) => `<span class="n">${p.n}.</span><span class="${2 * k === last ? "cur" : ""}">${esc(p.w)}</span><span class="${2 * k + 1 === last ? "cur" : ""}">${esc(p.b)}</span>`).join("")
      : `<span class="muted" style="grid-column:1/-1">No moves yet</span>`;
    list.scrollTop = list.scrollHeight;
  }

  async function send(name) {
    busy = true;
    drawActions();
    const r = await ctx.send(name);
    busy = false;
    if (gone) return;
    if (!r.ok) ctx.toast?.(r.reason ?? "That didn't work");
    if (view) drawActions();
  }

  // Offering a draw and resigning can't be taken back, so both ask first.
  const ASK = {
    offerDraw: { title: "Offer a draw?", text: () => `${esc(nameOf(view.seats[view.color ^ 1]))} can accept or decline. Your offer stands until they answer or move.`, yes: "Offer draw", danger: false },
    resign: { title: "Resign the game?", text: () => `${esc(nameOf(view.seats[view.color ^ 1]))} wins. This can't be undone.`, yes: "Resign", danger: true },
  };
  const dialog = $(".ch-confirm");
  function ask(action) {
    const a = ASK[action];
    confirming = action;
    dialog.querySelector("h3").textContent = a.title;
    dialog.querySelector("p").innerHTML = a.text();
    const yes = dialog.querySelector("[data-confirm=yes]");
    yes.textContent = a.yes;
    yes.className = a.danger ? "danger" : "primary";
    dialog.hidden = false;
    dialog.querySelector("[data-confirm=no]").focus();
  }
  function closeDialog() {
    confirming = null;
    dialog.hidden = true;
  }
  document.addEventListener("keydown", onKey);
  function onKey(e) {
    if (e.key === "Escape" && confirming) closeDialog();
  }

  root.addEventListener("click", (e) => {
    if (e.target === dialog) return closeDialog(); // tapping beside the box cancels
    const b = e.target.closest("button");
    if (!b || !view) return;
    if (b.dataset.confirm) {
      const action = confirming;
      closeDialog();
      if (b.dataset.confirm === "yes" && action && !busy) send(action);
      return;
    }
    if (busy) return;
    if (b.dataset.ask) return ask(b.dataset.ask);
    if (b.dataset.act) send(b.dataset.act);
  });

  const tick = setInterval(() => {
    if (!view?.clock || view.result) return;
    for (const el of root.querySelectorAll("[data-clock]")) {
      const c = Number(el.dataset.clock);
      const left = clockLeft(view, info, c, remainingMs);
      el.textContent = clockText(left);
      el.classList.toggle("low", left < 20_000);
    }
  }, 100);

  return {
    update(v, events, i) {
      const wasMyTurn = view?.myTurn;
      view = v;
      info = i;
      draw();
      // The question no longer applies once the game is over (or a draw was already agreed).
      if (confirming && (v.result || (confirming === "offerDraw" && v.drawOffer === v.seat))) closeDialog();
      if (v.myTurn && !wasMyTurn) ctx.vibrate?.(60);
      if (events.some((e) => e.name === "drawOffered" && e.data.by !== v.seat)) ctx.vibrate?.([80, 60, 80]);
    },
    destroy() {
      gone = true;
      clearInterval(tick);
      document.removeEventListener("keydown", onKey);
    },
  };
}
