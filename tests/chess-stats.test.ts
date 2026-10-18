// Chess statistics for the statistics window (games-service D-136): every piece followed from its starting square.
import { describe, expect, it } from "vitest";
import { chessAwards, chessStats } from "../games/chess/stats.ts";

const SEATS: [number, number] = [0, 1];

describe("chess statistics", () => {
  it("scholar's mate: the queen is the killer, the marathon runner and the frequenter", () => {
    const ucis = ["e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6", "h5f7"];
    const sans = ["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#"];
    const { sides } = chessStats(ucis, sans);
    expect(sides[0]).toMatchObject({ captures: 1, material: 1, pawnMoves: 1, checks: 1 });
    expect(sides[1]).toMatchObject({ captures: 0, pawnMoves: 1, checks: 0 });
    const a = Object.fromEntries(chessAwards(ucis, sans, SEATS).awards.map((x) => [x.id, x]));
    expect(a.killer).toMatchObject({ seats: [0], value: "1 piece" });
    expect(a.marathon).toMatchObject({ seats: [0], value: "White's queen from d1: 6 squares" });
    expect(a.frequenter).toMatchObject({ seats: [0], value: "White's queen from d1: 2 moves" });
    expect(a["pawn-rush"]).toBeUndefined(); // one pawn move each: nobody stands out
    expect(a["stay-home"]).toBeUndefined(); // neither king moved
  });

  it("castling moves the rook too; en passant takes the pawn beside; a promoted pawn keeps its history", () => {
    const castle = chessStats(["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6", "e1g1"], ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "O-O"]);
    const rook = castle.pieces.find((p) => p.id === "w r h1")!;
    expect([rook.moves, rook.distance]).toEqual([1, 2]);
    expect(castle.sides[0].castled).toBe(true);
    const ep = chessStats(["e2e4", "a7a6", "e4e5", "d7d5", "e5d6"], ["e4", "a6", "e5", "d5", "exd6"]);
    expect(ep.sides[0]).toMatchObject({ captures: 1, material: 1 });
    expect(ep.pieces.find((p) => p.id === "b p d7")).toBeDefined();
    // a pawn walks up and promotes: h-pawn takes on g7 and promotes on h8 to a queen
    const promo = chessStats(["h2h4", "g7g5", "h4g5", "h7h6", "g5h6", "g8f6", "h6h7", "a7a6", "h7g8q"], ["h4", "g5", "hxg5", "h6", "gxh6", "Nf6", "h7", "a6", "hxg8=Q"]);
    expect(promo.sides[0]).toMatchObject({ captures: 2, promotions: 1, pawnMoves: 5 });
    expect(promo.pieces.find((p) => p.id === "w p h2")!.now).toBe("q");
  });
});
