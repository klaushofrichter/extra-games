// Mexican Train's sounds and music (E-020), all synthesised with Web Audio: no files, nothing to license.
// Effects are `make(ctx, t0, out)` functions for the board kit's playSound(), which plays them only while the
// table's sound is on. The music composes itself: every tune picks a key, a mode, a tempo, two chord progressions and
// a melodic motif and plays them as A A B A (about 40 s); then the next tune starts with new choices.

function noise(c, dur) {
  const b = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = c.createBufferSource();
  s.buffer = b;
  return s;
}
function tone(c, out, t, f, dur, { type = "sine", gain = 0.3, attack = 0.005 } = {}) {
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.value = f;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.05);
}

/** Sound effects, by name, for playSound(info, name, make). */
export const SOUNDS = {
  // A tile set down on another.
  clack(c, t, out) {
    const n = noise(c, 0.06), f = c.createBiquadFilter(), g = c.createGain();
    f.type = "bandpass";
    f.frequency.value = 2600;
    f.Q.value = 3;
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    n.connect(f).connect(g).connect(out);
    n.start(t);
    tone(c, out, t, 190, 0.08, { gain: 0.35 });
  },
  // A double: the click and a two-note chime (its player plays again).
  double(c, t, out) {
    SOUNDS.clack(c, t, out);
    tone(c, out, t + 0.08, 1318, 0.5, { gain: 0.18 });
    tone(c, out, t + 0.2, 1760, 0.7, { gain: 0.18 });
  },
  // A rustle from the boneyard.
  draw(c, t, out) {
    const n = noise(c, 0.32), f = c.createBiquadFilter(), g = c.createGain();
    f.type = "lowpass";
    f.frequency.value = 1400;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.05);
    g.gain.linearRampToValueAtTime(0.15, t + 0.15);
    g.gain.linearRampToValueAtTime(0.4, t + 0.2);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    n.connect(f).connect(g).connect(out);
    n.start(t);
  },
  // A little steam whistle: a marker goes on a train.
  whistle(c, t, out) {
    const f = c.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 900;
    f.Q.value = 1.2;
    f.connect(out);
    for (const fr of [523, 659, 784]) {
      const o = c.createOscillator(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
      o.type = "sawtooth";
      o.frequency.value = fr;
      lfo.frequency.value = 6;
      lg.gain.value = 6;
      lfo.connect(lg).connect(o.frequency);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.09, t + 0.06);
      g.gain.setValueAtTime(0.09, t + 0.45);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
      o.connect(g).connect(f);
      o.start(t);
      lfo.start(t);
      o.stop(t + 0.75);
      lfo.stop(t + 0.75);
    }
  },
  // A soft ding when a player's turn begins.
  turn(c, t, out) {
    tone(c, out, t, 988, 0.4, { gain: 0.2 });
  },
  // "Domino!": someone played their last tile.
  domino(c, t, out) {
    const f = c.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 2400;
    f.connect(out);
    [[523, 0], [659, 0.12], [784, 0.24], [1047, 0.36]].forEach(([fr, d], i) => tone(c, f, t + d, fr, i === 3 ? 0.9 : 0.2, { type: "sawtooth", gain: 0.16, attack: 0.02 }));
  },
  // Bells while the round's scores show.
  round(c, t, out) {
    [784, 988, 1175, 1568].forEach((fr, i) => tone(c, out, t + i * 0.09, fr, 1.2, { gain: 0.14 }));
  },
};

// ---------- music ----------

const hz = (m) => 440 * 2 ** ((m - 69) / 12);
const MODES = { major: [0, 2, 4, 5, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10], dorian: [0, 2, 3, 5, 7, 9, 10] };
// Progressions as scale degrees (0 = the tonic chord), four bars each; rhythms for a bar of melody, in beats.
const PROGRESSIONS = [[0, 4, 5, 3], [0, 5, 3, 4], [5, 3, 0, 4], [0, 3, 4, 4], [1, 4, 0, 0], [0, 3, 0, 4], [3, 4, 2, 5], [0, 6, 3, 4]];
const RHYTHMS = [[1, 1, 1, 1], [1.5, 0.5, 1, 1], [0.5, 0.5, 1, 2], [1, 0.5, 0.5, 2], [0.75, 0.75, 0.5, 2], [2, 1, 1], [0.5, 0.5, 0.5, 0.5, 2], [1, 1, 2]];

/** A tune's choices, from a random source. */
export function composeTune(rnd) {
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const modeName = pick(Object.keys(MODES));
  return {
    root: 55 + Math.floor(rnd() * 9),
    modeName,
    mode: MODES[modeName],
    bpm: 92 + Math.floor(rnd() * 28),
    a: pick(PROGRESSIONS),
    b: pick(PROGRESSIONS),
    lead: rnd() < 0.5 ? "pluck" : "marimba",
    swing: rnd() < 0.5 ? 0.08 : 0,
    motif: { rhythm: pick(RHYTHMS), steps: Array.from({ length: 6 }, () => pick([-2, -1, -1, 0, 1, 1, 2, 3])) },
    bRhythm: pick(RHYTHMS),
  };
}
const degreeNote = (t, d) => t.root + 12 * Math.floor(d / t.mode.length) + t.mode[((d % t.mode.length) + t.mode.length) % t.mode.length];

/** One bar of melody over a chord: strong beats on chord tones, the rest following the motif's contour. */
function melodyBar(t, chord, rhythm, steps, rnd, lift) {
  const tones = [chord, chord + 2, chord + 4];
  let d = tones[Math.floor(rnd() * 3)] + 7 + lift;
  const notes = [];
  let beat = 0;
  rhythm.forEach((len, i) => {
    if (i > 0) d += steps[i % steps.length];
    if (Number.isInteger(beat) && beat % 2 === 0) d = [...tones.map((x) => x + 7 + lift), ...tones.map((x) => x + 14 + lift)].sort((a, b) => Math.abs(a - d) - Math.abs(b - d))[0];
    if (!(rnd() < 0.12 && i > 0)) notes.push({ beat, len, midi: degreeNote(t, d) });
    beat += len;
  });
  return notes;
}

const plucks = new Map();
/** Karplus–Strong plucked string, computed once per note. */
function pluckBuffer(c, midi) {
  if (plucks.has(midi)) return plucks.get(midi);
  const sr = c.sampleRate, n = Math.max(2, Math.round(sr / hz(midi))), len = Math.floor(sr * 1.6);
  const buf = c.createBuffer(1, len, sr), d = buf.getChannelData(0), ring = new Float32Array(n);
  for (let i = 0; i < n; i++) ring[i] = Math.random() * 2 - 1;
  for (let i = 0, k = 0; i < len; i++, k = (k + 1) % n) {
    d[i] = ring[k];
    ring[k] = 0.996 * 0.5 * (ring[k] + ring[(k + 1) % n]);
  }
  plucks.set(midi, buf);
  return buf;
}
function pluck(c, out, t, midi, gain) {
  const s = c.createBufferSource(), g = c.createGain(), f = c.createBiquadFilter();
  s.buffer = pluckBuffer(c, midi);
  f.type = "lowpass";
  f.frequency.value = 3200;
  g.gain.value = gain;
  s.connect(f).connect(g).connect(out);
  s.start(t);
}
function drum(c, out, t, kind) {
  if (kind === "kick") {
    const o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.18);
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.3);
    return;
  }
  const shaker = kind === "shaker";
  const n = noise(c, shaker ? 0.05 : 0.12), f = c.createBiquadFilter(), g = c.createGain();
  f.type = shaker ? "highpass" : "bandpass";
  f.frequency.value = shaker ? 6500 : 1800;
  g.gain.setValueAtTime(shaker ? 0.07 : 0.16, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + (shaker ? 0.05 : 0.12));
  n.connect(f).connect(g).connect(out);
  n.start(t);
}

function playBar(c, bus, t, part, bar, t0, rnd) {
  const beat = 60 / t.bpm;
  const chord = (part === "B" ? t.b : t.a)[bar % 4];
  const at = (b) => t0 + (b + (t.swing && b % 1 === 0.5 ? t.swing : 0)) * beat;
  tone(c, bus, at(0), hz(degreeNote(t, chord) - 24), beat * 1.7, { type: "triangle", gain: 0.32 });
  tone(c, bus, at(2), hz(degreeNote(t, chord + 4) - 24), beat * 1.5, { type: "triangle", gain: 0.26 });
  if (rnd() < 0.4) tone(c, bus, at(3.5), hz(degreeNote(t, chord + 1) - 24), beat * 0.45, { type: "triangle", gain: 0.2 });
  const triad = [chord, chord + 2, chord + 4].map((d) => degreeNote(t, d));
  if (part === "B") triad.forEach((m) => tone(c, bus, at(0), hz(m), beat * 3.8, { gain: 0.06, attack: 0.4 }));
  else for (const b of [0.5, 1.5, 2.5, 3.5]) triad.forEach((m, i) => pluck(c, bus, at(b) + i * 0.012, m, 0.09));
  const notes = part === "B" ? melodyBar(t, chord, t.bRhythm, t.motif.steps.map((x) => -x), rnd, 2) : melodyBar(t, chord, t.motif.rhythm, t.motif.steps, rnd, bar % 4 === 3 ? -1 : 0);
  for (const n of notes) {
    if (t.lead === "pluck") pluck(c, bus, at(n.beat), n.midi, 0.28);
    else {
      tone(c, bus, at(n.beat), hz(n.midi), Math.min(1.2, n.len * beat + 0.4), { gain: 0.2 });
      tone(c, bus, at(n.beat), hz(n.midi) * 4, 0.12, { gain: 0.05 });
    }
  }
  for (let b = 0; b < 4; b += 0.5) drum(c, bus, at(b), "shaker");
  drum(c, bus, at(0), "kick");
  if (part !== "B" || bar % 2) drum(c, bus, at(2), "kick");
  drum(c, bus, at(3), "rim");
}

/**
 * Background music on an AudioContext `c`: `start(level)` ("soft" or "on") begins composing, `stop()` fades out.
 * Starting again while it plays only changes the volume.
 */
export function createMusic(c) {
  let bus = null, timer = 0;
  const level = (l) => (l === "soft" ? 0.14 : 0.26);
  return {
    get playing() {
      return !!bus;
    },
    start(l) {
      if (bus) return void bus.gain.setTargetAtTime(level(l), c.currentTime, 0.3);
      bus = c.createGain();
      bus.gain.value = level(l);
      bus.connect(c.destination);
      let seed = 1 + Math.floor(Math.random() * 1e6);
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const form = ["A", "A", "B", "A"];
      let tune = composeTune(rnd), section = 0, bar = 0, next = c.currentTime + 0.15;
      const out = bus;
      const schedule = () => {
        while (next < c.currentTime + 1.5) {
          playBar(c, out, tune, form[section], bar, next, rnd);
          next += (4 * 60) / tune.bpm;
          if (++bar === 4) {
            bar = 0;
            if (++section === form.length) {
              section = 0;
              tune = composeTune(rnd);
              next += 60 / tune.bpm; // a breath between tunes
            }
          }
        }
      };
      schedule();
      timer = setInterval(schedule, 300);
    },
    stop() {
      if (!bus) return;
      clearInterval(timer);
      const b = bus;
      bus = null;
      b.gain.setTargetAtTime(0, c.currentTime, 0.2);
      setTimeout(() => b.disconnect(), 800);
    },
  };
}
