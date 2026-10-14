import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const script = new URL("../keys.sh", import.meta.url).pathname;

function key(name: string, stdin: string, file: string) {
  return spawnSync("bash", [script, "key", name], {
    input: stdin,
    encoding: "utf8",
    timeout: 5000,
    env: { ...process.env, LOOP_ENV: file, APP_PEM: "" },
  });
}

test("make loop-key stores GH_APP_ID_DEV and refuses GH_APP_KEY_DEV", () => {
  const dir = mkdtempSync(join(tmpdir(), "loop-key-"));
  const file = join(dir, "loop.env");
  const missing = join(dir, "missing.env");

  const id = key("GH_APP_ID_DEV", "1234567\n", file);
  assert.equal(id.status, 0, id.stderr);
  assert.equal(readFileSync(file, "utf8"), "GH_APP_ID_DEV=1234567\n");
  assert.equal(statSync(file).mode & 0o777, 0o600);

  writeFileSync(file, "CURSOR_API_KEY=keep\nGH_APP_ID_DEV=1234567\n", { mode: 0o600 });
  const again = key("GH_APP_ID_DEV", "999\n", file);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(readFileSync(file, "utf8"), "CURSOR_API_KEY=keep\nGH_APP_ID_DEV=999\n");

  const before = readFileSync(file, "utf8");
  const pem = key("GH_APP_KEY_DEV", "not-a-key\n", file);
  assert.equal(pem.status, 2, pem.stderr);
  assert.match(pem.stderr, /copy the file to/);
  assert.match(pem.stderr, /github-app\.pem/);
  assert.equal(pem.stdout, "");
  assert.equal(readFileSync(file, "utf8"), before);

  const refused = key("GH_APP_KEY_DEV", "", missing);
  assert.equal(refused.status, 2, refused.stderr);
  assert.match(refused.stderr, /copy the file to/);
  assert.equal(existsSync(missing), false);

  const bad = key("NOPE", "", file);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /CURSOR_API_KEY GH_APP_ID_DEV/);
  assert.doesNotMatch(bad.stderr, /GH_APP_KEY_DEV/);
});

/** `keys.sh secrets` with a fake `gh` that keeps each secret's stdin, and each variable's value, in a file of that name. */
function secrets(loopEnv: string, pem: string) {
  const dir = mkdtempSync(join(tmpdir(), "loop-secrets-"));
  const bin = join(dir, "bin");
  const out = join(dir, "out");
  spawnSync("mkdir", ["-p", bin, out]);
  writeFileSync(
    join(bin, "gh"),
    `#!/usr/bin/env bash\n[ "$1 $2" = "secret set" ] && cat >"${out}/$3"\n[ "$1 $2" = "variable set" ] && printf '%s' "$7" >"${out}/$3"\nexit 0\n`,
  );
  chmodSync(join(bin, "gh"), 0o755);
  const r = spawnSync("bash", [script, "secrets", "acme/app"], {
    encoding: "utf8",
    timeout: 5000,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, LOOP_ENV: loopEnv, APP_PEM: pem },
  });
  return { r, out };
}

test("make loop-secrets sets the secrets from loop.env and the App's key file, and prints only names", () => {
  const dir = mkdtempSync(join(tmpdir(), "loop-secrets-"));
  const loopEnv = join(dir, "loop.env");
  const pem = join(dir, "github-app.pem");
  writeFileSync(loopEnv, "CURSOR_API_KEY=cursor\nGH_APP_ID_DEV=1234567\n", { mode: 0o600 });
  writeFileSync(pem, "-----PEM-----\n", { mode: 0o600 });
  const { r, out } = secrets(loopEnv, pem);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(out, "CURSOR_API_KEY"), "utf8"), "cursor");
  assert.equal(readFileSync(join(out, "GH_APP_KEY_DEV"), "utf8"), "-----PEM-----\n");
  assert.equal(readFileSync(join(out, "GH_APP_ID_DEV"), "utf8"), "1234567");
  assert.match(r.stdout, /没设：（无）/);
  assert.doesNotMatch(r.stdout, /cursor\b|PEM|1234567/, "no value in the output");
});

test("make loop-secrets names what it did not set and where it looked", () => {
  const dir = mkdtempSync(join(tmpdir(), "loop-secrets-"));
  const loopEnv = join(dir, "loop.env");
  writeFileSync(loopEnv, "CURSOR_API_KEY=cursor\n", { mode: 0o600 });
  const { r } = secrets(loopEnv, join(dir, "none.pem"));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /GH_APP_KEY_DEV（none\.pem 里没有）/);
  assert.match(r.stdout, /GH_APP_ID_DEV（loop\.env 里没有）/);
  assert.doesNotMatch(r.stdout, /cursor\b/, "no value in the output");
});
