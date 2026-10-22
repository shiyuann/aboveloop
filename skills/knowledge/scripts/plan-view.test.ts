import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { Plan, PlanNode } from "./plan-graph.ts";
import { criticalPath, githubRepoOf, nodeStates, type PlanEdits, startPlanView } from "./plan-view.ts";

// The tests do not use `plan-graph.ts`: a plan file here holds the Plan as JSON, and the fake parser reads it.
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

// --- the edits of the groups: fakes on the JSON plans; no test runs the real `gh` ---

const fakeEdits: PlanEdits = {
  propose(text, file, codes, title) {
    const p = parse(text, file);
    for (const c of codes) if (p.nodes.find((n) => n.code === c)?.kind !== "A") throw new Error(`${c} is not an A node`);
    const code = `P${(p.groups ?? []).length + 1}`; // codes are not reused
    p.groups = [...(p.groups ?? []), { code, kind: "proposal", title, issue: null, nodes: codes, line: 3, endLine: 5 }];
    return { text: JSON.stringify(p), code };
  },
  unpropose(text, file, code) {
    const p = parse(text, file);
    p.groups = (p.groups ?? []).filter((g) => g.code !== code);
    return JSON.stringify(p);
  },
  regroup(text, file, code, add, remove) {
    const p = parse(text, file);
    const g = (p.groups ?? []).find((x) => x.code === code);
    if (!g) throw new Error(`no group ${code}`);
    g.nodes = [...g.nodes.filter((c) => !remove.includes(c)), ...add];
    return JSON.stringify(p);
  },
  issueCommand(text, file, code) {
    const g = (parse(text, file).groups ?? []).find((x) => x.code === code);
    if (!g) throw new Error(`no group ${code}`);
    return ["gh", "issue", "create", "--title", g.title, "--milestone", "alpha", "--body", `${g.nodes.join(", ")}\n\n${file}`];
  },
  openIssueEdit(text, file, code, issue) {
    const p = parse(text, file);
    p.groups = (p.groups ?? []).map((g) => (g.code === code ? { ...g, code: `I${issue}`, kind: "issue", issue } : g));
    return JSON.stringify(p);
  },
};

const alpha = plan(
  [
    { code: "A3", label: "A3 agent：导出" },
    { code: "A4", label: "A4 agent：上传" },
    { code: "D2", kind: "D", label: "D2 owner 拍板：格式" },
  ],
  [["D2", "A3"]],
  { kind: "milestone", title: "alpha", groups: [] },
);

test("the edits: a POST needs the origin, the token and JSON; a proposal is made, changed, opened as an issue and removed", async () => {
  const { root, write } = repo();
  write("knowledge/plan/alpha.md", JSON.stringify(alpha));
  const runs: string[][] = [];
  const s = await startPlanView({
    cwd: root,
    port: 0,
    parse,
    edit: fakeEdits,
    gh: async (argv) => {
      runs.push(argv);
      return "https://github.com/o/r/issues/42\n";
    },
  });
  const page = await (await fetch(s.url)).text();
  const token = /name="plan-view-token" content="([0-9a-f]{48})"/.exec(page)?.[1] ?? "";
  assert.ok(token, "the page holds the token");
  const origin = s.url.slice(0, -1);
  const post = async (path: string, body: object, headers: Record<string, string> = {}) => {
    const r = await fetch(`${s.url}${path.slice(1)}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, "x-plan-view-token": token, ...headers },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };
  const groups = () => JSON.parse(readFileSync(join(root, "knowledge/plan/alpha.md"), "utf8")).groups;
  const file = "knowledge/plan/alpha.md";
  try {
    // The safety of a write.
    assert.equal((await post("/api/propose", { file, codes: ["A3"], title: "x" }, { "x-plan-view-token": "0" })).status, 403);
    assert.equal((await post("/api/propose", { file, codes: ["A3"], title: "x" }, { origin: "http://evil.example" })).status, 403);
    assert.equal((await post("/api/propose", { file, codes: ["A3"], title: "x" }, { "content-type": "text/plain" })).status, 415);
    assert.equal((await post("/api/propose", { file, codes: ["A3"], title: "x".repeat(70_000) })).status, 413);
    assert.equal((await post("/api/propose", { file: "../AGENTS.md", codes: ["A3"], title: "x" })).status, 400);
    assert.equal((await post("/api/propose", { file: "knowledge/plan/42-export.md", codes: ["A2"], title: "x" })).status, 400, "not a milestone plan");
    assert.equal((await post("/api/propose", { file, codes: ["D2"], title: "x" })).status, 400, "the edit refuses a D node");
    assert.deepEqual(groups(), []);

    const made = await post("/api/propose", { file, codes: ["A3"], title: "导出和上传" });
    assert.deepEqual(made, { status: 200, body: { code: "P1" } });
    assert.equal((await post("/api/regroup", { file, code: "P1", add: ["A4"] })).status, 200);
    assert.deepEqual(groups().map((g: { code: string; nodes: string[] }) => [g.code, g.nodes]), [["P1", ["A3", "A4"]]]);

    // Open as an issue: first the command only, with no run.
    const preview = await post("/api/open-issue", { file, code: "P1" });
    assert.deepEqual(preview.body.command.slice(0, 5), ["gh", "issue", "create", "--title", "导出和上传"]);
    assert.equal(runs.length, 0);
    assert.equal((await post("/api/open-issue", { file, code: "P1", confirm: true, expect: ["gh", "other"] })).status, 409);
    assert.equal(runs.length, 0);
    const opened = await post("/api/open-issue", { file, code: "P1", confirm: true, expect: preview.body.command });
    assert.deepEqual(opened.body, { issue: 42, url: "https://github.com/o/r/issues/42" });
    assert.deepEqual(runs, [preview.body.command]);
    assert.deepEqual(groups().map((g: { code: string; issue: number }) => [g.code, g.issue]), [["I42", 42]]);

    await post("/api/propose", { file, codes: ["A3"], title: "second" });
    assert.equal((await post("/api/unpropose", { file, code: "P2" })).status, 200);
    assert.deepEqual(groups().map((g: { code: string }) => g.code), ["I42"]);
  } finally {
    await s.close();
  }
  // With no edits, the page is read-only.
  const ro = await startPlanView({ cwd: root, port: 0, parse });
  try {
    const t = /name="plan-view-token" content="([0-9a-f]+)"/.exec(await (await fetch(ro.url)).text())?.[1] ?? "";
    const r = await fetch(`${ro.url}api/unpropose`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ro.url.slice(0, -1), "x-plan-view-token": t },
      body: JSON.stringify({ file, code: "I42" }),
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
