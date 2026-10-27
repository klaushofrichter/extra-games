"""Browser check for who may drag Backgammon checkers and tap the cube (E-034), with a remote player and an AI.

A Table Host with this repo's games and a local cloud service; the board page, a phone (Ann) and a remote player
(Rita) who joins through an invite and gets her own board and deck over WebRTC.

Ann against Rita:
  - on the table's board only Ann's checkers, and only on her turn: a drag of Rita's checkers does nothing, and in
    Rita's turn the board's cube can't be tapped;
  - on Rita's board only Rita's checkers, and only on her turn: a drag of Ann's checkers does nothing; her own drag
    moves; her cube tap doubles, and her deck withdraws it;
  - the table's board drags Ann's checkers in her turn.
Ann against an AI (Rita leaves; a game needs a player at the table):
  - in the AI's turn the table's board moves none of its checkers, by tap or drag, and doesn't offer its cube.
No browser console error anywhere.
  python3 scripts/e2e/backgammon_seats.py out/
"""
import os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, ".games-service", "scripts", "e2e"))
from playwright.sync_api import sync_playwright  # noqa: E402
from common import call, errors, join_deck, pick_game, start_cloud, start_table, wait, watch  # noqa: E402
from game_check import TableCheck  # noqa: E402

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
ADMIN = "admin-token-for-e2e-0001"
CLOUD, BASE = "http://127.0.0.1:8098", "http://127.0.0.1:8099"
KEY = "e2ekey"
T = TableCheck(BASE, KEY, OUT, "backgammon-seats")
a, shot = T.a, T.shot


def game():
    return a("GET", "/game/board")["view"]


def player(name):
    return next(p for p in a("GET", "/state")["players"] if p["name"] == name)


def color_of(name):
    return game()["seats"].index(player(name)["seat"])


def top_checker(surface, spot, color):
    """The checker a finger picks up on a spot: the top one of that colour."""
    sel = f'.bg-ck[data-spot="bar"][data-color="{color}"]' if spot == "bar" else f'.bg-ck.{"b" if color else "w"}[data-spot="{spot}"]'
    loc = surface.locator(sel)
    ks = loc.evaluate_all("els => els.map((e) => Number(e.dataset.k))")
    assert ks, f"no checker of colour {color} on {spot}"
    return loc.nth(ks.index(max(ks)))


def drag(page, surface, spot, color, to):
    """Drag a checker as a finger would, on a board page or on the board inside the remote player's page."""
    b = top_checker(surface, spot, color).bounding_box()
    z = surface.locator(f'[data-zone="{to}"]').first.bounding_box()
    page.mouse.move(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2)
    page.mouse.down()
    page.mouse.move(z["x"] + z["width"] / 2, z["y"] + z["height"] / 2, steps=12)
    page.mouse.up()


def a_point_of(surface, color):
    """A point holding checkers of this colour."""
    spots = surface.locator(f'.bg-ck.{"b" if color else "w"}').evaluate_all("els => els.map((e) => e.dataset.spot)")
    return next(s for s in spots if s.isdigit())


def unchanged(surface, before, what):
    """Nothing moved: the same turn, the same dice left, and no checker left hanging where it was dropped."""
    time.sleep(0.7)
    v = game()
    assert (v["turn"], v["phase"], len(v["remaining"])) == before, f"{what}: the game changed ({before} -> {v['turn'], v['phase'], len(v['remaining'])})"
    assert surface.locator(".bg-ck.dragging").count() == 0, f"{what}: a checker is still carried"
    left = surface.locator(".bg-ck").evaluate_all("els => els.filter((e) => e.style.transform).length")
    assert left == 0, f"{what}: a checker stayed where it was dropped"


def snapshot():
    v = game()
    return (v["turn"], v["phase"], len(v["remaining"]))


def settle(surface):
    surface.locator(".bg-board:not([data-busy])").wait_for(timeout=30000)
    time.sleep(0.15)


def roll(deck):
    turn = game()["turn"]
    deck.locator(".bg-acts [data-act=roll]").click()
    wait(lambda: game()["phase"] != "roll" or game()["turn"] != turn, 5, "the roll")


def finish_turn(deck):
    """The rest of a turn from a deck: the first listed move until none is left, then Done."""
    turn = game()["turn"]
    for _ in range(5):
        v = game()
        if v["phase"] != "move" or v["turn"] != turn or not v["legal"]:
            break
        n = len(v["remaining"])
        deck.locator(".bg-moves button:not([disabled])").first.click()
        wait(lambda: game()["phase"] != "move" or game()["turn"] != turn or len(game()["remaining"]) < n, 5, "a deck move")
    v = game()
    if v["phase"] == "move" and v["turn"] == turn and v["canDone"]:
        deck.locator(".bg-acts [data-act=done]:not([disabled])").click()
    wait(lambda: game()["phase"] != "move" or game()["turn"] != turn, 6, "the end of the turn")


def to_move(color, decks, secs=60):
    """Play turns from the decks until it is this colour's turn to move (rolled, with a move to make)."""
    end = time.time() + secs
    while time.time() < end:
        v = game()
        if v["phase"] == "move" and v["turn"] == color and v["legal"]:
            return v
        if v["phase"] == "double":
            decks[v["turn"] ^ 1].locator(".bg-acts [data-act=take]").click()
            wait(lambda: game()["phase"] != "double", 5, "the take")
        elif v["phase"] == "roll" and decks.get(v["turn"]):
            roll(decks[v["turn"]])
        elif v["phase"] == "move" and decks.get(v["turn"]):
            finish_turn(decks[v["turn"]])
        else:
            time.sleep(0.2)  # the AI's turn
    raise AssertionError(f"colour {color} never came to move")


def main():
    cloud = start_cloud(8098, ADMIN_TOKEN=ADMIN, PUBLIC_URL=CLOUD, ICE_SERVERS="[]")
    # The AI takes its time, so its turn can be looked at.
    proc = start_table(8099, TABLE_KEY=KEY, GAMES_DIR=os.path.join(ROOT, "games"), AI_DELAY_MS="2500", PUBLIC_URL=BASE, CLOUD_URL=CLOUD)
    board = None
    try:
        code = wait(lambda: a("GET", "/state")["cloud"].get("pairingCode"), 15, "the pairing code")
        call(CLOUD, "POST", f"/admin/api/tables/pair/{code}", {}, {"authorization": f"Bearer {ADMIN}"})
        wait(lambda: a("GET", "/state")["cloud"]["status"] == "online", 20, "the table online")
        time.sleep(1.0)
        with sync_playwright() as p:
            # The table's WebRTC stack resolves real addresses only, and the check has no STUN server (remote.py).
            browser = p.chromium.launch(args=["--disable-features=WebRtcHideLocalIpsWithMdns"])
            board = browser.new_page(viewport={"width": 1920, "height": 1080})
            watch(board, "board")
            board.goto(BASE + "/board/")
            board.wait_for_selector("button.tile")
            ann = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True).new_page()
            watch(ann, "Ann")
            join_deck(ann, a("GET", "/join")["url"], "Ann")
            board.click("button[data-invite]")
            board.wait_for_selector(".invite-body .code")
            invite = board.inner_text(".invite-body .code").strip()
            remote = browser.new_context(viewport={"width": 1440, "height": 900}).new_page()
            watch(remote, "Rita")
            remote.goto(f"{CLOUD}/i/{invite}")
            remote.fill("#join input[name=name]", "Rita")
            remote.click("#join button[type=submit]")
            remote.wait_for_selector("#play:not([hidden])", timeout=30000)
            rdeck, rboard = remote.frame_locator("#deck"), remote.frame_locator("#board")
            rdeck.locator("text=Rita").first.wait_for(timeout=20000)
            board.wait_for_selector(".overlay .invite", state="detached", timeout=10000)

            pick_game(board, "backgammon")
            board.locator(".dialog [data-x=yes]").click()
            time.sleep(0.4)
            a("POST", "/game/settings", {"settings": {"matchLength": 5, "cube": True, "turnSeconds": 0}})
            ann.click("#ready")
            rdeck.locator("#ready").click()
            wait(lambda: all(x["ready"] for x in a("GET", "/state")["players"]), 5, "everyone ready")
            a("POST", "/game/start")
            board.wait_for_selector(".bg-ck")
            rboard.locator(".bg-ck").first.wait_for(timeout=20000)
            ac, rc = color_of("Ann"), color_of("Rita")
            decks = {ac: ann, rc: rdeck}

            # Rita's turn to move.
            v = to_move(rc, decks)
            settle(board)
            settle(rboard)
            assert board.locator(".bg-ck.movable").count() == 0, "the table's board offers a remote player's checkers"
            assert rboard.locator(f'.bg-ck.{"b" if rc else "w"}.movable').count() > 0, "Rita's board offers none of her checkers"
            assert rboard.locator(f'.bg-ck.{"b" if ac else "w"}.movable').count() == 0, "Rita's board offers Ann's checkers"
            t = v["targets"][0]
            drag(board, board, t["from"], rc, t["to"])
            unchanged(board, snapshot(), "the table's board dragged Rita's checker")
            drag(remote, rboard, a_point_of(rboard, ac), ac, t["to"])
            unchanged(rboard, snapshot(), "Rita's board dragged Ann's checker")
            shot(remote, "remote-refused")
            n = len(v["remaining"])
            drag(remote, rboard, t["from"], rc, t["to"])
            wait(lambda: game()["turn"] != rc or len(game()["remaining"]) < n, 5, "Rita's dragged move")
            settle(rboard)
            shot(remote, "remote-dragged")
            if game()["phase"] == "move" and game()["turn"] == rc:
                finish_turn(rdeck)

            # Ann's turn to move: Rita's board has nothing to move; the table's board drags for Ann.
            v = to_move(ac, decks)
            settle(board)
            settle(rboard)
            assert rboard.locator(".bg-ck.movable").count() == 0, "Rita's board offers checkers in Ann's turn"
            t = v["targets"][0]
            drag(remote, rboard, t["from"], ac, t["to"])
            unchanged(rboard, snapshot(), "Rita's board dragged Ann's checker in Ann's turn")
            n = len(v["remaining"])
            drag(board, board, t["from"], ac, t["to"])
            wait(lambda: game()["turn"] != ac or len(game()["remaining"]) < n, 5, "Ann's dragged move on the table's board")
            settle(board)
            if game()["phase"] == "move" and game()["turn"] == ac:
                finish_turn(ann)

            # Rita to roll, the cube in the middle: only her board can tap it; she withdraws the double from her deck.
            end = time.time() + 60
            while not (game()["phase"] == "roll" and game()["turn"] == rc and game().get("canDouble")):
                assert time.time() < end, "Rita never had the cube to double"
                v = game()
                if v["phase"] == "roll" and v["turn"] == ac:
                    roll(ann)
                elif v["phase"] == "move":
                    finish_turn(decks[v["turn"]])
                else:
                    time.sleep(0.2)
            settle(board)
            settle(rboard)
            assert board.locator(".bg-cube.tap").count() == 0, "the table's board offers a remote player's cube"
            rboard.locator(".bg-cube.tap").click()
            wait(lambda: game()["phase"] == "double", 5, "Rita's double from her cube")
            assert game()["turn"] == rc
            rdeck.locator(".bg-acts [data-act=withdraw]").wait_for()
            assert ann.locator(".bg-acts [data-act=withdraw]").count() == 0, "Ann may withdraw Rita's double"
            shot(remote, "remote-withdraw")
            rdeck.locator(".bg-acts [data-act=withdraw]").click()
            wait(lambda: game()["phase"] == "roll" and game()["turn"] == rc, 5, "the withdrawal")
            assert game()["cube"]["value"] == 1, "a withdrawn double changed the cube"

            # Ann against an AI: Rita leaves, the AI takes her place.
            a("POST", "/game/end", {})
            wait(lambda: a("GET", "/state")["phase"] not in ("active", "paused", "terminating"), 10, "the game to end")
            if a("GET", "/state")["phase"] != "idle":
                a("POST", "/game/close", {})
            a("DELETE", f"/players/{player('Rita')['id']}")
            remote.close()
            pick_game(board, "backgammon")
            board.locator(".dialog [data-x=yes]").click()
            time.sleep(0.4)
            a("POST", "/game/settings", {"settings": {"matchLength": 5, "cube": True, "turnSeconds": 0}})
            a("POST", "/ai", {})
            ann.click("#ready")
            wait(lambda: all(x["ready"] for x in a("GET", "/state")["players"]), 5, "everyone ready")
            a("POST", "/game/start")
            board.wait_for_selector(".bg-ck")
            ac = color_of("Ann")
            ai = ac ^ 1
            # The AI's turn, rolled: nothing to drag or tap on the table's board.
            end = time.time() + 90
            seen = False
            while time.time() < end and not seen:
                v = game()
                if v["turn"] == ai and v["phase"] == "move" and v["legal"]:
                    t = v["targets"][0]
                    before = snapshot()
                    assert board.locator(".bg-ck.movable").count() == 0, "the table's board offers the AI's checkers"
                    drag(board, board, t["from"], ai, t["to"])
                    if snapshot() == before:  # still the AI's same moment, so the drags were looked at in time
                        unchanged(board, before, "the AI's checker was dragged")
                        seen = True
                elif v["turn"] == ai and v["phase"] == "roll":
                    assert board.locator(".bg-cube.tap").count() == 0, "the table's board offers the AI's cube"
                    time.sleep(0.1)
                elif v["phase"] == "double" and v["turn"] == ai:
                    ann.locator(".bg-acts [data-act=take]").click()
                    wait(lambda: game()["phase"] != "double", 5, "Ann's take")
                elif v["turn"] == ac and v["phase"] == "roll":
                    roll(ann)
                elif v["turn"] == ac and v["phase"] == "move":
                    finish_turn(ann)
                else:
                    time.sleep(0.2)
            assert seen, "never caught the AI's turn to drag its checkers"
            shot(board, "ai-turn")
            browser.close()
    except Exception:
        try:
            if board:
                shot(board, "failed")
        except Exception:
            pass
        raise
    finally:
        proc.terminate()
        cloud.terminate()
    if errors:
        print("BROWSER ERRORS:\n" + "\n".join(errors))
        sys.exit(1)
    print(f"ok: Backgammon drag and cube by seat (table, remote, AI); screenshots in {OUT}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        if os.environ.get("GITHUB_ACTIONS"):
            print(f"::error file=scripts/e2e/backgammon_seats.py::{type(e).__name__}: {str(e)[:900]}".replace("\n", " "))
        raise
