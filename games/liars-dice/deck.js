// Liar's Dice phone: your own cup (nobody else's), the bid to beat, and on your turn a bid builder (how many,
// which face) plus "Liar!". The builder starts at the cheapest raise on the face you hold most.
import { esc, remainingMs } from "/shared/board-kit.js";
import { bidText, counts, die } from "/games/liars-dice/assets/dice.js";

const counted = (cup, face, wild) => cup.filter((d) => counts(d, face, wild)).length;
const faces = (wild) => (wild ? [2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6]);
const minFor = (bid, face) => (!bid ? 1 : face > bid.face ? bid.quantity : bid.quantity + 1);

export function mount(root, ctx) {
  root.innerHTML = `<style>
      .ld-cupline { display:flex; gap:6px; justify-content:center; flex-wrap:wrap; margin:6px 0 2px }
      .ld-faces { display:grid; grid-template-columns:repeat(6,1fr); gap:6px }
      .ld-faces button { padding:4px 0; min-height:48px; display:grid; place-items:center }
      .ld-faces button.picked { outline:3px solid var(--brass); outline-offset:1px }
      .ld-faces button:disabled { opacity:.35 }
      .ld-qty { display:flex; align-items:center; justify-content:center; gap:14px; margin:10px 0 }
      .ld-qty button { width:52px; min-height:48px; font-size:1.4em }
      .ld-qty .n { font-family:var(--display); font-size:2.2em; min-width:2.2ch; text-align:center }
      .ld-actions { display:grid; grid-template-columns:3fr 2fr; gap:8px }
      .ld-actions button { min-height:52px }
      .ld-liar { background:var(--ruby,#d2574a)!important; border-color:var(--ruby,#d2574a)!important; color:#fff!important; font-weight:700 }
      .ld-bar { height:6px; border-radius:3px; background:rgba(255,255,255,.12); overflow:hidden; margin-top:6px }
      .ld-bar > div { height:100%; transition:width .25s linear }
    </style>
    <div class="card"><div class="eyebrow ld-round"></div><div class="display ld-status" style="font-size:1.3em;margin-top:2px"></div>
      <div class="ld-clock"></div></div>
    <div class="card"><div class="eyebrow">Your cup</div><div class="ld-cupline ld-cup"></div><div class="muted center ld-cupnote" style="font-size:.8em"></div></div>
    <div class="card ld-bidcard"><div class="eyebrow">Bid to beat</div><div class="ld-current" style="display:flex;align-items:center;gap:10px;margin-top:4px"></div></div>
    <div class="card ld-builder" hidden>
      <div class="ld-faces"></div>
      <div class="ld-qty"><button type="button" data-q="-1" aria-label="One die fewer">−</button><span class="n"></span><button type="button" data-q="1" aria-label="One die more">+</button></div>
      <div class="ld-actions"><button type="button" class="primary ld-bid"></button><button type="button" class="ld-liar">Liar!</button></div>
      <div class="muted center ld-hint" style="font-size:.8em;margin-top:6px;min-height:1.2em"></div>
    </div>
    <div class="card ld-result" hidden></div>`;

  let view = null;
  let info = null;
  let pick = { quantity: 1, face: 6 };
  let busy = false;
  // The answer to a bid can arrive after the game ended and this UI was taken down: never draw after that.
  let gone = false;

  const $ = (s) => root.querySelector(s);

  /** Start the builder at the cheapest raise on the face this player holds most (ties: the higher face). */
  function preset(v) {
    const best = faces(v.onesWild).reduce((a, f) => (counted(v.myDice, f, v.onesWild) >= counted(v.myDice, a, v.onesWild) ? f : a));
    pick = { face: best, quantity: minFor(v.bid, best) };
  }

  function drawBuilder() {
    const v = view;
    $(".ld-faces").style.gridTemplateColumns = `repeat(${faces(v.onesWild).length}, 1fr)`;
    $(".ld-faces").innerHTML = faces(v.onesWild)
      .map((f) => `<button type="button" data-face="${f}" class="${f === pick.face ? "picked" : ""}" aria-label="Face ${f}">${die(f, { size: 36 })}</button>`)
      .join("");
    $(".ld-qty .n").textContent = pick.quantity;
    const legal = pick.quantity <= v.totalDice && (!v.bid || pick.quantity > v.bid.quantity || (pick.quantity === v.bid.quantity && pick.face > v.bid.face));
    const b = $(".ld-bid");
    b.textContent = `Bid ${bidText(pick)}`;
    b.disabled = !legal || busy;
    $(".ld-liar").disabled = !v.bid || busy;
    $(".ld-qty [data-q='-1']").disabled = pick.quantity <= 1;
    $(".ld-qty [data-q='1']").disabled = pick.quantity >= v.totalDice;
    const mine = counted(v.myDice, pick.face, v.onesWild);
    $(".ld-hint").textContent = !legal ? `Raise: more than ${v.bid.quantity}, or ${v.bid.quantity} of a higher face` : `You hold ${mine} of them${v.onesWild && pick.face !== 1 ? " (wild ones included)" : ""}`;
  }

  async function send(name, payload) {
    busy = true;
    drawBuilder();
    const r = await ctx.send(name, payload);
    busy = false;
    if (gone) return;
    if (!r.ok) ctx.toast?.(r.reason ?? "That didn't work");
    if (view?.myTurn) drawBuilder();
  }

  root.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || !view?.myTurn) return;
    if (b.dataset.face) {
      pick.face = Number(b.dataset.face);
      pick.quantity = Math.max(pick.quantity, minFor(view.bid, pick.face));
    } else if (b.dataset.q) pick.quantity = Math.min(view.totalDice, Math.max(1, pick.quantity + Number(b.dataset.q)));
    else if (b.classList.contains("ld-bid")) return void send("bid", { ...pick });
    else if (b.classList.contains("ld-liar")) return void send("liar");
    drawBuilder();
  });

  const clock = () => {
    const el = $(".ld-clock");
    const ms = view?.phase === "bidding" && view.turnMs ? remainingMs(info, "turn") : null;
    if (ms === null) return void (el.innerHTML = "");
    const s = Math.ceil(ms / 1000);
    const color = s <= 5 ? "var(--ruby, #e8735f)" : "var(--brass)";
    el.innerHTML = `<div class="muted" style="display:flex;justify-content:space-between;font-size:.8em;margin-top:4px"><span>${view.myTurn ? (view.bid ? "Then the table calls for you" : "Then the table bids for you") : ""}</span><span style="color:${color};font-family:var(--mono)">${s} s</span></div>
      <div class="ld-bar"><div style="width:${(100 * Math.max(0, Math.min(1, ms / view.turnMs))).toFixed(1)}%;background:${color}"></div></div>`;
  };
  const tick = setInterval(clock, 250);

  return {
    update(v, events, i) {
      const wasMyTurn = view?.myTurn;
      const name = (seat) => v.players.find((p) => p.seat === seat)?.name ?? "?";
      view = v;
      info = i;
      if (v.myTurn && !wasMyTurn) {
        preset(v);
        ctx.vibrate?.(80);
      }
      $(".ld-round").textContent = v.phase === "over" ? "Game over" : `Round ${v.round} · ${v.totalDice} dice on the table`;
      $(".ld-status").innerHTML =
        v.phase === "over" ? (v.winner === v.seat ? "You win!" : `${esc(name(v.winner))} wins`)
        : v.out ? "You're out of dice"
        : v.phase === "reveal" ? "Cups are up"
        : v.myTurn ? `<span style="color:var(--brass)">Your turn</span>`
        : `${esc(name(v.turn))} is thinking…`;

      // The cup: real dice while you have them; during the reveal, the ones that counted are lit.
      const face = v.reveal?.bid.face;
      $(".ld-cup").innerHTML = v.out
        ? `<span class="muted">Watch the board: you can still see every reveal there.</span>`
        : v.myDice.map((d) => die(d, { size: 46, hl: face !== undefined && counts(d, face, v.onesWild), wild: v.onesWild && d === 1 })).join("");
      $(".ld-cupnote").textContent = v.out ? "" : v.onesWild ? "Ones are wild: they count as any face." : "";

      const b = v.reveal?.bid ?? v.bid;
      $(".ld-current").innerHTML = b
        ? `<span class="display" style="font-size:1.8em">${b.quantity} ×</span>${die(b.face, { size: 44 })}<span class="muted">${esc(name(b.seat))}${b.seat === v.seat ? " (you)" : ""}</span>`
        : `<span class="muted">No bid yet${v.myTurn ? ": you open" : ""}</span>`;

      $(".ld-builder").hidden = !v.myTurn;
      if (v.myTurn) drawBuilder();

      const r = v.reveal;
      const res = $(".ld-result");
      res.hidden = !r;
      if (r) {
        const me = r.loser === v.seat ? "You lose a die." : `${esc(name(r.loser))} loses a die.`;
        res.innerHTML = `<div class="eyebrow">${esc(name(r.caller))} called ${esc(bidText(r.bid))}</div>
          <div style="margin-top:4px;font-size:1.1em">${r.matched} on the table: ${r.bidHeld ? "the bid holds" : "it was a lie"}.</div><div class="muted">${me}</div>`;
      }
      if (events.some((e) => e.name === "called" && e.data.loser === v.seat)) ctx.vibrate?.([120, 60, 120]);
      clock();
    },
    destroy() {
      gone = true;
      clearInterval(tick);
    },
  };
}
