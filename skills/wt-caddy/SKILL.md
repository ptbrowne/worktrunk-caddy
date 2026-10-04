---
name: wt-caddy
description: Install and use wt-caddy, which gives every git worktree dev server a URL like http://<branch>.<repo>.localhost:8080 and a live dashboard at http://wt.localhost:8080. Use for one-time machine setup ("install wt-caddy", "set up worktree URLs"), or to inspect and fix routes (`wt caddy ls`, stale routes, dashboard down). For wiring a specific repo, use the setup-wt skill.
---

`wt-caddy` only owns URLs. Creating worktrees, copying files and starting servers stay with worktrunk (`wt`) hooks. One Caddy, one route registry and one dashboard per machine (`~/.local/state/wt-caddy/`).

## Machine setup (once)

Run what is missing; skip what already works.

1. **Tools:** `brew install caddy worktrunk` (needs `wt` 0.80+ for `wt caddy` and the current hook format; `wt --version`). Node 22.18+ (runs the `.ts` file directly).
2. **Install the tool.** This skill sits in `<plugin>/skills/wt-caddy/`; the tool is two directories up (`../../wt-caddy.ts`, `../../dashboard.html`). Copy both so the install survives plugin updates:
   ```bash
   mkdir -p ~/.local/share/wt-caddy ~/bin
   cp <plugin>/wt-caddy.ts <plugin>/dashboard.html ~/.local/share/wt-caddy/
   cat > ~/bin/wt-caddy <<'SH'
   #!/bin/sh
   # Hosts like Claude Code mods run without the interactive shell's PATH: add the usual node and pnpm homes.
   PATH="$PATH:$HOME/.local/share/fnm/aliases/default/bin:$HOME/Library/pnpm:/opt/homebrew/bin"
   exec node "$HOME/.local/share/wt-caddy/wt-caddy.ts" "$@"
   SH
   chmod +x ~/bin/wt-caddy
   ```
   `~/bin` must be on PATH. `wt` then also exposes it as `wt caddy ...`.
3. **User-level wt config** (`~/.config/worktrunk/config.toml`), add if absent. Top-level keys go before any `[table]`:
   ```toml
   worktree-path = "{{ repo_path }}/.claude/worktrees/{{ branch | sanitize }}"

   [pre-remove]
   wt-caddy = "wt-caddy rm {{ repo }} {{ branch }} --kill"
   ```
   The `pre-remove` hook drops a worktree's routes and stops its dev servers in every repo. `wt config show` must print no warnings about these entries.
4. **Start:** `wt-caddy service` (starts Caddy and the dashboard, idempotent). Open http://wt.localhost:8080. No DNS setup: browsers and curl resolve `*.localhost` to loopback.

## Daily use

```
wt caddy ls                 # routes and whether each port is listening
wt caddy gc                 # drop routes whose worktree directory is gone
wt caddy start|stop|restart <repo> <branch> [--service name]   # needs --cmd from `add`
wt caddy rm <repo> <branch> [--service name] [--kill]
wt caddy service            # start Caddy + dashboard if not running
```

Routes are added by repo hooks (`wt-caddy add <repo> <branch> <port> [--service name] [--rewrite-host] [--path dir] [--cmd '<command>'] [--start]`; `--cmd` is what start/restart run, `--start` runs it now, logs in `~/.local/state/wt-caddy/logs/`), see setup-wt. The unnamed service gets `<branch>.<repo>.localhost:8080`, others `<service>.<branch>.<repo>.localhost:8080`.

## Troubleshooting

- 502 from a URL: the route exists but nothing listens on the port yet (dev server still booting, or crashed). `wt caddy ls` shows `down`. Hook logs: `.git/wt/logs/`.
- "Invalid host" from a dev server: register that service with `--rewrite-host`.
- Dashboard down: `wt caddy service`. Log: `~/.local/state/wt-caddy/service.log`.
- Port 8080 taken: Caddy cannot bind; free it, then `wt caddy service`.
