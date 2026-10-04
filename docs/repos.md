# Repos

| Repo | State |
|---|---|
| `ics-atlas-social-attitudes` | Hook entry in user config. Verified end to end (app and storybook through `.localhost`). Uncommitted: one line in `next.config.ts`, `"*.localhost"` in `allowedDevOrigins`. Needs a branch and PR. |
| `ixt-visualize-chat-prototype` | Hook entry in user config (client, server, storybook; CORS and `VITE_SERVER_URL` wired). Verified end to end before the `--cmd`/`--start` hook change; not re-run since. |
| `tpw-member-progress` | Hook entry in user config, not verified. Blocked: its old `.config/wt.toml` was committed, so new worktrees still contain it and `wt` 0.80 cannot parse it. Deleted in the working tree (shows as ` D` on `analytics/stop-non-production-traffic-v2`). Commit that deletion on a branch. Probably also needs `"*.localhost"` in `allowedDevOrigins` in `next.config.ts`. |

No wt config files remain inside any repo. wt reads everything from `~/.config/worktrunk/config.toml`.
The skills' `SKILL.md` files hold the exact hook template and the verify recipe.
