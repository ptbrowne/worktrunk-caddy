// wt-caddy: routes worktree dev servers through Caddy and serves a live dashboard.
// Registry: ~/.local/state/wt-caddy/routes.json. Caddy is told the full route set on every change.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, watch, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { connect } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type Route = { repo: string; branch: string; service: string; port: number; path: string; rewriteHost?: boolean; cmd?: string };
type RouteStatus = Route & { host: string; up: boolean };

const CADDY_ADMIN = "http://localhost:2019";
const CADDY_PORT = 8080;
const TLD = "localhost"; // browsers resolve *.localhost to loopback, no DNS setup needed
const DASHBOARD_PORT = 8079;
const DASHBOARD_HOST = `wt.${TLD}`;
const MAIN_SERVICE = "main";

const stateDir = join(homedir(), ".local/state/wt-caddy");
const registryFile = join(stateDir, "routes.json");
const lockDir = join(stateDir, "lock");
const logFile = join(stateDir, "service.log");
const here = dirname(fileURLToPath(import.meta.url));

// Stops whatever listens on the port. Used when a worktree goes away, so no orphaned dev servers.
const killListeners = (port: number) => {
  try {
    const pids = execFileSync("lsof", ["-ti", `:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).split("\n").filter(Boolean);
    for (const pid of pids) process.kill(Number(pid));
  } catch {
    // nothing listening
  }
};

const logDir = join(stateDir, "logs");

// Starts a registered service detached, in its worktree, logging to ~/.local/state/wt-caddy/logs/.
const routeLogFile = (r: Route) => join(logDir, `${sanitize(r.repo)}-${sanitize(r.branch)}-${sanitize(r.service)}.log`);

const startRoute = (r: Route) => {
  if (!r.cmd) return false;
  mkdirSync(logDir, { recursive: true });
  const log = openSync(routeLogFile(r), "a");
  spawn("sh", ["-c", r.cmd], { cwd: r.path, detached: true, stdio: ["ignore", log, log] }).unref();
  return true;
};

// ~/.config/wt-caddy/config.jsonc: "path" (extra PATH entries for everything wt-caddy runs) and
// "logs.open" (shell command to show a log; {log} and {title} are filled in).
type Config = { path?: string[]; logs?: { open?: string } };
const configFile = join(homedir(), ".config/wt-caddy/config.jsonc");
const DEFAULT_PATH = ["~/.local/share/fnm/aliases/default/bin", "~/Library/pnpm/bin", "/opt/homebrew/bin"];

// JSON with // and /* */ comments and trailing commas.
const parseJsonc = (src: string): unknown => {
  let out = "";
  let inString = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inString) {
      out += c;
      if (c === "\\") out += src[++i] ?? "";
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i++;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
};

let config: Config | undefined;
const readConfig = (): Config => {
  if (config) return config;
  try {
    config = parseJsonc(readFileSync(configFile, "utf8")) as Config;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") console.error(`ignoring ${configFile}: ${(e as Error).message}`);
    config = {};
  }
  return config;
};

const expandHome = (p: string) => (p.startsWith("~/") ? join(homedir(), p.slice(2)) : p);

// Added after the existing PATH, so the caller's own tools win.
const applyConfigPath = () => {
  const extra = (readConfig().path ?? DEFAULT_PATH).map(expandHome);
  process.env.PATH = [process.env.PATH, ...extra].filter(Boolean).join(":");
};

const shellQuote = (v: string) => `'${v.replaceAll("'", "'\\''")}'`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const sanitize = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");

const hostFor = (r: Route) =>
  [r.service === MAIN_SERVICE ? null : sanitize(r.service), sanitize(r.branch), sanitize(r.repo), TLD]
    .filter(Boolean)
    .join(".");

const readRoutes = (): Route[] => {
  try {
    return JSON.parse(readFileSync(registryFile, "utf8"));
  } catch {
    return [];
  }
};

const writeRoutes = (routes: Route[]) => {
  const tmp = `${registryFile}.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(routes, null, 2));
  renameSync(tmp, registryFile);
};

// wt runs hooks in parallel, so registry updates need a mutex.
const withLock = async <T>(fn: () => Promise<T> | T): Promise<T> => {
  mkdirSync(stateDir, { recursive: true });
  for (let i = 0; ; i++) {
    try {
      mkdirSync(lockDir);
      break;
    } catch {
      if (i > 100) rmSync(lockDir, { recursive: true, force: true }); // stale after ~5s
      await sleep(50);
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
};

const isListening = (port: number) =>
  new Promise<boolean>((resolve) => {
    const s = connect({ port, host: "127.0.0.1" });
    const done = (ok: boolean) => (s.destroy(), resolve(ok));
    s.setTimeout(300, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });

const caddyUp = () =>
  fetch(`${CADDY_ADMIN}/config/`, { signal: AbortSignal.timeout(500) }).then(
    (r) => r.ok,
    () => false,
  );

const ensureCaddy = async () => {
  if (await caddyUp()) return;
  execFileSync("caddy", ["start"], { stdio: "ignore" });
};

// rewriteHost: for dev servers with a host allowlist (Storybook) that can't be told about *.localhost.
const caddyRoute = (host: string, port: number, rewriteHost = false) => ({
  match: [{ host: [host] }],
  handle: [
    {
      handler: "reverse_proxy",
      upstreams: [{ dial: `127.0.0.1:${port}` }],
      ...(rewriteHost && { headers: { request: { set: { Host: [`localhost:${port}`] } } } }),
    },
  ],
});

const applyCaddy = async (routes: Route[]) => {
  await ensureCaddy();
  const server = {
    listen: [`:${CADDY_PORT}`],
    automatic_https: { disable: true },
    routes: [caddyRoute(DASHBOARD_HOST, DASHBOARD_PORT), ...routes.map((r) => caddyRoute(hostFor(r), r.port, r.rewriteHost))],
  };
  // PATCH replaces an existing server, PUT creates it (PUT alone is insert-only and 409s on replace).
  const send = (method: string) =>
    fetch(`${CADDY_ADMIN}/config/apps/http/servers/wt`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(server),
    });
  let res = await send("PATCH");
  if (!res.ok) res = await send("PUT");
  if (!res.ok) throw new Error(`Caddy rejected config: ${res.status} ${await res.text()}`);
};

const statuses = async (routes: Route[]): Promise<RouteStatus[]> =>
  Promise.all(routes.map(async (r) => ({ ...r, host: hostFor(r), up: await isListening(r.port) })));

// A route is the same slot when repo, branch and service match; re-adding replaces it.
const sameSlot = (a: Route, b: Pick<Route, "repo" | "branch" | "service">) =>
  a.repo === b.repo && a.branch === b.branch && a.service === b.service;

const url = (host: string) => `http://${host}:${CADDY_PORT}`;

const ensureService = async () => {
  if (await isListening(DASHBOARD_PORT)) return false;
  mkdirSync(stateDir, { recursive: true });
  const log = openSync(logFile, "a");
  spawn(process.execPath, [fileURLToPath(import.meta.url), "__serve"], {
    detached: true,
    stdio: ["ignore", log, log],
  }).unref();
  for (let i = 0; i < 40 && !(await isListening(DASHBOARD_PORT)); i++) await sleep(100);
  return true;
};

const runDashboard = async () => {
  const html = readFileSync(join(here, "dashboard.html"), "utf8");
  const clients = new Set<import("node:http").ServerResponse>();
  let last = "";

  const push = async () => {
    const payload = JSON.stringify(await statuses(readRoutes()));
    if (payload === last) return;
    last = payload;
    for (const c of clients) c.write(`data: ${payload}\n\n`);
  };

  const server = createServer(async (req, res) => {
    if (req.url === "/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      res.write(`data: ${JSON.stringify(await statuses(readRoutes()))}\n\n`);
      clients.add(res);
      req.on("close", () => clients.delete(res));
    } else if (req.url === "/api/routes") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(await statuses(readRoutes())));
    } else {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    }
  });
  server.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code === "EADDRINUSE") process.exit(0); // another instance won the race
    throw e;
  });
  server.listen(DASHBOARD_PORT, "127.0.0.1", () => console.log(`dashboard on ${url(DASHBOARD_HOST)}`));

  mkdirSync(stateDir, { recursive: true });
  watch(stateDir, (_e, name) => name?.startsWith("routes.json") && push());
  setInterval(push, 2000);
};

const usage = `wt-caddy: Caddy routes and live dashboard for worktree dev servers

  wt-caddy add <repo> <branch> <port> [--service <name>] [--path <dir>] [--rewrite-host] [--cmd <shell command>] [--start]
  wt-caddy start|stop|restart <repo> <branch> [--service <name>]   (start needs --cmd from add)
  wt-caddy rm <repo> <branch> [--service <name>] [--kill]   (no --service: all; --kill stops the servers)
  wt-caddy ls [--json]
  wt-caddy logs <repo> <branch> [--service <name>] [--open]   print the log path, or show it via config logs.open
  wt-caddy hooks | hook <name>   post-start hooks of this worktree as JSON | run one (used by the Claude Code mod)
  wt-caddy gc                  drop routes whose worktree directory is gone
  wt-caddy service             start dashboard (and Caddy) if not running`;

const main = async () => {
  applyConfigPath();
  const [cmd, ...rest] = process.argv.slice(2);
  const flags: Record<string, string> = {};
  const pos: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--kill" || rest[i] === "--rewrite-host" || rest[i] === "--json" || rest[i] === "--start" || rest[i] === "--open") flags[rest[i].slice(2)] = "";
    else if (rest[i].startsWith("--")) flags[rest[i].slice(2)] = rest[++i] ?? "";
    else pos.push(rest[i]);
  }

  switch (cmd) {
    case "add": {
      const [repo, branch, portArg] = pos;
      const port = Number(portArg);
      if (!repo || !branch || !Number.isInteger(port)) throw new Error(usage);
      const route: Route = { repo, branch, service: flags.service ?? MAIN_SERVICE, port, path: flags.path ?? process.cwd(), ...("rewrite-host" in flags && { rewriteHost: true }), ...(flags.cmd && { cmd: flags.cmd }) };
      const all = await withLock(async () => {
        const next = [...readRoutes().filter((r) => !sameSlot(r, route)), route];
        writeRoutes(next);
        await applyCaddy(next);
        return next;
      });
      await ensureService();
      if ("start" in flags && !(await isListening(port))) startRoute(route);
      console.log(`${url(hostFor(route))} -> :${port} (${all.length} routes)`);
      break;
    }
    case "rm": {
      const [repo, branch] = pos;
      if (!repo || !branch) throw new Error(usage);
      await withLock(async () => {
        const matches = (r: Route) =>
          r.repo === repo && r.branch === branch && (flags.service === undefined || r.service === flags.service);
        const next = readRoutes().filter((r) => !matches(r));
        if ("kill" in flags) for (const r of readRoutes().filter(matches)) killListeners(r.port);
        writeRoutes(next);
        await applyCaddy(next);
      });
      break;
    }
    case "start":
    case "stop":
    case "restart": {
      const [repo, branch] = pos;
      if (!repo || !branch) throw new Error(usage);
      const mine = readRoutes().filter(
        (r) => r.repo === repo && r.branch === branch && (flags.service === undefined || r.service === flags.service),
      );
      if (mine.length === 0) throw new Error(`no routes for ${repo} ${branch}`);
      if (cmd !== "start") for (const r of mine) killListeners(r.port);
      if (cmd === "restart") for (const r of mine) for (let i = 0; i < 30 && (await isListening(r.port)); i++) await sleep(100);
      if (cmd !== "stop")
        for (const r of mine) {
          if (await isListening(r.port)) continue;
          console.log(startRoute(r) ? `started ${r.service}` : `${r.service}: no --cmd registered`);
        }
      break;
    }
    case "logs": {
      const [repo, branch] = pos;
      if (!repo || !branch) throw new Error(usage);
      const slot = { repo, branch, service: flags.service ?? MAIN_SERVICE };
      const r = readRoutes().find((x) => sameSlot(x, slot));
      if (!r) throw new Error(`no route for ${repo} ${branch} ${slot.service}`);
      const file = routeLogFile(r);
      if (!existsSync(file)) throw new Error(`no log yet: ${file}`);
      const open = readConfig().logs?.open;
      if ("open" in flags && open) {
        const title = `${r.service === MAIN_SERVICE ? "dev" : r.service} · ${r.branch}`;
        execFileSync("sh", ["-c", open.replaceAll("{log}", shellQuote(file)).replaceAll("{title}", shellQuote(title))], { stdio: "inherit" });
      } else console.log(file);
      break;
    }
    case "hooks": // the post-start hooks of the worktree in the current directory, as JSON (for the Claude Code mod)
      process.stdout.write(
        execFileSync("wt", ["hook", "show", "post-start", "--expanded", "--format", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }),
      );
      break;
    case "hook": // run one post-start hook by name, in the current directory
      if (!pos[0]) throw new Error(usage);
      execFileSync("wt", ["hook", "post-start", pos[0]], { stdio: "ignore" });
      break;
    case "gc": {
      const removed = await withLock(async () => {
        const all = readRoutes();
        const next = all.filter((r) => existsSync(r.path));
        writeRoutes(next);
        await applyCaddy(next);
        return all.length - next.length;
      });
      console.log(`removed ${removed} stale route(s)`);
      break;
    }
    case "ls": {
      const all = await statuses(readRoutes());
      if ("json" in flags) {
        console.log(JSON.stringify(all));
        break;
      }
      for (const r of all) console.log(`${r.up ? "up  " : "down"}  ${url(r.host)}  :${r.port}  ${r.path}`);
      break;
    }
    case "service": {
      await withLock(async () => applyCaddy(readRoutes()));
      console.log((await ensureService()) ? `started: ${url(DASHBOARD_HOST)}` : `already running: ${url(DASHBOARD_HOST)}`);
      break;
    }
    case "__serve":
      await runDashboard();
      break;
    default:
      console.log(usage);
      process.exit(cmd ? 1 : 0);
  }
};

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
