export type Route = { repo: string; branch: string; service: string; host: string; path: string; up: boolean };

export const CADDY_PORT = 8080;

// Routes of the worktree the session is in; the session may sit in a subdirectory of it.
export const routesFor = (routes: readonly Route[], cwd: string): Route[] =>
  routes
    .filter((r) => cwd === r.path || cwd.startsWith(`${r.path}/`))
    .sort((a, b) => Number(b.service === "main") - Number(a.service === "main") || a.service.localeCompare(b.service));

// "● dev  ● storybook  ○ server · branch.repo.localhost:8080", or undefined when the worktree has no routes.
export const statusText = (routes: readonly Route[], cwd: string): string | undefined => {
  const mine = routesFor(routes, cwd);
  if (mine.length === 0) return undefined;
  const dots = mine.map((r) => `${r.up ? "●" : "○"} ${r.service === "main" ? "dev" : r.service}`).join("  ");
  return `${dots} · ${mine[0].host}:${CADDY_PORT}`;
};

export type Defined = { name: string; service: string };

// The services a repo's post-start hooks would register: `wt hook show post-start --expanded --format json`
// entries that run `wt-caddy add`, the service taken from `--service` (none means the main one).
export const parseDefined = (hooks: readonly { name: string; expanded: string }[]): Defined[] =>
  hooks
    .filter((h) => h.expanded.startsWith("wt-caddy add "))
    .map((h) => ({ name: h.name, service: /--service (\S+)/.exec(h.expanded)?.[1] ?? "main" }));

// Defined services with no route yet in this worktree.
export const notRegistered = (defined: readonly Defined[], routes: readonly Route[]): Defined[] =>
  defined.filter((d) => !routes.some((r) => r.service === d.service));
