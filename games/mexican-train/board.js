// Mexican Train board (E-020): the hub with the round's engine, every train in its lane toward its owner's seat, the
// open end of each train in big numbers, markers on open trains, and an animated table behind it all. The seat plates
// are the platform's own (board kit), restyled in board.css. Tiles size themselves to the room (assets/layout.js) and
// only shrink during a round. Played tiles slide in from their player's seat; whenIdle() tells the platform when the
// board has caught up, so AI players wait for it. Sounds play through the board kit only while the table's sound is
// on; the music (off by default) follows the same switch.
import { audio, esc, html, playerColor, playSound, remainingMs, seatPlates, useStyles } from "/shared/board-kit.js";
import { C, FIELD, HALF, HUB_R, W, H, layout } from "/games/mexican-train/assets/layout.js";
import { MEXICAN, tileSvg } from "/games/mexican-train/assets/tiles.js";
import { BACKGROUNDS, startBackground } from "/games/mexican-train/assets/scenes.js";
import { SOUNDS, createMusic } from "/games/mexican-train/assets/audio.js";

/** Rails, sleepers and the hub's ring for each background. */
const STYLE = {
  aurora: { rail: "#03050c", sleeper: "#3f8f7a", hub: "#5ef2a8", felt: "#04060f" },
  lava: { rail: "#120510", sleeper: "#b8503a", hub: "#ffb35c", felt: "#0d0410" },
  plasma: { rail: "#05070f", sleeper: "#6a6aa8", hub: "#c39bff", felt: "#060a18" },
  fireflies: { rail: "#020504", sleeper: "#6b5a2a", hub: "#ffd166", felt: "#030806" },
  stars: { rail: "#05070f", sleeper: "#5a6aa8", hub: "#8fd3ff", felt: "#070a1c" },
  clouds: { rail: "#0d2240", sleeper: "#c98a4b", hub: "#ffd166", felt: "#123a6b" },
};
const prefOf = (info) => ({
  faces: info.prefs?.faces ?? "colour",
  // A scene, or "rotate" for a new one each round.
  background: STYLE[info.prefs?.background] || info.prefs?.background === "rotate" ? info.prefs.background : "aurora",
  motion: info.prefs?.motion !== false,
  music: ["soft", "on"].includes(info.prefs?.music) ? info.prefs.music : "off",
  ends: info.prefs?.ends !== false,
});
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** What Mexican Train adds to the board's settings: display only, kept per table (games-service D-088). */
export function settings({ info, setPrefs }) {
  const p = prefOf(info);
  return [
    // One choice, so it always names what the board shows: a scene, or a new one each round (a separate "each round"
    // switch left the choice saying Starfield while the board had moved on to Clouds).
    {
      type: "choice",
      label: "Background",
      value: p.background,
      options: [...BACKGROUNDS.map((b) => ({ value: b.id, label: b.label })), { value: "rotate", label: "A new one each round" }],
      onChange: (v) => setPrefs({ background: v }),
    },
    { type: "toggle", label: "Background motion", value: p.motion, onChange: (v) => setPrefs({ motion: !!v }) },
    { type: "choice", label: "Music", value: p.music, options: [{ value: "off", label: "Off" }, { value: "soft", label: "Soft" }, { value: "on", label: "On" }], onChange: (v) => setPrefs({ music: v }) },
    { type: "choice", label: "Tile faces", value: p.faces, options: [{ value: "colour", label: "Coloured" }, { value: "classic", label: "Classic" }, { value: "numbers", label: "Numbers" }], onChange: (v) => setPrefs({ faces: v }) },
    { type: "toggle", label: "Big numbers at the train ends", value: p.ends, onChange: (v) => setPrefs({ ends: !!v }) },
  ];
}

export function mount(root, ctx = {}) {
  useStyles("/games/mexican-train/board.css");
  const box = html(`<div class="mt-root"><div class="mt-felt"></div><div class="mt-bgbox"></div>
    <svg class="mt-svg" viewBox="0 0 ${W} ${H}" aria-hidden="true"></svg>
    <div class="mt-layer"><div class="mt-hubtext"></div><div class="mt-banner" hidden></div><div class="mt-result" hidden></div></div></div>`);
  root.appendChild(box);
  const svg = box.querySelector(".mt-svg");
  const hubText = box.querySelector(".mt-hubtext");
  const banner = box.querySelector(".mt-banner");
  const result = box.querySelector(".mt-result");
  let info = null, view = null;
  let heldScale = null, round = 0, lastTurn = null, platesKey = "";
  let bg = { key: "", stop: () => {} };
  let music = null;
  let busyUntil = 0;

  const name = (seat) => view.players.find((p) => p.seat === seat)?.name ?? "?";
  const colorOf = (t) => (t.owner === null ? MEXICAN : playerColor(info, t.owner));
  const seatAt = (seat) => info.seatPositions?.[seat] ?? null;

  function background() {
    const p = prefOf(info);
    // "A new one each round": the scenes in turn, round 1 the first.
    const id = p.background === "rotate" ? BACKGROUNDS[Math.max(0, view.round - 1) % BACKGROUNDS.length].id : p.background;
    const moving = p.motion && !reducedMotion();
    const key = `${id}:${moving}`;
    if (key === bg.key) return id;
    bg.stop();
    bg = { key, stop: startBackground(box.querySelector(".mt-bgbox"), id, moving) };
    box.querySelector(".mt-felt").style.background = STYLE[id].felt;
    return id;
  }

  function musicFollow() {
    const p = prefOf(info);
    const want = info.sound !== false && p.music !== "off" && !info.over;
    if (!want) return music?.stop();
    const c = audio();
    if (!c) return;
    music ??= createMusic(c);
    music.start(p.music);
  }

  function draw(animate) {
    const p = prefOf(info);
    const st = STYLE[background()];
    const lay = layout(view.trains, seatAt, heldScale ?? undefined);
    heldScale = lay.scale;
    const h = HALF * lay.scale;
    const playable = (t) => view.phase === "playing" && (view.pending ? t.id === view.pending : t.owner === view.turn || t.owner === null || t.marker);
    let s = `<defs><radialGradient id="mt-vig" cx="50%" cy="50%" r="62%"><stop offset=".45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></radialGradient></defs>
      <rect width="${W}" height="${H}" fill="url(#mt-vig)"/>`;
    // Rails under every train; a light runs along the rails of the player on turn.
    for (const t of view.trains) {
      const L = lay.trains[t.id];
      const start = { x: C.x + L.ua.x * HUB_R, y: C.y + L.ua.y * HUB_R };
      const pts = [start, ...L.placed, L.tip].map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(" ");
      s += `<polyline points="${pts}" fill="none" stroke="${st.rail}" stroke-width="${(h * 1.25).toFixed(1)}" stroke-linejoin="round" stroke-linecap="round" opacity=".85"/>
        <polyline points="${pts}" fill="none" stroke="${st.sleeper}" stroke-width="${(h * 1.05).toFixed(1)}" stroke-dasharray="${(h * 0.16).toFixed(1)} ${(h * 0.3).toFixed(1)}" stroke-linejoin="round" opacity=".7"/>
        <polyline points="${pts}" fill="none" stroke="${colorOf(t)}" stroke-width="${(h * 0.1).toFixed(1)}" stroke-linejoin="round" opacity=".55"/>`;
      if (view.phase === "playing" && t.owner === view.turn) s += `<polyline class="mt-runlight" points="${pts}" fill="none" stroke="${colorOf(t)}" stroke-width="${(h * 0.5).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round" pathLength="1000" stroke-dasharray="70 930"/>`;
    }
    // Tiles; a "+n" chip where a train is folded.
    for (const t of view.trains) {
      const L = lay.trains[t.id];
      L.shown.forEach((tile, i) => {
        const q = L.placed[i];
        if (!q) return;
        if (tile === null) {
          s += `<g transform="translate(${q.x.toFixed(1)},${q.y.toFixed(1)})"><rect x="${-h * 0.9}" y="${-h * 0.42}" width="${h * 1.8}" height="${h * 0.84}" rx="${h * 0.42}" fill="${colorOf(t)}"/><text y="${h * 0.17}" text-anchor="middle" font-size="${h * 0.5}" font-weight="800" fill="#1b1407">+${L.fold}</text></g>`;
          return;
        }
        const last = i === L.shown.length - 1;
        const deg = (q.ang * 180) / Math.PI;
        s += `<g class="mt-tile"${last ? ` data-end="${esc(t.id)}"` : ""} transform="translate(${q.x.toFixed(1)},${q.y.toFixed(1)}) rotate(${deg.toFixed(1)})">${tileSvg(tile[0], tile[1], h, { faces: p.faces, upright: (info.rotation ?? 0) - deg })}</g>`;
      });
    }
    // Open ends, markers, the Mexican train's label.
    for (const t of view.trains) {
      const L = lay.trains[t.id];
      const col = colorOf(t);
      const pend = view.pending === t.id;
      if (p.ends) s += `<g transform="translate(${L.tip.x.toFixed(1)},${L.tip.y.toFixed(1)})"><circle r="25" fill="#0b1310" stroke="${col}" stroke-width="4"${pend || playable(t) ? ` class="mt-pulse${pend ? "" : " slow"}"` : ""}/><text y="9" text-anchor="middle" font-size="26" font-weight="800" fill="#fff" transform="rotate(${info.rotation ?? 0})">${t.end}</text></g>`;
      if (t.marker && t.owner !== null) {
        const m = { x: L.tip.x + L.v.x * 34, y: L.tip.y + L.v.y * 34 };
        s += `<g transform="translate(${m.x.toFixed(1)},${m.y.toFixed(1)})"><circle r="17" fill="${col}"/><path d="M-9,5 h18 v-6 h-5 v-5 h-7 v5 h-6z M-7,7 a2.5,2.5 0 1,0 0.1,0 M6,7 a2.5,2.5 0 1,0 0.1,0" fill="#1b1407"/></g>`;
      }
      if (t.owner === null) {
        const lab = { x: Math.min(FIELD.x1 - 80, Math.max(FIELD.x0 + 80, L.tip.x + L.u.x * 52)), y: Math.min(FIELD.y1, Math.max(FIELD.y0, L.tip.y + L.u.y * 52 + (L.u.y ? 0 : 44))) };
        s += `<g transform="translate(${lab.x.toFixed(1)},${lab.y.toFixed(1)}) rotate(${info.rotation ?? 0})"><rect x="-74" y="-17" width="148" height="34" rx="17" fill="${MEXICAN}"/><text y="7" text-anchor="middle" font-size="18" font-weight="800" fill="#1b1407">★ Mexican train</text></g>`;
      }
    }
    // The hub with the round's engine.
    s += `<circle cx="${C.x}" cy="${C.y}" r="${HUB_R}" fill="${st.felt}" stroke="${st.hub}" stroke-width="6" opacity=".92"/>
      <g transform="translate(${C.x},${C.y}) rotate(${info.rotation ?? 0}) translate(0,-8)">${tileSvg(view.engine, view.engine, 27, { faces: p.faces })}</g>`;
    svg.innerHTML = s;
    if (animate) slideIn(animate);
    hub();
    plates();
  }

  /** A played tile slides in from its player's seat to where it lies now. */
  function slideIn({ seat, train }) {
    const el = svg.querySelector(`.mt-tile[data-end="${CSS.escape(train)}"]`);
    const from = seatAt(seat);
    if (!el || !from) return;
    const to = el.getAttribute("transform").replace(/translate\(([^,]+),([^)]+)\)/, "translate($1px,$2px)").replace(/rotate\(([^)]+)\)/, "rotate($1deg)");
    el.animate([{ transform: `translate(${from.x}px,${from.y}px) rotate(${from.rot ?? 0}deg) scale(1.5)`, opacity: 0.2 }, { transform: to, opacity: 1 }], { duration: 650, easing: "cubic-bezier(.2,.8,.2,1)" });
    busyUntil = Math.max(busyUntil, performance.now() + 700);
  }

  /** Round, tiles to draw, the turn's countdown, and a banner while a double waits; facing the board's front. */
  function hub() {
    const turnMs = view.phase === "playing" && view.turnMs ? remainingMs(info, "turn") : null;
    hubText.style.transform = `translate(-50%,-50%) rotate(${info.rotation ?? 0}deg)`;
    hubText.innerHTML = `<b>${view.round} / ${view.rounds}</b><span>${view.boneyard} to draw</span>${turnMs === null ? "" : `<span class="mt-clock${turnMs < 10000 ? " low" : ""}">${Math.ceil(turnMs / 1000)} s</span>`}`;
    const pend = view.pending && view.trains.find((t) => t.id === view.pending);
    banner.hidden = !pend;
    if (pend) {
      banner.style.transform = `translate(-50%,-50%) rotate(${info.rotation ?? 0}deg) translateY(-${HUB_R + 60}px)`;
      banner.textContent = `Cover the double ${pend.end}|${pend.end}!`;
    }
  }

  /** The platform's seat plates, redrawn only when what they show changes (so their animations keep running). */
  function plates() {
    const active = view.phase === "playing" ? view.turn : undefined;
    const extra = (seat) => {
      const pl = view.players.find((x) => x.seat === seat);
      if (!pl) return "watching";
      // Points are scored only at the end of a round (the pips left in hand): until the first round is over there are
      // none to show, and "0 pts" read as if nobody were scoring (E-022).
      const score = view.last ? ` · ${pl.total} ${pl.total === 1 ? "pt" : "pts"}${view.phase === "over" ? "" : " so far"}` : "";
      return `${seat === active ? `<b class="mt-turn">Their turn</b> · ` : ""}${pl.tiles} ${pl.tiles === 1 ? "tile" : "tiles"}${score}`;
    };
    const key = JSON.stringify([active, view.phase, !!view.last, view.players.map((x) => [x.seat, x.tiles, x.total]), info.players.map((x) => [x.seat, x.name, x.connected, x.color])]);
    if (key === platesKey) return;
    platesKey = key;
    seatPlates(box, info, (seat) => extra(seat), { active });
  }

  /** After a round: everyone's points for it and in all, until the next round is dealt. */
  function roundResult() {
    const r = view.last;
    const show = (view.phase === "roundOver" || view.phase === "over") && r;
    result.hidden = !show;
    if (!show) return;
    result.style.transform = `translate(-50%,-50%) rotate(${info.rotation ?? 0}deg)`;
    const rows = [...view.players].sort((a, b) => a.total - b.total);
    const head = r.out !== null ? `${esc(name(r.out))} played their last tile` : "Nobody can play";
    const next = view.phase === "roundOver" ? remainingMs(info, "next") : null;
    result.innerHTML = `<div class="mt-r-head">Round ${r.round} · ${head}</div>
      <table><tr><th></th><th>This round</th><th>Total</th></tr>${rows
        .map((pl) => `<tr><td><span class="mt-dot" style="background:${playerColor(info, pl.seat)}"></span>${esc(pl.name)}</td><td>${r.scores[pl.seat] ?? 0}</td><td><b>${pl.total}</b></td></tr>`)
        .join("")}</table>
      ${view.phase === "roundOver" ? `<div class="mt-r-foot">Round ${r.round + 1} starts from the double ${12 - r.round}${next !== null ? ` in ${Math.ceil(next / 1000)} s` : ""}.${info.boardControl ? ` <button type="button" class="mt-next">Next round</button>` : ""}</div>` : ""}`;
  }
  result.addEventListener("click", (e) => {
    if (e.target.closest(".mt-next")) ctx.skipTimer?.("next");
  });

  const tick = setInterval(() => {
    if (!view) return;
    hub();
    if (view.phase === "roundOver") roundResult();
  }, 500);

  return {
    update(v, events, i) {
      info = i;
      view = v;
      if (v.round !== round) {
        round = v.round;
        heldScale = null; // a new round may start bigger
      }
      const played = events.filter((e) => e.name === "played").at(-1)?.data;
      draw(played ? { seat: played.seat, train: played.train } : null);
      roundResult();
      musicFollow();
      for (const e of events) {
        if (e.name === "played") playSound(info, "mt-play", e.data.tile[0] === e.data.tile[1] ? SOUNDS.double : SOUNDS.clack);
        if (e.name === "drew") playSound(info, "mt-draw", SOUNDS.draw);
        if (e.name === "passed") playSound(info, "mt-marker", SOUNDS.whistle);
        if (e.name === "roundOver") playSound(info, e.data.out !== null ? "mt-domino" : "mt-round", e.data.out !== null ? SOUNDS.domino : SOUNDS.round);
      }
      // A soft ding when a person's turn begins (AI players move without one).
      const human = info.players.some((x) => x.seat === v.turn && x.kind === "human");
      if (v.phase === "playing" && v.turn !== lastTurn && events.length && human) playSound(info, "mt-turn", SOUNDS.turn);
      lastTurn = v.phase === "playing" ? v.turn : null;
    },
    whenIdle() {
      const wait = busyUntil - performance.now();
      return wait > 0 ? new Promise((r) => setTimeout(r, wait)) : Promise.resolve();
    },
    destroy() {
      clearInterval(tick);
      bg.stop();
      music?.stop();
    },
  };
}
