# wt-caddy

Routes git-worktree dev servers through Caddy and shows them on a live dashboard. Companion to [worktrunk](https://worktrunk.dev) (`wt`), which owns creating worktrees, copying files and starting servers. `wt-caddy` only owns URLs.

```
wt-caddy add <repo> <branch> <port> [--service name] [--path dir] [--rewrite-host] [--cmd '<command>'] [--start]
wt-caddy start|stop|restart <repo> <branch> [--service name]
wt-caddy rm  <repo> <branch> [--service name] [--kill]
wt-caddy ls [--json]
wt-caddy logs <repo> <branch> [--service name] [--open]   # path, or show it via config logs.open
wt-caddy gc        # drop routes whose worktree directory is gone
wt-caddy service   # start Caddy and the dashboard if they aren't running
```

- URL: `<branch>.<repo>.localhost:8080`, or `<service>.<branch>.<repo>.localhost:8080`. `*.localhost` resolves to loopback in browsers, so no DNS setup.
- Dashboard: `http://wt.localhost:8080` (live over SSE). Started automatically by `add`.
- Registry: `~/.local/state/wt-caddy/routes.json`. Every change replaces the whole Caddy server config.
- `--rewrite-host` sends `Host: localhost:<port>` upstream, for servers with a host allowlist (Storybook).
- `--kill` on `rm` stops whatever listens on the removed ports.

Needs Node 22.6+ (runs the `.ts` file directly; the shim passes `--experimental-strip-types`). `~/bin/wt-caddy` is a shim around `wt-caddy.ts`.
Hooks: see `~/.claude/skills/setup-wt/SKILL.md`.

## Config

`~/.config/wt-caddy/config.jsonc` (JSON with comments), optional:

```jsonc
{
  // Added after the existing PATH for everything wt-caddy runs. Replaces the defaults when set.
  "path": ["~/.local/share/fnm/aliases/default/bin", "~/Library/pnpm/bin", "/opt/homebrew/bin"],
  "logs": {
    // {log} = file, {title} = label. Leave out to just print the path.
    "open": "kitten @ launch --type=window --cwd=current --title {title} tail -f {log}"
  }
}
```

The `~/bin/wt-caddy` shim only has to find `node`; the rest of PATH comes from this file. For tmux use `tmux split-window -v "tail -f {log}"`.
Logs exist for services started by `wt-caddy` (`add --start`, `start`, `restart`) in `~/.local/state/wt-caddy/logs/`. Each start begins a fresh log and keeps the previous run once as `<name>.log.1`; `rm` and `gc` delete a removed route's logs. A single run's log is not rotated.
