// Last Card's cards (E-023), drawn as SVG at any size for the board and the phones. Its own look: a coloured card
// with a white window, the number or symbol large in the middle and small in two corners.
/** Card animation, the board's setting (info.prefs.anim), which the phones read too so drawn cards arrive in time. */
export const SPEEDS = { fast: 0.7, normal: 1, slow: 1.5 };

export const FILL = { r: "#e5484d", y: "#f2b81c", g: "#2fa35b", b: "#2f7fe0" };
const DARK = { r: "#9e1f24", y: "#a06d00", g: "#16683a", b: "#174f99" };
const KINDS = new Set(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "skip", "rev", "+2"]);
const WILDS = new Set(["wild", "+4"]);

/** The symbol of a kind, centred at (0, 0) in a box about 40 wide, in `ink`. */
function symbol(k, ink, big) {
  const s = big ? 1 : 0.42;
  if (/^\d$/.test(k))
    // 6 and 9 are underlined, so a card turned round still reads right.
    return `<text x="0" y="${16 * s}" text-anchor="middle" font-size="${46 * s}" font-weight="900" font-family="system-ui,sans-serif" fill="${ink}">${k}</text>${k === "6" || k === "9" ? `<rect x="${-11 * s}" y="${21 * s}" width="${22 * s}" height="${4 * s}" rx="${1.5 * s}" fill="${ink}"/>` : ""}`;
  if (k === "+2" || k === "+4") return `<text x="0" y="${13 * s}" text-anchor="middle" font-size="${36 * s}" font-weight="900" font-family="system-ui,sans-serif" fill="${ink}">${k}</text>`;
  if (k === "skip") return `<g transform="scale(${s})" fill="none" stroke="${ink}" stroke-width="7"><circle r="16"/><path d="M-11 11 L11 -11"/></g>`;
  if (k === "rev")
    return `<g transform="scale(${s})" fill="none" stroke="${ink}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M-14 -4 A14 14 0 0 1 12 -8"/><path d="M5 -15 L12 -8 L4 -2"/><path d="M14 4 A14 14 0 0 1 -12 8"/><path d="M-5 15 L-12 8 L-4 2"/></g>`;
  return "";
}

/** Four colour quarters: the wild cards' mark. */
const quarters = (r) => {
  const q = (a, c) => {
    const x1 = r * Math.cos(a), y1 = r * Math.sin(a), x2 = r * Math.cos(a + Math.PI / 2), y2 = r * Math.sin(a + Math.PI / 2);
    return `<path d="M0 0 L${x1.toFixed(1)} ${y1.toFixed(1)} A${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z" fill="${c}"/>`;
  };
  return q(-Math.PI, FILL.r) + q(-Math.PI / 2, FILL.y) + q(0, FILL.g) + q(Math.PI / 2, FILL.b);
};

/** A card's face, w × h pixels. `color` tints a wild card that has been played (the colour it called). */
export function cardFace(card, w, h, { color } = {}) {
  // A face can come from a phone's gesture on the board (games-service D-202): only known colours and kinds reach the
  // markup; anything else is drawn as the back.
  if (!(card?.c === "w" ? WILDS.has(card.k) : Object.hasOwn(FILL, card?.c) && KINDS.has(card.k))) return cardBack(w, h);
  if (!Object.hasOwn(FILL, color)) color = undefined;
  const wild = card.c === "w";
  const fill = wild ? "#1d1d22" : FILL[card.c];
  const ink = wild ? "#fff" : FILL[card.c];
  const label = wild ? (card.k === "+4" ? "Wild Draw Four" : "Wild") : `${{ r: "red", y: "yellow", g: "green", b: "blue" }[card.c]} ${card.k}`;
  const centre = wild
    ? `<g transform="translate(50 75)">${quarters(card.k === "+4" ? 22 : 27)}${card.k === "+4" ? `<text x="0" y="44" text-anchor="middle" font-size="20" font-weight="900" font-family="system-ui,sans-serif" fill="#fff">+4</text>` : ""}</g>`
    : `<g transform="translate(50 76)">${symbol(card.k, ink, true)}</g>`;
  const corner = wild ? (card.k === "+4" ? "+4" : "W") : null;
  const small = (x, y, rot) =>
    `<g transform="translate(${x} ${y}) rotate(${rot})">${corner ? `<text x="0" y="5" text-anchor="middle" font-size="15" font-weight="900" font-family="system-ui,sans-serif" fill="#fff">${corner}</text>` : symbol(card.k, "#fff", false)}</g>`;
  return `<svg viewBox="0 0 100 150" width="${w}" height="${h}" role="img" aria-label="${label}">
    <rect x="1" y="1" width="98" height="148" rx="11" fill="#fff"/>
    <rect x="5" y="5" width="90" height="140" rx="8" fill="${fill}"/>
    ${color && wild ? `<rect x="5" y="5" width="90" height="140" rx="8" fill="none" stroke="${FILL[color]}" stroke-width="6"/>` : ""}
    ${wild ? "" : `<rect x="20" y="30" width="60" height="90" rx="12" fill="#fff"/><rect x="20" y="30" width="60" height="90" rx="12" fill="none" stroke="${DARK[card.c]}" stroke-width="1.5" opacity=".35"/>`}
    ${centre}${small(16, 18, 0)}${small(84, 132, 180)}
  </svg>`;
}

/** The back of a card, w × h pixels. */
export function cardBack(w, h) {
  return `<svg viewBox="0 0 100 150" width="${w}" height="${h}" aria-hidden="true">
    <rect x="1" y="1" width="98" height="148" rx="11" fill="#fff"/>
    <rect x="5" y="5" width="90" height="140" rx="8" fill="#1b2340"/>
    <clipPath id="lc-back-clip"><rect x="5" y="5" width="90" height="140" rx="8"/></clipPath>
    <g clip-path="url(#lc-back-clip)"><g transform="translate(50 75) rotate(-30)">
      <rect x="-60" y="-14" width="120" height="28" fill="${FILL.r}"/><rect x="-60" y="-14" width="120" height="4" fill="${FILL.y}"/><rect x="-60" y="10" width="120" height="4" fill="${FILL.b}"/>
      <text x="0" y="6" text-anchor="middle" font-size="15" font-weight="900" font-style="italic" font-family="system-ui,sans-serif" fill="#fff" letter-spacing="1">LAST CARD</text>
    </g></g>
    <rect x="5" y="5" width="90" height="140" rx="8" fill="none" stroke="#3a4672" stroke-width="2"/>
  </svg>`;
}
