// Backgammon phone: the dice, the score and pip counts, and what the player does now: Roll, Double, Undo and Done, Take
// or Pass when doubled. Moves are made on the board; the phone also lists the moves the dice allow, as buttons, for a
// player who would rather move from here. Doubling and passing ask for confirmation first.
import { esc, playerColor, remainingMs } from "/shared/board-kit.js";
import { COLOR_NAME, ROLL_MS, diceState, dieHtml, moveText, ownNumber, setFace } from "/games/backgammon/assets/bg-ui.js";

export function mount(root, ctx) {
  root.innerHTML = `<style>
      .bg-row { display:flex; align-items:center; gap:10px }
      .bg-row .nm { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
      .bg-dot { width:12px; height:12px; border-radius:50%; flex:none; box-shadow:0 0 0 2px rgba(0,0,0,.35) }
      .bg-badge { font-size:.75em; padding:2px 8px; border-radius:99px; flex:none }
      .bg-badge.w { background:#f3ead8; color:#241a10 } .bg-badge.b { background:#2a2420; color:#e2d3b2; border:1px solid #e2d3b2 }
      .bg-sc { font-family:var(--mono); font-weight:600; flex:none }
      .bg-sc small { font-family:var(--text); font-weight:400; color:var(--ink-soft) }
      .bg-status { font-family:var(--display); font-size:1.3em; margin:2px 0 }
      .bg-dice { display:flex; gap:10px; justify-content:center; margin:10px 0 4px; min-height:56px; align-items:center }
      .bg-dice:empty { display:none }
      .bg-die { width:var(--s); height:var(--s); padding:calc(var(--s)*.14); box-sizing:border-box; border-radius:calc(var(--s)*.18);
        display:grid; grid-template:repeat(3,1fr)/repeat(3,1fr); place-items:center; background:linear-gradient(145deg,#fffdf6,#e4d9c2); box-shadow:0 3px 5px rgba(0,0,0,.4) }
      .bg-die i { width:62%; height:62%; border-radius:50%; background:#241a10 }
      .bg-die.used { opacity:.35; filter:grayscale(1) }
      .bg-acts { display:grid; grid-template-columns:1fr 1fr; gap:8px }
      .bg-acts button { min-height:48px }
      .bg-acts .wide { grid-column:1/-1 }
      .bg-moves { display:flex; flex-wrap:wrap; gap:6px; margin-top:6px }
      .bg-moves button { min-height:44px; min-width:64px; font-family:var(--mono) }
      .bg-plays { display:grid; gap:2px; font-size:.9em; max-height:34vh; overflow:auto; margin-top:6px }
      .bg-plays .dd { font-family:var(--mono); color:var(--ink-faint) }
      .bg-plays .me { color:var(--ink) } .bg-plays div { color:var(--ink-soft) }
      .bg-clock { font-family:var(--mono); color:var(--ink-soft); font-size:.9em }
      .bg-opt { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:8px }
      .bg-seg { display:flex; gap:4px; flex:none }
      .bg-seg button { min-height:40px; padding:0 12px }
      .bg-seg button.on { background:var(--brass,#d6a94a); border-color:var(--brass,#d6a94a); color:#1b1407; font-weight:700 }
      .bg-confirm { position:fixed; inset:0; z-index:50; display:grid; place-items:center; padding:16px; background:rgba(0,0,0,.6) }
      .bg-confirm[hidden] { display:none }
      .bg-confirm .box { width:100%; max-width:360px; padding:18px; border-radius:16px; background:var(--felt,#0f2a24); border:2px solid var(--brass,#d6a94a); box-shadow:0 16px 40px rgba(0,0,0,.6) }
      .bg-confirm h3 { margin:0 0 6px; font-family:var(--display); font-size:1.3em }
      .bg-confirm p { margin:0 0 14px; color:var(--ink-soft) }
      .bg-confirm .btns { display:grid; grid-template-columns:1fr 1fr; gap:8px }
      .bg-confirm .btns button { min-height:48px }
      .bg-confirm .danger { background:var(--ruby,#d2574a)!important; border-color:var(--ruby,#d2574a)!important; color:#fff!important; font-weight:700 }
    </style>
    <div class="card"><div class="bg-them"></div></div>
    <div class="card"><div class="eyebrow bg-head"></div><div class="bg-me" style="margin-top:4px"></div>
      <div class="bg-status"></div><div class="bg-dice"></div><div class="muted bg-hint" style="font-size:.85em"></div></div>
    <div class="card bg-actcard"><div class="bg-acts"></div><div class="bg-movecard"><div class="eyebrow" style="margin-top:10px">Or move from here</div><div class="bg-moves"></div></div></div>
    <div class="card"><div class="eyebrow bg-plays-head">This game</div><div class="bg-plays"></div></div>
    <div class="card bg-optcard" hidden><div class="eyebrow">Your options</div>
      <div class="bg-opt"><span>Undo</span><div class="bg-seg"><button type="button" data-opt="undo" data-val="all">All moves</button><button type="button" data-opt="undo" data-val="none">Off</button></div></div>
      <div class="bg-opt"><span>Roll for me</span><div class="bg-seg"><button type="button" data-opt="autoRoll" data-val="false">Off</button><button type="button" data-opt="autoRoll" data-val="true">On</button></div></div>
      <div class="muted" style="font-size:.85em;margin-top:8px">Undo off: your turn ends as soon as your dice are played. Roll for me: your dice are rolled as your turn begins, unless you could double first.</div></div>
    <div class="bg-confirm" hidden role="dialog" aria-modal="true" aria-labelledby="bg-confirm-title"><div class="box">
      <h3 id="bg-confirm-title"></h3><p></p>
      <div class="btns"><button type="button" data-confirm="no">Cancel</button><button type="button" data-confirm="yes"></button></div></div></div>`;

  let view = null;
  let info = null;
  let busy = false;
  let confirming = null; // "double" or "pass", waiting for the player's confirmation
  let gone = false;
  // A new roll tumbles until then (as on the board): its numbers and the moves it allows show once it lands.
  let rollingUntil = 0, tumbleTimer = null;
  const rolling = () => Date.now() < rollingUntil;
  const $ = (s) => root.querySelector(s);
  const nameOf = (color) => view.names[view.seats[color]] ?? COLOR_NAME[color];

  function playerRow(color) {
    const seat = view.seats[color];
    const standIn = view.standIn.includes(seat);
    const cube = view.cube.enabled && view.cube.owner === color ? ` <span class="bg-badge w">cube ${view.cube.value}</span>` : "";
    return `<div class="bg-row"><span class="bg-dot" style="background:${playerColor(info, seat)}"></span>
      <span class="nm">${esc(nameOf(color))}${seat === view.seat ? " (you)" : ""}${standIn ? ` <span class="muted">· stand-in</span>` : ""}</span>
      <span class="bg-badge ${color ? "b" : "w"}">${COLOR_NAME[color]}</span>${cube}
      <span class="bg-sc">${view.match.score[color]} <small>pts · ${view.pips[color]} pips</small></span></div>`;
  }

  function status() {
    const v = view;
    const me = v.color;
    if (v.result) return v.result.winner === me ? `<span style="color:var(--brass)">You win the match!</span>` : me === null ? esc(v.result.text) : "You lose the match";
    if (info.over) return "The match has ended";
    if (v.phase === "gameOver") {
      const g = v.lastGame;
      return g ? (g.winner === me ? `<span style="color:var(--brass)">You win game ${g.game}</span>` : `${esc(nameOf(g.winner))} wins game ${g.game}`) : "";
    }
    if (me === null) return `${esc(nameOf(v.turn))} ${v.phase === "roll" ? "to roll" : "to move"}`;
    if (v.phase === "double") return v.turn === me ? `You doubled: waiting for ${esc(nameOf(me ^ 1))}` : `<span style="color:var(--brass)">${esc(nameOf(me ^ 1))} doubles to ${v.cube.value * 2}</span>`;
    if (v.turn !== me) {
      const ai = (info.players ?? []).find((p) => p.seat === v.seats[me ^ 1])?.kind === "ai" || v.standIn.includes(v.seats[me ^ 1]);
      return `${esc(nameOf(me ^ 1))} ${ai ? "is thinking…" : v.phase === "roll" ? "to roll" : "is moving"}`;
    }
    if (v.phase === "roll") return `<span style="color:var(--brass)">Your roll</span>`;
    if (rolling()) return `<span style="color:var(--brass)">Rolling…</span>`;
    if (v.blocked) return "No move possible";
    if (v.canDone) return `<span style="color:var(--brass)">All moved: tap Done</span>`;
    return `<span style="color:var(--brass)">Your move</span>`;
  }

  function hint() {
    const v = view;
    if (v.result || info.over || v.color === null) return v.result?.text ?? "";
    if (v.phase === "gameOver") {
      const g = v.lastGame;
      const kind = { single: "", gammon: " (gammon)", backgammon: " (backgammon)", pass: " (double passed)" }[g?.kind ?? "single"];
      return `${g ? `${g.points} point${g.points === 1 ? "" : "s"}${kind}. ` : ""}Score ${v.match.score[v.color]}–${v.match.score[v.color ^ 1]}. The next game starts in a moment.${v.match.crawford ? " It is the Crawford game: no doubling." : ""}`;
    }
    if (v.turn !== v.color) return "";
    if (v.phase === "roll") return v.canDouble ? "Roll here or tap the dice on the board. Before you roll you may double." : v.match.crawford ? "Roll here or tap the dice on the board. No doubling in the Crawford game." : "Roll here or tap the dice on the board.";
    if (v.phase === "move" && !v.blocked && !v.canDone) {
      const done = v.turnMoves && v.turnMoves !== "(no move)" ? `So far: ${v.turnMoves}. ` : "";
      return `${done}On the board: tap a checker, then where it goes.${v.legal.some((m) => m.from === "bar") ? " Your checker on the bar comes in first." : ""}`;
    }
    return v.turnMoves && v.turnMoves !== "(no move)" ? `This turn: ${v.turnMoves}` : "";
  }

  function drawDice() {
    const v = view;
    const box = $(".bg-dice");
    if (!v.dice || v.phase === "roll" || v.phase === "double" || v.phase === "gameOver" || v.phase === "over") {
      box.innerHTML = v.phase === "roll" && v.turn === v.color && !v.result ? `<span class="muted">Your dice are in the cup</span>` : "";
      return;
    }
    if (rolling()) {
      // Two dice while they tumble (four would tell a doublet); the timer changes their faces in place.
      if (!box.querySelector(".tumbling")) box.innerHTML = `<span class="tumbling" style="display:contents">${dieHtml(3, { size: 52 })}${dieHtml(5, { size: 52 })}</span>`;
      return;
    }
    box.innerHTML = diceState(v.dice, v.remaining, v.phase).map((d) => dieHtml(d.n, { size: v.dice[0] === v.dice[1] ? 44 : 52, used: d.used })).join("");
  }

  function tumble() {
    rollingUntil = Date.now() + ROLL_MS;
    clearInterval(tumbleTimer);
    tumbleTimer = setInterval(() => {
      if (gone) return clearInterval(tumbleTimer);
      if (rolling()) {
        for (const d of root.querySelectorAll(".bg-dice .bg-die")) setFace(d, 1 + Math.floor(Math.random() * 6));
        return;
      }
      clearInterval(tumbleTimer);
      if (view) draw();
    }, 90);
  }

  function drawOptions() {
    const v = view;
    const card = $(".bg-optcard");
    card.hidden = v.color === null || !!v.result || !!info.over;
    if (card.hidden) return;
    const o = v.options?.[v.color] ?? { undo: "all", autoRoll: false };
    for (const b of card.querySelectorAll("[data-opt]")) {
      b.classList.toggle("on", String(o[b.dataset.opt]) === b.dataset.val);
      b.disabled = busy;
    }
  }

  function drawActions() {
    const v = view;
    const card = $(".bg-actcard");
    const box = $(".bg-acts");
    const moves = $(".bg-moves");
    const me = v.color;
    const answering = v.phase === "double" && v.turn !== me;
    const mine = (v.phase === "roll" || v.phase === "move") && v.turn === me && !v.standIn.includes(v.seat);
    const show = !v.result && !info.over && me !== null && (answering || mine);
    card.hidden = !show;
    $(".bg-movecard").hidden = !(show && v.phase === "move" && v.legal.length && !rolling());
    if (!show) return;
    const dis = busy ? "disabled" : "";
    if (answering) {
      box.innerHTML = `<button type="button" class="primary" data-act="take" ${dis}>Take (cube ${v.cube.value * 2})</button><button type="button" data-ask="pass" ${dis}>Pass</button>
        <div class="muted wide" style="font-size:.85em">Take: play on for ${v.cube.value * 2} points, and the cube is yours. Pass: give up this game for ${v.cube.value} point${v.cube.value === 1 ? "" : "s"}.</div>`;
    } else if (v.phase === "roll") {
      box.innerHTML = `<button type="button" class="primary ${v.cube.enabled ? "" : "wide"}" data-act="roll" ${dis}>Roll</button>${v.cube.enabled ? `<button type="button" data-ask="double" ${dis || (v.canDouble ? "" : "disabled")}>Double to ${v.cube.value * 2}</button>` : ""}`;
    } else {
      const wait = busy || rolling();
      const undo = v.options?.[me]?.undo !== "none";
      box.innerHTML = `${undo ? `<button type="button" data-act="undo" ${wait || !v.canUndo ? "disabled" : ""}>Undo</button>` : ""}<button type="button" class="primary ${undo ? "" : "wide"}" data-act="done" ${wait || !v.canDone ? "disabled" : ""}>Done</button>`;
    }
    // The moves the dice allow now, in the player's own numbering (one die each).
    if (v.phase === "move") {
      const seen = new Set();
      moves.innerHTML = v.legal
        .filter((m) => {
          const k = `${m.from}>${m.to}>${m.die}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .sort((a, b) => (ownNumber(b.from, me) === "bar" ? 99 : ownNumber(b.from, me)) - (ownNumber(a.from, me) === "bar" ? 99 : ownNumber(a.from, me)) || b.die - a.die)
        .map((m) => `<button type="button" data-from="${m.from}" data-to="${m.to}" data-die="${m.die}" ${dis}>${esc(moveText(m, me))}</button>`)
        .join("");
    }
  }

  function draw() {
    const v = view;
    const me = v.color ?? 0;
    $(".bg-them").innerHTML = playerRow((me ^ 1));
    $(".bg-me").innerHTML = playerRow(me);
    $(".bg-head").textContent = v.color === null ? "Backgammon · watching" : `You play ${COLOR_NAME[v.color].toLowerCase()} · ${v.match.length === 1 ? "one game" : `match to ${v.match.length}`} · game ${v.match.game}`;
    $(".bg-status").innerHTML = status();
    $(".bg-hint").textContent = hint();
    drawDice();
    drawActions();
    drawOptions();
    $(".bg-plays-head").textContent = `Game ${v.match.game}${v.games.length ? ` · games so far: ${v.games.map((g) => (g.winner === v.color ? "won" : "lost") + " " + g.points).join(", ")}` : ""}`;
    const list = $(".bg-plays");
    const seen = v.color ?? 0;
    list.innerHTML = v.plays.length
      ? v.plays.map((p) => `<div class="${p.color === seen ? "me" : ""}"><span class="dd">${p.dice[0]}-${p.dice[1]}</span> ${esc(p.color === v.color ? "You" : nameOf(p.color))}: ${esc(p.text)}${p.opening ? ' <span class="muted">(opening)</span>' : ""}</div>`).join("")
      : `<span class="muted">No moves yet</span>`;
    list.scrollTop = list.scrollHeight;
  }

  async function send(name, payload) {
    busy = true;
    drawActions();
    const r = await ctx.send(name, payload);
    busy = false;
    if (gone) return;
    if (!r.ok) ctx.toast?.(r.reason ?? "That didn't work");
    if (view) draw();
  }

  const ASK = {
    double: { title: "Double?", text: () => `${esc(nameOf(view.color ^ 1))} can take, and play on for ${view.cube.value * 2} points with the cube on their side, or pass and give you this game for ${view.cube.value}.`, yes: "Double", danger: false },
    pass: { title: "Pass the double?", text: () => `You give up this game: ${esc(nameOf(view.color ^ 1))} scores ${view.cube.value} point${view.cube.value === 1 ? "" : "s"}.`, yes: "Pass", danger: true },
  };
  const dialog = $(".bg-confirm");
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
  function onKey(e) {
    if (e.key === "Escape" && confirming) closeDialog();
  }
  document.addEventListener("keydown", onKey);

  root.addEventListener("click", (e) => {
    if (e.target === dialog) return closeDialog();
    const b = e.target.closest("button");
    if (!b || !view) return;
    if (b.dataset.confirm) {
      const action = confirming;
      closeDialog();
      if (b.dataset.confirm === "yes" && action && !busy) send(action);
      return;
    }
    if (busy || b.disabled) return;
    if (b.dataset.ask) return ask(b.dataset.ask);
    if (b.dataset.act) return void send(b.dataset.act);
    if (b.dataset.opt) return void send("options", { [b.dataset.opt]: b.dataset.opt === "autoRoll" ? b.dataset.val === "true" : b.dataset.val });
    if (b.dataset.from) {
      const spot = (x) => (x === "bar" || x === "off" ? x : Number(x));
      send("move", { from: spot(b.dataset.from), to: spot(b.dataset.to), die: Number(b.dataset.die) });
    }
  });

  // A turn time limit counts down in the hint line.
  const tick = setInterval(() => {
    if (!view || !view.turnMs || view.result || info?.over) return;
    const left = remainingMs(info, "turn");
    const el = $(".bg-hint");
    if (left === null || !el || view.actorSeat !== view.seat) return;
    el.textContent = `${hint()} ${Math.ceil(left / 1000)} s left.`.trim();
  }, 500);

  return {
    update(v, events, i) {
      const wasMine = view?.myTurn;
      view = v;
      info = i;
      if (events.some((e) => e.name === "rolled" || e.name === "opening")) tumble();
      draw();
      if (confirming && (v.result || i.over || (confirming === "double" && v.phase !== "roll") || (confirming === "pass" && v.phase !== "double"))) closeDialog();
      if (v.myTurn && !wasMine) ctx.vibrate?.(60);
      if (events.some((e) => e.name === "doubled" && e.data.by !== v.color)) ctx.vibrate?.([80, 60, 80]);
    },
    destroy() {
      gone = true;
      clearInterval(tick);
      clearInterval(tumbleTimer);
      document.removeEventListener("keydown", onKey);
    },
  };
}
