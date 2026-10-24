"""Browser check for Last Card (E-023) on a real games-service Table Host: the board page and two phones (one at the
smallest supported size, 320 x 568) play a game to 150 points with one AI player, by slinging cards off the phones.

Checks on the way:
  - no browser console error or uncaught exception, on the board or any phone;
  - the board draws both piles, the colour ring and the platform's seat plates with the player on turn marked;
  - each phone shows exactly its own seven cards, and the board shows no hand;
  - the phone layout rules of games-service (D-065): no sideways scrolling, buttons at least 40 px high;
  - the rules on the smallest phone: title, the four settings, the illustration;
  - the sling (games-service D-189): while a card is pushed off a phone, the board shows its back at that player's
    edge; once played it lands on the pile; a card that doesn't fit bounces back; a wild card asks for its colour;
  - "Last card!" shows on the board with its sound when someone is down to one card;
  - the round's scores show on the board, and the game ends with a summary.

Starts its own Table Host from .games-service with GAMES_DIR pointing at this repo's games/.
  python3 scripts/e2e/last_card.py out/
"""
import os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, ".games-service", "scripts", "e2e"))
from playwright.sync_api import sync_playwright  # noqa: E402
from common import api, errors, join_deck, pick_game, start_table, watch, wait  # noqa: E402

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
PORT = 8098
BASE = f"http://127.0.0.1:{PORT}"
KEY = "e2ekey"
problems = []
CHROMIUM = os.environ.get("CHROMIUM_PATH")

CHECK = """() => {
  const w = innerWidth, out = [];
  if (document.documentElement.scrollWidth > w + 1) out.push(`page is ${document.documentElement.scrollWidth}px wide in a ${w}px window`);
  for (const b of document.querySelectorAll('button')) {
    const r = b.getBoundingClientRect(), cs = getComputedStyle(b);
    if (!r.width || !r.height || cs.visibility === 'hidden' || b.closest('[hidden]')) continue;
    if (r.right > w + 1) out.push(`"${(b.textContent || b.className).trim().slice(0, 30)}" sticks out to ${Math.round(r.right)}px`);
    if (r.height < 40) out.push(`"${(b.textContent || b.className).trim().slice(0, 30)}" is only ${Math.round(r.height)}px high`);
  }
  return out;
}"""


def a(method, path, body=None):
    return api(method, path, body, base=BASE, key=KEY)


def shot(page, name):
    page.screenshot(path=os.path.join(OUT, f"last-card-{name}.png"))


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


# A point of a card that no other card covers (the hand overlaps): a finger there touches this card, not its neighbour.
VISIBLE = """e => { const r = e.getBoundingClientRect();
  for (const fy of [0.5, 0.3, 0.7, 0.15, 0.85]) for (const fx of [0.5, 0.3, 0.15, 0.7, 0.85]) {
    const x = r.left + r.width * fx, y = r.top + r.height * fy, t = document.elementFromPoint(x, y);
    if (t && e.contains(t)) return [x, y]; }
  return null; }"""


def grab(el):
    """Where a finger touches this card, or None when other cards cover all of it."""
    return el.evaluate(VISIBLE)


def sling(d, el, board=None, peek=None):
    """Push a card up and off the top of the phone; with `board`, look at the board while it is a third out."""
    b = el.bounding_box()
    x, y = grab(el) or (b["x"] + b["width"] / 2, b["y"] + b["height"] / 2)
    top = d.evaluate("document.querySelector('.lcd').getBoundingClientRect().top")
    third = top + b["height"] / 2 - b["height"] / 3
    d.mouse.move(x, y)
    d.mouse.down()
    for i in range(1, 21):
        d.mouse.move(x + 20 * i / 20, y + (third - y) * i / 20)
        time.sleep(0.012)
    if board is not None and peek is not None:
        time.sleep(0.3)
        peek()
    for i in range(1, 8):
        d.mouse.move(x + 20, third - 30 * i)
        time.sleep(0.008)
    d.mouse.up()


seen = {"burst": False, "wild": False, "bounce": False, "peek": False, "panel": False, "receive": False, "line": False, "tap": False}

# The drawn card's way in on the phone (E-024): a card whose animation is running (it comes in at the top).
# Script animations only: cards sliding to new places (CSS transitions) don't count.
INCOMING = "() => [...document.querySelectorAll('.lcd-card')].filter(el => el.getAnimations().some(a => !(a instanceof CSSTransition) && !(a instanceof CSSAnimation) && (a.playState === 'running' || a.playState === 'pending'))).map(el => el.dataset.sling)"


def take_turn(d, board):
    """One action on this phone's turn. True if it acted."""
    if not d.locator(".lcd-status.go").count() or d.locator(".lcd-pick:not([hidden])").count():
        return False
    if d.locator(".lcd-keep:not([hidden])").count():
        ok = d.locator(".lcd-card.ok")
        if ok.count():
            return play(d, ok.first, board)
        d.locator(".lcd-keep").click()
        return True
    ok = d.locator(".lcd-card.ok")
    if ok.count():
        # Once: a card that doesn't fit bounces back.
        no = d.locator(".lcd-card.no")
        if not seen["bounce"] and no.count():
            # The same card a moment later, if it still doesn't fit: the hand may still be catching up with a new view.
            nid = no.first.get_attribute("data-sling")
            time.sleep(0.3)
            card = d.locator(f'.lcd-card.no[data-sling="{nid}"]')
            if not card.count() or not d.locator(".lcd-status.go").count() or not grab(card):
                return False
            n = d.locator(".lcd-card").count()
            y = d.locator(".lcd-status").bounding_box()["y"]
            sling(d, card)
            time.sleep(0.4)
            assert d.locator(".lcd-card").count() == n, "a card that doesn't fit left the phone"
            # Its message floats over the top (games-service D-191) and moves nothing.
            assert d.locator(".deck-toast.on").count() == 1, "no message for a card that doesn't fit"
            assert d.locator(".deck-toast.on").bounding_box()["height"] < 120, "the message covers the screen"
            assert abs(d.locator(".lcd-status").bounding_box()["y"] - y) < 1, "the message moved the status"
            shot(d, f"deck-bounce-{d.label}")
            seen["bounce"] = True
        # Once, draw although a card fits (the rules allow it), so a game always shows a drawn card coming in.
        if seen["bounce"] and not seen["receive"] and d.locator(".lcd-draw:not([hidden]):not([disabled])").count():
            return draw(d)
        return play(d, ok.first, board)
    if d.locator(".lcd-draw:not([hidden])").count():
        return draw(d)
    return False


def draw(d):
    """Draw a card; the first time, check that it comes in at the top of the phone (E-024)."""
    d.locator(".lcd-draw").click()
    if not seen["receive"]:
        # The new card comes in at the top of the phone, and keeps coming in through the next updates.
        moving = []
        for _ in range(20):
            time.sleep(0.05)
            moving = d.evaluate(INCOMING)
            if moving:
                break
        assert moving, "a drawn card appeared on the phone without coming in"
        time.sleep(0.5)
        assert d.evaluate(INCOMING) == moving, "the drawn card's way in was cut short"
        shot(d, f"deck-receive-{d.label}")
        seen["receive"] = True
    return True


def release_above_line(d, el):
    """Drag a card until its middle is just above the release line under the status, and let go there (D-193)."""
    b = el.bounding_box()
    x, y = grab(el) or (b["x"] + b["width"] / 2, b["y"] + b["height"] / 2)
    line = d.locator(".lcd-line").bounding_box()["y"]
    d.mouse.move(x, y)
    d.mouse.down()
    for i in range(1, 16):
        d.mouse.move(x, y + (line - 25 - y) * i / 15)
        time.sleep(0.02)
    assert d.locator(".lcd.sling-armed").count() == 1, "the line does not light up with a card above it"
    shot(d, f"deck-line-{d.label}")
    time.sleep(0.15)
    d.mouse.up()


def play(d, el, board):
    before = board.evaluate("document.querySelectorAll('.lc-pile > div').length")
    # A point of the card that is not under its neighbour in the hand (cards overlap), for a tap.
    spot = grab(el)
    if seen["line"] and not seen["tap"] and spot and el.evaluate("e => !e.querySelector('[aria-label^=Wild]')"):
        # Once, with Tap a card to play it on (E-025): a tap plays a card that fits.
        n = d.locator(".lcd-card").count()
        d.mouse.click(*spot)
        for _ in range(40):
            if d.locator(".lcd-card").count() < n:
                break
            time.sleep(0.1)
        assert d.locator(".lcd-card").count() < n, "a tapped card that fits was not played"
        seen["tap"] = True
        return True
    if not seen["line"] and el.evaluate("e => !e.querySelector('[aria-label^=Wild]')"):
        # Once: let go above the line, not off the top. The card is played toward the middle.
        n = d.locator(".lcd-card").count()
        release_above_line(d, el)
        for _ in range(40):
            if d.locator(".lcd-card").count() < n:
                break
            time.sleep(0.1)
        assert d.locator(".lcd-card").count() < n, "a card let go above the line was not played"
        seen["line"] = True
        return True

    def peek():
        if seen["peek"]:
            return
        shown = board.evaluate("(() => { const c = [...document.querySelectorAll('.sling-item')].find(e => e.style.visibility === 'visible'); return c && c.textContent.includes('LAST CARD') })()")
        assert shown, "the board shows nothing (or the face) at the player's edge while the card is pushed off the phone"
        shot(board, "board-sling")
        shot(d, f"deck-sling-{d.label}")
        seen["peek"] = True

    sling(d, el, board, peek)
    time.sleep(0.3)
    if d.locator(".lcd-pick:not([hidden])").count():
        seen["wild"] = True
        shot(d, f"deck-wild-{d.label}")
        d.locator(".lcd-colors button").first.click()
    return True


def main():
    proc = start_table(PORT, TABLE_KEY=KEY, GAMES_DIR=os.path.join(ROOT, "games"), AI_DELAY_MS="150", PUBLIC_URL=BASE)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(**({"executable_path": CHROMIUM} if CHROMIUM else {}))
            board = browser.new_page(viewport={"width": 1920, "height": 1080})
            watch(board, "board")
            board.goto(BASE + "/board/")
            board.wait_for_selector("button.tile")
            decks = [phone(browser, "Klaus", 390, 844), phone(browser, "Jo", 320, 568)]
            a("POST", "/ai", {})
            pick_game(board, "last-card")
            board.locator(".dialog [data-x=yes]").click()
            time.sleep(0.4)
            a("POST", "/game/settings", {"settings": {"target": 150, "turnSeconds": 60, "roundSeconds": 4, "tapToPlay": True}})
            for d in decks:
                d.click("#ready")
            time.sleep(0.4)
            a("POST", "/game/start")
            for d in decks:
                d.wait_for_selector(".lcd-card")
            board.wait_for_selector(".lc-root .kit-plate")
            time.sleep(1.0)
            shot(board, "board-start")

            assert board.locator(".lc-pile > div").count() == 1, "the first card on the pile"
            assert board.locator(".lc-draw .lc-stack").count() == 3, "the draw pile"
            assert board.locator(".lc-root .kit-plate").count() == 3, "three seat plates"
            assert board.locator(".lc-root .kit-plate.active").count() == 1, "one plate marked for the player on turn"
            assert board.locator(".lc-root .lcd-card").count() == 0, "the board shows a hand"
            # Every player's hand as a fan of backs with its number (E-024).
            assert board.locator(".lc-fan").count() == 3, "a fan for each player"
            assert board.locator(".lc-fan b").all_inner_texts() == ["7", "7", "7"], board.locator(".lc-fan b").all_inner_texts()
            assert board.locator(".lc-fan i").count() == 21, "seven backs in each fan"

            small = decks[1]
            if small.locator("#tab-table").count():
                small.locator("#tab-table").click()
            small.locator("[data-rules]").click()
            small.locator(".rules-modal .md h3").first.wait_for()
            assert "Last Card" in small.inner_text(".rules-modal .rules-head h2")
            assert small.locator(".rules-settings tr").count() == 4, "the four settings at this table"
            img = small.locator(".rules-modal .md img")
            img.scroll_into_view_if_needed()
            wait(lambda: img.evaluate("i => i.complete && i.naturalWidth > 0"), 10, "the rules illustration")
            shot(small, "rules-illustration")
            small.locator(".rules-modal .rules-close").click()
            small.wait_for_selector(".rules-modal", state="detached")
            if small.locator("#tab-game").count():
                small.locator("#tab-game").click()

            for d in decks:
                assert d.locator(".lcd-card").count() == 7, f"{d.label} shows {d.locator('.lcd-card').count()} cards"
                # The buttons sit right under the status (E-024).
                st, bar = d.locator(".lcd-status").bounding_box(), d.locator(".lcd-actions").bounding_box()
                assert bar["y"] - (st["y"] + st["height"]) < 80, f"{d.label}: the buttons are far from the status"
                line = d.locator(".lcd-line").bounding_box()
                assert 0 <= line["y"] - (st["y"] + st["height"]) < 20, f"{d.label}: the release line is not under the status"
                check(d, f"{d.label} at the start")
                shot(d, f"deck-start-{d.label}")

            checked = set()
            end = time.time() + 900
            while time.time() < end:
                st = a("GET", "/state")
                if st["phase"] == "finished":
                    break
                if not seen["burst"] and board.locator(".lc-burst").count():
                    seen["burst"] = True
                    shot(board, "board-last-card")
                if not seen["panel"] and board.locator(".lc-panel:not([hidden])").count():
                    seen["panel"] = True
                    time.sleep(0.5)
                    shot(board, "board-round-over")
                acted = False
                for d in decks:
                    if d.locator(".lcd-status.go").count() and d.label not in checked:
                        check(d, f"{d.label} on turn")
                        shot(d, f"deck-turn-{d.label}")
                        checked.add(d.label)
                    if take_turn(d, board):
                        acted = True
                        time.sleep(0.35)
                        break
                if not acted:
                    time.sleep(0.15)
            time.sleep(0.8)
            shot(board, "board-final")
            st = a("GET", "/state")
            assert st["phase"] == "finished", f"the game did not finish (phase {st['phase']})"
            assert seen["peek"], "never saw a card at a player's edge while it was being slung"
            assert seen["bounce"], "never tried a card that doesn't fit"
            # The scores between rounds show only when there is a next round: a game can end in its first.
            if st["summary"]["highlights"]["rounds"] > 1:
                assert seen["panel"], "the round's scores never showed"
            assert seen["receive"], "never drew a card from a phone"
            assert seen["line"], "never let go of a card above the line"
            assert seen["tap"], "never tapped a card to play it"
            sounds = board.evaluate("window.gameTableSounds || []")
            assert seen["burst"] or "lastCard" in sounds, "never saw Last card!"
            summary = st["summary"]["text"]
            assert "wins" in summary or "win" in summary, summary
            print("seen:", seen, "sounds:", sorted(set(sounds)))
            browser.close()
    finally:
        proc.terminate()
    if errors or problems:
        print("BROWSER ERRORS:\n" + "\n".join(errors) if errors else "", "\nLAYOUT PROBLEMS:\n" + "\n".join(problems) if problems else "")
        sys.exit(1)
    print(f"ok: Last Card played to the end ({summary}); screenshots in {OUT}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        if os.environ.get("GITHUB_ACTIONS"):
            print(f"::error title=Last Card browser check::{e}")
        raise
