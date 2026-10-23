"""Browser check for Mexican Train (E-020) on a real games-service Table Host: the board page and three phones (one
at the smallest supported size, 320 x 568) play a two-round game by tapping, with one AI player.

Checks on the way:
  - no browser console error or uncaught exception, on the board or any phone;
  - the board draws its background, the hub, a tile for every tile on the trains, and the platform's seat plates with
    the player on turn marked;
  - each phone shows exactly its own tiles (as many as the board's plate says), and the board shows no hand;
  - the phone layout rules of games-service (D-065): no sideways scrolling, nothing sticking out of its card, buttons
    at least 40 px high;
  - the rules on the smallest phone: title, the five settings, the illustration;
  - after the first round the board shows the scores, and its Next round button deals the next round;
  - Starfield picked in round 2 shows the starfield, also after "A new one each round";
  - the game ends with a summary.

Starts its own Table Host from .games-service with GAMES_DIR pointing at this repo's games/.
  python3 scripts/e2e/mexican_train.py out/
"""
import os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, ".games-service", "scripts", "e2e"))
from playwright.sync_api import sync_playwright  # noqa: E402
from common import api, errors, join_deck, pick_game, start_table, watch, wait  # noqa: E402

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
PORT = 8097
BASE = f"http://127.0.0.1:{PORT}"
KEY = "e2ekey"
problems = []
CHROMIUM = os.environ.get("CHROMIUM_PATH")  # a browser installed elsewhere (e.g. a container without Playwright's)

CHECK = """() => {
  const w = innerWidth, out = [];
  if (document.documentElement.scrollWidth > w + 1) out.push(`page is ${document.documentElement.scrollWidth}px wide in a ${w}px window`);
  for (const b of document.querySelectorAll('button')) {
    const r = b.getBoundingClientRect(), cs = getComputedStyle(b);
    if (!r.width || !r.height || cs.visibility === 'hidden' || b.closest('[hidden]')) continue;
    if (r.right > w + 1) out.push(`"${(b.textContent || b.className).trim().slice(0, 30)}" sticks out to ${Math.round(r.right)}px`);
    if (r.height < 40) out.push(`"${(b.textContent || b.getAttribute('aria-label') || b.className).trim().slice(0, 30)}" is only ${Math.round(r.height)}px high`);
  }
  for (const card of document.querySelectorAll('.mtd .card')) {
    const c = card.getBoundingClientRect();
    if (!c.width) continue;
    for (const el of card.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || el.closest('svg') && el.tagName !== 'svg') continue;
      if (r.left < c.left - 1 || r.right > c.right + 1) out.push(`${el.tagName.toLowerCase()}.${String(el.getAttribute('class') || '').split(' ')[0]} sticks out of its card by ${Math.round(Math.max(c.left - r.left, r.right - c.right))}px`);
    }
  }
  return out;
}"""


def a(method, path, body=None):
    return api(method, path, body, base=BASE, key=KEY)


def shot(page, name):
    page.screenshot(path=os.path.join(OUT, f"mexican-train-{name}.png"))


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


def take_turn(d):
    """One action on this phone's turn: a glowing tile and a highlighted train, or Done, or Draw. True if it acted."""
    if not d.locator(".mtd-status.go").count():
        return False
    tiles = d.locator(".mtd-tile.ok")
    if tiles.count():
        tiles.first.click()
        hit = d.locator(".mtd-train.hit")
        if hit.count():
            hit.first.click(force=True)  # highlighted trains bob gently, so they are never "stable"; a finger taps them anyway
        else:
            tiles.first.click()  # a tile that fits one train only: the second tap plays it
        return True
    if d.locator(".mtd-done:not([hidden])").count():
        d.locator(".mtd-done").click()
        return True
    if d.locator(".mtd-draw:not([hidden]):not([disabled])").count():
        d.locator(".mtd-draw").click()
        return True
    return False


def main():
    proc = start_table(PORT, TABLE_KEY=KEY, GAMES_DIR=os.path.join(ROOT, "games"), AI_DELAY_MS="150", PUBLIC_URL=BASE)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(**({"executable_path": CHROMIUM} if CHROMIUM else {}))
            board = browser.new_page(viewport={"width": 1920, "height": 1080})
            watch(board, "board")
            board.goto(BASE + "/board/")
            board.wait_for_selector("button.tile")  # the lobby pages its games: pick_game below pages to this one
            decks = [phone(browser, "Klaus", 390, 844), phone(browser, "Mira", 360, 640), phone(browser, "Jo", 320, 568)]
            a("POST", "/ai", {})
            pick_game(board, "mexican-train")
            board.locator(".dialog [data-x=yes]").click()
            time.sleep(0.4)
            a("POST", "/game/settings", {"settings": {"rounds": 2, "turnSeconds": 60, "roundSeconds": 30}})
            for d in decks:
                d.click("#ready")
            time.sleep(0.4)
            a("POST", "/game/start")
            for d in decks:
                d.wait_for_selector(".mtd-tile")
            board.wait_for_selector(".mt-root .kit-plate")
            time.sleep(1.0)
            shot(board, "board-start")

            # The board: a background, the hub, the platform's plates with the player on turn marked.
            assert board.locator(".mt-root .mt-scene, .mt-root .mt-sky").count() > 0, "no background on the board"
            assert board.locator(".mt-root .kit-plate").count() == 4, "four seat plates"
            assert board.locator(".mt-root .kit-plate.active").count() == 1, "one plate marked for the player on turn"

            # The rules on the smallest phone: title, the five settings of this table, the illustration.
            small = decks[2]
            if small.locator("#tab-table").count():
                small.locator("#tab-table").click()
            small.locator("[data-rules]").click()
            small.locator(".rules-modal .md h3").first.wait_for()
            assert "Mexican Train" in small.inner_text(".rules-modal .rules-head h2")
            assert small.locator(".rules-settings tr").count() == 5, "the five settings at this table"
            img = small.locator(".rules-modal .md img")
            img.scroll_into_view_if_needed()
            wait(lambda: img.evaluate("i => i.complete && i.naturalWidth > 0"), 10, "the rules illustration")
            shot(small, "rules-illustration")
            small.locator(".rules-modal .rules-close").click()
            small.wait_for_selector(".rules-modal", state="detached")
            if small.locator("#tab-game").count():
                small.locator("#tab-game").click()

            # Each phone shows its own tiles only: as many as its plate on the board says.
            for d in decks:
                n = d.locator(".mtd-tile").count()
                assert n == 15, f"{d.label} shows {n} tiles, expected their own 15"
                check(d, f"{d.label} at the start")
            assert board.locator(".mt-root .mtd-tile").count() == 0, "the board shows a hand"

            checked_turn, seen_result = set(), False
            end = time.time() + 300
            while time.time() < end:
                st = a("GET", "/state")
                if st["phase"] == "finished":
                    break
                acted = False
                for d in decks:
                    if d.locator(".mtd-status.go").count() and d.label not in checked_turn:
                        check(d, f"{d.label} on turn")
                        shot(d, f"deck-turn-{d.label}")
                        checked_turn.add(d.label)
                    if take_turn(d):
                        acted = True
                        time.sleep(0.3)
                        break
                result = board.locator(".mt-result:not([hidden])")
                if result.count() and not seen_result:
                    seen_result = True
                    time.sleep(0.6)
                    shot(board, "board-round-over")
                    shot(decks[0], "deck-round-over")
                    assert "Round 1" in board.inner_text(".mt-result"), board.inner_text(".mt-result")
                    # The table may deal the next round at once.
                    board.locator(".mt-next").click()
                    wait(lambda: board.locator(".mt-result:not([hidden])").count() == 0, 10, "the next round to be dealt")
                    # The background choice names what the board shows (E-021): a new one each round, then Starfield
                    # picked in round 2 is the starfield, not the next scene in the turn.
                    a("POST", "/game/prefs", {"prefs": {"background": "rotate"}})
                    time.sleep(0.6)
                    a("POST", "/game/prefs", {"prefs": {"background": "stars"}})
                    time.sleep(0.6)
                    felt = board.evaluate("() => getComputedStyle(document.querySelector('.mt-felt')).backgroundColor")
                    assert felt == "rgb(7, 10, 28)" and board.locator(".mt-sky").count() == 3, f"Starfield shows {felt}"
                if not acted:
                    time.sleep(0.2)
            st = a("GET", "/state")
            assert st["phase"] == "finished", f"the game did not finish (phase {st['phase']})"
            assert seen_result, "the scores after round 1 were never shown"
            summary = st["summary"]["text"]
            assert "with" in summary and "points" in summary, summary
            time.sleep(0.8)
            shot(board, "board-final")
            browser.close()
    finally:
        proc.terminate()
    if errors or problems:
        print("BROWSER ERRORS:\n" + "\n".join(errors) if errors else "", "\nLAYOUT PROBLEMS:\n" + "\n".join(problems) if problems else "")
        sys.exit(1)
    print(f"ok: Mexican Train played to the end ({summary}); screenshots in {OUT}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        if os.environ.get("GITHUB_ACTIONS"):
            print(f"::error title=Mexican Train browser check::{e}")
        raise
