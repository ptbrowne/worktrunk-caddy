// wt-caddy ui: full-screen list of every route. view() turns state into lines (pure), onKey() changes state,
// the painter redraws only the lines that changed. No dependencies, loaded only by `wt-caddy ui`.
import { spawn } from "node:child_process";
import { closeSync, fstatSync, openSync, readSync, watch } from "node:fs";
import type { Route, RouteStatus } from "./wt-caddy.ts";

export type Api = {
  stateDir: string;
  readRoutes: () => Route[];
  statuses: (routes: Route[]) => Promise<RouteStatus[]>;
  startRoute: (r: Route) => boolean;
  killListeners: (port: number) => void;
  routeLogFile: (r: Route) => string;
  openLog: (r: Route) => boolean; // config logs.open
  urlOf: (r: Route) => string;
  isListening: (port: number) => Promise<boolean>;
  sleep: (ms: number) => Promise<unknown>;
};

type Busy = { kind: "starting" | "stopping"; since: number };
export type State = {
  routes: RouteStatus[];
  sel: string;
  busy: Record<string, Busy>;
  logOn: boolean;
  log: string[];
  notice: string;
  w: number;
  h: number;
  cwd: string;
  urlOf: (r: Route) => string;
};

const ESC = "\x1b[";
const style = (code: string, s: string) => `${ESC}${code}m${s}${ESC}0m`;
const bold = (s: string) => style("1", s);
const dim = (s: string) => style("2", s);
const green = (s: string) => style("32", s);
const yellow = (s: string) => style("33", s);
const reverse = (s: string) => style("7", s);

const fit = (s: string, w: number) => (s.length > w ? `${s.slice(0, Math.max(0, w - 1))}…` : s);
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");

export const id = (r: Route) => `${r.repo}\0${r.branch}\0${r.service}`;
const isHere = (r: Route, cwd: string) => cwd === r.path || cwd.startsWith(`${r.path}/`);
const BUSY_TIMEOUT_MS = 30_000;

// The worktree you are in first, then by repo, branch, and "main" before other services.
export const order = (routes: RouteStatus[], cwd: string) =>
  [...routes].sort(
    (a, b) =>
      Number(isHere(b, cwd)) - Number(isHere(a, cwd)) ||
      a.repo.localeCompare(b.repo) ||
      a.branch.localeCompare(b.branch) ||
      Number(b.service === "main") - Number(a.service === "main") ||
      a.service.localeCompare(b.service),
  );

const listView = (s: State): string[] => {
  const { w, h } = s;
  const head = [bold(fit(` wt-caddy  ${s.routes.length} routes, ${s.routes.filter((r) => r.up).length} up`, w)), ""];
  const body: { text: string; id?: string }[] = [];
  const svcW = Math.max(4, ...s.routes.map((r) => r.service.length));
  let group = "";
  for (const r of s.routes) {
    const g = `${r.repo} · ${r.branch}`;
    if (g !== group) {
      group = g;
      if (body.length) body.push({ text: "" });
      body.push({ text: bold(fit(` ${g}${isHere(r, s.cwd) ? "  (this worktree)" : ""}`, w)) });
    }
    const b = s.busy[id(r)];
    const word = (b ? (b.kind === "starting" ? "starting…" : "stopping…") : r.up ? "up" : "down").padEnd(9);
    const dot = b ? "◐" : r.up ? "●" : "○";
    const prefix = ` ${dot} ${r.service.padEnd(svcW)}  ${word}  `;
    const url = fit(s.urlOf(r), Math.max(0, w - prefix.length));
    const selected = id(r) === s.sel;
    const text = selected
      ? reverse(`${prefix}${url}`.padEnd(w))
      : ` ${b ? yellow(dot) : r.up ? green(dot) : dim(dot)} ${r.service.padEnd(svcW)}  ${b ? yellow(word) : r.up ? green(word) : dim(word)}  ${dim(url)}`;
    body.push({ text, id: id(r) });
  }
  if (!body.length) body.push({ text: dim(" no routes yet. create a worktree: wt switch --create <branch>") });

  const bodyH = Math.max(1, h - head.length - 1);
  const selIdx = body.findIndex((l) => l.id === s.sel);
  const top = selIdx >= bodyH ? selIdx - bodyH + 1 : 0;
  const footer = s.notice ? yellow(fit(` ${s.notice}`, w)) : dim(fit(" ↑↓ move  s start/stop  r restart  o open  enter logs  l logs in split  q quit", w));
  return [...head, ...body.slice(top, top + bodyH).map((l) => l.text), ...Array(Math.max(0, bodyH - (body.length - top))).fill(""), footer].slice(0, h);
};

const logView = (s: State): string[] => {
  const { w, h } = s;
  const r = s.routes.find((x) => id(x) === s.sel);
  const head = bold(fit(r ? ` ${r.repo} · ${r.branch} · ${r.service}  ${r.up ? "up" : "down"}` : " no route", w));
  const bodyH = Math.max(1, h - 2);
  const lines = s.log.slice(-bodyH).map((l) => fit(l, w));
  const footer = s.notice ? yellow(fit(` ${s.notice}`, w)) : dim(fit(" ↑↓ other service  s start/stop  r restart  o open  esc back", w));
  return [head, ...lines, ...Array(Math.max(0, bodyH - lines.length)).fill(""), footer].slice(0, h);
};

export const view = (s: State): string[] => (s.logOn ? logView(s) : listView(s));

// Last n lines of a file, read from its tail. Dev servers redraw with \r and color with ANSI; keep plain text.
const tailLines = (file: string, n: number): string[] => {
  let fd: number;
  try {
    fd = openSync(file, "r");
  } catch {
    return [];
  }
  try {
    const size = fstatSync(fd).size;
    const len = Math.min(size, 64 * 1024);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    return stripAnsi(buf.toString("utf8"))
      .split("\n")
      .map((l) => l.split("\r").pop() ?? "")
      .slice(-n - 1)
      .filter((l, i, a) => i < a.length - 1 || l !== "")
      .slice(-n);
  } finally {
    closeSync(fd);
  }
};

export const runUi = async (api: Api) => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("wt-caddy ui needs a terminal");
  let state: State = {
    routes: [],
    sel: "",
    busy: {},
    logOn: false,
    log: [],
    notice: "",
    w: process.stdout.columns,
    h: process.stdout.rows,
    cwd: process.cwd(),
    urlOf: api.urlOf,
  };
  let prev: string[] = [];

  const render = () => {
    const lines = view(state);
    let out = "";
    for (let i = 0; i < state.h; i++) {
      const l = lines[i] ?? "";
      if (l !== prev[i]) out += `${ESC}${i + 1};1H${l}${ESC}K`;
    }
    prev = lines;
    if (out) process.stdout.write(out);
  };
  const set = (patch: Partial<State>) => {
    state = { ...state, ...patch };
    render();
  };
  const current = () => state.routes.find((r) => id(r) === state.sel);

  const readLog = () => {
    const r = current();
    return r ? tailLines(api.routeLogFile(r), state.h - 2) : [];
  };

  let refreshing = false;
  const refresh = async () => {
    if (refreshing) return;
    refreshing = true;
    try {
      const routes = order(await api.statuses(api.readRoutes()), state.cwd);
      const busy = { ...state.busy };
      let notice = state.notice;
      for (const r of routes) {
        const b = busy[id(r)];
        if (!b) continue;
        if ((b.kind === "starting" && r.up) || (b.kind === "stopping" && !r.up)) delete busy[id(r)];
        else if (Date.now() - b.since > BUSY_TIMEOUT_MS) {
          delete busy[id(r)];
          notice = `${r.service}: still ${b.kind === "starting" ? "down" : "up"} after 30s, see logs`;
        }
      }
      const sel = routes.some((r) => id(r) === state.sel) ? state.sel : routes[0] ? id(routes[0]) : "";
      set({ routes, busy, sel, notice });
    } finally {
      refreshing = false;
    }
  };

  const setBusy = (r: Route, kind: Busy["kind"]) => set({ busy: { ...state.busy, [id(r)]: { kind, since: Date.now() } } });
  const start = (r: Route) => {
    if (!api.startRoute(r)) return set({ notice: `${r.service}: no command registered, re-run its hook` });
    setBusy(r, "starting");
  };
  const stop = (r: Route) => {
    setBusy(r, "stopping");
    api.killListeners(r.port);
    setTimeout(refresh, 150);
  };
  const restart = async (r: Route) => {
    setBusy(r, "stopping");
    api.killListeners(r.port);
    for (let i = 0; i < 30 && (await api.isListening(r.port)); i++) await api.sleep(100);
    start(r);
  };
  const open = (r: Route) => {
    const child = spawn(process.platform === "darwin" ? "open" : "xdg-open", [api.urlOf(r)], { detached: true, stdio: "ignore" });
    child.on("error", () => set({ notice: "could not open the URL" }));
    child.unref();
  };

  const move = (delta: number) => {
    const i = state.routes.findIndex((r) => id(r) === state.sel);
    const next = state.routes[Math.min(state.routes.length - 1, Math.max(0, i + delta))];
    if (!next) return;
    set({ sel: id(next) });
    if (state.logOn) set({ log: readLog() });
  };

  const quit = () => {
    process.stdout.write(`${ESC}?25h${ESC}?1049l`);
    process.exit(0);
  };

  const onKey = (k: string) => {
    if (state.notice) set({ notice: "" });
    const r = current();
    if (k === "\x03" || (k === "q" && !state.logOn)) quit();
    else if (k === "\x1b" || k === "q") set({ logOn: false });
    else if (k === `${ESC}A` || k === "k") move(-1);
    else if (k === `${ESC}B` || k === "j") move(1);
    else if (!r) return;
    else if (k === "s") (r.up || state.busy[id(r)]?.kind === "starting" ? stop : start)(r);
    else if (k === "r") restart(r);
    else if (k === "o") open(r);
    else if (k === "l") {
      try {
        if (!api.openLog(r)) set({ notice: 'no "logs.open" in ~/.config/wt-caddy/config.jsonc' });
      } catch {
        set({ notice: "logs.open failed (kitty needs allow_remote_control)" });
      }
    }
    else if (k === "\r" && !state.logOn) {
      const log = readLog();
      set(log.length ? { logOn: true, log } : { notice: `${r.service}: no log yet` });
    }
  };

  const resize = () => {
    prev = [];
    process.stdout.write(`${ESC}2J`);
    set({ w: process.stdout.columns, h: process.stdout.rows });
  };

  process.stdout.write(`${ESC}?1049h${ESC}?25l${ESC}2J`);
  process.on("exit", () => process.stdout.write(`${ESC}?25h${ESC}?1049l`));
  await refresh();
  process.on("SIGTERM", quit);
  process.stdout.on("resize", resize);
  process.stdin.setRawMode(true);
  process.stdin.on("data", (d) => {
    for (const k of d.toString().match(/\x1b\[[A-D]|\x1b|[\s\S]/g) ?? []) onKey(k);
  });
  process.stdin.resume();

  watch(api.stateDir, (_e, name) => name?.startsWith("routes.json") && refresh());
  setInterval(refresh, 1000);
  setInterval(() => state.logOn && set({ log: readLog() }), 250);
  render();
};
