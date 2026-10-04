# Architecture

## The pieces

| Piece | Where | Does |
|---|---|---|
| `wt-caddy` CLI | `~/code/wt-caddy/wt-caddy.ts` | Registers routes in Caddy, starts/stops servers, shows logs, serves a live dashboard |
| UI | `~/code/wt-caddy/ui.ts` | `wt caddy ui`, see [ui.md](ui.md). Loaded only by that command |
| Shim | `~/bin/wt-caddy` | Finds `node`, passes `--experimental-strip-types`, runs the `.ts` file |
| Dashboard | `http://wt.localhost:8080` | All routes across repos, live over SSE (started by `wt-caddy add` or `wt-caddy service`) |
| Config | `~/.config/wt-caddy/config.jsonc` | `path` (extra PATH entries), `logs.open` (command that shows a log; kitty split today). Used by the CLI and the UI |
| Claude Code mod | `~/code/wt-caddy/mods/wt-caddy-status/` | See [claude-code-mod.md](claude-code-mod.md) |
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

## CLI

`add`, `start|stop|restart`, `rm [--kill]`, `ls [--json]`, `logs [--open]`, `ui`, `hooks`, `hook <name>`,
`gc`, `service`. `--rewrite-host` on `add` sends `Host: localhost:<port>` upstream; needed for Storybook,
which answers "Invalid host" to `*.localhost`.

Needs Node 22.6+, Caddy on `:8080` with the admin API on `:2019`, and `*.localhost` resolving (browsers and curl do).
