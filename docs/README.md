# wt-caddy docs

Goal: every git worktree gets its own dev servers, reachable at `http://<branch>.<repo>.localhost:8080`, set up by worktrunk (`wt`) hooks, and visible and controllable from Claude Code.

- [architecture.md](architecture.md): the pieces, how a worktree gets its servers, the CLI
- [ui.md](ui.md): `wt caddy ui`, the interactive list
- [claude-code-mod.md](claude-code-mod.md): status line and `/servers` pane
- [repos.md](repos.md): which repos are wired up and what is left in each
- [decisions.md](decisions.md): what was decided and why
- [status.md](status.md): not verified, known limits, leftovers, next steps

Written 2026-10-04, split into these files 2026-10-05.
