/**
 * The token of an implement run.
 * It mints a one-hour installation token for this repo only, logs `gh` in with it,
 * and keeps only the expiry outside the clones. It never prints the token or the key,
 * never puts the token in a remote URL, and never sets `GH_TOKEN`.
 *
 *   node --experimental-strip-types --no-warnings token.ts [--force]
 *
 * With no `GH_APP_KEY_DEV` it does nothing: a session on the Mac has its own login.
 * `stopped` means three hours have passed since `LAUNCHED_AT`. `failed` means the mint did not work.
 */
import { execFileSync } from "node:child_process";
import { createSign } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The permissions of the step `dev` of `services/loop/action.yml`. The script mints these. */
export const PERMISSIONS = { contents: "write", issues: "write", pull_requests: "write" } as const;

/** Mint again when the current token has less than this left. */
export const MINT_IF_UNDER_MS = 35 * 60_000;
/** A stuck run stops minting this long after the launch. The agent still holds the key, so this is not a stop (A6). */
export const STOP_AFTER_MS = 3 * 60 * 60_000;

const API = "https://api.github.com";

export type Word = "ok" | "stopped" | "failed";

export interface TokenEnv {
  GH_APP_ID_DEV?: string;
  GH_APP_KEY_DEV?: string;
  LAUNCHED_AT?: string;
  REPO?: string;
  HOME?: string;
}

interface State {
  exp?: string;
  setup?: boolean;
}

export interface Deps {
  fetch: typeof fetch;
  now: () => Date;
  login: (token: string) => boolean;
  setupGit: () => void;
  /** Writes the token into `gh`'s own config, outside any clone. Used only when `gh auth login` fails. */
  writeGhConfig: (token: string) => void;
  readState: () => State | null;
  writeState: (state: State) => void;
}

const b64 = (s: string) => Buffer.from(s).toString("base64url");

/** A GitHub App JWT. `iss` is the App id. It is valid for nine minutes. */
export function appJwt(appId: string, pem: string, now: Date): string {
  const header = b64(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64(JSON.stringify({ iat: Math.floor(now.getTime() / 1000) - 60, exp: Math.floor(now.getTime() / 1000) + 9 * 60, iss: appId }));
  const data = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(data);
  return `${data}.${sign.sign(pem).toString("base64url")}`;
}

async function gh(fetchImpl: typeof fetch, jwt: string, method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  const res = await fetchImpl(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${jwt}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

/** One run of the script. `""` means it did nothing, because there is no key. */
export async function run(env: TokenEnv, opts: { force?: boolean }, deps: Deps): Promise<Word | ""> {
  const pem = env.GH_APP_KEY_DEV?.trim() ?? "";
  const appId = env.GH_APP_ID_DEV?.trim() ?? "";
  if (!pem) return "";
  if (!appId || !env.REPO?.includes("/")) return "failed";
  const now = deps.now();
  const launched = env.LAUNCHED_AT ? Date.parse(env.LAUNCHED_AT) : now.getTime();
  if (Number.isNaN(launched) || now.getTime() - launched > STOP_AFTER_MS) return "stopped";
  const state = deps.readState();
  const left = state?.exp ? Date.parse(state.exp) - now.getTime() : 0;
  if (!opts.force && left > MINT_IF_UNDER_MS) return "ok";

  const owner = env.REPO.slice(0, env.REPO.indexOf("/"));
  const repo = env.REPO.slice(owner.length + 1);
  let jwt: string;
  try {
    jwt = appJwt(appId, pem, now);
  } catch {
    return "failed";
  }
  const listed = await gh(deps.fetch, jwt, "GET", "/app/installations");
  const installs = Array.isArray(listed.json) ? listed.json : [];
  const inst = installs.find((x) => (x as { account?: { login?: string } }).account?.login === owner) as { id?: number } | undefined;
  if (listed.status !== 200 || !inst?.id) return "failed";
  const minted = await gh(deps.fetch, jwt, "POST", `/app/installations/${inst.id}/access_tokens`, { repositories: [repo], permissions: PERMISSIONS });
  const token = (minted.json as { token?: unknown; expires_at?: unknown } | null)?.token;
  const exp = (minted.json as { expires_at?: unknown } | null)?.expires_at;
  if (minted.status !== 201 || typeof token !== "string" || typeof exp !== "string") return "failed";

  const loggedIn = deps.login(token);
  if (!loggedIn) deps.writeGhConfig(token);
  if (!state?.setup) deps.setupGit();
  deps.writeState({ exp, setup: true });
  return "ok";
}

const statePath = (home: string) => join(home, ".config/aboveloop/implement-token.json");

function realDeps(env: TokenEnv): Deps {
  const home = env.HOME?.trim() || homedir();
  return {
    fetch,
    now: () => new Date(),
    login: (token) => {
      try {
        execFileSync("gh", ["auth", "login", "--hostname", "github.com", "--with-token"], { input: token, stdio: ["pipe", "pipe", "pipe"] });
        return true;
      } catch {
        return false;
      }
    },
    setupGit: () => {
      try {
        execFileSync("gh", ["auth", "setup-git"], { stdio: "ignore" });
      } catch {
        /* the login still holds the token in gh's own config */
      }
    },
    writeGhConfig: (token) => {
      const file = join(home, ".config/gh/hosts.yml");
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `github.com:\n    oauth_token: ${token}\n    git_protocol: https\n`);
    },
    readState: () => {
      try {
        return JSON.parse(readFileSync(statePath(home), "utf8")) as State;
      } catch {
        return null;
      }
    },
    writeState: (state) => {
      const file = statePath(home);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify({ exp: state.exp, setup: state.setup }));
    },
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
if (isMain) {
  const word = await run(process.env, { force: process.argv.includes("--force") }, realDeps(process.env));
  if (word) console.log(word);
  process.exit(word === "failed" ? 1 : 0);
}
