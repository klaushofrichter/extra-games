// Liar's Dice board: the bid in the middle, whose turn it is with a countdown, the bids so far, and after a call
// every cup laid open with the dice that count lit up. Seat plates show how many dice each player has left.
// The cups themselves never appear here while bidding: the board only gets the public view.
import { esc, html, ping, playerColor, playSound, remainingMs, seatPlates, useStyles } from "/shared/board-kit.js";
import { bidText, counts, die, revealSound, shakeSound } from "/games/liars-dice/assets/dice.js";

export function mount(root) {
  useStyles("/games/liars-dice/board.css");
  const box = html(`<div class="ld-board"><div class="ld-felt"></div>
    <div class="ld-center">
      <div class="ld-round eyebrow"></div>
      <div class="ld-bid"></div>
      <div class="ld-turn"></div>
      <div class="ld-clock"></div>
      <div class="ld-history"></div>
      <div class="ld-reveal"></div>
    </div></div>`);
  root.appendChild(box);
  const center = box.querySelector(".ld-center");
  let info = null;
  let view = null;

  const name = (seat) => view?.players.find((p) => p.seat === seat)?.name ?? "?";

  const clock = () => {
    const el = center.querySelector(".ld-clock");
    const ms = view?.phase === "bidding" && view.turnMs ? remainingMs(info, "turn") : null;
    if (ms === null) return void (el.innerHTML = "");
    const s = Math.ceil(ms / 1000);
    const frac = Math.max(0, Math.min(1, ms / view.turnMs));
    const color = s <= 5 ? "var(--ruby, #e8735f)" : "var(--brass)";
    el.innerHTML = `<div class="ld-bar"><div style="width:${(frac * 100).toFixed(1)}%;background:${color}"></div></div><span style="color:${color}">${s} s</span>`;
  };
  const tick = setInterval(clock, 250);

  function draw() {
    const v = view;
    const total = `${v.totalDice} ${v.totalDice === 1 ? "die" : "dice"} on the table${v.onesWild ? " · ones are wild" : ""}`;
    center.querySelector(".ld-round").textContent = v.phase === "over" ? "Game over" : `Round ${v.round} · ${total}`;

    // The bid: big, with who made it.
    const b = v.reveal?.bid ?? v.bid;
    center.querySelector(".ld-bid").innerHTML = b
      ? `<span class="ld-q">${b.quantity} ×</span>${die(b.face, { size: 120 })}<div class="ld-by" style="color:${playerColor(info, b.seat)}">${esc(name(b.seat))} bids ${esc(bidText(b))}</div>`
      : `<div class="ld-by muted">Waiting for the opening bid</div>`;

    const turn = center.querySelector(".ld-turn");
    if (v.phase === "bidding") turn.innerHTML = `<span style="color:${playerColor(info, v.turn)}">${esc(name(v.turn))}</span> ${v.bid ? "raises or calls" : "opens"}`;
    else if (v.phase === "over") turn.innerHTML = `<span style="color:${playerColor(info, v.winner)}">${esc(name(v.winner))}</span> wins`;
    else turn.textContent = "";

    // Earlier bids of this round, oldest first, the current one last.
    const earlier = v.phase === "bidding" ? v.bids.slice(0, -1) : [];
    center.querySelector(".ld-history").innerHTML = earlier.length
      ? earlier.map((x) => `<span class="chip" style="border-color:${playerColor(info, x.seat)}">${esc(name(x.seat))}: ${x.quantity} × ${x.face}</span>`).join("")
      : "";

    // After a call: every cup, the dice that count lit.
    const r = v.reveal;
    center.querySelector(".ld-reveal").innerHTML = r
      ? `<div class="ld-verdict ${r.bidHeld ? "held" : "lie"}">${esc(name(r.caller))} ${r.auto ? "ran out of time and called" : "called"} it: ${r.matched} ${r.matched === 1 ? "die counts" : "dice count"}. ${
          r.bidHeld ? `The bid holds. ${esc(name(r.loser))} loses a die.` : `A lie! ${esc(name(r.loser))} loses a die.`
        }</div>
        <div class="ld-cups">${Object.entries(r.cups).map(([seat, cup]) => `<div class="ld-cup"><span style="color:${playerColor(info, Number(seat))}">${esc(name(Number(seat)))}</span>
          <span class="ld-dice">${cup.map((d) => {
            const lit = counts(d, r.bid.face, v.onesWild);
            return die(d, { size: 44, hl: lit, dim: !lit, wild: v.onesWild && d === 1 && r.bid.face !== 1 });
          }).join("")}</span></div>`).join("")}</div>`
      : "";
    clock();

    const bySeat = Object.fromEntries(v.players.map((p) => [p.seat, p]));
    seatPlates(
      root,
      info,
      (seat) => {
        const p = bySeat[seat];
        if (!p) return "watching";
        if (p.out) return "out";
        return `<span class="ld-pips">${"●".repeat(p.dice)}</span> ${p.dice} ${p.dice === 1 ? "die" : "dice"}`;
      },
      { active: v.phase === "bidding" ? v.turn : undefined },
    );
  }

  return {
    update(v, events, i) {
      info = i;
      view = v;
      center.style.transform = `translate(-50%,-50%) rotate(${i.rotation}deg)`;
      draw();
      if (events.some((e) => e.name === "round") || (events.length === 0 && v.round === 1 && v.bids.length === 0 && !v.reveal)) playSound(info, "ld-shake", (c, t, o) => shakeSound(c, t, o, ping));
      if (events.some((e) => e.name === "called")) {
        playSound(info, "ld-reveal", (c, t, o) => revealSound(c, t, o, ping));
        requestAnimationFrame(() => center.querySelectorAll(".ld-cup .ld-die").forEach((el, k) => el.animate([{ transform: "translateY(-30px) rotate(-20deg)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 380, delay: k * 25, easing: "cubic-bezier(.2,.8,.3,1.2)", fill: "backwards" })));
      }
      if (events.some((e) => e.name === "bid")) center.querySelector(".ld-bid .ld-die")?.animate([{ transform: "scale(.6) rotate(-90deg)" }, { transform: "none" }], { duration: 300, easing: "ease-out" });
    },
    destroy() {
      clearInterval(tick);
    },
  };
}
