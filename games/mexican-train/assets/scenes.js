// The game's background engine (E-020): screensaver-style scenes behind the table, all of our own, on classic
// techniques (aurora curtains, metaballs, demo-scene plasma, a flow field). Shader scenes and the 2D one render at a
// third of the board's resolution and are stretched, at most 30 frames a second, paused while the page is hidden.
// Starfield and Clouds are pictures painted once and slid by the compositor. With motion off (the board setting, or a
// viewer who asked for reduced motion) every scene shows one still frame. The game's code, not the platform's.

export const BACKGROUNDS = [
  { id: "aurora", label: "Aurora" },
  { id: "lava", label: "Lava lamp" },
  { id: "plasma", label: "Plasma" },
  { id: "fireflies", label: "Fireflies" },
  { id: "stars", label: "Starfield" },
  { id: "clouds", label: "Clouds" },
];

const SCENE_W = 640, SCENE_H = 360;
const VERT = "attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }";
const NOISE = `
  float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
  float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * n(p); p *= 2.03; a *= 0.5; } return v; }`;

const SHADERS = {
  // Green and violet curtains folding slowly over a night sky.
  aurora: `precision mediump float; uniform float t; uniform vec2 r; ${NOISE}
    void main() {
      vec2 uv = gl_FragCoord.xy / r; uv.x *= r.x / r.y;
      vec3 col = mix(vec3(0.02, 0.03, 0.09), vec3(0.04, 0.06, 0.16), uv.y);
      for (int k = 0; k < 3; k++) {
        float fk = float(k);
        float x = uv.x * (1.2 + fk * 0.3) + t * (0.015 + fk * 0.006);
        float band = 0.45 + 0.22 * sin(x * 2.1 + fk * 2.0 + t * 0.05) + 0.12 * fbm(vec2(x * 1.5, t * 0.03 + fk));
        float d = abs(uv.y - band);
        float curtain = exp(-d * (9.0 + fk * 4.0)) * (0.6 + 0.4 * fbm(vec2(x * 7.0, uv.y * 2.0 - t * 0.08)));
        col += mix(vec3(0.15, 0.95, 0.55), vec3(0.6, 0.35, 1.0), fk / 2.0) * curtain * 0.42;
      }
      gl_FragColor = vec4(col + step(0.997, h(floor(gl_FragCoord.xy))) * 0.6, 1.0);
    }`,
  // Warm blobs that drift, meet and part (metaballs).
  lava: `precision mediump float; uniform float t; uniform vec2 r;
    void main() {
      vec2 uv = gl_FragCoord.xy / r; uv.x *= r.x / r.y;
      float f = 0.0;
      for (int i = 0; i < 7; i++) {
        float fi = float(i);
        vec2 c = vec2(0.89 + 0.7 * sin(t * (0.05 + fi * 0.011) + fi * 1.7), 0.5 + 0.36 * cos(t * (0.043 + fi * 0.009) + fi * 2.3));
        float rad = 0.10 + 0.04 * sin(fi * 3.1);
        f += rad * rad / dot(uv - c, uv - c);
      }
      vec3 bg = vec3(0.10, 0.03, 0.12);
      vec3 lava = mix(vec3(0.95, 0.30, 0.20), vec3(1.0, 0.65, 0.25), clamp(f - 1.0, 0.0, 1.0));
      float glow = smoothstep(0.3, 0.9, f) * 0.25;
      gl_FragColor = vec4(mix(bg + glow * vec3(0.9, 0.3, 0.4), lava * 0.75, smoothstep(0.85, 1.05, f)), 1.0);
    }`,
  // The demo-scene classic, slow, dimmed and a little less saturated.
  plasma: `precision mediump float; uniform float t; uniform vec2 r;
    void main() {
      vec2 uv = gl_FragCoord.xy / r * 6.0;
      float v = sin(uv.x + t * 0.21) + sin(uv.y * 0.8 + t * 0.17) + sin((uv.x + uv.y) * 0.6 + t * 0.13) + sin(length(uv - 3.0) * 1.3 - t * 0.25);
      vec3 col = 0.5 + 0.5 * cos(v * 1.4 + t * 0.05 + vec3(0.0, 2.1, 4.2));
      col = mix(vec3(dot(col, vec3(0.33))), col, 0.65);
      gl_FragColor = vec4(col * 0.26 + vec3(0.03, 0.03, 0.08), 1.0);
    }`,
};

/** Fireflies: small lights following a slowly turning flow field, leaving short fading trails (2D canvas). */
function fireflies(el) {
  const g = el.getContext("2d");
  const pts = Array.from({ length: 260 }, () => ({ x: Math.random() * SCENE_W, y: Math.random() * SCENE_H, life: Math.random() * 400, hue: 40 + Math.random() * 40 }));
  g.fillStyle = "#06120e";
  g.fillRect(0, 0, SCENE_W, SCENE_H);
  return (secs) => {
    g.fillStyle = "rgba(6, 18, 14, 0.09)";
    g.fillRect(0, 0, SCENE_W, SCENE_H);
    g.globalCompositeOperation = "lighter";
    for (const p of pts) {
      const a = Math.sin(p.x * 0.012 + secs * 0.05) * 1.6 + Math.cos(p.y * 0.015 - secs * 0.04) * 1.6;
      p.x += Math.cos(a) * 0.6;
      p.y += Math.sin(a) * 0.6;
      if (--p.life < 0 || p.x < 0 || p.y < 0 || p.x > SCENE_W || p.y > SCENE_H) Object.assign(p, { x: Math.random() * SCENE_W, y: Math.random() * SCENE_H, life: 200 + Math.random() * 400 });
      g.fillStyle = `hsla(${p.hue}, 100%, 65%, ${0.5 * (0.4 + 0.6 * Math.abs(Math.sin(secs * 1.5 + p.hue)))})`;
      g.beginPath();
      g.arc(p.x, p.y, 1.2, 0, 7);
      g.fill();
    }
    g.globalCompositeOperation = "source-over";
  };
}

// ---------- Starfield and Clouds: pictures that repeat without a seam, painted once ----------

function paint(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  return c.toDataURL("image/png");
}
function seeded(n) {
  let s = n;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
/** Draw f at (x, y) and, near the edges, again one picture over, so the picture repeats without a seam. */
function wrap(w, h, x, y, r, f) {
  for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) if (x + dx > -r && x + dx < w + r && y + dy > -r && y + dy < h + r) f(x + dx, y + dy);
}
function glowBlobs(g, w, h, blobs) {
  for (const [x, y, r, col] of blobs) {
    wrap(w, h, x, y, r, (X, Y) => {
      const rg = g.createRadialGradient(X, Y, 0, X, Y, r);
      rg.addColorStop(0, col);
      rg.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = rg;
      g.fillRect(X - r, Y - r, 2 * r, 2 * r);
    });
  }
}
const SKY = {
  stars() {
    const base = paint(960, 540, (g, w, h) => {
      g.fillStyle = "#080b22"; // flat: a gradient would show a seam where the picture repeats
      g.fillRect(0, 0, w, h);
      glowBlobs(g, w, h, [[220, 140, 260, "rgba(120,80,220,.22)"], [700, 380, 300, "rgba(40,160,200,.18)"], [520, 90, 180, "rgba(220,90,160,.12)"]]);
    });
    const stars = (count, big, seed) =>
      paint(960, 540, (g, w, h) => {
        const r2 = seeded(seed);
        for (let i = 0; i < count; i++) {
          const x = r2() * w, y = r2() * h, r = big ? 0.8 + r2() * 1.4 : 0.3 + r2() * 0.7;
          g.fillStyle = ["#ffffff", "#cfe3ff", "#fff1c9", "#ffd6e8"][Math.floor(r2() * 4)];
          g.globalAlpha = big ? 0.75 + r2() * 0.25 : 0.35 + r2() * 0.4;
          wrap(w, h, x, y, 3, (X, Y) => {
            g.beginPath();
            g.arc(X, Y, r, 0, 7);
            g.fill();
          });
        }
      });
    return [{ img: base, secs: 600 }, { img: stars(420, false, 3), secs: 360 }, { img: stars(70, true, 5), secs: 180 }];
  },
  clouds() {
    const base = paint(960, 540, (g, w, h) => {
      g.fillStyle = "#2a62a8";
      g.fillRect(0, 0, w, h);
      glowBlobs(g, w, h, [[200, 120, 300, "rgba(120,180,240,.35)"], [720, 400, 320, "rgba(20,50,110,.35)"]]);
    });
    const clouds = (n, alpha, size, seed) =>
      paint(960, 540, (g, w, h) => {
        const r2 = seeded(seed);
        for (let i = 0; i < n; i++) {
          const cx = r2() * w, cy = r2() * h, puffs = 7 + Math.floor(r2() * 7);
          for (let k = 0; k < puffs; k++) {
            const x = cx + (r2() - 0.5) * size * 2.2, y = cy + (r2() - 0.5) * size * 0.8, r = size * (0.35 + r2() * 0.5);
            wrap(w, h, x, y, r + 20, (X, Y) => {
              const rg = g.createRadialGradient(X, Y, 0, X, Y, r);
              rg.addColorStop(0, `rgba(255,255,255,${alpha})`);
              rg.addColorStop(0.6, `rgba(255,255,255,${alpha * 0.5})`);
              rg.addColorStop(1, "rgba(255,255,255,0)");
              g.fillStyle = rg;
              g.fillRect(X - r, Y - r, 2 * r, 2 * r);
            });
          }
        }
      });
    return [{ img: base, secs: 0 }, { img: clouds(6, 0.3, 70, 9), secs: 420 }, { img: clouds(4, 0.45, 110, 13), secs: 220 }];
  },
};
const skyCache = {};

/**
 * Start background `name` in `box` (a layer covering the board); `moving` false shows one still frame. Returns a
 * function that stops it and removes what it added.
 */
export function startBackground(box, name, moving) {
  const layer = document.createElement("div");
  layer.className = "mt-bg";
  box.appendChild(layer);
  const stop = () => layer.remove();
  if (SKY[name]) {
    for (const l of (skyCache[name] ??= SKY[name]())) {
      // Twice the board's size, its picture repeating every half board; it slides by one picture and starts over.
      const el = document.createElement("div");
      el.className = "mt-sky";
      el.style.backgroundImage = `url(${l.img})`;
      layer.appendChild(el);
      if (l.secs && moving) el.animate([{ transform: "translate(0,0)" }, { transform: name === "stars" ? "translate(-25%,-25%)" : "translate(-25%,0)" }], { duration: l.secs * 1000, iterations: Infinity });
    }
    return stop;
  }
  const el = document.createElement("canvas");
  el.width = SCENE_W;
  el.height = SCENE_H;
  el.className = "mt-scene";
  layer.appendChild(el);
  const t0 = performance.now() - 120000 * Math.random(); // somewhere in the scene, not always its first frame
  let draw;
  if (name === "fireflies") draw = fireflies(el);
  else {
    const gl = el.getContext("webgl", { antialias: false, alpha: false });
    if (!gl) return stop;
    try {
      const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
        return s;
      };
      const prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, SHADERS[name] ?? SHADERS.aurora));
      gl.linkProgram(prog);
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, "p");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      const ut = gl.getUniformLocation(prog, "t");
      gl.uniform2f(gl.getUniformLocation(prog, "r"), SCENE_W, SCENE_H);
      draw = (secs) => {
        gl.uniform1f(ut, secs);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      };
    } catch {
      return stop; // no shaders on this graphics card: the plain table colour shows instead
    }
  }
  let raf = 0, last = 0;
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    if (document.hidden || now - last < 1000 / 30) return; // at most 30 frames a second
    last = now;
    draw((now - t0) / 1000);
  };
  if (moving) raf = requestAnimationFrame(loop);
  else draw((performance.now() - t0) / 1000);
  return () => {
    cancelAnimationFrame(raf);
    stop();
  };
}
