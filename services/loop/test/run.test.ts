/**
 * runLoop end to end against a fake GitHub and a fake Cursor (an injected fetch).
 * Nothing here uses the network.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { type Options, runLoop } from "../run.ts";

const REPO = "acme/app";

const BASE_ENV = {
  REPO,
  GITHUB_TOKEN: "gh-tok",
  CURSOR_API_KEY: "cursor-key",
  GH_TOKEN_KIT: "kit-tok",
  GH_APP_ID_DEV: "99",
  GH_APP_KEY_DEV: "pem",
  GH_TOKEN_EXPLORER: "explorer-tok",
};

interface Call {
  method: string;
  url: string;
  body: string;
}

/**
 * The fake world: open issues #1 and #2 with the labels ready-for-auto-builder and
 * explored, #4 and #7 not explored yet, and PR #3 with the labels too; open PR
 * #50 fixes #1 (or the open PRs of `prs`). `refused` makes GitHub answer 500 to the issue lists.
 * `post` makes the launch time out, be refused, or answer 400; after a timeout, the list of agents is
 * `recovered`, and `late` on the read after the wait.
 */
function world(over: { refused?: boolean; agents?: unknown[]; prs?: unknown[]; post?: "timeout" | "refused" | "http"; recovered?: unknown[] | "fail"; late?: unknown[] | "fail" } = {}) {
  const calls: Call[] = [];
  let lists = 0;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const body = typeof init.body === "string" ? init.body : "";
    calls.push({ method: init.method ?? "GET", url, body });
    if (url.startsWith("https://api.github.com/repos/acme/app/pulls?"))
      return json(over.prs ?? [{ number: 50, head: { ref: "fix-1" }, body: "Fixes #1", draft: false }]);
    const label = [{ name: "ready-for-auto-builder" }, { name: "explored" }];
    const ready = [
      { number: 1, state: "open", labels: label, title: "secret title", body: "secret body" },
      { number: 2, state: "open", labels: label, updated_at: "2026-10-12T09:00:00Z" },
      { number: 3, state: "open", labels: label, pull_request: {} },
    ];
    if (url.startsWith("https://api.github.com/repos/acme/app/issues?state=open&labels=ready-for-auto-builder&"))
      return over.refused ? json({ message: "boom" }, 500) : json(ready);
    if (url.startsWith("https://api.github.com/repos/acme/app/issues?state=open&per_page="))
      return over.refused
        ? json({ message: "boom" }, 500)
        : json([...ready, { number: 7, state: "open", labels: [{ name: "bug" }] }, { number: 4, state: "open", labels: [] }]);
    if (url.startsWith("https://api.cursor.com/v1/agents?")) {
      lists += 1;
      // The first list is the hold-back read. A launch timeout reads the list again, and once more after a wait (`late`).
      if (over.post === "timeout" && lists > 1) {
        const items = lists > 2 && over.late !== undefined ? over.late : over.recovered;
        return items === "fail" ? json({ message: "nope" }, 500) : json({ items: items ?? [], nextCursor: null });
      }
      return over.agents ? json({ items: over.agents, nextCursor: null }) : json({ message: "nope" }, 404);
    }
    if (url === "https://api.cursor.com/v1/agents") {
      if (over.post === "timeout") throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
      if (over.post === "refused") throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
      if (over.post === "http") return json({ code: "validation_error", message: "secret" }, 400);
      return json({ agent: { id: "bc-1", url: "https://cursor.com/agents/bc-1" }, run: { id: "run-1" } }, 201);
    }
    return json({ message: "not found" }, 404);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

async function go(o: Partial<Options> & { w?: ReturnType<typeof world> }) {
  const w = o.w ?? world();
  const lines: string[] = [];
  const sleeps: number[] = [];
  const sleep = async (ms: number) => void sleeps.push(ms);
  const ok = await runLoop({ env: BASE_ENV, sleep, ...o, fetch: w.fetchImpl, log: (l) => lines.push(l) });
  const launches = w.calls.filter((c) => c.url === "https://api.cursor.com/v1/agents");
  return { ok, lines, launches, sleeps, calls: w.calls, text: lines.join("\n") };
}

test("a dry run reads everything and launches nothing", async () => {
  const r = await go({ step: "all", dryRun: true });
  assert.equal(r.ok, true, r.text);
  assert.equal(r.launches.length, 0);
  assert.ok(r.calls.every((c) => c.method === "GET"));
  // The workflow `loop.yml` reads GitHub with REST only: no GraphQL.
  assert.ok(r.calls.every((c) => c.url !== "https://api.github.com/graphql"));
  assert.match(r.text, /explore: 4 open issues, 2 without the label explored in the batch/);
  assert.match(r.text, /explore: would launch builder \(explore\) for 2 issues of acme\/app \(#4 #7\)/);
  assert.match(r.text, /implement: 2 open issues with the label ready-for-auto-builder/);
  assert.match(r.text, /implement: chose #2/);
  assert.match(r.text, /implement: would launch builder \(implement\) for acme\/app#2/);
});

test("a real run: launches explore for #4 #7 and implement for #2, and writes nothing to GitHub", async () => {
  const r = await go({ step: "all" });
  assert.equal(r.ok, true, r.text);
  assert.ok(r.calls.filter((c) => c.url.startsWith("https://api.github.com/")).every((c) => c.method === "GET"));

  assert.equal(r.launches.length, 2);
  const [explore, impl] = r.launches.map((c) => JSON.parse(c.body));
  assert.equal(explore.name, "builder explore · acme/app");
  assert.ok(explore.prompt.text.includes('"issues": [\n    4,\n    7\n  ]'));
  assert.equal(impl.name, "builder implement · acme/app#2");
  assert.ok(impl.prompt.text.includes('"issue": 2'));
  // No launch has repos. Each job gets its own token, and every one the kit's read token.
  for (const b of [explore, impl]) assert.ok(!("repos" in b), b.name);
  assert.equal(impl.envVars.GH_APP_ID_DEV, "99");
  assert.equal(impl.envVars.GH_APP_KEY_DEV, "pem");
  assert.equal(impl.envVars.GH_TOKEN_KIT, "kit-tok");
  assert.equal(impl.envVars.GH_TOKEN, undefined);
  assert.ok(impl.envVars.LAUNCHED_AT);
  assert.deepEqual(explore.envVars, { GH_TOKEN: "explorer-tok", GH_TOKEN_KIT: "kit-tok" });
  assert.match(r.text, /implement: launched builder \(implement\) for acme\/app#2 .*agent bc-1 https:\/\/cursor.com\/agents\/bc-1 run run-1/);
  // The log has no token and no issue text.
  for (const secret of ["gh-tok", "cursor-key", "agent-tok", "explorer-tok", "secret title", "secret body"]) assert.ok(!r.text.includes(secret), secret);
});

test("a run with no step does explore and implement", async () => {
  const r = await go({ dryRun: true });
  assert.match(r.text, /steps explore\+implement/);
});

test("implement reads no comments, and continues an issue's own draft on issues/<N>", async () => {
  const r = await go({ step: "implement", dryRun: true });
  assert.match(r.text, /implement: chose #2$/m);
  assert.ok(r.calls.every((c) => !c.url.includes("/comments")), "no wait for an answer: the rule reads no comments");
  // A session handed #1 over: its draft on issues/1 does not hold it.
  const draft = await go({ step: "implement", dryRun: true, w: world({ prs: [{ number: 50, head: { ref: "issues/1" }, body: "Fixes #1", draft: true }] }) });
  assert.match(draft.text, /implement: chose #1 \(continues its draft #50\)/);
  // The same PR, ready: it waits for the owner, and #1 is not taken.
  const ready = await go({ step: "implement", dryRun: true, w: world({ prs: [{ number: 50, head: { ref: "issues/1" }, body: "Fixes #1", draft: false }] }) });
  assert.match(ready.text, /implement: chose #2$/m);
  // Ready PRs on other issues' branches wait for the owner, and do not stop the step.
  const three = [50, 51, 52].map((n) => ({ number: n, head: { ref: `issues/${n}` }, body: "", draft: false }));
  assert.match((await go({ step: "implement", dryRun: true, w: world({ prs: three }) })).text, /implement: chose #1$/m);
});

test("GitHub refuses the issue lists: explore and implement launch nothing, the run fails", async () => {
  const r = await go({ w: world({ refused: true }) });
  assert.equal(r.ok, false);
  assert.equal(r.launches.length, 0);
  assert.match(r.text, /FAIL explore: GET repos\/acme\/app\/issues answered 500/);
  assert.match(r.text, /FAIL implement: GET repos\/acme\/app\/issues answered 500/);
});

test("an unknown step fails the run before any read", async () => {
  const r = await go({ step: "deploy" });
  assert.equal(r.ok, false);
  assert.equal(r.calls.length, 0);
  assert.match(r.text, /FAIL unknown step "deploy"/);
});

test("a missing value skips its step with one line; a missing launch key skips the launch, not the reads", async () => {
  const r = await go({ env: { ...BASE_ENV, GITHUB_TOKEN: "", CURSOR_API_KEY: "" }, step: "explore,implement" });
  assert.equal(r.ok, true, r.text);
  assert.match(r.text, /^skip explore: no GITHUB_TOKEN$/m);
  assert.match(r.text, /^skip implement: no GITHUB_TOKEN$/m);
  const s = await go({ env: { ...BASE_ENV, CURSOR_API_KEY: "" }, step: "implement" });
  assert.match(s.text, /skip implement: would launch builder \(implement\) for acme\/app#2, but no CURSOR_API_KEY/);
  assert.equal(s.launches.length, 0);
});

test("a run skips work whose agent still runs, and fails on work tried twice with no mark", async () => {
  const now = new Date("2026-10-12T22:33:00Z");
  const busy = await go({ step: "implement", now, w: world({ agents: [{ id: "bc-9", name: "builder implement · acme/app#2", status: "RUNNING", createdAt: "2026-10-12T22:29:57Z" }] }) });
  assert.equal(busy.ok, true, busy.text);
  assert.equal(busy.launches.length, 0);
  assert.match(busy.text, /skip implement: acme\/app#2: agent bc-9 of the same work is still RUNNING/);
  const tried = await go({ step: "implement", now, w: world({ agents: ["10", "16"].map((h) => ({ id: `bc-${h}`, name: "builder implement · acme/app#2", status: "IDLE", createdAt: `2026-10-12T${h}:00:00Z` })) }) });
  assert.equal(tried.ok, false, "the run fails, so the owner sees it");
  assert.equal(tried.launches.length, 0);
  assert.match(tried.text, /FAIL implement: launches nothing for acme\/app#2: 2 agents started since it last changed/);
});

test("a launch timeout keeps an agent of the same name created since the run started, and does not POST again", async () => {
  const now = new Date("2026-10-09T10:35:00.000Z");
  const name = "builder implement · acme/app#2";
  const row = (id: string, createdAt: string, agentName = name) => ({
    id,
    name: agentName,
    status: "ACTIVE",
    url: `https://cursor.com/agents/${id}`,
    createdAt,
    latestRunId: `run-${id}`,
  });
  const lists = (calls: Call[]) => calls.filter((c) => c.url.startsWith("https://api.cursor.com/v1/agents?")).length;

  const hit = await go({ step: "implement", now, w: world({ agents: [], post: "timeout", recovered: [row("bc-new", "2026-10-09T10:35:01.000Z")] }) });
  assert.equal(hit.ok, true, hit.text);
  assert.equal(hit.launches.length, 1, "a timeout is not a second POST");
  assert.equal(lists(hit.calls), 2, "the hold-back read, then one read after the timeout");
  assert.deepEqual(hit.sleeps, [], "a match on the first read does not wait");
  assert.match(hit.text, /implement: launched builder \(implement\) for acme\/app#2 .*agent bc-new https:\/\/cursor.com\/agents\/bc-new run run-bc-new/);
  assert.ok(!hit.text.includes("FAIL"));
  assert.ok(!hit.text.includes("cursor-key"));

  const two = await go({
    step: "implement",
    now,
    w: world({ agents: [], post: "timeout", recovered: [row("bc-early", "2026-10-09T10:35:01.000Z"), row("bc-new", "2026-10-09T10:35:20.000Z")] }),
  });
  assert.equal(two.ok, true, two.text);
  assert.match(two.text, /agent bc-new https:\/\/cursor.com\/agents\/bc-new run run-bc-new also bc-early/);

  // Seen in a run: the step ended one second after the agent was created, so the
  // first read can miss it. No match on the first read: wait 5 seconds, read once more.
  for (const recovered of [[], "fail" as const]) {
    const late = await go({ step: "implement", now, w: world({ agents: [], post: "timeout", recovered, late: [row("bc-late", "2026-10-09T10:35:31.000Z")] }) });
    assert.equal(late.ok, true, late.text);
    assert.equal(late.launches.length, 1, "a timeout is not a second POST");
    assert.equal(lists(late.calls), 3, "the hold-back read, a read after the timeout, one more read after the wait");
    assert.deepEqual(late.sleeps, [5_000]);
    assert.match(late.text, /implement: launched builder \(implement\) for acme\/app#2 .*agent bc-late https:\/\/cursor.com\/agents\/bc-late run run-bc-late/);
  }

  for (const recovered of [[], [row("bc-old", "2026-10-09T10:34:59.000Z")], [row("bc-other", "2026-10-09T10:36:00.000Z", "builder explore · acme/app")]]) {
    const miss = await go({ step: "implement", now, w: world({ agents: [], post: "timeout", recovered }) });
    assert.equal(miss.ok, false, miss.text);
    assert.equal(miss.launches.length, 1);
    assert.equal(lists(miss.calls), 3, "one more read after the wait, and no more");
    assert.deepEqual(miss.sleeps, [5_000]);
    assert.match(miss.text, /FAIL implement: launch builder \(implement\) for acme\/app#2: network: TimeoutError$/m);
  }

  const listed = await go({ step: "implement", now, w: world({ agents: [], post: "timeout", recovered: "fail" }) });
  assert.equal(listed.ok, false, listed.text);
  assert.equal(listed.launches.length, 1);
  assert.equal(lists(listed.calls), 3);
  assert.match(listed.text, /FAIL implement: launch builder \(implement\) for acme\/app#2: network: TimeoutError; the list request failed/);

  const refused = await go({ step: "implement", now, w: world({ agents: [], post: "refused" }) });
  assert.equal(refused.ok, false, refused.text);
  assert.equal(refused.launches.length, 1);
  assert.equal(lists(refused.calls), 1, "a refused connection does not read the list again");
  assert.deepEqual(refused.sleeps, []);
  assert.match(refused.text, /network: ECONNREFUSED/);

  const http = await go({ step: "implement", now, w: world({ agents: [], post: "http" }) });
  assert.equal(http.ok, false, http.text);
  assert.equal(lists(http.calls), 1, "an HTTP status does not read the list again");
  assert.match(http.text, /HTTP 400 validation_error/);
  assert.ok(!http.text.includes("secret"));
});
