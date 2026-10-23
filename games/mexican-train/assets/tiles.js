// Domino tiles as SVG, for the board and the phones (E-020). Each number from 1 to 12 has its own pip colour, so a
// tile reads at a glance; "classic" draws black pips and "numbers" draws digits, for the board's Tile faces setting.

export const PIP = ["", "#0b7285", "#2f9e44", "#e03131", "#6741d9", "#1c7ed6", "#f08c00", "#c2255c", "#5c940d", "#862e9c", "#d9480f", "#364fc7", "#087f5b"];
/** The Mexican train's colour: one no seat has. */
export const MEXICAN = "#2ec4b6";

const g3 = [-1, 0, 1];
const all9 = g3.flatMap((y) => g3.map((x) => [x, y]));
const SPOTS = {
  0: [], 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]],
  7: [[-1, -1], [-1, 0], [-1, 1], [0, 0], [1, -1], [1, 0], [1, 1]], 8: all9.filter(([x, y]) => x || y), 9: all9,
};
/** Pip positions for n on a half tile, in units of half the half's side. Ten to twelve use a 3 × 4 grid. */
function spots(n) {
  if (SPOTS[n]) return SPOTS[n].map(([x, y]) => [x * 0.62, y * 0.62]);
  const full = [-1.5, -0.5, 0.5, 1.5].flatMap((y) => g3.map((x) => [x * 0.62, y * 0.42]));
  if (n === 12) return full;
  if (n === 11) return full.filter(([x, y]) => !(x === 0 && y > 0.6));
  return full.filter(([x, y]) => !(x === 0 && Math.abs(y) > 0.6));
}

/** One half of a tile, centred on (0,0), side h. A digit is turned by `turn` degrees, so it reads upright. */
function half(n, h, faces, turn = 0) {
  if (faces === "numbers") {
    const t = ((Math.round(turn) % 360) + 360) % 360;
    return `<g${t ? ` transform="rotate(${t})"` : ""}><text x="0" y="${(h * 0.18).toFixed(1)}" text-anchor="middle" font-size="${(h * 0.56).toFixed(1)}" font-weight="700" fill="${n ? PIP[n] : "#8a9a96"}" font-family="system-ui,sans-serif">${n}</text></g>`;
  }
  const r = (n > 9 ? 0.075 : 0.09) * h;
  return spots(n)
    .map(([x, y]) => `<circle cx="${(x * h * 0.5).toFixed(1)}" cy="${(y * h * 0.5).toFixed(1)}" r="${r.toFixed(1)}" fill="${faces === "classic" ? "#1d1d1d" : PIP[n]}"/>`)
    .join("");
}

/**
 * A tile [a, b] centred at the origin, a on the left, b on the right. A double is turned across (as it lies in a
 * train) unless `flat`. `faces`: "colour" (default), "classic" or "numbers". `upright`: the angle, in degrees, at
 * which digits read upright in the tile's own frame (the board's facing minus the tile's direction), so a tile in a
 * row running right to left doesn't show its numbers upside down (E-022).
 */
export function tileSvg(a, b, h, { faces = "colour", flat = false, upright = 0 } = {}) {
  const across = a === b && !flat;
  const turn = across ? ` transform="rotate(90)"` : "";
  const digits = across ? upright - 90 : upright;
  return `<g${turn}><rect x="${-h}" y="${-h / 2}" width="${2 * h}" height="${h}" rx="${(h * 0.16).toFixed(1)}" fill="#fbf6e9" stroke="#c9bd9d" stroke-width="${(h * 0.04).toFixed(1)}"/>
    <rect x="${-h}" y="${-h / 2}" width="${2 * h}" height="${(h * 0.14).toFixed(1)}" rx="${(h * 0.12).toFixed(1)}" fill="#fff" opacity=".7"/>
    <line x1="0" y1="${(-h * 0.38).toFixed(1)}" x2="0" y2="${(h * 0.38).toFixed(1)}" stroke="#b9ab84" stroke-width="${(h * 0.04).toFixed(1)}"/>
    <g transform="translate(${-h / 2},0)">${half(a, h, faces, digits)}</g><g transform="translate(${h / 2},0)">${half(b, h, faces, digits)}</g></g>`;
}

/** A tile standing upright (for a hand on a phone), as a whole <svg>. */
export function uprightTile(a, b, h = 30) {
  return `<svg viewBox="${-h / 2 - 2} ${-h - 2} ${h + 4} ${2 * h + 4}" width="${h + 4}" height="${2 * h + 4}" aria-hidden="true"><g transform="rotate(90)">${tileSvg(a, b, h, { flat: true })}</g></svg>`;
}
