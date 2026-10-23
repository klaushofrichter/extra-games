// Mexican Train phone (E-020): your own tiles (nobody else's), the trains you may play on with the number at their open
// end, and on your turn two taps to play: a tile that fits (they glow), then one of the highlighted trains. Draw when
// nothing fits; Done ends an opening run. The phone vibrates when your turn begins and stays quiet otherwise.
import { esc, playerColor, useStyles } from "/shared/board-kit.js";
import { MEXICAN, uprightTile } from "/games/mexican-train/assets/tiles.js";

const same = (a, b) => (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);

export function mount(root, ctx) {
  useStyles("/games/mexican-train/deck.css");
  root.innerHTML = `<div class="mtd">
    <div class="card mtd-status"><div class="eyebrow mtd-round"></div><div class="mtd-row"><div class="display mtd-big"></div><div class="mtd-score"><b></b><span>points</span></div></div></div>
    <div class="card"><div class="eyebrow mtd-trains-h">Trains you can play on</div><div class="mtd-trains"></div></div>
    <div class="card"><div class="mtd-hand-h"><span class="eyebrow">My tiles <b class="mtd-count"></b></span><button type="button" class="mtd-sort"></button></div><div class="mtd-hand"></div>
      <div class="mtd-actions"><button type="button" class="primary mtd-draw">Draw a tile</button><button type="button" class="mtd-done" hidden>Done</button></div>
      <div class="muted center mtd-hint"></div></div>
    <div class="card mtd-result" hidden></div></div>`;
  const $ = (s) => root.querySelector(s);
  let view = null, info = null, picked = null, busy = false, gone = false, wasMyTurn = false;
  let sortBy = "number";

  const name = (seat) => view.players.find((p) => p.seat === seat)?.name ?? "?";
  const colorOf = (t) => (t.owner === null ? MEXICAN : playerColor(info, t.owner));
  // Short names: the colour dot already says whose train it is.
  const trainName = (t) => (t.owner === null ? "Mexican" : t.owner === view.seat ? "Mine" : name(t.owner));
  const movesFor = (tile) => view.moves.filter((m) => same(m.tile, tile));

  function draw() {
    const v = view;
    const me = v.players.find((p) => p.seat === v.seat);
    $(".mtd-round").textContent = v.phase === "over" ? "Game over" : `Round ${v.round} of ${v.rounds} · ${v.boneyard} to draw`;
    $(".mtd-score b").textContent = me?.total ?? 0;
    let big;
    if (v.phase === "over") big = v.winners.includes(v.seat) ? "You win!" : `${v.winners.map((x) => esc(name(x))).join(" and ")} ${v.winners.length === 1 ? "wins" : "win"}`;
    else if (v.phase === "roundOver") big = v.last?.out === v.seat ? "Domino! You're out." : `Round over: ${v.last?.scores?.[v.seat] ?? 0} points for you`;
    else if (!v.myTurn) big = `${esc(name(v.turn))} is playing`;
    else if (v.pending) big = `Cover the double ${v.trains.find((t) => t.id === v.pending)?.end}!`;
    else if (v.inRun) big = "Keep going on your train, or tap Done";
    else if (!v.moves.length) big = v.canDraw ? "Nothing fits: draw a tile" : "Nothing fits";
    else big = picked ? "Now tap a train" : "Your turn: pick a tile";
    $(".mtd-big").innerHTML = big;
    $(".mtd-status").classList.toggle("go", !!v.myTurn);

    // Trains: on your turn the ones you may use; otherwise every open train, to plan ahead.
    const open = v.trains.filter((t) => (v.pending ? t.id === v.pending : t.owner === v.seat || t.owner === null || t.marker));
    const targets = picked ? movesFor(picked).map((m) => m.train) : [];
    $(".mtd-trains").innerHTML = open
      .map((t) => `<button type="button" class="mtd-train ${targets.includes(t.id) ? "hit" : picked ? "dim" : ""}" data-train="${esc(t.id)}" style="--c:${colorOf(t)}" ${v.myTurn ? "" : "disabled"}>
        <span class="dot"></span><span class="nm">${esc(trainName(t))}</span><span class="end">${t.end}</span>${t.marker && t.owner !== null ? `<span class="mk">open</span>` : ""}</button>`)
      .join("");

    // My tiles: the ones that fit glow on my turn.
    const hand = [...v.hand].sort((a, b) => (sortBy === "pips" ? b[0] + b[1] - (a[0] + a[1]) : a[1] - b[1] || a[0] - b[0]));
    $(".mtd-count").textContent = hand.length;
    $(".mtd-sort").textContent = sortBy === "pips" ? "Heaviest first" : "By number";
    $(".mtd-hand").innerHTML = hand
      .map((t) => {
        const ok = v.myTurn && movesFor(t).length > 0;
        const sel = picked && same(picked, t);
        return `<button type="button" class="mtd-tile ${ok ? "ok" : v.myTurn ? "no" : ""} ${sel ? "sel" : ""}" data-t="${t[0]},${t[1]}" aria-label="Tile ${t[0]} and ${t[1]}">${uprightTile(t[0], t[1], 30)}</button>`;
      })
      .join("");
    $(".mtd-draw").disabled = !v.canDraw || busy;
    $(".mtd-draw").hidden = !v.myTurn || v.moves.length > 0;
    $(".mtd-done").hidden = !v.canDone;
    $(".mtd-hint").textContent = hand.length === 1 && v.phase === "playing" ? "One tile left. Domino is close!" : "";

    // After a round, and at the end.
    const r = v.last;
    const res = $(".mtd-result");
    res.hidden = !(r && (v.phase === "roundOver" || v.phase === "over"));
    if (!res.hidden) {
      const rows = [...v.players].sort((a, b) => a.total - b.total);
      res.innerHTML = `<div class="eyebrow">Round ${r.round}</div><table class="mtd-table"><tr><th></th><th>Round</th><th>Total</th></tr>${rows
        .map((p) => `<tr class="${p.seat === v.seat ? "me" : ""}"><td>${esc(p.name)}</td><td>${r.scores[p.seat] ?? 0}</td><td>${p.total}</td></tr>`)
        .join("")}</table>`;
    }
  }

  async function send(nameOf, payload) {
    busy = true;
    draw();
    const r = await ctx.send(nameOf, payload);
    busy = false;
    if (gone) return;
    if (r?.ok) picked = null;
    draw();
  }

  root.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || !view || busy) return;
    if (b.classList.contains("mtd-sort")) {
      sortBy = sortBy === "pips" ? "number" : "pips";
      return draw();
    }
    if (b.dataset.t) {
      if (!view.myTurn) return;
      const t = b.dataset.t.split(",").map(Number);
      const fits = movesFor(t);
      if (!fits.length) return ctx.toast?.("That tile doesn't fit an open train.");
      // A tile that fits one train only goes there at once on a second tap of the same tile.
      if (picked && same(picked, t) && fits.length === 1) return send("play", { tile: t, train: fits[0].train });
      picked = picked && same(picked, t) ? null : t;
      ctx.vibrate?.(10);
      return draw();
    }
    if (b.dataset.train) {
      if (!picked) return ctx.toast?.("Pick a tile first.");
      const m = movesFor(picked).find((x) => x.train === b.dataset.train);
      if (!m) return ctx.toast?.("That tile doesn't match the end of this train.");
      return send("play", { tile: picked, train: m.train });
    }
    if (b.classList.contains("mtd-draw")) return send("draw");
    if (b.classList.contains("mtd-done")) return send("done");
  });

  return {
    update(v, events, i) {
      view = v;
      info = i;
      if (picked && !v.hand.some((t) => same(t, picked))) picked = null;
      if (!v.myTurn) picked = null;
      if (v.myTurn && !wasMyTurn) ctx.vibrate?.(60);
      wasMyTurn = !!v.myTurn;
      draw();
    },
    destroy() {
      gone = true;
    },
  };
}
