/**
 * The plan viewer: a local web page that draws the plans of `knowledge/plan/` as graphs, live, with their
 * activity from git. Zero dependencies: `node:http`, `node:fs` and `git`.
 *
 *   node --experimental-strip-types --no-warnings <this folder>/plan-view.ts [--cwd <repo>] [--port 4317] [--open]
 *
 * - It binds to 127.0.0.1 only, and answers only a Host of 127.0.0.1 or localhost (no DNS rebinding).
 * - `/`: the page (`plan-view.html`, read at each request).
 * - `/api/plans`: each plan file, with its kind, title and counts.
 * - `/api/plan?file=knowledge/plan/<name>.md`: the Plan (`plan-graph.ts`), the findings of `checkPlan` (and of
 *   `checkTransition` for an uncommitted change), the activity (`plan-activity.ts`) and the view: the state of
 *   each node, the critical path and the decisions. A file outside `knowledge/plan/` gets 400.
 * - `/api/events`: Server-Sent Events. `changed` with `{"file": …}` when a file under `knowledge/plan/` changes
 *   on disk, and with `{"file": null, "head": …}` when `git rev-parse HEAD` changes.
 *
 * The parser is injected (`startPlanView({ parse, check, transition })`): the command line imports
 * `plan-graph.ts`; the tests give a fake one.
 */
import { execFile, spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync, watch, type FSWatcher } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { type ActivityEvent, answerOf, plain, planActivity, type PlanVersion } from "./plan-activity.ts";
import type { Plan, PlanFinding } from "./plan-graph.ts";

export type ParseFn = (text: string, file: string) => Plan;
export type CheckFn = (plan: Plan, text: string) => PlanFinding[];
export type TransitionFn = (before: Plan, after: Plan) => PlanFinding[];

export interface PlanViewOptions {
  cwd: string;
  /** 0 picks a free port. */
  port: number;
  parse: ParseFn;
  check?: CheckFn;
  transition?: TransitionFn;
  /** How often to read `git rev-parse HEAD` while a page listens. */
  headPollMs?: number;
  /** How long a file must be quiet before its change goes out. */
  debounceMs?: number;
}

export interface PlanViewServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

const PLAN_DIR = "knowledge/plan";
/** The most commits of one file that the activity reads. */
const HISTORY_CAP = 200;

// ---------------------------------------------------------------------------
// The view model: pure, from a Plan.
// ---------------------------------------------------------------------------

/**
 * - done, dropped: the node is ✅, or struck through.
 * - ready (能做): every incoming node is done or dropped, and an agent does it (not D, O, E).
 * - waits (等): every incoming node is done or dropped, and it is a D, an O or an E: the owner or an event moves.
 * - blocked: an incoming node is open.
 */
export type NodeState = "done" | "dropped" | "ready" | "waits" | "blocked";

const finished = (n: { done: boolean; dropped: boolean }) => n.done || n.dropped;
const OUTSIDE = new Set(["D", "O", "E"]);

export function nodeStates(plan: Plan): Record<string, NodeState> {
  const byCode = new Map(plan.nodes.map((n) => [n.code, n]));
  const states: Record<string, NodeState> = {};
  for (const n of plan.nodes) {
    if (n.dropped) states[n.code] = "dropped";
    else if (n.done) states[n.code] = "done";
    else {
      const open = plan.edges.filter((e) => e.to === n.code).some((e) => {
        const p = byCode.get(e.from);
        return p ? !finished(p) : false;
      });
      states[n.code] = open ? "blocked" : OUTSIDE.has(n.kind) ? "waits" : "ready";
    }
  }
  return states;
}

/** The longest path of open nodes (by count) that ends at a node with no open node after it. The first in
 *  chart order wins a tie. Empty when no node is open. */
export function criticalPath(plan: Plan): string[] {
  const open = new Set(plan.nodes.filter((n) => !finished(n)).map((n) => n.code));
  const after = new Map<string, string[]>();
  for (const e of plan.edges) {
    if (open.has(e.from) && open.has(e.to)) after.set(e.from, [...(after.get(e.from) ?? []), e.to]);
  }
  const best = new Map<string, string[]>();
  const visiting = new Set<string>();
  const walk = (code: string): string[] => {
    const known = best.get(code);
    if (known) return known;
    if (visiting.has(code)) return []; // a loop: no path through it
    visiting.add(code);
    let tail: string[] = [];
    for (const next of after.get(code) ?? []) {
      const t = walk(next);
      if (t.length > tail.length) tail = t;
    }
    visiting.delete(code);
    const path = [code, ...tail];
    best.set(code, path);
    return path;
  };
  let longest: string[] = [];
  for (const n of plan.nodes) {
    if (!open.has(n.code)) continue;
    const p = walk(n.code);
    if (p.length > longest.length) longest = p;
  }
  return longest;
}

export interface Decision {
  code: string;
  label: string;
  state: NodeState;
  question: string;
  recommended: string | null;
  answered: boolean;
  by: "owner" | "agent" | null;
  quote: string | null;
  answer: string | null;
  /** The date of the answer event, when the activity has one. */
  date: string | null;
}

/** Each D node: its question, its recommended option, and its answer. */
export function decisionsOf(plan: Plan, events: ActivityEvent[]): Decision[] {
  const states = nodeStates(plan);
  return plan.nodes
    .filter((n) => n.kind === "D")
    .map((n) => {
      const lines = (n.section?.body ?? "").split("\n");
      const q = lines
        .map((l) => /^\s*(?:[-*]\s*)?(?:\*\*)?(?:问题|Question)(?:\*\*)?\s*[：:.。]\s*(?:\*\*)?\s*(.+)/.exec(l))
        .find(Boolean);
      const rec = lines.find((l) => /推荐|recommend/i.test(l));
      const a = answerOf(n);
      const ev = events.find((e) => e.kind === "answer" && e.node === n.code);
      return {
        code: n.code,
        label: n.label,
        state: states[n.code],
        question: q ? plain(q[1], 300) : plain(n.label.replace(/^\S+\s*/, ""), 300),
        recommended: rec ? plain(rec.replace(/^\s*[-*]\s*/, ""), 300) : null,
        answered: n.done,
        by: n.done ? a.by : null,
        quote: n.done ? (a.quote ?? ev?.quote ?? null) : null,
        answer: n.done ? a.line : null,
        date: ev?.date ?? null,
      };
    });
}

/** The node that a finding (`file:line`) is about: the section that holds the line, the node or the item on
 *  it, or the arrow on it (its end). Null when none. */
export function findingNode(plan: Plan, where: string): string | null {
  const line = Number(/:(\d+)$/.exec(where)?.[1] ?? Number.NaN);
  if (Number.isNaN(line)) return null;
  const n =
    plan.nodes.find((x) => x.chartLine === line) ??
    plan.nodes.find((x) => x.items.some((i) => i.line === line)) ??
    plan.nodes.find((x) => x.section && x.section.line <= line && line <= x.section.endLine);
  if (n) return n.code;
  return plan.edges.find((e) => e.line === line)?.to ?? null;
}

/** The repo-relative path of a plan file, or null when `file` is not a `.md` file under `knowledge/plan/`
 *  (path traversal, a symlink out, another folder). It does not say whether the file exists. */
export function planFileOf(root: string, file: string): string | null {
  if (!file || file.includes("\0")) return null;
  const dir = resolve(root, PLAN_DIR);
  const abs = resolve(root, file);
  if (!abs.startsWith(dir + sep) || !abs.endsWith(".md")) return null;
  if (existsSync(abs)) {
    const real = realpathSync(abs);
    if (!real.startsWith(realpathSync(dir) + sep)) return null;
  }
  return relative(root, abs).split(sep).join("/");
}

// ---------------------------------------------------------------------------
// git
// ---------------------------------------------------------------------------

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((ok, fail) => {
    execFile("git", ["-c", "core.quotepath=off", ...args], { cwd, maxBuffer: 64 << 20 }, (err, out) =>
      err ? fail(err) : ok(out),
    );
  });
}

interface Commit {
  sha: string;
  date: string;
  author: string;
  subject: string;
  blob: string;
  path: string;
}

/** The commits that changed a file, newest first, at most `HISTORY_CAP`, across renames. A merge with no
 *  change of its own and a deletion give no version. */
async function history(root: string, file: string): Promise<Commit[]> {
  let out: string;
  try {
    out = await git(root, ["log", "--follow", "-n", String(HISTORY_CAP), "--no-abbrev", "--raw", "--format=%x1e%H%x1f%aI%x1f%an%x1f%s", "--", file]);
  } catch {
    return []; // no commits yet, or not a git repo
  }
  const commits: Commit[] = [];
  for (const chunk of out.split("\x1e").slice(1)) {
    const [head, ...rest] = chunk.split("\n");
    const [sha, date, author, subject] = head.split("\x1f");
    const raw = rest.find((l) => l.startsWith(":"));
    if (!raw) continue;
    const [meta, ...paths] = raw.split("\t");
    const blob = meta.split(" ")[3];
    if (!blob || /^0+$/.test(blob)) continue;
    commits.push({ sha, date, author, subject, blob, path: paths.at(-1) ?? file });
  }
  return commits;
}

/** The text of each blob, with one `git cat-file --batch`. */
function readBlobs(root: string, blobs: string[]): Promise<Map<string, string>> {
  return new Promise((ok, fail) => {
    if (blobs.length === 0) return ok(new Map());
    const p = spawn("git", ["cat-file", "--batch"], { cwd: root });
    const chunks: Buffer[] = [];
    p.stdout.on("data", (c: Buffer) => chunks.push(c));
    p.on("error", fail);
    p.on("close", () => {
      const buf = Buffer.concat(chunks);
      const texts = new Map<string, string>();
      let at = 0;
      while (at < buf.length) {
        const nl = buf.indexOf(10, at);
        if (nl < 0) break;
        const [sha, type, size] = buf.subarray(at, nl).toString().split(" ");
        at = nl + 1;
        if (type !== "blob") continue; // "<sha> missing"
        texts.set(sha, buf.subarray(at, at + Number(size)).toString("utf8"));
        at += Number(size) + 1;
      }
      ok(texts);
    });
    p.stdin.end(`${blobs.join("\n")}\n`);
  });
}

// ---------------------------------------------------------------------------
// The server
// ---------------------------------------------------------------------------

function send(res: ServerResponse, status: number, body: unknown, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

/** The repo root of `cwd`, or `cwd` when it is not in a git repo. */
async function rootOf(cwd: string): Promise<string> {
  try {
    return (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
  } catch {
    return resolve(cwd);
  }
}

export async function startPlanView(o: PlanViewOptions): Promise<PlanViewServer> {
  const root = await rootOf(o.cwd);
  const dir = resolve(root, PLAN_DIR);
  const blobText = new Map<string, string>();
  const parsed = new Map<string, Plan>(); // `${blob}\u0000${path}` -> Plan

  const parseBlob = (blob: string, path: string): Plan | null => {
    const key = `${blob}\u0000${path}`;
    let p = parsed.get(key);
    if (!p) {
      try {
        p = o.parse(blobText.get(blob) ?? "", path);
      } catch {
        return null; // an old version that the parser cannot read gives no events
      }
      parsed.set(key, p);
    }
    return p;
  };

  async function planData(file: string) {
    const abs = resolve(root, file);
    const text = readFileSync(abs, "utf8");
    const plan = o.parse(text, file);
    const commits = (await history(root, file)).reverse(); // oldest first
    const need = [...new Set(commits.map((c) => c.blob))].filter((b) => !blobText.has(b));
    for (const [sha, t] of await readBlobs(root, need)) blobText.set(sha, t);
    const versions: PlanVersion[] = [];
    for (const c of commits) {
      const p = parseBlob(c.blob, c.path);
      if (p) versions.push({ sha: c.sha, date: c.date, author: c.author, subject: c.subject, plan: p });
    }
    const newest = commits.at(-1);
    const changed = !newest || blobText.get(newest.blob) !== text;
    const working = changed ? { plan, date: statSync(abs).mtime.toISOString() } : null;
    const activity = planActivity(versions, working, plan);
    const findings: PlanFinding[] = [...(o.check?.(plan, text) ?? [])];
    const last = versions.at(-1);
    if (changed && last && o.transition) findings.push(...o.transition(last.plan, plan));
    return {
      file,
      plan,
      findings: findings.map((f) => ({ ...f, node: findingNode(plan, f.where) })),
      activity,
      view: { states: nodeStates(plan), critical: criticalPath(plan), decisions: decisionsOf(plan, activity) },
    };
  }

  function planList() {
    if (!existsSync(dir)) return [];
    const rank = (k: string) => (k === "index" ? 0 : k === "milestone" ? 1 : 2);
    return readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => {
        const file = `${PLAN_DIR}/${f}`;
        try {
          const p = o.parse(readFileSync(resolve(dir, f), "utf8"), file);
          const done = p.nodes.filter((n) => finished(n)).length;
          return { file, kind: p.kind, title: p.title, done, open: p.nodes.length - done, error: null };
        } catch (e) {
          return { file, kind: "issue", title: f, done: 0, open: 0, error: String((e as Error).message ?? e) };
        }
      })
      .sort((a, b) => rank(a.kind) - rank(b.kind) || a.file.localeCompare(b.file, "en", { numeric: true }));
  }

  // --- live changes ---
  const clients = new Set<ServerResponse>();
  const broadcast = (data: object) => {
    for (const c of clients) c.write(`event: changed\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const timers = new Map<string, NodeJS.Timeout>();
  let watcher: FSWatcher | null = null;
  if (existsSync(dir)) {
    watcher = watch(dir, { recursive: true }, (_event, name) => {
      if (!name || !String(name).endsWith(".md")) return;
      const file = `${PLAN_DIR}/${String(name).split(sep).join("/")}`;
      clearTimeout(timers.get(file));
      timers.set(
        file,
        setTimeout(() => {
          timers.delete(file);
          broadcast({ file });
        }, o.debounceMs ?? 150),
      );
    });
  }
  let head: string | null = null;
  const readHead = async () => {
    try {
      return (await git(root, ["rev-parse", "HEAD"])).trim();
    } catch {
      return null;
    }
  };
  head = await readHead();
  const poll = setInterval(async () => {
    if (clients.size === 0) return;
    const h = await readHead();
    if (h !== head) {
      head = h;
      broadcast({ file: null, head: h });
    }
  }, o.headPollMs ?? 2000);
  const ping = setInterval(() => {
    for (const c of clients) c.write(": ping\n\n");
  }, 25_000);

  const page = fileURLToPath(new URL("./plan-view.html", import.meta.url));

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const port = (server.address() as { port: number }).port;
    const host = req.headers.host ?? "";
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return send(res, 403, { error: "bad host" });
    if (req.method !== "GET") return send(res, 405, { error: "GET only" });
    const url = new URL(req.url ?? "/", `http://${host}`);
    try {
      if (url.pathname === "/") return send(res, 200, readFileSync(page, "utf8"), "text/html; charset=utf-8");
      if (url.pathname === "/api/plans") return send(res, 200, { root, plans: planList() });
      if (url.pathname === "/api/plan") {
        const file = planFileOf(root, url.searchParams.get("file") ?? "");
        if (!file) return send(res, 400, { error: "not a plan file under knowledge/plan/" });
        if (!existsSync(resolve(root, file))) return send(res, 404, { error: "no such plan" });
        return send(res, 200, await planData(file));
      }
      if (url.pathname === "/api/events") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        res.write(`event: hello\ndata: ${JSON.stringify({ head })}\n\n`);
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }
      return send(res, 404, { error: "not found" });
    } catch (e) {
      return send(res, 500, { error: String((e as Error).message ?? e) });
    }
  });
  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(o.port, "127.0.0.1", () => ok());
  });
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}/`,
    port,
    close: () =>
      new Promise<void>((ok) => {
        clearInterval(poll);
        clearInterval(ping);
        for (const t of timers.values()) clearTimeout(t);
        watcher?.close();
        for (const c of clients) c.end();
        server.close(() => ok());
      }),
  };
}

async function main() {
  const { values } = parseArgs({
    options: { cwd: { type: "string" }, port: { type: "string", default: "4317" }, open: { type: "boolean", default: false } },
  });
  // The parser is the one of the knowledge check (`plan-graph.ts`), imported here only: the tests inject theirs.
  const graph = await import("./plan-graph.ts");
  const s = await startPlanView({
    cwd: values.cwd ?? process.cwd(),
    port: Number(values.port),
    parse: graph.parsePlan,
    check: graph.checkPlan,
    transition: graph.checkTransition,
  }).catch((e: NodeJS.ErrnoException) => {
    console.error(e.code === "EADDRINUSE" ? `port ${values.port} is in use: give another with --port` : String(e));
    process.exit(1);
  });
  console.log(`plan view: ${s.url}`);
  if (values.open) spawn(process.platform === "darwin" ? "open" : "xdg-open", [s.url], { stdio: "ignore", detached: true }).unref();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
