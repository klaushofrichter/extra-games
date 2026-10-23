// Last Card's sound effects (E-023), made with Web Audio when they play: no files, no music. Each takes
// (ctx, t0, out) as board-kit's playSound expects.

function noise(ctx, seconds) {
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  return src;
}

function tone(ctx, out, t, freq, dur, { type = "sine", gain = 0.25, to = null } = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.05);
}

/** Air moving: a card in flight. */
function swish(ctx, out, t, dur = 0.28, gain = 0.35) {
  const n = noise(ctx, dur), f = ctx.createBiquadFilter(), g = ctx.createGain();
  f.type = "bandpass";
  f.Q.value = 1.2;
  f.frequency.setValueAtTime(900, t);
  f.frequency.exponentialRampToValueAtTime(3200, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.4);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  n.connect(f).connect(g).connect(out);
  n.start(t);
}

/** A card landing on the pile. */
function snap(ctx, out, t) {
  const n = noise(ctx, 0.06), f = ctx.createBiquadFilter(), g = ctx.createGain();
  f.type = "highpass";
  f.frequency.value = 1800;
  g.gain.setValueAtTime(0.6, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  n.connect(f).connect(g).connect(out);
  n.start(t);
  tone(ctx, out, t, 180, 0.08, { gain: 0.25 });
}

export const SOUNDS = {
  throw: (ctx, t, out) => swish(ctx, out, t),
  land: (ctx, t, out) => snap(ctx, out, t),
  draw: (ctx, t, out) => swish(ctx, out, t, 0.22, 0.22),
  skip: (ctx, t, out) => (tone(ctx, out, t, 220, 0.16, { type: "square", gain: 0.12 }), tone(ctx, out, t + 0.18, 165, 0.22, { type: "square", gain: 0.12 })),
  reverse: (ctx, t, out) => (tone(ctx, out, t, 300, 0.22, { type: "triangle", to: 900, gain: 0.2 }), tone(ctx, out, t + 0.22, 900, 0.22, { type: "triangle", to: 300, gain: 0.2 })),
  plus: (ctx, t, out) => (tone(ctx, out, t, 120, 0.3, { type: "sawtooth", to: 60, gain: 0.22 }), snap(ctx, out, t + 0.02)),
  wild: (ctx, t, out) => [523, 659, 784, 1047].forEach((f, i) => tone(ctx, out, t + i * 0.07, f, 0.35, { type: "triangle", gain: 0.18 })),
  lastCard: (ctx, t, out) => {
    [784, 988, 1175, 1568].forEach((f, i) => tone(ctx, out, t + i * 0.09, f, 0.5, { type: "square", gain: 0.08 }));
    tone(ctx, out, t + 0.36, 1568, 0.7, { type: "triangle", gain: 0.2 });
  },
  shuffle: (ctx, t, out) => {
    for (let i = 0; i < 9; i++) snap(ctx, out, t + i * 0.045 + Math.random() * 0.02);
  },
  roundWon: (ctx, t, out) => [523, 659, 784, 659, 1047].forEach((f, i) => tone(ctx, out, t + i * 0.12, f, i === 4 ? 0.8 : 0.22, { type: "triangle", gain: 0.22 })),
};
