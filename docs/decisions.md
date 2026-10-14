# Decision log

Decisions for the extra-games repository, newest last. Platform decisions live in games-service `docs/decisions.md`
(D-097 describes how these games reach tables). "Klaus" marks product decisions; "Claude" marks implementation
choices, which Klaus can overrule.

Format: **E-nnn · date · decided by** — decision. *Why:* reason.

- **E-001 · 2026-10-14 · Klaus** — A private repository for games that are not public yet (private games, early
  releases). Tables get them only when an administrator ticks this repository for them in the games-service console.
- **E-002 · 2026-10-14 · Claude** — Games import the SDK as `@game-table/sdk`; the table host maps the name to its own
  copy, and the tests map it to a checkout of games-service (`scripts/games-service.sh`, ref in `games-service.ref`).
  *Why:* no copy of the SDK to drift, and the tests run the games on exactly the runtime a table runs.
- **E-003 · 2026-10-14 · Claude** — Tables run the `production` branch (the console entry is
  `klaushofrichter/extra-games@production`); `main` → `production` by PR, the same shape as the cluster's services.
  Required checks on `production`: `test`, `e2e`, `codeql`. *Why:* the console refetches hourly, so whatever the
  tracked branch holds reaches tables within the hour; that branch needs the gate.
- **E-004 · 2026-10-14 · Claude** — kube-setup's repository baseline applies as far as it fits: alerts and security
  updates, `dependabot.yml` (npm, pip, github-actions; no docker, there is no image), the audit and a typecheck in the
  required `test` job, badges (blank while private), Node 26 everywhere, delete head branches on merge. Requirement 6
  (release evidence) does not apply: nothing here deploys or cuts releases.
- **E-005 · 2026-10-14 · Claude** — First game: Liar's Dice. Cups are private to each phone; the board shows them only
  after a call. Ones are wild by default (then ones can't be bid on). A slow player's turn timer opens with one of their
  most common face, or calls the bid in front of them. A player leaving mid-round restarts the round with fresh cups,
  since the bids so far counted their dice. AI styles: cautious (calls early, raises carefully) and bold (believes
  bids more, sometimes pushes one die further). In 2-player soak runs bold wins about two games in three.
