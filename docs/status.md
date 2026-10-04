# Status

## Not verified

- UI: the first paint works (a bug where nothing showed until a row was highlighted is fixed). Start/stop/restart, `l`,
  resize and the log view have not been confirmed in a real terminal. `l` needs `allow_remote_control` in `kitty.conf`.
- The `/servers` pane layout, button keys (Up/Down/Enter/Esc) and focus. Focus is only a request: the surface
  refuses it while the composer holds text. The mod retries 200 ms after the command and shows
  `ctrl+x` then `Tab` as a fallback. A first version told you the keys worked; they did not.
- The pane's `logs` button: needs `KITTY_LISTEN_ON` or a terminal in the mod's process. If it does nothing, put
  `--to unix:/tmp/mykitty` in `logs.open`.
- Whether the status line URL is clickable in your terminal.
- Whether a symlinked or folder-based mod loads in a fresh session via `CLAUDE_CODE_PLUGIN_DIRS`.
- The plugin and marketplace manifests (`/plugin marketplace add ...`).
- ixt and tpw after the `--cmd`/`--start` hook change.

## Known limits

- Restarted servers use your default fnm node, not a repo's `.nvmrc`.
- Defined-but-not-started services show only in the pane, not the status line or the UI.
- Servers started by hooks before the `--cmd` change log under `.git/wt/logs/`, not in wt-caddy's log folder.
- `[list] url` (the URL column in `wt list`) is project-config only in wt 0.80, so it is not set.
- Pressing `start` twice during a slow boot can spawn a duplicate (it fails on the busy port).

## Cleanup and leftovers

- `~/bin/caddy-route.sh` is obsolete.
- `wt config show` says the fish integration is outdated; `wt config shell install` refreshes it (not run).
- Backups: `~/.config/worktrunk/config.toml.bak-2026-10-04`, `.bak-2`, and `~/.claude/settings.json.bak-plugin-dirs`.
- Old per-session copy of the mod under `~/.claude/dev-mods/<session-id>/`; harmless, the repo copy is the source of truth.

## Picking it up

1. Use the UI for a few days; then decide whether to remove the `/servers` pane (and maybe the web dashboard).
2. Commit the tpw `wt.toml` deletion on a branch, then create a throwaway worktree there to verify.
3. Re-run an ixt worktree to confirm the new hook form.
4. Decide on sharing: skills plus the plugin manifests, after testing the install path.
