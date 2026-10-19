# Guidance for Claude

- Games here follow games-service's developer guide, [`docs/developers/game-development.md`](https://github.com/klaushofrichter/games-service/blob/main/docs/developers/game-development.md) (also `https://games.skylar.technology/llms.txt`). Read it before writing or changing a game: the platform owns the lobby, seats, joining,
  leaving, away phones and exchanging players; a game only reacts (`onSeatChanged`).
- Record decisions in `docs/decisions.md` (E-nnn) in the same pull request.
- Rules stay deterministic (`ctx.random()`, `ctx.now()`); AI code reads only the seat's view.
- A change in a game's folder takes a new calendar version: `node .games-service/scripts/check-game-versions.ts --base origin/main --fix`.
