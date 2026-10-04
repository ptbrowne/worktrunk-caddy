# wt-caddy and worktree setup: where things stand

Written 2026-10-04. Goal: every git worktree gets its own dev servers, reachable at
`http://<branch>.<repo>.localhost:8080`, set up by worktrunk (`wt`) hooks, and visible and
controllable from Claude Code.

## The pieces

| Piece | Where | Does |
|---|---|---|
| `wt-caddy` CLI | `~/code/wt-caddy/wt-caddy.ts` (git repo, `main`) | Registers routes in Caddy, starts/stops servers, shows logs, serves a live dashboard |
| Shim | `~/bin/wt-caddy` | Finds `node`, passes `--experimental-strip-types`, runs the `.ts` file |
| Dashboard | `http://wt.localhost:8080` | All routes across repos, live over SSE (started by `wt-caddy add` or `wt-caddy service`) |
| Config | `~/.config/wt-caddy/config.jsonc` | `path` (extra PATH entries), `logs.open` (command that shows a log; kitty split today) |
| Claude Code mod | `~/code/wt-caddy/mods/wt-caddy-status/` | Status line entry, `/servers` pane |
| Mod loading | `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json` `env` | Points at the mod folder, so every session loads it |
| Skills | `~/code/wt-caddy/skills/{wt-caddy,setup-wt}/` (symlinked into `~/.claude/skills/`) | `wt-caddy`: machine setup and daily use. `setup-wt`: wire a repo |
| Plugin manifests | `~/code/wt-caddy/.claude-plugin/` | For sharing the skills with a team. Written from memory, never tested |
| wt hooks | `~/.config/worktrunk/config.toml` | Per-repo hooks under `[projects."<id>"]`, plus global `worktree-path` and `pre-remove` |
| Global Claude rules | `~/.claude/CLAUDE.md`, section 5 | Manage worktrees via `wt`, use the `.localhost` URLs |

## How it works

- `wt switch --create <branch>` runs `pre-start` (copy ignored files except `node_modules/`,
  `pnpm install`), then `post-start`. Each service is one hook line:
  `wt-caddy add <repo> <branch> <port> [--service x] --cmd '<command>' --start`.
  `add` registers the route, remembers the command, starts the server detached.
- Ports come from `{{ branch | hash_port }}` (10000-19999), one seed per service.
- Registry: `~/.local/state/wt-caddy/routes.json`. Every change replaces the whole Caddy server
  config (admin API, `PATCH`, falls back to `PUT`). Writes are locked, because `wt` runs hooks in parallel.
- Logs: `~/.local/state/wt-caddy/logs/<repo>-<branch>-<service>.log`. Each start begins a fresh log and
  keeps the previous run as `.log.1`. `rm` and `gc` delete a removed route's logs. No size rotation.
- `wt remove` runs the global `pre-remove` hook `wt-caddy rm {{ repo }} {{ branch }} --kill`:
  drops the routes, kills the listeners, deletes the logs.
- `wt` 0.80 runs `wt-caddy` as `wt caddy ...` (external subcommands).

CLI: `add`, `start|stop|restart`, `rm [--kill]`, `ls [--json]`, `logs [--open]`, `hooks`, `hook <name>`,
`gc`, `service`. `--rewrite-host` on `add` sends `Host: localhost:<port>` upstream; needed for Storybook,
which answers "Invalid host" to `*.localhost`.

## Claude Code mod

- Status line: `● dev  ○ server · http://<branch>.<repo>.localhost:8080 · /servers`. Polls `wt-caddy ls --json`
  every 3 s and matches routes to the session's current directory.
- `/servers`: pane with one start/stop button per service (vertical list), a `logs` button under each running
  service, and `○ name [ start ]  not started` for services the hooks define but that have no route yet
  (start runs `wt hook post-start <name>`).
- The mod folder has 6 tests (`claude plugin test`), covering formatting and parsing only.

## Repos

| Repo | State |
|---|---|
| `ics-atlas-social-attitudes` | Hook entry in user config. Verified end to end (app and storybook through `.localhost`). Uncommitted: one line in `next.config.ts`, `"*.localhost"` in `allowedDevOrigins`. Needs a branch and PR. |
| `ixt-visualize-chat-prototype` | Hook entry in user config (client, server, storybook; CORS and `VITE_SERVER_URL` wired). Verified end to end before the `--cmd`/`--start` hook change; not re-run since. |
| `tpw-member-progress` | Hook entry in user config, not verified. Blocked: its old `.config/wt.toml` was committed, so new worktrees still contain it and `wt` 0.80 cannot parse it. I deleted it in the working tree (shows as ` D` on `analytics/stop-non-production-traffic-v2`). Commit that deletion on a branch. Probably also needs `"*.localhost"` in `allowedDevOrigins` in `next.config.ts`. |

No wt config files remain inside any repo. wt reads everything from `~/.config/worktrunk/config.toml`.

## Not verified

- The `/servers` pane layout, button keys (Up/Down/Enter/Esc) and focus. Focus is only a request: the surface
  refuses it while the composer holds text. The mod retries 200 ms after the command and shows
  `ctrl+x` then `Tab` as a fallback. A first version told you the keys worked; they did not.
- The `logs` button: needs `KITTY_LISTEN_ON` or a terminal in the mod's process. If it does nothing, put
  `--to unix:/tmp/mykitty` in `logs.open`.
- Whether the status line URL is clickable in your terminal.
- Whether a symlinked or folder-based mod loads in a fresh session via `CLAUDE_CODE_PLUGIN_DIRS`.
- The plugin and marketplace manifests (`/plugin marketplace add ...`).
- ixt and tpw after the `--cmd`/`--start` hook change.

## Known limits

- Restarted servers use your default fnm node, not a repo's `.nvmrc`.
- Defined-but-not-started services show only in the pane, not the status line.
- Servers started by hooks before the `--cmd` change log under `.git/wt/logs/`, not in wt-caddy's log folder.
- `[list] url` (the URL column in `wt list`) is project-config only in wt 0.80, so it is not set.
- Pressing `start` twice during a slow boot can spawn a duplicate (it fails on the busy port).
- Needs Node 22.6+, Caddy on `:8080` with the admin API on `:2019`, and `*.localhost` resolving (browsers and curl do).

## Cleanup and leftovers

- `~/bin/caddy-route.sh` is obsolete.
- `wt config show` says the fish integration is outdated; `wt config shell install` refreshes it (not run).
- Backups: `~/.config/worktrunk/config.toml.bak-2026-10-04`, `.bak-2`, and `~/.claude/settings.json.bak-plugin-dirs`.
- Old per-session copy of the mod under `~/.claude/dev-mods/<session-id>/`; harmless, the repo copy is the source of truth.

## Decisions made

- `wt` stays a personal tool: hooks live in the user config, not in shared repos (a `setup-wt` skill writes them).
- `wt-caddy` does URLs, process start/stop and logs only. `wt` owns worktree creation, file copying and install.
- `.localhost` instead of `.test`: no dnsmasq or `sudo` needed.
- Not an npm `devDependency`: one Caddy, registry and dashboard per machine. If shared, publish globally or as a plugin.
- Mod loaded by listing its folder in `CLAUDE_CODE_PLUGIN_DIRS` (colon-separated for more mods). The symlink-directory idea was dropped.
- Worth trying before sharing with the team: `portree` (github.com/fairy-pitta/portree), which covers similar ground.

## Picking it up

1. Open a fresh Claude Code session in a worktree with routes; check the status line, `/servers`, and the `logs` button.
2. Commit the tpw `wt.toml` deletion on a branch, then create a throwaway worktree there to verify.
3. Re-run an ixt worktree to confirm the new hook form.
4. Decide on sharing: skills plus the plugin manifests, after testing the install path.

Commits are in `~/code/wt-caddy` (`git log`). The skills' `SKILL.md` files hold the exact hook template and the verify recipe.
