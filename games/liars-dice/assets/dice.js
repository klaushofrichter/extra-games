// Dice drawing shared by the board and the phones: an ivory die as inline SVG, so it scales cleanly at any size.
const PIPS = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[26, 26], [50, 50], [74, 74]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[26, 26], [74, 26], [50, 50], [26, 74], [74, 74]],
  6: [[28, 24], [72, 24], [28, 50], [72, 50], [28, 76], [72, 76]],
};

/**
 * One die. `face` 1–6, or 0/null for a hidden die (a cup). Options: size in px, `hl` to highlight it (it counts
 * toward the bid), `dim` to fade it, `wild` to mark a wild one, `cls` for extra classes.
 */
export function die(face, { size = 48, hl = false, dim = false, wild = false, cls = "" } = {}) {
  const pips = (PIPS[face] ?? []).map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${face === 1 ? 11 : 9}" fill="${face === 1 ? "#b8322a" : "#1d1b17"}"/>`).join("");
  const body = face ? (hl ? "#fff4cf" : "#f7f2e6") : "#3b2a1a";
  const ring = hl ? `<rect x="3" y="3" width="94" height="94" rx="20" fill="none" stroke="#e7b84d" stroke-width="7"/>` : "";
  const q = face ? "" : `<text x="50" y="64" font-size="44" text-anchor="middle" fill="#d6b88a" font-family="Georgia,serif">?</text>`;
  const star = wild ? `<text x="88" y="22" font-size="22" text-anchor="middle" fill="#e7b84d">★</text>` : "";
  return `<svg class="ld-die ${cls}" viewBox="0 0 100 100" width="${size}" height="${size}" style="opacity:${dim ? 0.35 : 1}" role="img" aria-label="${face ? `die showing ${face}` : "hidden die"}">
    <rect x="6" y="6" width="88" height="88" rx="18" fill="${body}" stroke="rgba(0,0,0,.35)" stroke-width="2"/>${ring}${pips}${q}${star}</svg>`;
}

/** Does a die count toward a bid on `face`? */
export const counts = (d, face, onesWild) => d === face || (onesWild && face !== 1 && d === 1);

/** "4 fives", "one six": a bid in words. */
const NAMES = ["", "one", "two", "three", "four", "five", "six"];
const PLURAL = ["", "ones", "twos", "threes", "fours", "fives", "sixes"];
export function bidText(b) {
  if (!b) return "";
  return `${b.quantity < 7 ? NAMES[b.quantity] ?? b.quantity : b.quantity} ${b.quantity === 1 ? NAMES[b.face] : PLURAL[b.face]}`;
}

// Sound effects (games-service D-092), synthesised with the board kit's ping(): no audio files.
/** Dice rattling in cups. */
export function shakeSound(ctx, t, out, ping) {
  for (let k = 0; k < 14; k++) ping(ctx, out, t + k * 0.035 + (k % 3) * 0.008, { freq: 900 + ((k * 397) % 700), partials: [1, 2.3], decay: 0.04, gain: 0.08 });
}
/** Cups lifted: one clack, then a soft settle. */
export function revealSound(ctx, t, out, ping) {
  ping(ctx, out, t, { freq: 620, partials: [1, 1.9, 3.1], decay: 0.18, gain: 0.35 });
  ping(ctx, out, t + 0.09, { freq: 740, partials: [1, 2.2], decay: 0.12, gain: 0.18 });
}
