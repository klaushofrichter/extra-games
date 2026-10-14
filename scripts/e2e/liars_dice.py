"""Browser check for Liar's Dice on a real games-service Table Host: the board page and three phones (one at the
smallest supported size, 320 x 568) play a whole game by tapping, against an AI player.

Checks on the way:
  - no browser console error or uncaught exception, on the board or any phone;
  - while bidding, the board shows no cup and each phone shows only its own five dice;
  - after a call, the board shows every cup;
  - the phone layout rules of games-service (D-065): no sideways scrolling, nothing sticking out of its card,
    buttons at least 40 px high, and on your turn the Bid and Liar! buttons on screen without scrolling;
  - the game ends with a summary on the board.

Starts its own Table Host from .games-service with GAMES_DIR pointing at this repo's games/.
  python3 scripts/e2e/liars_dice.py out/
"""
import os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, ".games-service", "scripts", "e2e"))
from playwright.sync_api import sync_playwright  # noqa: E402
from common import api, errors, join_deck, pick_game, start_table, watch, wait  # noqa: E402

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
PORT = 8095
BASE = f"http://127.0.0.1:{PORT}"
KEY = "e2ekey"
problems = []

CHECK = """() => {
  const w = innerWidth, h = innerHeight, out = [];
  if (document.documentElement.scrollWidth > w + 1) out.push(`page is ${document.documentElement.scrollWidth}px wide in a ${w}px window`);
  for (const b of document.querySelectorAll('button')) {
    const r = b.getBoundingClientRect(), cs = getComputedStyle(b);
    if (!r.width || !r.height || cs.visibility === 'hidden' || b.closest('[hidden]')) continue;
    if (r.right > w + 1) out.push(`"${(b.textContent || b.className).trim().slice(0, 30)}" sticks out to ${Math.round(r.right)}px`);
    if (r.height < 40) out.push(`"${(b.textContent || b.getAttribute('aria-label') || b.className).trim().slice(0, 30)}" is only ${Math.round(r.height)}px high`);
  }
  for (const card of document.querySelectorAll('.card')) {
    const c = card.getBoundingClientRect();
    if (!c.width) continue;
    for (const el of card.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.left < c.left - 1 || r.right > c.right + 1) out.push(`${el.tagName.toLowerCase()}.${String(el.getAttribute('class') || '').split(' ')[0]} sticks out of its card by ${Math.round(Math.max(c.left - r.left, r.right - c.right))}px`);
    }
  }
  return out;
}"""

# The phone's own action buttons must be on screen on its turn (after the page scrolls them into view, which a
# player would do too: the builder sits below the cup).
ON_SCREEN = """() => {
  const out = [];
  for (const s of ['.ld-bid', '.ld-liar']) {
    const b = document.querySelector(s);
    if (!b || b.closest('[hidden]')) { out.push(`${s} missing`); continue; }
    const r = b.getBoundingClientRect();
    if (r.bottom > innerHeight + 1 || r.top < 0) out.push(`${s} is off screen (${Math.round(r.top)}..${Math.round(r.bottom)} in ${innerHeight})`);
  }
  return out;
}"""


def a(method, path, body=None):
    return api(method, path, body, base=BASE, key=KEY)


def shot(page, name):
    page.screenshot(path=os.path.join(OUT, f"liars-dice-{name}.png"))


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


def main():
    proc = start_table(PORT, TABLE_KEY=KEY, GAMES_DIR=os.path.join(ROOT, "games"), AI_DELAY_MS="300", PUBLIC_URL=BASE)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            board = browser.new_page(viewport={"width": 1920, "height": 1080})
            watch(board, "board")
            board.goto(BASE + "/board/")
            board.wait_for_selector("button.tile[data-game=liars-dice]")
            shot(board, "lobby")
            decks = [phone(browser, "Klaus", 390, 844), phone(browser, "Mira", 360, 640), phone(browser, "Jo", 320, 568)]
            a("POST", "/ai", {})
            pick_game(board, "liars-dice")
            # The game's settings dialog: take the defaults, then make it quick through the API.
            board.locator(".dialog [data-x=yes]").click()
            time.sleep(0.4)
            a("POST", "/game/settings", {"settings": {"startDice": 2, "turnSeconds": 60, "revealSeconds": 3}})
            for d in decks:
                d.click("#ready")
            time.sleep(0.4)
            a("POST", "/game/start")
            for d in decks:
                d.wait_for_selector(".ld-cup .ld-die")
            time.sleep(0.6)
            shot(board, "board-opening")

            # The rules on the smallest phone (games-service D-099): title, this table's settings, the illustration.
            small = decks[2]
            small.locator("[data-rules]").click()
            # The sheet shows the game's name at once and the rules when they have loaded: wait for the rules.
            small.locator(".rules-modal .md h3").first.wait_for()
            assert "Liar's Dice" in small.inner_text(".rules-modal .rules-head h2")
            assert small.locator(".rules-settings tr").count() == 4, "the four settings at this table"
            img = small.locator(".rules-modal .md img")
            img.scroll_into_view_if_needed()
            wait(lambda: img.evaluate("i => i.complete && i.naturalWidth > 0"), 10, "the rules illustration")
            shot(small, "rules-illustration")
            small.locator(".rules-modal .rules-body").evaluate("b => b.scrollTop = 0")
            shot(small, "rules")
            small.locator(".rules-modal .rules-close").click()
            small.wait_for_selector(".rules-modal", state="detached")

            # Privacy while bidding: the board has no cup, each phone shows exactly its own dice.
            assert board.locator(".ld-cup").count() == 0, "the board shows cups while bidding"
            for d in decks:
                n = d.locator(".ld-cup .ld-die").count()
                assert n == 2, f"{d.label} shows {n} dice, expected their own 2"

            seen_reveal = False
            checked_turn = set()
            end = time.time() + 180
            while time.time() < end:
                st = a("GET", "/state")
                if st["phase"] == "finished":
                    break
                acted = False
                for d in decks:
                    if not d.locator(".ld-builder").is_visible():
                        continue
                    # Layout on this phone's turn, once per phone.
                    if d.label not in checked_turn:
                        check(d, f"{d.label} on turn")
                        d.locator(".ld-actions").scroll_into_view_if_needed()
                        problems.extend(f"{d.label}: {x}" for x in d.evaluate(ON_SCREEN))
                        shot(d, f"deck-turn-{d.label}")
                        checked_turn.add(d.label)
                    liar = d.locator(".ld-liar")
                    # Call once the bid reaches two dice; before that, raise with the preset bid.
                    current = d.locator(".ld-current .display").inner_text() if d.locator(".ld-current .display").count() else ""
                    if liar.is_enabled() and current and int(current.split()[0]) >= 2:
                        liar.click()
                    else:
                        d.locator(".ld-bid").click()
                    acted = True
                    time.sleep(0.35)
                    break
                if not seen_reveal and board.locator(".ld-cup").count():
                    seen_reveal = True
                    time.sleep(0.5)
                    shot(board, "board-reveal")
                    for d in decks:
                        check(d, f"{d.label} in the reveal")
                    shot(decks[2], "deck-reveal-small")
                    # Every player still in at the call has a cup on the board (four players, none out yet).
                    cups = board.locator(".ld-cup").count()
                    assert cups == 4, f"the reveal shows {cups} cups, expected 4"
                if not acted:
                    time.sleep(0.2)
            st = a("GET", "/state")
            assert st["phase"] == "finished", f"the game did not finish (phase {st['phase']})"
            assert seen_reveal, "no reveal was seen on the board"
            summary = st["summary"]["text"]
            assert "wins with" in summary, summary
            time.sleep(0.8)
            shot(board, "board-final")
            browser.close()
    finally:
        proc.terminate()
    if errors or problems:
        print("BROWSER ERRORS:\n" + "\n".join(errors) if errors else "", "\nLAYOUT PROBLEMS:\n" + "\n".join(problems) if problems else "")
        sys.exit(1)
    print(f"ok: Liar's Dice played to the end ({summary}); screenshots in {OUT}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        # On GitHub, an annotation carries the reason to the PR page, where the job log may not be at hand.
        if os.environ.get("GITHUB_ACTIONS"):
            print(f"::error file=scripts/e2e/liars_dice.py::{type(e).__name__}: {str(e)[:900]}".replace("\n", " "))
        raise
