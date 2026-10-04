// wt-caddy: routes worktree dev servers through Caddy and serves a live dashboard.
// Registry: ~/.local/state/wt-caddy/routes.json. Caddy is told the full route set on every change.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, watch, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { connect } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type Route = { repo: string; branch: string; service: string; port: number; path: string; rewriteHost?: boolean };
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

  wt-caddy add <repo> <branch> <port> [--service <name>] [--path <dir>] [--rewrite-host]
  wt-caddy rm <repo> <branch> [--service <name>] [--kill]   (no --service: all; --kill stops the servers)
  wt-caddy ls
  wt-caddy gc                  drop routes whose worktree directory is gone
  wt-caddy service             start dashboard (and Caddy) if not running`;

const main = async () => {
  const [cmd, ...rest] = process.argv.slice(2);
  const flags: Record<string, string> = {};
  const pos: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--kill" || rest[i] === "--rewrite-host") flags[rest[i].slice(2)] = "";
    else if (rest[i].startsWith("--")) flags[rest[i].slice(2)] = rest[++i] ?? "";
    else pos.push(rest[i]);
  }

  switch (cmd) {
    case "add": {
      const [repo, branch, portArg] = pos;
      const port = Number(portArg);
      if (!repo || !branch || !Number.isInteger(port)) throw new Error(usage);
      const route: Route = { repo, branch, service: flags.service ?? MAIN_SERVICE, port, path: flags.path ?? process.cwd(), ...("rewrite-host" in flags && { rewriteHost: true }) };
      const all = await withLock(async () => {
        const next = [...readRoutes().filter((r) => !sameSlot(r, route)), route];
        writeRoutes(next);
        await applyCaddy(next);
        return next;
      });
      await ensureService();
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
      for (const r of await statuses(readRoutes())) console.log(`${r.up ? "up  " : "down"}  ${url(r.host)}  :${r.port}  ${r.path}`);
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
