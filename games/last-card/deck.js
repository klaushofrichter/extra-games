// Last Card phone (E-023): your own cards at the bottom, and on your turn the ones that fit lift and glow. Push one up
// and off the top of the phone to play it (games-service's sling, D-189): the board shows it coming in at your edge
// while you drag, and it flies onto the pile once played. A wild card asks for its colour first. Nothing fits? Draw a
// card; if it fits you may play it, else Keep it. Drawn cards come in at the top once the board has thrown them.
import { esc, useStyles } from "/shared/board-kit.js";
import { slingDeck } from "/shared/sling.js";
import { cardFace, FILL, SPEEDS } from "/games/last-card/assets/cards.js";

const CW = 76, CH = 114;
const ORDER = { r: 0, y: 1, g: 2, b: 3, w: 4 };
const KINDS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "skip", "rev", "+2", "wild", "+4"];
const NAMES = { r: "Red", y: "Yellow", g: "Green", b: "Blue" };

export function mount(root, ctx) {
  useStyles("/games/last-card/deck.css");
  root.innerHTML = `<div class="lcd">
    <div class="card lcd-status"><div class="eyebrow lcd-round"></div>
      <div class="lcd-row"><div class="display lcd-big"></div><div class="lcd-top"></div></div></div>
    <div class="card lcd-result" hidden></div>
    <div class="lcd-actions"><span class="lcd-me"></span><button type="button" class="primary lcd-draw">Draw a card</button><button type="button" class="lcd-keep" hidden>Keep it</button></div>
    <div class="lcd-zone"><div class="lcd-hint">Push a card off the top to play it</div><div class="lcd-arrow" aria-hidden="true">↑</div></div>
    <div class="lcd-hand"></div>
    <div class="lcd-pick" hidden><div class="lcd-pick-box"><div class="eyebrow">Wild card: pick the colour</div>
      <div class="lcd-colors">${Object.entries(NAMES).map(([c, n]) => `<button type="button" data-color="${c}" style="--c:${FILL[c]}">${n}</button>`).join("")}</div>
      <button type="button" class="lcd-cancel">Cancel</button></div></div></div>`;
  const $ = (s) => root.querySelector(s);
  let view = null, info = null, pending = null, wasMyTurn = false, picking = null, gone = false;
  const speed = () => SPEEDS[info?.prefs?.anim] ?? 1;
  // The hint to push cards off the top shows until this phone has played three cards that way (remembered).
  const HINT_KEY = "gametable.last-card.slung";
  const slung = () => {
    try {
      return Number(localStorage.getItem(HINT_KEY)) || 0;
    } catch {
      return 0;
    }
  };
  const countSling = () => {
    try {
      localStorage.setItem(HINT_KEY, String(slung() + 1));
    } catch {}
  };

  // ---------- the colour of a wild card ----------
  function pickColor() {
    $(".lcd-pick").hidden = false;
    return new Promise((resolve) => (picking = resolve));
  }
  function picked(color) {
    $(".lcd-pick").hidden = true;
    const r = picking;
    picking = null;
    r?.(color);
  }

  const sling = slingDeck($(".lcd"), ctx, {
    canSling: (id) => {
      if (!view?.myTurn) return "Wait for your turn";
      if (!view.playable.includes(Number(id))) return view.drewId !== null ? "Play the card you drew, or keep it" : "That card doesn't match the pile";
      return true;
    },
    onSling: async (id) => {
      const card = view.hand.find((c) => c.id === Number(id));
      if (!card) return false;
      let color;
      if (card.c === "w") {
        color = await pickColor();
        if (!color) return false;
      }
      const r = await ctx.send("play", { id: card.id, ...(color ? { color } : {}) });
      if (r?.ok) countSling();
      return !!r?.ok;
    },
    speed,
  });

  // ---------- drawing ----------
  /**
   * Where each card goes: rows of overlapping cards, at least 30 px of each showing (10 to a row on a 390 px phone, 8
   * on 320 px), from the bottom up into the free space above; rows close up when there are many.
   */
  function layout(hand) {
    const w = $(".lcd-hand").clientWidth - 16;
    const perMax = Math.max(1, Math.floor((w - CW) / 30) + 1);
    const rows = Math.max(1, Math.ceil(hand.length / perMax));
    const per = Math.ceil(hand.length / rows);
    const bar = $(".lcd-actions");
    const room = Math.max(CH, $(".lcd").clientHeight - (bar.offsetTop + bar.offsetHeight) - 24); // all the space below the buttons
    const gap = rows > 1 ? Math.max(34, Math.min(64, (room - CH - 20) / (rows - 1))) : 0;
    return {
      gap,
      rows,
      at: hand.map((c, i) => {
        const r = Math.floor(i / per), j = i % per, n = Math.min(per, hand.length - r * per);
        const step = n > 1 ? Math.min(CW + 6, (w - CW) / (n - 1)) : 0;
        const start = 8 + Math.max(0, (w - CW - step * (n - 1)) / 2);
        return { left: start + j * step, bottom: 10 + (rows - 1 - r) * gap, z: i + 1 };
      }),
    };
  }

  function render(entering = [], forced = false) {
    const v = view;
    if (!v) return;
    const name = (s) => v.names[s] ?? "?";
    $(".lcd-round").textContent = v.phase === "over" ? "Game over" : `Round ${v.round} · first to ${v.target} points`;
    let big;
    if (v.phase === "over") big = v.winners.includes(v.seat) ? "You win!" : `${esc(v.winners.map(name).join(" and "))} ${v.winners.length === 1 ? "wins" : "win"}`;
    else if (v.phase === "roundOver") big = v.last?.out === v.seat ? "You played your last card!" : `${esc(name(v.last?.out))} is out`;
    else if (!v.myTurn) big = `${esc(name(v.turn))} is playing`;
    else if (v.drewId !== null) big = "Play the card you drew, or keep it";
    else if (!v.playable.length) big = "Nothing fits: draw a card";
    else big = "Your turn";
    $(".lcd-big").innerHTML = big;
    $(".lcd-status").classList.toggle("go", !!v.myTurn);
    $(".lcd-top").innerHTML = v.top ? `${cardFace(v.top, 40, 60, { color: v.top.color })}<span class="lcd-dot" style="--c:${FILL[v.color]}" title="${NAMES[v.color]}"></span>` : "";
    $(".lcd-me").textContent = `${v.totals[v.seat] ?? 0} pts`;
    $(".lcd-zone").classList.toggle("on", !!v.myTurn && v.playable.length > 0 && slung() < 3);
    $(".lcd-draw").hidden = !v.myTurn || !v.canDraw;
    $(".lcd-draw").classList.toggle("primary", !v.playable.length);
    $(".lcd-keep").hidden = !v.canKeep;

    const hand = [...v.hand].sort((a, b) => ORDER[a.c] - ORDER[b.c] || KINDS.indexOf(a.k) - KINDS.indexOf(b.k));
    const { at: pos, rows, gap } = layout(hand);
    $(".lcd-hand").style.height = `${CH + 20 + (rows - 1) * gap}px`;
    $(".lcd-hand").innerHTML = hand
      .map((c, i) => {
        const ok = v.myTurn && v.playable.includes(c.id);
        return `<div class="lcd-card ${ok ? "ok" : v.myTurn ? "no" : ""}" data-sling="${c.id}" style="left:${pos[i].left}px;bottom:${pos[i].bottom}px;z-index:${pos[i].z}">${cardFace(c, CW, CH)}</div>`;
      })
      .join("");
    // Drawn cards come in at the top after the board has thrown them (a forced draw waits for the card that forced it).
    const k = speed();
    entering.forEach((id, i) => sling.receive($(`[data-sling="${id}"]`), { delay: (forced ? 700 * k : 0) + i * 240 * k + 500 * k }));

    const res = $(".lcd-result");
    res.hidden = !(v.last && (v.phase === "roundOver" || v.phase === "over"));
    if (!res.hidden) {
      const rows = [...v.order].sort((a, b) => v.totals[b] - v.totals[a]);
      res.innerHTML = `<div class="eyebrow">Round ${v.last.round}</div><table class="lcd-table"><tr><th></th><th>Round</th><th>Total</th></tr>${rows
        .map((s) => `<tr class="${s === v.seat ? "me" : ""}"><td>${esc(name(s))}</td><td>${v.last.scores[s] ? `+${v.last.scores[s]}` : "–"}</td><td>${v.totals[s]}</td></tr>`)
        .join("")}</table>`;
    }
  }

  // The hand changes while a card is under a finger: show it once the card is gone or back.
  function flush() {
    if (!pending || gone) return;
    if (sling.busy() || picking) return void setTimeout(flush, 60);
    const p = pending;
    pending = null;
    view = p.v;
    render(p.entering, p.forced);
  }

  // The hand fills the space it has: lay it out again when that changes (the styles arriving, turning the phone).
  let lastH = 0;
  const resized = new ResizeObserver(() => {
    const h = $(".lcd").clientHeight;
    if (h === lastH || !view || sling.busy() || picking) return;
    lastH = h;
    render();
  });
  resized.observe($(".lcd"));

  root.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.color) return picked(b.dataset.color);
    if (b.classList.contains("lcd-cancel")) return picked(null);
    if (b.classList.contains("lcd-draw")) return void ctx.send("draw");
    if (b.classList.contains("lcd-keep")) return void ctx.send("keep");
  });

  return {
    update(v, events, i) {
      info = i;
      const before = new Set(((pending?.v ?? view)?.hand ?? []).map((c) => c.id));
      const mine = events.filter((e) => e.name === "drew" && e.data.seat === v.seat);
      const entering = mine.length && before.size ? v.hand.filter((c) => !before.has(c.id)).map((c) => c.id) : [];
      pending = { v, entering: [...(pending?.entering ?? []), ...entering], forced: mine.some((e) => e.data.forced) || !!pending?.forced };
      if (v.myTurn && !wasMyTurn) ctx.vibrate?.(60);
      wasMyTurn = !!v.myTurn;
      flush();
    },
    destroy() {
      gone = true;
      resized.disconnect();
      sling.destroy();
    },
  };
}
