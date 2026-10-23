// Where every tile goes on the board (E-020). Pure geometry, no DOM: the board draws from it and the tests check it.
//
// Each train has a lane from the hub toward its owner's seat; the Mexican train takes the gap with the most room.
// A lane reaches halfway to its neighbours on either side. A train leaves the hub as a straight line and, where its
// lane is wide enough for rows of two tiles, bends into rows square to the board that wind toward the seat. All tiles
// share one scale: as big as the room allows (up to MAX_SCALE), smaller when a train needs the space (down to
// MIN_SCALE). Past that, a train folds its middle into a "+n" chip, keeping its first tile and the open end.

export const W = 1920, H = 1080, C = { x: W / 2, y: H / 2 };
/** The play area between the platform's seat plates (drawn 92 px from each edge). */
export const FIELD = { x0: 186, x1: 1734, y0: 146, y1: 934 };
export const HUB_R = 74;
/** Half a tile's length at scale 1: a tile is 76 × 38. */
export const HALF = 38;
export const MAX_SCALE = 1.6, MIN_SCALE = 0.6;

const norm = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

/** How far a line from p in direction u runs before it leaves the play area. */
export function toEdge(p, u) {
  let t = Infinity;
  if (u.x > 1e-9) t = Math.min(t, (FIELD.x1 - p.x) / u.x);
  if (u.x < -1e-9) t = Math.min(t, (FIELD.x0 - p.x) / u.x);
  if (u.y > 1e-9) t = Math.min(t, (FIELD.y1 - p.y) / u.y);
  if (u.y < -1e-9) t = Math.min(t, (FIELD.y0 - p.y) / u.y);
  return t;
}

/** Room in a gap between lanes: how far its middle reaches into the play area, squared, times its angle. */
const room = (a, gap) => {
  const L = toEdge(C, { x: Math.cos(a), y: Math.sin(a) });
  return gap * L * L;
};

/**
 * One lane per train, by train id. `seatAt(seat)` gives a seat's position on the board. Lanes point at their seats;
 * the Mexican train ("m") goes into the gap with the most room. `neg`/`pos` are how far a lane reaches toward its
 * neighbours on either side (at most 75°).
 */
export function lanes(trains, seatAt) {
  const out = trains
    .filter((t) => t.owner !== null)
    .map((t) => {
      const p = seatAt(t.owner) ?? C;
      return { id: t.id, a: norm(Math.atan2(p.y - C.y, p.x - C.x)) };
    });
  const sorted = [...out].sort((p, q) => p.a - q.a);
  let best = -1, at = 0;
  sorted.forEach((l, i) => {
    const next = i + 1 < sorted.length ? sorted[i + 1].a : sorted[0].a + 2 * Math.PI;
    const mid = l.a + (next - l.a) / 2, r = room(mid, next - l.a);
    if (r > best) { best = r; at = mid; }
  });
  if (trains.some((t) => t.owner === null)) out.push({ id: "m", a: norm(sorted.length ? at : 0) });
  const all = [...out].sort((p, q) => p.a - q.a);
  const cap = (75 * Math.PI) / 180;
  all.forEach((l, i) => {
    const prev = all[(i - 1 + all.length) % all.length].a, next = all[(i + 1) % all.length].a;
    l.neg = Math.min(cap, (norm(l.a - prev) || 2 * Math.PI) / 2 - 0.03);
    l.pos = Math.min(cap, (norm(next - l.a) || 2 * Math.PI) / 2 - 0.03);
  });
  return Object.fromEntries(all.map((l) => [l.id, l]));
}

/**
 * Place `count` tiles of one train in its lane at scale s. `isDbl(i)` says whether tile i is a double (laid across, so
 * shorter along the train). Returns { placed: [{ x, y, ang }], tip, ua, u, v } or null when they don't fit.
 */
export function placeTrain(lane, count, s, isDbl) {
  const ua = { x: Math.cos(lane.a), y: Math.sin(lane.a) };
  const u = Math.abs(ua.x) > Math.abs(ua.y) ? { x: Math.sign(ua.x), y: 0 } : { x: 0, y: Math.sign(ua.y) };
  const v = { x: -u.y, y: u.x };
  const thick = HALF * s, len = 2 * HALF * s, dbl = HALF * s, pad = 5 * s, rowGap = thick + 12 * s;
  const reach = toEdge(C, u) - 8;
  const bound = (b, d, side) => {
    const w = { x: Math.cos(b), y: Math.sin(b) };
    const wu = w.x * u.x + w.y * u.y, wv = w.x * v.x + w.y * v.y;
    return wu <= 1e-6 ? side * Infinity : (d * wv) / wu;
  };
  const placed = [];
  // A straight line from the hub toward the seat, until the lane is wide enough for rows of two tiles.
  let i = 0, sd = HUB_R + 14;
  const width = (dist) => dist * (Math.tan(lane.neg) + Math.tan(lane.pos));
  const straight = toEdge(C, ua) - 8;
  while (i < count && width(sd) < 2.2 * len && sd + len < straight) {
    const L = isDbl(i) ? dbl : len;
    placed.push({ x: C.x + ua.x * (sd + L / 2), y: C.y + ua.y * (sd + L / 2), ang: lane.a });
    sd += L + pad;
    i++;
  }
  if (i === count) return { placed, tip: { x: C.x + ua.x * (sd + 22 * s), y: C.y + ua.y * (sd + 22 * s) }, ua, u, v };
  const stemEnd = { x: C.x + ua.x * sd, y: C.y + ua.y * sd };
  const d0 = (stemEnd.x - C.x) * u.x + (stemEnd.y - C.y) * u.y;
  const along = (stemEnd.x - C.x) * v.x + (stemEnd.y - C.y) * v.y;
  let k = 0, dir = along >= 0 ? -1 : 1, last = null;
  while (i < count) {
    const d = d0 + thick / 2 + 8 * s + k * rowGap;
    if (d + thick / 2 > reach) return null;
    const P = { x: C.x + u.x * d, y: C.y + u.y * d };
    const inner = d - thick / 2;
    const lo = Math.max(bound(lane.a - lane.neg, inner, -1), -toEdge(P, { x: -v.x, y: -v.y })) + 6;
    const hi = Math.min(bound(lane.a + lane.pos, inner, 1), toEdge(P, v)) - 6;
    k++;
    if (hi - lo < len) continue; // too narrow for a tile here: the rail passes through
    let x = dir > 0 ? lo : hi;
    while (i < count) {
      const L = isDbl(i) ? dbl : len;
      if (dir > 0 ? x + L > hi : x - L < lo) break;
      const c = dir > 0 ? x + L / 2 : x - L / 2;
      placed.push({ x: P.x + v.x * c, y: P.y + v.y * c, ang: Math.atan2(v.y * dir, v.x * dir) });
      x = dir > 0 ? x + L + pad : x - L - pad;
      i++;
    }
    last = { P, lo, hi, dir, x };
    dir = -dir;
  }
  const t = last.dir > 0 ? Math.min(last.x + 18 * s, last.hi) : Math.max(last.x - 18 * s, last.lo);
  return { placed, tip: { x: last.P.x + v.x * t, y: last.P.y + v.y * t }, ua, u, v };
}

/**
 * The whole board. `trains` as in the board view; `seatAt(seat)` gives a seat's position; `cap` is the largest scale
 * allowed (the board keeps the scale of the round so far, so tiles never grow mid-round). Returns { scale, trains }
 * where each train has its placed tiles, its tip, its lane, how many tiles are folded and the tiles shown (null for
 * the "+n" chip).
 */
export function layout(trains, seatAt, cap = MAX_SCALE) {
  const L = lanes(trains, seatAt);
  const dbl = (tiles) => (i) => !!tiles[i] && tiles[i][0] === tiles[i][1];
  const fits = (t, s) => placeTrain(L[t.id], t.tiles.length, s, dbl(t.tiles));
  let scale = Math.min(MAX_SCALE, cap);
  for (; scale >= MIN_SCALE - 1e-9; scale -= 0.05) if (trains.every((t) => fits(t, scale))) break;
  scale = Math.max(MIN_SCALE, Math.round(scale * 100) / 100);
  const out = {};
  for (const t of trains) {
    let p = fits(t, scale), fold = 0, shown = t.tiles;
    while (!p && fold < t.tiles.length) {
      fold++;
      shown = [t.tiles[0], null, ...t.tiles.slice(1 + fold)];
      p = placeTrain(L[t.id], shown.length, scale, dbl(shown));
    }
    out[t.id] = { ...(p ?? { placed: [], tip: C, ua: { x: 1, y: 0 }, u: { x: 1, y: 0 }, v: { x: 0, y: 1 } }), lane: L[t.id], fold, shown };
  }
  return { scale, trains: out };
}
