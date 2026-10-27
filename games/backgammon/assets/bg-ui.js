// Shared by Backgammon's board and phone: dice faces, notation in a player's own numbering, and the sounds.

/** Pip positions on a 3 × 3 grid (0–8, row by row) for each face. */
export const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

/** A die as HTML: `used` dims it. */
/** Shows face n on a die drawn by dieHtml, in place (the dice tumbling while a roll lands). */
export function setFace(el, n) {
  el.querySelectorAll("i").forEach((pip, k) => (pip.style.visibility = PIPS[n]?.includes(k) ? "visible" : "hidden"));
}
export function dieHtml(n, { size = 56, used = false, cls = "" } = {}) {
  const pips = Array.from({ length: 9 }, (_, k) => `<i style="visibility:${PIPS[n]?.includes(k) ? "visible" : "hidden"}"></i>`).join("");
  return `<span class="bg-die ${used ? "used" : ""} ${cls}" style="--s:${size}px" aria-label="${n}">${pips}</span>`;
}

/** The dice of a roll, each marked used once played: [a, b] and what is left to play. */
export function diceState(dice, remaining, phase) {
  if (!dice) return [];
  const all = dice[0] === dice[1] ? [dice[0], dice[0], dice[0], dice[0]] : [dice[0], dice[1]];
  if (phase !== "move") return all.map((n) => ({ n, used: false }));
  const left = [...remaining];
  // Used dice are the ones no longer in `remaining`; mark from the end so the first die stays lit longest.
  return all.map((n) => {
    const i = left.indexOf(n);
    if (i >= 0) {
      left.splice(i, 1);
      return { n, used: false };
    }
    return { n, used: true };
  });
}

/** An absolute spot (1–24, "bar", "off") in the numbering of the player of `color` (White counts 24 → 1). */
export const ownNumber = (spot, color) => (typeof spot === "number" ? (color === 0 ? spot : 25 - spot) : spot);
export const moveText = (m, color) => `${ownNumber(m.from, color)}/${ownNumber(m.to, color)}${m.hit ? "*" : ""}`;

export const COLOR_NAME = ["White", "Black"];

// ---------- sounds (Web Audio, no files; through the board kit's playSound) ----------
function noise(c, out, t, { freq, q = 3, gain = 0.5, decay = 0.06 }) {
  const len = Math.ceil(c.sampleRate * (decay + 0.02));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  src.connect(f).connect(g).connect(out);
  src.start(t);
  src.stop(t + decay + 0.03);
}
function tone(c, out, t, { from, to = from, dur, gain = 0.25, type = "sine" }) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(from, t);
  if (to !== from) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export const ROLL_MS = 1300;
/** Two dice shaken in a cup and thrown on the board: rattles, then two landings. */
export function rollSound(c, t, out) {
  [0, 0.04, 0.08, 0.13, 0.18, 0.24, 0.3].forEach((at, k) => noise(c, out, t + at, { freq: 1600 + ((k * 431) % 900), gain: 0.4, decay: 0.04 }));
  noise(c, out, t + 0.45, { freq: 900, q: 2, gain: 0.55, decay: 0.07 });
  noise(c, out, t + 0.53, { freq: 1100, q: 2, gain: 0.45, decay: 0.06 });
  noise(c, out, t + 0.6, { freq: 1300, q: 2, gain: 0.25, decay: 0.05 });
}
/** A checker set down on the board: a wooden click. */
export function checkerSound(c, t, out) {
  noise(c, out, t, { freq: 1300, q: 4, gain: 0.55, decay: 0.05 });
  tone(c, out, t, { from: 420, to: 220, dur: 0.07, gain: 0.15 });
}
/** A hit: the checker knocked off to the bar with a sharper clack and a slide. */
export function hitSound(c, t, out) {
  noise(c, out, t, { freq: 2200, q: 3, gain: 0.7, decay: 0.05 });
  tone(c, out, t + 0.04, { from: 700, to: 160, dur: 0.35, gain: 0.18, type: "triangle" });
  noise(c, out, t + 0.36, { freq: 600, q: 1.5, gain: 0.4, decay: 0.08 });
}
/** A checker borne off: a soft drop into the tray. */
export function offSound(c, t, out) {
  noise(c, out, t, { freq: 700, q: 2, gain: 0.45, decay: 0.08 });
  tone(c, out, t, { from: 300, to: 180, dur: 0.12, gain: 0.12 });
}
/** The cube turned: a heavy knock and a low bell. */
export function cubeSound(c, t, out) {
  noise(c, out, t, { freq: 500, q: 1.5, gain: 0.7, decay: 0.1 });
  tone(c, out, t + 0.05, { from: 330, dur: 0.6, gain: 0.18 });
  tone(c, out, t + 0.05, { from: 495, dur: 0.5, gain: 0.08 });
}
/** A move that isn't allowed (a checker dropped where it can't go): a low "uh-uh", and it slides back (E-034). */
export function badSound(c, t, out) {
  tone(c, out, t, { from: 220, to: 196, dur: 0.14, gain: 0.2, type: "square" });
  tone(c, out, t + 0.18, { from: 175, to: 147, dur: 0.22, gain: 0.2, type: "square" });
}
/** A game won: three rising notes. */
export function winSound(c, t, out) {
  [523, 659, 784, 1047].forEach((f, k) => tone(c, out, t + k * 0.13, { from: f, dur: 0.5, gain: 0.16 }));
}
