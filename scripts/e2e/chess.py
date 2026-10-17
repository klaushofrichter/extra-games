"""Browser check for Chess on a real games-service Table Host: the board page and two phones (one at the smallest
supported size, 320 x 568) play a short game by tapping pieces on the board.

Checks on the way:
  - no browser console error or uncaught exception, on the board or either phone;
  - the board shows 32 pieces, White's first rank toward White's seat (south), every piece facing the board's front;
  - the turn-around button turns every piece to face north;
  - tapping a piece shows its moves, tapping a target moves it, and only the player to move can pick up pieces;
  - the phones show both clocks (the running one counting down), the moves, a draw offer and its answer, and Resign
    both asking for confirmation first;
  - the phone layout rules of games-service (D-065) on both phones;
  - the rules on the smallest phone: this table's three settings and the illustration;
  - checkmate ends the game with a summary.

Starts its own Table Host from .games-service with GAMES_DIR pointing at this repo's games/.
  python3 scripts/e2e/chess.py out/
"""
import os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, ".games-service", "scripts", "e2e"))
sys.path.insert(0, HERE)
from playwright.sync_api import sync_playwright  # noqa: E402
from common import api, errors, join_deck, pick_game, start_table, watch, wait  # noqa: E402
from liars_dice import CHECK  # noqa: E402  the same phone layout rules

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
PORT = 8096
BASE = f"http://127.0.0.1:{PORT}"
KEY = "e2ekey"
problems = []


def a(method, path, body=None):
    return api(method, path, body, base=BASE, key=KEY)


def shot(page, name):
    page.screenshot(path=os.path.join(OUT, f"chess-{name}.png"))


def check(page, where):
    for p in page.evaluate(CHECK):
        problems.append(f"{where}: {p}")


def phone(browser, name, w, h):
    ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=2, has_touch=True)
    d = ctx.new_page()
    watch(d, name)
    join_deck(d, a("GET", "/join")["url"], name)
    d.label = name
    return d


def tap(board, selector):
    """A tap where a finger would land: the middle of the element, through whatever lies on top."""
    box = board.locator(selector).first.bounding_box()
    if not box:
        shot(board, "failed-tap")
    assert box, f"{selector} is not on the board"
    board.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)


def moves():
    return a("GET", "/game/board")["view"]["sans"]


def play(board, frm, to, expect_count):
    board.wait_for_selector(f'.ch-pc.movable[data-sq="{frm}"]')  # the board has the last move: it's this side's turn
    tap(board, f'.ch-pc[data-sq="{frm}"]')
    try:
        board.wait_for_selector(f'.ch-mark.target[data-sq="{to}"]', timeout=5000)
    except Exception:
        shot(board, f"failed-{frm}{to}")
        raise
    tap(board, f'.ch-sq[data-sq="{to}"]')
    wait(lambda: len(moves()) == expect_count, 10, f"move {frm}{to}")


def main():
    proc = start_table(PORT, TABLE_KEY=KEY, GAMES_DIR=os.path.join(ROOT, "games"), AI_DELAY_MS="300", PUBLIC_URL=BASE)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            board = browser.new_page(viewport={"width": 1920, "height": 1080})
            watch(board, "board")
            board.goto(BASE + "/board/")
            board.wait_for_selector("button.tile[data-game=chess]")
            ann = phone(browser, "Ann", 390, 844)
            ben = phone(browser, "Ben", 320, 568)
            pick_game(board, "chess")
            board.locator(".dialog [data-x=yes]").click()
            time.sleep(0.4)
            a("POST", "/game/settings", {"settings": {"timeControl": "3+2", "whiteSeat": "south"}})
            for d in (ann, ben):
                d.click("#ready")
            time.sleep(0.4)
            a("POST", "/game/start")
            board.wait_for_selector(".ch-pc")
            for d in (ann, ben):
                d.wait_for_selector(".ch-moves")
            time.sleep(0.6)
            shot(board, "board-opening")

            # The set-up: 32 pieces, White at the south edge, Black's pieces facing north.
            assert board.locator(".ch-pc").count() == 32, "32 pieces on the board"
            e1 = board.locator('.ch-pc[data-sq="e1"]').bounding_box()
            e8 = board.locator('.ch-pc[data-sq="e8"]').bounding_box()
            assert e1["y"] > e8["y"], "White's king is not toward the south seat"
            facing = {board.locator(f'.ch-pc[data-sq="{sq}"] > div').evaluate("e => e.style.transform") for sq in ("e1", "e8", "a2", "h7")}
            assert facing == {"rotate(0deg)"}, f"every piece should face the board's front edge (south), got {facing!r}"
            assert board.locator('.ch-pc[data-sq="e7"].movable').count() == 0, "Black's pieces answer while White is to move"

            # Phones: who plays what, both clocks, the hint.
            assert "You play white" in ann.text_content(".ch-head")
            assert "You play black" in ben.text_content(".ch-head")
            assert ann.locator("[data-clock]").count() == 2, "Ann's phone shows both clocks"
            first = ann.inner_text('[data-clock="0"]')
            time.sleep(1.3)
            assert ann.inner_text('[data-clock="0"]') != first, "White's clock is not running"
            assert ben.inner_text('[data-clock="1"]') == "3:00", "Black's clock runs before Black's turn"
            check(ann, "Ann at the start")
            check(ben, "Ben at the start")
            shot(ann, "deck-white")

            # A move by tapping, with the targets shown.
            tap(board, '.ch-pc[data-sq="e2"]')
            board.wait_for_selector('.ch-mark.target[data-sq="e4"]')
            assert board.locator(".ch-mark.target").count() == 2, "e2 has two moves"
            shot(board, "board-picked-up")
            tap(board, '.ch-sq[data-sq="e4"]')
            wait(lambda: len(moves()) == 1, 10, "e4")
            play(board, "e7", "e5", 2)
            # A draw offer and its answer on the phones.
            # Offering a draw asks first: Cancel sends nothing, the confirmation sends the offer.
            ann.locator("[data-ask=offerDraw]").click()
            ann.wait_for_selector(".ch-confirm:not([hidden])")
            check(ann, "Ann's draw confirmation")
            shot(ann, "deck-confirm-draw")
            ann.locator("[data-confirm=no]").click()
            time.sleep(0.4)
            assert a("GET", "/game/board")["view"]["drawOffer"] is None, "Cancel sent a draw offer"
            ann.locator("[data-ask=offerDraw]").click()
            ann.locator("[data-confirm=yes]").click()
            ben.wait_for_selector("[data-act=acceptDraw]")
            check(ben, "Ben with a draw offer")
            shot(ben, "deck-draw-offer")
            ben.locator("[data-act=declineDraw]").click()
            ann.wait_for_selector("[data-ask=offerDraw]:not([disabled])")
            # Resign asks first; Escape cancels it and the game goes on.
            ben.locator(".ch-resign").click()
            ben.wait_for_selector(".ch-confirm:not([hidden])")
            assert "Resign the game?" in ben.inner_text(".ch-confirm h3")
            check(ben, "Ben's resign confirmation")
            shot(ben, "deck-confirm-resign")
            ben.keyboard.press("Escape")
            ben.wait_for_selector(".ch-confirm", state="hidden")
            assert a("GET", "/state")["phase"] == "active", "Escape resigned the game"
            play(board, "f1", "c4", 3)
            play(board, "b8", "c6", 4)
            play(board, "d1", "h5", 5)
            play(board, "g8", "f6", 6)
            assert "Your move" in ann.inner_text(".ch-status")
            assert "Qh5" in ann.inner_text(".ch-moves")
            shot(board, "board-middle")

            # The rules on the smallest phone: title, this table's settings, the illustration.
            if ben.locator("#tab-table").count():
                ben.locator("#tab-table").click()
            ben.locator("[data-rules]").click()
            ben.locator(".rules-modal .md h3").first.wait_for()
            assert "Chess" in ben.inner_text(".rules-modal .rules-head h2")
            assert ben.locator(".rules-settings tr").count() == 3, "the three settings at this table"
            img = ben.locator(".rules-modal .md img")
            img.scroll_into_view_if_needed()
            wait(lambda: img.evaluate("i => i.complete && i.naturalWidth > 0"), 10, "the rules illustration")
            shot(ben, "rules")
            ben.locator(".rules-modal .rules-close").click()
            ben.wait_for_selector(".rules-modal", state="detached")
            if ben.locator("#tab-game").count():
                ben.locator("#tab-game").click()

            # The turn-around button turns every piece toward the north edge, and back.
            board.locator("#flip-button").click()
            wait(lambda: {board.locator(f'.ch-pc[data-sq="{sq}"] > div').evaluate("e => e.style.transform") for sq in ("e1", "f6")} == {"rotate(180deg)"}, 10, "pieces facing north")
            shot(board, "board-turned")
            board.locator("#flip-button").click()
            wait(lambda: board.locator('.ch-pc[data-sq="e1"] > div').evaluate("e => e.style.transform") == "rotate(0deg)", 10, "pieces facing south again")

            # Scholar's mate.
            board.wait_for_selector('.ch-pc.movable[data-sq="h5"]')
            tap(board, '.ch-pc[data-sq="h5"]')
            board.wait_for_selector('.ch-mark.target.take[data-sq="f7"]')
            tap(board, '.ch-pc[data-sq="f7"]')
            wait(lambda: a("GET", "/state")["phase"] == "finished", 10, "the end of the game")
            summary = a("GET", "/state")["summary"]["text"]
            assert summary == "Ann wins with white by checkmate after four moves.", summary
            time.sleep(0.8)
            shot(board, "board-final")
            shot(ann, "deck-final")
            browser.close()
    finally:
        proc.terminate()
    if errors or problems:
        print("BROWSER ERRORS:\n" + "\n".join(errors) if errors else "", "\nLAYOUT PROBLEMS:\n" + "\n".join(problems) if problems else "")
        sys.exit(1)
    print(f"ok: Chess played to the end ({summary}); screenshots in {OUT}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        if os.environ.get("GITHUB_ACTIONS"):
            print(f"::error file=scripts/e2e/chess.py::{type(e).__name__}: {str(e)[:900]}".replace("\n", " "))
        raise
