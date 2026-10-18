"""Browser check for Backgammon on a real games-service Table Host: the board page and two phones (one at the smallest
supported size, 320 x 568) play a game by tapping.

Checks on the way:
  - no browser console error or uncaught exception, on the board or either phone;
  - the board shows 15 checkers a side in the starting position, White's home at the south player's right hand;
  - tapping a checker lights up where it can go, tapping one of those moves it there, Undo on the board takes it back,
    and only the side to move can pick up checkers;
  - tapping the dice on the board rolls them; the phones' move buttons and Done play a turn too;
  - doubling on a phone asks for confirmation first (Cancel changes nothing), the other phone takes, the cube shows 2;
  - the phone layout rules of games-service (D-065) on both phones, on and off turn and when doubled;
  - the rules on the smallest phone: this table's three settings and the illustration;
  - a whole game played on, then Next game on the board starts the next one at once.

Starts its own Table Host from .games-service with GAMES_DIR pointing at this repo's games/.
  python3 scripts/e2e/backgammon.py out/
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
PORT = 8097
BASE = f"http://127.0.0.1:{PORT}"
KEY = "e2ekey"
problems = []


def a(method, path, body=None):
    return api(method, path, body, base=BASE, key=KEY)


def shot(page, name):
    page.screenshot(path=os.path.join(OUT, f"backgammon-{name}.png"))


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
    el = board.locator(selector).first
    box = el.bounding_box()
    if not box:
        shot(board, "failed-tap")
        raise AssertionError(f"nothing to tap at {selector}")
    board.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)


def pick(board, spot):
    """Pick up the checker on a spot and wait for its targets. The API can answer before the board has the same update
    (an Undo, say); when that update lands, the board drops a checker picked up just before it, so tap once more."""
    for attempt in range(3):
        tap(board, f'[data-zone="{spot}"]')
        try:
            board.wait_for_selector(".bg-target", timeout=2000)
            return
        except Exception:
            if attempt == 2:
                raise


def tap_until(board, selector, cond, what):
    """Tap a board button until it takes effect. The API can be ahead of the board by one update, and a button the board
    still draws disabled (Done before the last move has arrived) ignores the tap, as it should."""
    for attempt in range(3):
        tap(board, selector)
        try:
            wait(cond, 2, what)
            return
        except AssertionError:
            if attempt == 2:
                raise
        settle(board)


def game():
    return a("GET", "/game/board")["view"]


def settle(board):
    """Wait until the board has shown every move it was sent (its animations)."""
    board.wait_for_function("() => !document.querySelector('.bg-board[data-busy]')", timeout=30000)
    time.sleep(0.15)


def phone_turn(d):
    """Play a whole turn from a phone: roll, the first listed move until none is left, then Done (or the pass)."""
    if d.locator(".bg-acts [data-act=roll]").count():
        d.locator(".bg-acts [data-act=roll]").click()
        wait(lambda: game()["phase"] != "roll", 5, "the roll")
    for _ in range(5):
        v = game()
        if v["phase"] != "move" or not v["legal"]:
            break
        before = len(v["remaining"])
        b = d.locator(".bg-moves button:not([disabled])").first
        b.wait_for(timeout=5000)
        b.click()
        wait(lambda: game()["phase"] != "move" or len(game()["remaining"]) < before, 5, "a phone move")
    v = game()
    if v["phase"] == "move" and v["canDone"]:
        d.locator(".bg-acts [data-act=done]").click()
    wait(lambda: game()["phase"] != "move", 6, "the end of the turn")


def main():
    proc = start_table(PORT, TABLE_KEY=KEY, GAMES_DIR=os.path.join(ROOT, "games"), AI_DELAY_MS="300", PUBLIC_URL=BASE)
    summary = ""
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            board = browser.new_page(viewport={"width": 1920, "height": 1080})
            watch(board, "board")
            board.goto(BASE + "/board/")
            board.wait_for_selector("button.tile[data-game=backgammon]")
            ann = phone(browser, "Ann", 390, 844)
            ben = phone(browser, "Ben", 320, 568)
            pick_game(board, "backgammon")
            board.locator(".dialog [data-x=yes]").click()
            time.sleep(0.4)
            a("POST", "/game/settings", {"settings": {"matchLength": 3, "cube": True, "turnSeconds": 0}})
            for d in (ann, ben):
                d.click("#ready")
            time.sleep(0.4)
            a("POST", "/game/start")
            board.wait_for_selector(".bg-ck")
            for d in (ann, ben):
                d.wait_for_selector(".bg-plays")
            time.sleep(0.8)
            shot(board, "board-opening")

            # The starting position: 15 a side, White's 6-point (five checkers) at the south player's right.
            assert board.locator(".bg-ck.w").count() == 15 and board.locator(".bg-ck.b").count() == 15, "15 checkers a side"
            six = board.locator('.bg-ck[data-spot="6"]')
            assert six.count() == 5, f"five White checkers on the 6-point, got {six.count()}"
            box6 = six.first.bounding_box()
            box24 = board.locator('.bg-ck[data-spot="24"]').first.bounding_box()
            mid = lambda b: (b["x"] + b["width"] / 2, b["y"] + b["height"] / 2)
            assert mid(box6)[1] > 540 and mid(box6)[0] > 960, "White's 6-point is not at the bottom right"
            assert mid(box24)[1] < 540 and mid(box24)[0] > 960, "White's 24-point is not at the top right"
            assert "You play white" in ann.text_content(".bg-head")
            assert "You play black" in ben.text_content(".bg-head")

            v = game()
            white_starts = v["turn"] == 0
            mover, other = (ann, ben) if white_starts else (ben, ann)
            # Only the side to move answers a tap.
            mine = "w" if white_starts else "b"
            theirs = "b" if white_starts else "w"
            assert board.locator(f".bg-ck.{theirs}.movable").count() == 0, "the other side's checkers answer"
            assert board.locator(f".bg-ck.{mine}.movable").count() > 0, "no movable checker for the side to move"
            check(mover, f"{mover.label} on the opening roll")
            check(other, f"{other.label} waiting")
            shot(mover, "deck-opening-mover")
            shot(other, "deck-opening-other")

            # A move by tapping: pick a checker up, its targets light up, tap one.
            t0 = v["targets"][0]
            pick(board, t0["from"])
            assert board.locator(".bg-ck.lifted").count() == 1, "the picked-up checker is not lifted"
            shot(board, "board-picked")
            to = t0["to"]
            tap(board, f'[data-zone="{to}"]')
            wait(lambda: len(game()["remaining"]) < 2, 5, "the board move")
            settle(board)
            shot(board, "board-moved")
            # Undo on the board takes it back.
            tap_until(board, ".bg-panel.active [data-act=undo]", lambda: len(game()["remaining"]) == 2, "Undo")
            settle(board)
            # Now the whole opening roll by taps: for each die, the first target one die away, then Done.
            for _ in range(2):
                v = game()
                one = [t for t in v["targets"] if t["steps"] == 1]
                if not one:
                    break
                t = one[0]
                n = len(v["remaining"])
                pick(board, t["from"])
                tap(board, f'[data-zone="{t["to"]}"]')
                wait(lambda: len(game()["remaining"]) < n, 5, "a board move")
                settle(board)
            assert game()["canDone"], "all moved, but Done is not offered"
            tap_until(board, ".bg-panel.active [data-act=done]", lambda: game()["phase"] == "roll", "the turn to pass")
            settle(board)

            # The other player rolls by tapping the dice on the board, and moves from the phone's list.
            board.wait_for_selector("[data-roll]")
            shot(board, "board-roll")
            check(other, f"{other.label} on their roll")
            tap_until(board, "[data-roll]", lambda: game()["phase"] == "move", "the board roll")
            settle(board)
            shot(board, "board-rolled")
            check(other, f"{other.label} moving")
            shot(other, "deck-moving")
            phone_turn(other)
            settle(board)

            # The first mover doubles from the phone: Cancel first, then confirm; the other phone takes.
            mover.locator("[data-ask=double]").click()
            mover.locator(".bg-confirm:not([hidden])").wait_for()
            shot(mover, "deck-double-confirm")
            mover.locator("[data-confirm=no]").click()
            assert game()["phase"] == "roll", "Cancel doubled anyway"
            mover.locator("[data-ask=double]").click()
            mover.locator("[data-confirm=yes]").click()
            wait(lambda: game()["phase"] == "double", 5, "the double")
            other.locator(".bg-acts [data-act=take]").wait_for()
            check(other, f"{other.label} doubled")
            shot(other, "deck-doubled")
            time.sleep(0.4)
            shot(board, "board-doubled")
            other.locator(".bg-acts [data-act=take]").click()
            wait(lambda: game()["cube"]["value"] == 2, 5, "the take")
            time.sleep(0.4)
            assert board.inner_text(".bg-cube").strip() == "2", "the cube does not show 2"

            # The rules on the smallest phone (games-service D-099): title, this table's settings, the illustration.
            small = ben
            if small.locator("#tab-table").count():
                small.locator("#tab-table").click()
            small.locator("[data-rules]").click()
            small.locator(".rules-modal .md h3").first.wait_for()
            assert "Backgammon" in small.inner_text(".rules-modal .rules-head h2")
            assert small.locator(".rules-settings tr").count() == 3, "the three settings at this table"
            img = small.locator(".rules-modal .md img")
            img.scroll_into_view_if_needed()
            wait(lambda: img.evaluate("i => i.complete && i.naturalWidth > 0"), 10, "the rules illustration")
            shot(small, "rules-illustration")
            small.locator(".rules-modal .rules-close").click()
            small.wait_for_selector(".rules-modal", state="detached")
            if small.locator("#tab-game").count():
                small.locator("#tab-game").click()

            # Play the game on from the phones until it is won.
            end = time.time() + 240
            turns = 0
            while time.time() < end:
                v = game()
                if v["phase"] in ("gameOver", "over"):
                    break
                if v["phase"] == "double":  # never offered here, but answer it if it comes
                    (ann if v["turn"] == 1 else ben).locator(".bg-acts [data-act=take]").click()
                    continue
                d = ann if v["turn"] == 0 else ben
                phone_turn(d)
                settle(board)  # as fast as people at a table: the board shows each turn before the next
                turns += 1
                if turns == 6:
                    time.sleep(0.6)
                    shot(board, "board-middle")
            v = game()
            assert v["phase"] in ("gameOver", "over"), f"the game did not end (phase {v['phase']})"
            settle(board)
            shot(board, "board-game-won")
            check(ann, "Ann after the game")
            check(ben, "Ben after the game")
            if v["phase"] == "gameOver":
                # Next game on the board starts the next one at once.
                board.wait_for_selector("[data-next]")
                tap(board, "[data-next]")
                wait(lambda: game()["match"]["game"] == 2, 5, "Next game")
                time.sleep(0.8)
                shot(board, "board-game-2")
                a("POST", "/game/end")
            wait(lambda: a("GET", "/state")["phase"] == "finished", 10, "the end of the match")
            summary = a("GET", "/state")["summary"]["text"]
            time.sleep(0.6)
            shot(board, "board-final")
            browser.close()
    except Exception:
        try:
            shot(board, "failed")
        except Exception:
            pass
        raise
    finally:
        proc.terminate()
    if errors or problems:
        print("BROWSER ERRORS:\n" + "\n".join(errors) if errors else "", "\nLAYOUT PROBLEMS:\n" + "\n".join(problems) if problems else "")
        sys.exit(1)
    print(f"ok: Backgammon played ({summary}); screenshots in {OUT}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        if os.environ.get("GITHUB_ACTIONS"):
            print(f"::error file=scripts/e2e/backgammon.py::{type(e).__name__}: {str(e)[:900]}".replace("\n", " "))
        raise
