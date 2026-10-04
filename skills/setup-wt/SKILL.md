---
name: setup-wt
description: Wire the current repo into worktrunk (wt) plus wt-caddy, so new worktrees copy env files, install deps, start dev servers and get http://<branch>.<repo>.localhost:8080 URLs. Writes hooks into the user's own wt config, nothing into the repo. Use for "set up wt for this repo" or when worktrees of this repo have no dev server URLs. Needs the machine setup from the wt-caddy skill first.
---

Per-repo setup, opt-in and personal: everything goes into `~/.config/worktrunk/config.toml` under `[projects."<identifier>"]`. The repo gets no `.config/wt.toml` (a user's wt choice stays out of shared repos). User hooks need no approval prompts.

Precondition: `wt --version` is 0.80+, `wt-caddy` is on PATH and `wt config show` has no warnings (otherwise run the wt-caddy skill's machine setup first).

## Steps

1. **Identifier.** `wt config show` inside the repo prints `Identifier: github.com/<owner>/<repo>`. Use it as the table key. `{{ repo }}` in hooks is the repo directory name.
2. **Inspect the repo:** package manager (`packageManager`, lockfile), dev scripts in `package.json` and workspace apps, and which service needs which port: a `--port` flag (append to `pnpm <script>`, or `pnpm exec <bin> --port N` when the script hardcodes a port) or a `PORT` env var. A service with a hardcoded port and no override: say so and ask.
3. **Write the entry** from the template below (check first that no `[projects."<id>"]` exists; edit it instead of duplicating).
4. **Host checks.** Requests arrive as `Host: <branch>.<repo>.localhost`:
   - Next.js: add `"*.localhost"` to `allowedDevOrigins` in `next.config`. This is the one change inside the repo; show it to the user as a normal PR suggestion, do not commit it to the default branch.
   - Vite: `*.localhost` is allowed by default.
   - Storybook ("Invalid host"): `--rewrite-host` on its `wt-caddy add` (already in the template).
5. **Cross-service wiring.** If a browser app calls another local service, give that service its own route (`--service server`), pass the app that URL (e.g. `VITE_SERVER_URL=http://server.{{ branch | sanitize }}.{{ repo }}.localhost:8080`), and tell the service the app's origin (CORS, e.g. `ALLOWED_ORIGINS`).
6. **Verify with a throwaway worktree**, then remove it (below). Report which repo files, if any, were touched.

## Template

```toml
[projects."github.com/<owner>/<repo>"]
step.copy-ignored.exclude = ["node_modules/"]     # copy env files and caches, let pnpm rebuild node_modules

[[projects."github.com/<owner>/<repo>".pre-start]]  # blocking, runs in order
copy = "wt step copy-ignored"

[[projects."github.com/<owner>/<repo>".pre-start]]
install = "pnpm install"

[projects."github.com/<owner>/<repo>".post-start]    # background, concurrent
server = "pnpm dev --port {{ branch | hash_port }}"
storybook = "pnpm storybook --port {{ (branch ~ \"storybook\") | hash_port }} --no-open"
route-server = "wt-caddy add {{ repo }} {{ branch }} {{ branch | hash_port }} --path {{ worktree_path }}"
route-storybook = "wt-caddy add {{ repo }} {{ branch }} {{ (branch ~ \"storybook\") | hash_port }} --service storybook --rewrite-host --path {{ worktree_path }}"
open = "sleep 2; open http://{{ branch | sanitize }}.{{ repo }}.localhost:8080"
```

- The unnamed service (no `--service`) gets `<branch>.<repo>.localhost`; others `<service>.<branch>.<repo>.localhost`.
- Each service needs its own `hash_port` seed: `branch` for the main one, `branch ~ "<name>"` for the others.
- Drop storybook lines if the repo has none. Prefix env vars on the command (`PORT=... pnpm ...`).
- Playwright: append `PLAYWRIGHT_BASE_URL=http://localhost:{{ branch | hash_port }}` to `.env.local` in a further pre-start step only if the playwright config's `webServer.url` follows it; otherwise tests start their own server on the default port.
- `[list] url` (the URL column in `wt list`) is project-config-only in wt 0.80, so it is not set here. The dashboard lists every URL.
- Pipelines: each `[[...pre-start]]` block is one step, run in order; keys inside a block run concurrently. A failing step aborts the rest.

## Verify

```bash
cd <repo> && wt switch --create wt-setup-test --no-cd
sleep 40; wt caddy ls                                        # every service "up"
curl -s -o /dev/null -w "%{http_code}\n" http://wt-setup-test.<repo>.localhost:8080/
wt remove wt-setup-test --yes --force-delete                 # routes gone, ports free
```
