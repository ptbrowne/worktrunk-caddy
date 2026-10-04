# UI: `wt caddy ui`

Full-screen list of every route, for use in a terminal split next to Claude Code
(for example `kitten @ launch --type=overlay wt caddy ui`).

| Key | Does |
|---|---|
| `↑` `↓` / `j` `k` | Move. In the log view, switches to the neighbouring service's log |
| `s` | Start, or stop if up or starting |
| `r` | Restart |
| `o` | Open the URL (`open`, or `xdg-open`) |
| `enter` | Tail the log inside the UI |
| `l` | Show the log through `logs.open` in `config.jsonc` (the kitty split) |
| `esc` / `q` | Back from the log view / quit |

- Rows are grouped by repo and branch; the worktree you started it in comes first and is marked.
- `starting…` and `stopping…` show until the port actually changes; after 30 s a notice points you at the logs.
- Status refreshes every second and when `routes.json` changes; the log view every 250 ms.

## How it is built

`ui.ts`, no dependencies, loaded lazily so other commands start as fast as before.

- `view(state)` is a pure function from state to the lines of the screen.
- A painter compares each line with the previous frame and redraws only the changed ones.
- `onKey` changes state and runs the action (start, stop, restart, open).
- Gets what it needs from `wt-caddy.ts` by argument (`Api`), so `ui.ts` never imports runtime code from it.

Ink was considered and dropped: it needs React and `node_modules` in a one-file repo, starts slower, and the
`--experimental-strip-types` loader cannot handle JSX.
