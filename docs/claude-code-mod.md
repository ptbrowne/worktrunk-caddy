# Claude Code mod

`mods/wt-caddy-status/`, loaded through `CLAUDE_CODE_PLUGIN_DIRS` (colon-separated for more mods).

- Status line: `● dev  ○ server · http://<branch>.<repo>.localhost:8080 · /servers`. Polls `wt-caddy ls --json`
  every 3 s and matches routes to the session's current directory.
- `/servers`: pane with one start/stop button per service (vertical list), a `logs` button under each running
  service, and `○ name [ start ]  not started` for services the hooks define but that have no route yet
  (start runs `wt hook post-start <name>`).
- 6 tests (`claude plugin test`), covering formatting and parsing only.

The pane's focus and keys were never confirmed to work (the surface can refuse focus while the composer holds
text). The [UI](ui.md) is the more reliable way to control servers; the pane stays until the UI has proven
itself, then it is a candidate for removal.
