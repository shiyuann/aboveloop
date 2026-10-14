/**
 * The only GitHub reads of the scripts: repo-scoped REST (`gh api repos/…`),
 * which works in every session. GraphQL does not (some cloud sessions block
 * GraphQL and REST outside their repos), so no script uses it.
 */
import { execFileSync } from "node:child_process";

const gh = (args: string[]) => JSON.parse(execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 << 20 }));

/** One REST resource, or every page of a list, as one array. */
export function rest<T>(path: string): T {
  return gh(["api", path]);
}
export function restList<T>(path: string): T[] {
  const sep = path.includes("?") ? "&" : "?";
  return (gh(["api", `${path}${sep}per_page=100`, "--paginate", "--slurp"]) as T[][]).flat();
}

export const openPrs = <T>(repo: string) => restList<T>(`repos/${repo}/pulls?state=open`);
export const openIssues = <T>(repo: string) => restList<T>(`repos/${repo}/issues?state=open`);
export const readyIssues = <T>(repo: string, label: string) =>
  restList<T>(`repos/${repo}/issues?state=open&labels=${encodeURIComponent(label)}`);
/** The names of the repo's branches that start with `prefix`. */
export const branchesUnder = (repo: string, prefix: string) =>
  restList<{ ref: string }>(`repos/${repo}/git/matching-refs/heads/${prefix}`).map((r) => r.ref.replace(/^refs\/heads\//, ""));
