# Decisions

- `wt` stays a personal tool: hooks live in the user config, not in shared repos (a `setup-wt` skill writes them).
- `wt-caddy` does URLs, process start/stop and logs only. `wt` owns worktree creation, file copying and install.
- `.localhost` instead of `.test`: no dnsmasq or `sudo` needed.
- Not an npm `devDependency`: one Caddy, registry and dashboard per machine. If shared, publish globally or as a plugin.
- Mod loaded by listing its folder in `CLAUDE_CODE_PLUGIN_DIRS`. The symlink-directory idea was dropped.
- Control surface is a terminal UI, not a pane inside Claude Code (2026-10-05): the pane's focus is unreliable. The UI is dependency-free and declarative (`view(state)`) instead of Ink.
- Worth trying before sharing with the team: `portree` (github.com/fairy-pitta/portree), which covers similar ground.
