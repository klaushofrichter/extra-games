// Last Card board (E-023). The draw pile and the discard pile in the middle, ringed in the colour to play, with arrows
// that turn the way play goes. Cards come in at a player's edge of the board while they push them off their phone
// (games-service's sling, D-189: the back until the move is made), then fly face up onto the pile; drawn cards fly
// from the draw pile to the player. A player down to one card gets a "Last card!" next to their plate, with a sound.
import { esc, playSound, remainingMs, seatPlates, useStyles } from "/shared/board-kit.js";
import { slingBoard } from "/shared/sling.js";
import { cardBack, cardFace, FILL, SPEEDS } from "/games/last-card/assets/cards.js";
import { SOUNDS } from "/games/last-card/assets/sounds.js";

const CW = 128, CH = 192;
const PILE = { x: 1030, y: 530 };
const DRAW = { x: 810, y: 530 };
const NAMES = { r: "Red", y: "Yellow", g: "Green", b: "Blue" };

export function mount(root, ctx) {
  useStyles("/games/last-card/board.css");
  root.innerHTML = `<div class="lc-root">
    <svg class="lc-dir" viewBox="-300 -300 600 600" aria-hidden="true"><g class="lc-spin">
      <path d="M -250 -40 A 254 254 0 0 1 40 -250" /><path d="M 30 -268 L 52 -248 L 28 -228" />
      <path d="M 250 40 A 254 254 0 0 1 -40 250" /><path d="M -30 268 L -52 248 L -28 228" /></g></svg>
    <div class="lc-ring"></div>
    <div class="lc-draw"><div class="lc-stack">${cardBack(CW, CH)}</div><div class="lc-stack">${cardBack(CW, CH)}</div><div class="lc-stack">${cardBack(CW, CH)}</div><div class="lc-left"></div></div>
    <div class="lc-pile"></div>
    <div class="lc-called"></div>
    <div class="lc-fans"></div>
    <div class="lc-bursts"></div>
    <div class="lc-panel" hidden></div></div>`;
  const box = root.querySelector(".lc-root");
  const $ = (s) => root.querySelector(s);
  let view = null, info = null, flights = 0, gone = false, panelTimer = 0;
  const landing = new Set();
  const speed = () => SPEEDS[info?.prefs?.anim] ?? 1;
  const sound = (name) => playSound(info, name, SOUNDS[name]);
  const sling = slingBoard(box, {
    render: (c, { back }) => (back ? cardBack(CW, CH) : cardFace(c, CW, CH, { color: c.color })),
    size: { w: CW, h: CH },
    speed,
  });

  function renderPile() {
    const pile = (view?.pile ?? []).filter((c) => !landing.has(c.id));
    $(".lc-pile").innerHTML = pile
      .map((c) => `<div style="transform:translate(${PILE.x + c.dx - CW / 2}px,${PILE.y + c.dy - CH / 2}px) rotate(${c.angle}deg)">${cardFace(c, CW, CH, { color: c.color })}</div>`)
      .join("");
    const shown = pile.at(-1);
    const color = shown ? shown.color : view?.color;
    $(".lc-ring").style.setProperty("--c", FILL[color] ?? "#fff");
    // A wild card says which colour it called, facing the board's front.
    $(".lc-called").innerHTML = shown && shown.c === "w" ? `<span style="--c:${FILL[shown.color]}">${NAMES[shown.color]}</span>` : "";
    $(".lc-called").style.transform = `translate(${PILE.x}px, ${PILE.y}px) rotate(${info?.rotation ?? 0}deg) translateY(${CH / 2 + 46}px)`;
  }

  function renderPanel() {
    const v = view, p = $(".lc-panel");
    const show = v && (v.phase === "roundOver" || v.phase === "over") && v.last;
    p.hidden = !show;
    clearInterval(panelTimer);
    if (!show) return;
    const rows = [...v.order].sort((a, b) => v.totals[b] - v.totals[a]);
    const draw = () => {
      const ms = remainingMs(info, "next");
      const next = v.phase === "roundOver" ? `<div class="lc-next">${info?.boardControl ? `<button type="button" class="lc-go">Next round</button>` : ""}${ms !== null ? `<span>in ${Math.ceil(ms / 1000)} s</span>` : ""}</div>` : "";
      p.innerHTML = `<h2>Round ${v.last.round}: ${esc(v.names[v.last.out])} played their last card</h2>
        <table><tr><th></th><th>This round</th><th>Total</th></tr>${rows
          .map((s) => `<tr class="${s === v.last.out ? "won" : ""}"><td>${esc(v.names[s])}</td><td>${v.last.scores[s] ? `+${v.last.scores[s]}` : "–"}</td><td>${v.totals[s]}</td></tr>`)
          .join("")}</table><p>${v.phase === "over" ? "Game over" : `First to ${v.target} points wins`}</p>${next}`;
    };
    draw();
    if (v.phase === "roundOver") panelTimer = setInterval(draw, 500);
    p.style.transform = `translate(-50%, -50%) rotate(${info?.rotation ?? 0}deg)`;
  }

  // Each player's hand as a fan of backs between their plate and the middle, with the number on it: as at a real
  // table, everyone sees at a glance who is nearly out. Redrawn only when a count changes.
  const fans = new Map();
  function renderFans() {
    const box = $(".lc-fans");
    const seats = new Set(view.order);
    for (const [seat, f] of fans) if (!seats.has(seat)) (f.el.remove(), fans.delete(seat));
    for (const seat of view.order) {
      const at = info?.seatPositions?.[seat];
      if (!at) continue;
      const n = view.counts[seat] ?? 0;
      let f = fans.get(seat);
      if (!f) {
        f = { el: document.createElement("div"), n: -1, key: "" };
        f.el.className = "lc-fan";
        box.appendChild(f.el);
        fans.set(seat, f);
      }
      const r = (at.rot * Math.PI) / 180, d = 74;
      const key = `${at.x},${at.y},${at.rot}`;
      if (f.key !== key) {
        f.key = key;
        f.el.style.cssText = `left:${at.x + d * Math.sin(r)}px;top:${at.y - d * Math.cos(r)}px;transform:rotate(${at.rot}deg)`;
      }
      if (f.n === n) continue;
      f.n = n;
      const shown = Math.min(n, 15);
      const step = shown > 1 ? Math.min(7, 84 / (shown - 1)) : 0;
      f.el.innerHTML =
        Array.from({ length: shown }, (_, i) => `<i style="transform:translateX(-50%) rotate(${(i - (shown - 1) / 2) * step}deg)"></i>`).join("") +
        `<b class="${n === 1 ? "one" : ""}">${n}</b>`;
      f.el.classList.toggle("empty", n === 0);
    }
  }

  function burst(seat) {
    const at = info?.seatPositions?.[seat];
    if (!at) return;
    const r = (at.rot * Math.PI) / 180, d = 250;
    const el = document.createElement("div");
    el.className = "lc-burst";
    el.style.cssText = `left:${at.x + d * Math.sin(r)}px;top:${at.y - d * Math.cos(r)}px;--rot:${at.rot}deg`;
    el.innerHTML = `<span>Last card!</span>`;
    $(".lc-bursts").appendChild(el);
    sound("lastCard");
    el.addEventListener("animationend", () => el.remove());
  }

  box.addEventListener("click", (e) => e.target.closest(".lc-go") && ctx.skipTimer?.("next"));

  const track = (p) => (flights++, p.finally(() => flights--));

  function played(e) {
    const { seat, card } = e;
    landing.add(card.id);
    sound("throw");
    track(
      sling.fly(seat, { id: String(card.id), item: card, to: { x: PILE.x + card.dx, y: PILE.y + card.dy, angle: card.angle } }).then(() => {
        landing.delete(card.id);
        renderPile();
        sound("land");
        if (card.c === "w") sound("wild");
        else if (card.k === "skip") sound("skip");
        else if (card.k === "rev") sound("reverse");
        if (card.k === "+2" || card.k === "+4") sound("plus");
      }),
    );
  }

  function drew(seat, n, delay) {
    for (let i = 0; i < n; i++) {
      track(
        new Promise((r) => setTimeout(r, delay + i * 240 * speed())).then(() => {
          if (gone) return;
          sound("draw");
          return sling.toSeat(seat, { from: { x: DRAW.x, y: DRAW.y, angle: 0 } });
        }),
      );
    }
  }

  return {
    update(v, events, i) {
      view = v;
      info = i;
      sling.info(i);
      box.classList.toggle("ccw", v.dir === -1);
      seatPlates(box, i, (seat) => `${v.totals[seat] ?? 0} pts`, { active: v.phase === "playing" ? v.turn : null });
      renderFans();
      $(".lc-left").textContent = `${v.drawPile} cards`;
      // A forced draw waits for the card that forced it to land.
      const landingMs = 700 * speed();
      let afterPlay = 0;
      for (const e of events) {
        if (e.name === "played") {
          played(e.data);
          afterPlay = landingMs;
        } else if (e.name === "drew") drew(e.data.seat, e.data.n, afterPlay);
        else if (e.name === "lastCard") setTimeout(() => !gone && burst(e.data.seat), afterPlay);
        else if (e.name === "reshuffled") sound("shuffle");
        else if (e.name === "roundOver") setTimeout(() => !gone && sound("roundWon"), afterPlay);
        else if (e.name === "round") sound("shuffle");
      }
      renderPile();
      renderPanel();
    },
    gesture: (seat, data) => sling.gesture(seat, data),
    // The platform waits for this before an AI player moves, so cards fly one after another.
    whenIdle: () =>
      new Promise((resolve) => {
        const t0 = Date.now();
        const check = () => (flights === 0 || Date.now() - t0 > 4000 ? resolve() : setTimeout(check, 50));
        check();
      }),
    destroy() {
      gone = true;
      clearInterval(panelTimer);
      sling.destroy();
    },
  };
}

// The board's settings: how fast cards fly. The phones read the same choice, so drawn cards arrive in time.
export function settings({ info, setPrefs }) {
  return [
    {
      type: "choice",
      label: "Card animation",
      value: info.prefs?.anim ?? "normal",
      options: [
        { value: "fast", label: "Fast" },
        { value: "normal", label: "Normal" },
        { value: "slow", label: "Slow" },
      ],
      onChange: (v) => setPrefs({ anim: v }),
    },
  ];
}
