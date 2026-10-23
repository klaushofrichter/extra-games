// Pure helpers for Last Card's board (E-025): no DOM, so the tests can check them.

const FLIP = { 0: "0", 1: "1", 6: "9", 8: "8", 9: "6" };

/**
 * Whether a number reads as another number upside down (6, 9, 16, 18, 66 …; not 8, 11 or 10): a hand's badge then
 * underlines it, as the cards do, since players read the board from every side.
 */
export function upsideDownAmbiguous(n) {
  const s = String(n);
  const turned = [...s].reverse().map((d) => FLIP[d]);
  if (turned.some((d) => d === undefined)) return false;
  const t = turned.join("");
  return t !== s && t[0] !== "0";
}

/**
 * Whether play goes clockwise on the board: from where the seats are (board coordinates, y down) in playing order,
 * and the direction of play (1 along that order, −1 against it). The signed area of the seats in turn order says which
 * way the order runs round the middle; with two players there is no way round and it counts as clockwise.
 */
export function clockwise(order, positions, dir, centre = { x: 960, y: 540 }) {
  let area = 0;
  for (let i = 0; i < order.length; i++) {
    const a = positions[order[i]], b = positions[order[(i + 1) % order.length]];
    if (!a || !b) continue;
    area += (a.x - centre.x) * (b.y - centre.y) - (a.y - centre.y) * (b.x - centre.x);
  }
  return (area >= 0) === (dir === 1);
}
