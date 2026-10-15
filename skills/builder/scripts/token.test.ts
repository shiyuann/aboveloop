import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { MINT_IF_UNDER_MS, PERMISSIONS, STOP_AFTER_MS, appJwt, run, type Deps, type TokenEnv } from "./token.ts";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }) as string;

const repo = "shiyuann/aboveloop";

const env: TokenEnv = {
  GH_APP_ID_DEV: "1",
  GH_APP_KEY_DEV: pem,
  LAUNCHED_AT: "2026-10-15T05:00:00.000Z",
  REPO: repo,
};

function deps(over: Partial<Deps> = {}): Deps & { logins: string[]; configs: string[]; states: unknown[] } {
  const logins: string[] = [];
  const configs: string[] = [];
  const states: unknown[] = [];
  const owner = repo.slice(0, repo.indexOf("/"));
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/app/installations") && (!init || init.method === "GET" || !init.method))
      return new Response(JSON.stringify([{ id: 9, account: { login: owner } }]), { status: 200 });
    if (url.includes("/access_tokens"))
      return new Response(JSON.stringify({ token: "ghs_test", expires_at: "2026-10-15T06:00:00.000Z" }), { status: 201 });
    return new Response("no", { status: 404 });
  };
  return {
    fetch: fetchImpl,
    now: () => new Date("2026-10-15T05:40:00.000Z"),
    login: (token) => (logins.push(token), true),
    setupGit: () => {},
    writeGhConfig: (token) => configs.push(token),
    readState: () => null,
    writeState: (s) => states.push(s),
    logins,
    configs,
    states,
    ...over,
  };
}

test("no key: the script does nothing", async () => {
  assert.equal(await run({}, {}, deps()), "");
});

test("three hours after the launch: stopped, and it does not mint", async () => {
  let called = false;
  const d = deps({ fetch: async () => ((called = true), new Response("no")) });
  const word = await run({ ...env, LAUNCHED_AT: new Date(Date.parse("2026-10-15T05:40:00.000Z") - STOP_AFTER_MS - 1).toISOString() }, {}, d);
  assert.equal(word, "stopped");
  assert.equal(called, false);
});

test("more than 35 minutes left: ok, and it does not mint", async () => {
  let called = false;
  const exp = new Date(Date.parse("2026-10-15T05:40:00.000Z") + MINT_IF_UNDER_MS + 1000).toISOString();
  const d = deps({ fetch: async () => ((called = true), new Response("no")), readState: () => ({ exp, setup: true }) });
  assert.equal(await run(env, {}, d), "ok");
  assert.equal(called, false);
});

test("a mint logs gh in and stores only the expiry", async () => {
  const d = deps();
  assert.equal(await run(env, { force: true }, d), "ok");
  assert.deepEqual(d.logins, ["ghs_test"]);
  assert.deepEqual(d.configs, []);
  assert.deepEqual(d.states, [{ exp: "2026-10-15T06:00:00.000Z", setup: true }]);
});

test("when gh auth login fails, the token goes only into gh's own config", async () => {
  const d = deps({ login: () => false });
  assert.equal(await run(env, { force: true }, d), "ok");
  assert.deepEqual(d.configs, ["ghs_test"]);
});

test("the minted permissions are the step dev of action.yml", () => {
  const yml = readFileSync(fileURLToPath(new URL("../../../services/loop/action.yml", import.meta.url)), "utf8");
  const dev = yml.slice(yml.indexOf("- id: dev"), yml.indexOf("- name: Run the loop"));
  assert.match(dev, /permission-contents: write/);
  assert.match(dev, /permission-issues: write/);
  assert.match(dev, /permission-pull-requests: write/);
  assert.deepEqual(PERMISSIONS, { contents: "write", issues: "write", pull_requests: "write" });
});

test("a JWT is three parts and carries the App id", () => {
  const jwt = appJwt("4242", pem, new Date("2026-10-15T05:00:00.000Z"));
  const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
  assert.equal(payload.iss, "4242");
  assert.equal(jwt.split(".").length, 3);
});
