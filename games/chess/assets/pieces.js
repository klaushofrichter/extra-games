// Chess pieces drawn for Game Table: simple geometric shapes in a 100 × 100 box, light pieces with dark outlines and
// dark pieces with light ones, so both read on light and dark squares. Shared by the board and the phones.

const BASE = `<rect x="18" y="80" width="64" height="11" rx="4"/><rect x="26" y="72" width="48" height="9" rx="2"/>`;

const SHAPES = {
  p: `<circle cx="50" cy="30" r="12"/><ellipse cx="50" cy="45" rx="14" ry="4"/><path d="M41 47 H59 L66 72 H34 Z"/>`,
  r: `<path d="M33 38 H67 L69 72 H31 Z"/><path d="M25 18 H36 V26 H44 V18 H56 V26 H64 V18 H75 V38 H25 Z"/>`,
  n: `<path d="M31 72 C31 57 38 51 46 45 C40 45 34 49 28 47 C23 41 29 33 35 29 C39 19 49 12 59 14 C73 18 77 37 72 56 L70 72 Z"/>
      <circle cx="47" cy="27" r="3" fill="{D}" stroke="none"/>`,
  b: `<circle cx="50" cy="11" r="5"/><path d="M50 15 C64 27 64 41 58 51 H42 C36 41 36 27 50 15 Z"/><line x1="55" y1="25" x2="47" y2="37" stroke="{D}" stroke-width="3"/>
      <path d="M41 52 H59 L64 72 H36 Z"/>`,
  q: `<path d="M24 30 L32 47 L37 24 L44 43 L50 19 L56 43 L63 24 L68 47 L76 30 L70 60 H30 Z"/>
      <circle cx="24" cy="28" r="4"/><circle cx="37" cy="22" r="4"/><circle cx="50" cy="17" r="4"/><circle cx="63" cy="22" r="4"/><circle cx="76" cy="28" r="4"/>
      <path d="M31 60 H69 L65 72 H35 Z"/>`,
  k: `<rect x="46" y="4" width="8" height="24" rx="1"/><rect x="39" y="10" width="22" height="8" rx="1"/>
      <path d="M27 36 C27 25 73 25 73 36 L66 60 H34 Z"/><path d="M34 60 H66 L64 72 H36 Z"/>`,
};

const STYLE = {
  w: { fill: "#f3ead8", stroke: "#241a10", detail: "#241a10" },
  b: { fill: "#2a2420", stroke: "#e2d3b2", detail: "#e2d3b2" },
};

/** SVG markup for a piece letter (FEN: upper case white, lower case black). */
export function pieceSvg(letter, size = 80) {
  const side = letter === letter.toUpperCase() ? "w" : "b";
  const st = STYLE[side];
  const t = letter.toLowerCase();
  return `<svg class="cp-piece cp-${side}${t}" viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true">
    <g fill="${st.fill}" stroke="${st.stroke}" stroke-width="3.5" stroke-linejoin="round">${SHAPES[t].replaceAll("{D}", st.detail)}${BASE}</g></svg>`;
}

/** Piece names for texts. */
export const PIECE_NAME = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
export const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** "4:05", or "0:09.3" under ten seconds (the same as the rules' clockText). */
export function clockText(ms) {
  const t = Math.max(0, ms);
  if (t < 10_000) return `0:0${(Math.floor(t / 100) / 10).toFixed(1)}`;
  const s = Math.floor(t / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** The time on a colour's clock now: the running one counts down from the host's flag timer. */
export function clockLeft(view, info, color, remainingMs) {
  if (!view.clock) return null;
  if (view.clock.running === color) {
    const ms = remainingMs(info, "flag");
    return ms === null ? view.clock.left[color] : ms;
  }
  return view.clock.left[color];
}

/** Moves as numbered pairs: [{ n: 1, w: "e4", b: "e5" }, ...]. */
export function movePairs(sans) {
  const out = [];
  for (let i = 0; i < sans.length; i += 2) out.push({ n: i / 2 + 1, w: sans[i], b: sans[i + 1] ?? "" });
  return out;
}

/** Material the colour is up, from the captured pieces ("QRP" white lost, "nb" black lost). */
export function materialEdge(captured, color) {
  const sum = (s) => [...s].reduce((a, ch) => a + VALUE[ch.toLowerCase()], 0);
  const d = sum(captured.black) - sum(captured.white);
  return color === 0 ? d : -d;
}

/** A wooden knock for a move, a sharper one for a capture (Web Audio, no files). */
export function moveSound(capture) {
  return (c, t, out) => {
    const len = 0.09;
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * len), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 6);
    const src = c.createBufferSource();
    src.buffer = buf;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = capture ? 1900 : 1100;
    bp.Q.value = 3;
    const g = c.createGain();
    g.gain.setValueAtTime(capture ? 0.9 : 0.7, t);
    src.connect(bp).connect(g).connect(out);
    src.start(t);
    const o = c.createOscillator();
    o.frequency.setValueAtTime(capture ? 260 : 180, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.08);
    const og = c.createGain();
    og.gain.setValueAtTime(0.35, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(og).connect(out);
    o.start(t);
    o.stop(t + 0.12);
    if (capture) {
      const s2 = c.createBufferSource();
      s2.buffer = buf;
      s2.connect(bp);
      s2.start(t + 0.05);
    }
  };
}
