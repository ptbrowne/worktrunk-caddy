# wt-caddy

Routes git-worktree dev servers through Caddy and shows them on a live dashboard. Companion to [worktrunk](https://worktrunk.dev) (`wt`), which owns creating worktrees, copying files and starting servers. `wt-caddy` only owns URLs.

```
wt-caddy add <repo> <branch> <port> [--service name] [--path dir] [--rewrite-host]
wt-caddy rm  <repo> <branch> [--service name] [--kill]
wt-caddy ls
wt-caddy gc        # drop routes whose worktree directory is gone
wt-caddy service   # start Caddy and the dashboard if they aren't running
```

- URL: `<branch>.<repo>.test:8080`, or `<service>.<branch>.<repo>.test:8080`. `*.test` resolves through dnsmasq.
- Dashboard: `http://wt.test:8080` (live over SSE). Started automatically by `add`.
- Registry: `~/.local/state/wt-caddy/routes.json`. Every change replaces the whole Caddy server config.
- `--rewrite-host` sends `Host: localhost:<port>` upstream, for servers with a host allowlist (Storybook).
- `--kill` on `rm` stops whatever listens on the removed ports.

Needs Node 22.18+ (runs the `.ts` file directly). `~/bin/wt-caddy` is a shim around `wt-caddy.ts`.
Hooks: see `~/.claude/skills/setup-wt/SKILL.md`.
