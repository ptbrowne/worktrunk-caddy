# worktrunk-caddy

Routes git-worktree dev servers through Caddy and shows them on a live dashboard. Companion to [worktrunk](https://worktrunk.dev) (`wt`, [docs](https://worktrunk.dev/hook/)), which owns creating worktrees, copying files and starting servers. The command is `wt-caddy`, and it only owns URLs.

## Quick usage

Needs [Caddy](https://caddyserver.com) and Node 22.6+.

```bash
git clone https://github.com/ptbrowne/worktrunk-caddy ~/code/wt-caddy
# put a shim on your PATH (see skills/wt-caddy/SKILL.md for the exact one)
wt-caddy service        # starts Caddy and the dashboard

# in a worktree, register its dev server on a stable port and start it
wt-caddy add myrepo my-branch 4310 --cmd 'pnpm dev --port 4310' --start
# -> http://my-branch.myrepo.localhost:8080

wt-caddy ls             # routes, whether each port is listening
wt-caddy ui             # interactive list: start/stop/restart, open, tail logs
wt-caddy rm myrepo my-branch --kill
```

The dashboard is at http://wt.localhost:8080. Routes whose worktree directory has been deleted are pruned by `ls`, `ui` and the dashboard, so removing a worktree with plain `git` or `rm -rf` doesn't leave a route behind.

With worktrunk, `wt-caddy add` goes in a `post-start` hook and `wt-caddy rm --kill` in a `pre-remove` hook (see the worktrunk [hook documentation](https://worktrunk.dev/hook/) and [config documentation](https://worktrunk.dev/config/)). Ready-made hooks: [skills/setup-wt/SKILL.md](skills/setup-wt/SKILL.md).

## How it differs from portree

[portree](https://github.com/fairy-pitta/portree) is the closest tool. It also gives each worktree `<branch>.localhost` URLs and a terminal dashboard. The differences:

| | wt-caddy | portree |
|---|---|---|
| Proxy | Caddy, one instance per machine | Built-in Go proxy |
| Config | None in the repo; routes are registered by commands (hooks) | `.portree.toml` at the repo root |
| Scope | One registry for every repo on the machine | Per repo, state in `.portree/` |
| Starting servers | Starts and logs what you registered with `--cmd`; worktrunk hooks do the rest | `portree up` starts the services in the config |
| Ports | You pass the port (worktrunk hooks use a hash of the branch name) | Hash of branch and service, with probing for a free port |
| Worktree creation | Expects worktrunk to create and remove worktrees | Create worktrees yourself with `git worktree add` |
| HTTPS | No | Yes, generated certificates |
| Dashboard | Web page plus terminal UI | Terminal UI |

I'd pick portree if you want a self-contained, per-repo config with no other tools. I'd pick wt-caddy if you already use worktrunk and want every repo's dev servers behind one Caddy and one dashboard.

## Reference

```
wt-caddy add <repo> <branch> <port> [--service name] [--path dir] [--rewrite-host] [--cmd '<command>'] [--start]
wt-caddy start|stop|restart <repo> <branch> [--service name]
wt-caddy rm  <repo> <branch> [--service name] [--kill]
wt-caddy ls [--json]
wt-caddy logs <repo> <branch> [--service name] [--open]   # path, or show it via config logs.open
wt-caddy ui       # interactive list: start/stop/restart, open the URL, tail logs
wt-caddy gc        # drop routes whose worktree directory is gone (ls, ui and the dashboard do this too)
wt-caddy service   # start Caddy and the dashboard if they aren't running
```

- URL: `<branch>.<repo>.localhost:8080`, or `<service>.<branch>.<repo>.localhost:8080`. `*.localhost` resolves to loopback in browsers, so no DNS setup.
- Dashboard: `http://wt.localhost:8080` (live over SSE). Started automatically by `add`.
- Registry: `~/.local/state/wt-caddy/routes.json`. Every change replaces the whole Caddy server config.
- `--rewrite-host` sends `Host: localhost:<port>` upstream, for servers with a host allowlist (Storybook).
- `--kill` on `rm` stops whatever listens on the removed ports.

Node 22.6+ runs the `.ts` file directly; the shim passes `--experimental-strip-types`. Hooks: see [skills/setup-wt/SKILL.md](skills/setup-wt/SKILL.md). More in [docs/](docs/README.md).

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

The `~/bin/wt-caddy` shim only has to find `node`; the rest of PATH comes from this file. The UI's `l` key uses the same `logs.open`. For tmux use `tmux split-window -v "tail -f {log}"`.
Logs exist for services started by `wt-caddy` (`add --start`, `start`, `restart`) in `~/.local/state/wt-caddy/logs/`. Each start begins a fresh log and keeps the previous run once as `<name>.log.1`; `rm` and `gc` delete a removed route's logs. A single run's log is not rotated.
