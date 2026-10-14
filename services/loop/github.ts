/**
 * The GitHub calls of the workflow `loop.yml`, each with the token it needs:
 *
 *   GITHUB_TOKEN   REST, the own repo: open issues and their labels, and open PRs. Read only.
 *
 * `gitHub(fetch)` makes the client, so the tests hand in a fake fetch.
 * An error names the call and the status, never the token or the response
 * body (a body can quote issue text).
 */
import { type Issue, type Pr, READY_LABEL } from "../../skills/builder-resolve/scripts/loop.ts";

export const API = "https://api.github.com";

const headers = (token: string) => ({
  authorization: `Bearer ${token}`,
  accept: "application/vnd.github+json",
  "x-github-api-version": "2022-11-28",
  "user-agent": "aboveloop-loop",
});

/** Only the fields the rules use: no title or body stays in memory. */
const slim = (i: Issue): Issue => ({
  number: i.number,
  state: i.state,
  labels: (i.labels ?? []).map((l) => (typeof l === "string" ? l : (l.name ?? ""))),
  ...(i.pull_request ? { pull_request: true } : {}),
  ...(typeof i.updated_at === "string" ? { updated_at: i.updated_at } : {}),
});

export function gitHub(fetchImpl: typeof fetch = fetch) {
  /** Every page of a REST list. */
  async function restList<T>(token: string, path: string): Promise<T[]> {
    const out: T[] = [];
    let url: string | null = `${API}/${path}${path.includes("?") ? "&" : "?"}per_page=100`;
    while (url) {
      const res: Response = await fetchImpl(url, { headers: headers(token), signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`GET ${path.split("?")[0]} answered ${res.status}`);
      out.push(...((await res.json()) as T[]));
      url = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get("link") ?? "")?.[1] ?? null;
    }
    return out;
  }

  return {
    openPrs: (token: string, repo: string): Promise<Pr[]> =>
      restList<Pr & Record<string, unknown>>(token, `repos/${repo}/pulls?state=open`).then((list) =>
        list.map((p) => ({ number: p.number, head: { ref: p.head.ref }, body: p.body ?? null, draft: p.draft === true })),
      ),

    /** All open issues with their labels (for the explore batch). Only number, state, labels: no title or body. */
    openIssues: (token: string, repo: string): Promise<Issue[]> =>
      restList<Issue & Record<string, unknown>>(token, `repos/${repo}/issues?state=open`).then((list) => list.map(slim)),

    /**
     * The open issues with READY_LABEL. REST lists PRs here too; `choose` drops them.
     * Only the fields `choose` uses: no title or body stays in memory.
     */
    readyIssues: (token: string, repo: string): Promise<Issue[]> =>
      restList<Issue & Record<string, unknown>>(token, `repos/${repo}/issues?state=open&labels=${encodeURIComponent(READY_LABEL)}`).then((list) =>
        list.map(slim),
      ),
  };
}

export type GitHub = ReturnType<typeof gitHub>;
