import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { Plan, PlanNode } from "./plan-graph.ts";
import { fileURLToPath } from "node:url";
import { checkPlan, checkTransition, parsePlan } from "./plan-graph.ts";
import * as edits from "./plan.ts";
import { criticalPath, githubRepoOf, nodeStates, startPlanView } from "./plan-view.ts";

// The first tests use a fake parser: a plan file holds the Plan as JSON. The test of the edits uses the real
// parser and edits (`plan-graph.ts`, `plan.ts`) on the fixture `alpha.txt`, with a fake `gh`.
const parse = (text: string, file: string): Plan => ({ ...JSON.parse(text), file });

function plan(nodes: Partial<PlanNode>[], edges: [string, string][], extra: Partial<Plan> = {}): Plan {
  return {
    file: "",
    kind: "issue",
    title: "my-app #42 plan：导出",
    update: null,
    now: null,
    log: [],
    notes: "",
    nodes: nodes.map((n, i) => ({ code: "A1", kind: "A", label: "", done: false, dropped: false, section: null, items: [], chartLine: i + 3, ...n })) as PlanNode[],
    edges: edges.map(([from, to], i) => ({ from, to, line: 20 + i })),
    ...extra,
  };
}

const v1 = plan(
  [
    { code: "A1", label: "A1 agent：调研" },
    { code: "D1", kind: "D", label: "D1 owner 拍板：存在哪", section: { line: 30, endLine: 34, title: "D1", body: "问题：存在哪？\n\n- **推荐：桶。** agent 做。" } },
    { code: "O1", kind: "O", label: "O1 owner：spec review" },
    { code: "A2", label: "A2 agent：导出" },
    { code: "A3", label: "A3 agent：上传" },
  ],
  [
    ["A1", "O1"],
    ["D1", "O1"],
    ["O1", "A2"],
    ["A2", "A3"],
  ],
);
const v2 = {
  ...v1,
  nodes: v1.nodes.map((n) =>
    n.code === "A1"
      ? { ...n, done: true }
      : n.code === "D1"
        ? { ...n, done: true, section: { ...n.section, body: `${n.section?.body}\n\nowner 定的（2026-10-21，「放桶里」）：桶。` } }
        : n,
  ),
} as Plan;

const index = plan([{ code: "I42", kind: "I", label: "#42 导出：agent" }, { code: "O9", kind: "O", label: "O9 owner：发版 ✅", done: true }], [["I42", "O9"]], {
  kind: "index",
  title: "Open work",
  now: "I42",
});

/** A git repo in a temp folder: two commits of the issue plan, then an uncommitted change. */
function repo() {
  const root = mkdtempSync(join(tmpdir(), "plan-view-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  write("AGENTS.md", "secret\n");
  write("knowledge/plan/index.md", JSON.stringify(index));
  write("knowledge/plan/42-export.md", JSON.stringify(v1));
  git("add", ".");
  git("commit", "-qm", "plan of #42", "--date", "2026-10-20T10:00:00Z");
  write("knowledge/plan/42-export.md", JSON.stringify(v2));
  git("commit", "-qam", "D1 answered, A1 done", "--date", "2026-10-21T10:00:00Z");
  const v3 = { ...v2, nodes: v2.nodes.map((n) => (n.code === "A3" ? { ...n, dropped: true } : n)) };
  write("knowledge/plan/42-export.md", JSON.stringify(v3));
  return { root, write };
}

/** GET with a raw Host header (fetch does not let a test set it). */
function get(port: number, path: string, host = `127.0.0.1:${port}`): Promise<{ status: number; body: string }> {
  return new Promise((ok, fail) => {
    const r = request({ host: "127.0.0.1", port, path, headers: { host } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => ok({ status: res.statusCode ?? 0, body }));
    });
    r.on("error", fail);
    r.end();
  });
}

test("the view model: node states and the critical path of the open nodes", () => {
  assert.deepEqual(nodeStates(v1), { A1: "ready", D1: "waits", O1: "blocked", A2: "blocked", A3: "blocked" });
  assert.deepEqual(nodeStates(v2), { A1: "done", D1: "done", O1: "waits", A2: "blocked", A3: "blocked" });
  assert.deepEqual(criticalPath(v1), ["A1", "O1", "A2", "A3"]);
  assert.deepEqual(criticalPath(v2), ["O1", "A2", "A3"]);
});

test("the server lists the plans, gives a plan with its activity and findings, and refuses a file outside knowledge/plan/", async () => {
  const { root } = repo();
  symlinkSync(join(root, "AGENTS.md"), join(root, "knowledge/plan/out.md"));
  const s = await startPlanView({
    cwd: root,
    port: 0,
    parse,
    check: (p) => [{ kind: "question", where: `${p.file}:30`, text: "D1 has no example" }],
    transition: () => [],
  });
  try {
    const list = JSON.parse((await get(s.port, "/api/plans")).body);
    assert.deepEqual(
      list.plans.filter((p: { error: string | null }) => !p.error).map((p: { file: string; kind: string; done: number; open: number }) => [p.file, p.kind, p.done, p.open]),
      [
        ["knowledge/plan/index.md", "index", 1, 1],
        ["knowledge/plan/42-export.md", "issue", 3, 2],
      ],
    );

    const r = await get(s.port, `/api/plan?file=${encodeURIComponent("knowledge/plan/42-export.md")}`);
    assert.equal(r.status, 200);
    const data = JSON.parse(r.body);
    assert.equal(data.plan.nodes.length, 5);
    assert.deepEqual(
      data.activity.map((e: { source: string; kind: string; node: string }) => `${e.source} ${e.kind} ${e.node}`),
      [
        "uncommitted drop A3",
        "commit done A1",
        "commit answer D1",
        "commit add A1",
        "commit add D1",
        "commit add O1",
        "commit add A2",
        "commit add A3",
      ],
    );
    const answer = data.activity.find((e: { kind: string }) => e.kind === "answer");
    assert.equal(answer.quote, "放桶里");
    assert.equal(answer.subject, "D1 answered, A1 done");
    assert.deepEqual(data.findings.map((f: { node: string }) => f.node), ["D1"]);
    assert.deepEqual(data.view.critical, ["O1", "A2"]);
    assert.deepEqual(
      data.view.decisions.map((d: { code: string; question: string; recommended: string; quote: string }) => [d.code, d.question, d.recommended, d.quote]),
      [["D1", "存在哪？", "推荐：桶。 agent 做。", "放桶里"]],
    );

    for (const bad of ["../../AGENTS.md", "knowledge/plan/../../AGENTS.md", "/etc/passwd", "knowledge/spec/L1.md", "knowledge/plan/out.md", "knowledge/plan/x.txt"]) {
      assert.equal((await get(s.port, `/api/plan?file=${encodeURIComponent(bad)}`)).status, 400, bad);
    }
    assert.equal((await get(s.port, "/api/plan?file=knowledge/plan/none.md")).status, 404);
    // Another site that resolves its name to 127.0.0.1 gets nothing (DNS rebinding).
    assert.equal((await get(s.port, "/api/plans", "evil.example:80")).status, 403);
  } finally {
    await s.close();
  }
});

test("the event stream sends `changed` when a plan file changes on disk", async () => {
  const { root, write } = repo();
  const s = await startPlanView({ cwd: root, port: 0, parse, debounceMs: 50 });
  const ac = new AbortController();
  try {
    const res = await fetch(`${s.url}api/events`, { signal: ac.signal });
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const dec = new TextDecoder();
    let seen = "";
    const until = async (re: RegExp) => {
      const end = Date.now() + 5000;
      while (!re.test(seen)) {
        if (Date.now() > end) throw new Error(`no ${re} in: ${seen}`);
        const { value, done } = await reader.read();
        if (done) break;
        seen += dec.decode(value);
      }
    };
    await until(/event: hello/);
    await new Promise((r) => setTimeout(r, 300)); // events of the setup writes go first
    write("knowledge/plan/42-export.md", JSON.stringify(v1));
    await until(/event: changed\ndata: \{"file":"knowledge\/plan\/42-export\.md"\}/);
  } finally {
    ac.abort();
    await s.close();
  }
});

// --- the edits of the groups: the real parser and edits of plan.ts on the fixture alpha.txt; no test runs `gh` ---

test("the edits: a POST needs the origin, the token and JSON; a proposal is made, changed, opened as an issue and removed", async () => {
  const { root, write } = repo();
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  write("knowledge/plan/alpha.md", readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures/alpha.txt"), "utf8"));
  git("add", ".");
  git("commit", "-qm", "alpha");
  git("remote", "add", "origin", "git@github.com:me/my-app.git");
  const runs: string[][] = [];
  const s = await startPlanView({
    cwd: root,
    port: 0,
    parse: parsePlan,
    check: checkPlan,
    transition: checkTransition,
    edit: edits,
    gh: (args) => {
      runs.push(args);
      return "https://github.com/me/my-app/issues/43\n";
    },
  });
  const page = await (await fetch(s.url)).text();
  const token = /name="plan-view-token" content="([0-9a-f]{48})"/.exec(page)?.[1] ?? "";
  assert.ok(token, "the page holds the token");
  const origin = s.url.slice(0, -1);
  const file = "knowledge/plan/alpha.md";
  const post = async (path: string, body: object, headers: Record<string, string> = {}) => {
    const r = await fetch(`${s.url}${path.slice(1)}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, "x-plan-view-token": token, ...headers },
      body: JSON.stringify({ file, ...body }),
    });
    return { status: r.status, body: await r.json() };
  };
  const text = () => readFileSync(join(root, file), "utf8");
  const groups = () => parsePlan(text(), file).groups.map((g) => `${g.code}:${g.nodes.join(",")}`);
  try {
    const view = JSON.parse((await get(s.port, `/api/plan?file=${encodeURIComponent(file)}`)).body);
    assert.equal(view.editable, true);
    assert.equal(view.github, "me/my-app");
    assert.deepEqual(view.plan.groups.map((g: { code: string }) => g.code), ["I7", "P2", "P4"]);

    // The safety of a write: each of these changes nothing.
    const start = text();
    assert.equal((await post("/api/unpropose", { code: "P4" }, { "x-plan-view-token": "0" })).status, 403);
    assert.equal((await post("/api/unpropose", { code: "P4" }, { origin: "http://evil.example" })).status, 403);
    assert.equal((await post("/api/unpropose", { code: "P4" }, { "content-type": "text/plain" })).status, 415);
    assert.equal((await post("/api/propose", { codes: ["A5"], title: "x".repeat(70_000) })).status, 413);
    assert.equal((await post("/api/unpropose", { file: "../AGENTS.md", code: "P4" })).status, 400);
    // The edits of plan.ts refuse: a D node, a node in a group, an issue group.
    const d = await post("/api/propose", { codes: ["D1"], title: "x" });
    assert.deepEqual([d.status, /not an A node/.test(d.body.error)], [400, true]);
    assert.equal((await post("/api/propose", { codes: ["A3"], title: "x" })).status, 400);
    assert.equal((await post("/api/unpropose", { code: "I7" })).status, 400);
    assert.equal(text(), start);

    // Remove P4, propose its node again (P3 and P4 stay used: the next code is P5), change P2.
    assert.equal((await post("/api/unpropose", { code: "P4" })).status, 200);
    assert.deepEqual(await post("/api/propose", { codes: ["A5"], title: "测试数据" }), { status: 200, body: { code: "P5", findings: [] } });
    assert.equal((await post("/api/regroup", { code: "P2", remove: ["A4"] })).status, 200);
    assert.equal((await post("/api/regroup", { code: "P2", add: ["A4"] })).status, 200);
    assert.deepEqual(groups(), ["I7:A2", "P2:A3,A4", "P5:A5"]);

    // Open P2 as an issue: first the dry run (the command and the changed lines), with no run of gh.
    const dry = await post("/api/open-issue", { code: "P2" });
    assert.deepEqual(dry.body.command.slice(0, 7), ["gh", "issue", "create", "--title", "导出和上传", "--milestone", "alpha"]);
    assert.ok(dry.body.diff.some((l: string) => l.includes('subgraph IN["#N 导出和上传"]')), dry.body.diff.join("\n"));
    assert.equal(runs.length, 0);
    assert.equal((await post("/api/open-issue", { code: "P2", confirm: true, expect: ["gh", "other"] })).status, 409);
    assert.equal(runs.length, 0);
    const opened = await post("/api/open-issue", { code: "P2", confirm: true, expect: dry.body.command });
    assert.deepEqual(opened.body, { issue: 43, url: "https://github.com/me/my-app/issues/43", written: true, findings: [] });
    assert.deepEqual(runs, [dry.body.command.slice(1)]);
    assert.deepEqual(groups(), ["I7:A2", "I43:A3,A4", "P5:A5"]);

    // The activity of the uncommitted change: the proposal opened as the issue is one event.
    const after = JSON.parse((await get(s.port, `/api/plan?file=${encodeURIComponent(file)}`)).body);
    const kinds = after.activity.filter((e: { source: string }) => e.source === "uncommitted").map((e: { kind: string; text: string }) => `${e.kind} ${e.text}`);
    assert.ok(kinds.includes("issue P2 opened as #43: 导出和上传"), kinds.join("\n"));
    assert.ok(kinds.includes("unpropose P4 removed: 测试数据"), kinds.join("\n"));
    assert.ok(kinds.includes("propose P5 proposed: 测试数据 (A5)"), kinds.join("\n"));
  } finally {
    await s.close();
  }
  // With no edits, the page is read-only.
  const ro = await startPlanView({ cwd: root, port: 0, parse: parsePlan });
  try {
    const t = /name="plan-view-token" content="([0-9a-f]+)"/.exec(await (await fetch(ro.url)).text())?.[1] ?? "";
    const r = await fetch(`${ro.url}api/unpropose`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ro.url.slice(0, -1), "x-plan-view-token": t },
      body: JSON.stringify({ file, code: "P5" }),
    });
    assert.equal(r.status, 501);
  } finally {
    await ro.close();
  }
});

test("the GitHub repo of the origin remote", () => {
  assert.equal(githubRepoOf("https://github.com/shiyuann/aboveloop.git"), "shiyuann/aboveloop");
  assert.equal(githubRepoOf("git@github.com:me/my-app.git\n"), "me/my-app");
  assert.equal(githubRepoOf("ssh://git@github.com/me/my.app"), "me/my.app");
  assert.equal(githubRepoOf("https://gitlab.com/me/x.git"), null);
});
