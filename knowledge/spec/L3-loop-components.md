# Components

> Every part that the loops in CI need, and where it is: the global parts (set up one time) and the parts of each app (`setup-app`; its script `scripts/check.sh` examines them). Why these platforms: [L2-loop-architecture §1](L2-loop-architecture.md#1-platforms).

All the parts that the loops in CI need. **Global** parts are set up one time, in aboveloop and the accounts of the owner (§1). **Each app** has its own copy of the other parts; the skill `setup-app` sets them up, and its script `scripts/check.sh <owner>/<repo>` examines them (§2).

"Where" always starts with the platform: `GitHub ›`, `Cursor ›` or `Local ›` (the Mac of the owner). `<app repo>` is the repo of the app.

## 1. Global: aboveloop, set up once

**GitHub**

- **Composite action `services/loop`.** The code of every workflow `loop.yml`: it selects the work and launches the cloud agents ([L3-loop-workflow §1](L3-loop-workflow.md#1-the-workflow-loopyml)).
  - Where: `GitHub › aboveloop › services/loop/`
  - Where: `GitHub › aboveloop › Settings › Actions › Access` = "none": each `loop.yml` checks out the action at the latest release with a token that reads aboveloop, so no repo needs to use the action of aboveloop by name.
- **Reference workflow.** Each app gets a copy of it.
  - Where: `GitHub › aboveloop › skills/setup-app/references/loop.yml`
- **Workflow `tag-record.yml` of aboveloop.** It runs on each release tag push; its run's actor is the record of who pushed the tag (L2-release §0).
  - Where: `GitHub › aboveloop › .github/workflows/tag-record.yml`
- **The GitHub App of the loop.** One App on every repo ([L2-loops §5](L2-loops.md#5-names-and-domains)), with Actions read, Contents write (for implement), Issues write and Pull requests write; no Workflows. No token is kept: each run of `loop.yml` mints one-hour tokens from it (`actions/create-github-app-token`), each narrowed to its use: for every agent, aboveloop only with Contents read (the skills); for explore, the repo with Contents read and Issues write; for implement, the repo with Contents, Issues and PRs write, and no `workflows` (R5). The agents act as the bot of the App.
  - Where: `GitHub › account › Developer settings › GitHub Apps › <your GitHub App>`; its private key: the App's key file in `Local › ~/.config/aboveloop/`, and the repo secret `GH_APP_KEY_DEV` of each repo (the key has no expiry and every permission of the App on every installed repo; the owner accepts this, A1 in [L2-loop-untrusted-text §3](L2-loop-untrusted-text.md#3-design-requirements)); the ID: the repo variable `GH_APP_ID_DEV`
- **Cursor GitHub App.** Not used by the loops: their agents start with no repos and clone with tokens of the GitHub App of the loop. It stays on the repos for the owner's own Cursor cloud agents.
  - Where: `GitHub › account › Applications › Cursor` (installed on aboveloop; each app adds its repo, if the App is not on all repositories)

**Cursor**

- **Cloud Agents API key `CURSOR_API_KEY`**, and a **spend limit**.
  - Where: `Cursor › dashboard › API keys`; `Cursor › dashboard › Spending`
- **Cloud agents** ([L3-loop-workflow §2](L3-loop-workflow.md#2-the-agents)): `builder-resolve` explore; `builder-resolve` implement. Explore can start subagents (B1). Nothing to set up for them.

**Local**

- **The keys, stored one time.** Never in a repo or a chat.
  - Where: `Local › ~/.config/aboveloop/loop.env` (never in the aboveloop folder, which `claude plugin update` copies): `CURSOR_API_KEY` (the owner edits the file, or runs `make loop-key NAME=CURSOR_API_KEY`), and `GH_APP_ID_DEV` (the owner edits the file, or runs `make loop-key NAME=GH_APP_ID_DEV`); and the App's key file beside it

**Skills** (all in `GitHub › aboveloop › skills/`): `builder-resolve` runs as cloud agents; `setup-app` runs in a session of the owner.

## 2. Each app: `setup-app`

- **Workflow `loop.yml`.** The only trigger of the loops in CI in the app, a copy of the reference workflow, byte for byte. It finds the latest release tag of aboveloop that the owner pushed, and runs the action from a checkout at it.
  - Where: `GitHub › <app repo> › .github/workflows/loop.yml`
- **Labels:** `explored` and `ready-for-auto-builder` ([L2-loop-builder §3](L2-loop-builder.md#3-the-labels-explored-and-ready-for-auto-builder)), and the family `Kind:` ([L2-loop-builder §4](L2-loop-builder.md#4-labels-that-describe-an-issue)). `setup-app` makes the labels of `references/labels.tsv`, and one `Kind:` label for each kind of the project.
  - Where: `GitHub › <app repo> › Issues › Labels`
- **Merged branches are deleted** ([L2-loop-builder §5](L2-loop-builder.md#5-the-branch-the-pr-and-the-plan-of-an-issue-)).
  - Where: `GitHub › <app repo> › Settings › General › Pull Requests › Automatically delete head branches`
- **Repo secrets**, copied from `Local › loop.env` with `make loop-secrets REPO=<app repo>`.
  - Where: `GitHub › <app repo> › Settings › Secrets`: `CURSOR_API_KEY`, `GH_APP_KEY_DEV`; `Settings › Variables`: `GH_APP_ID_DEV`
- **Configuration of `builder-resolve`**: the kinds of issue, the Auto-ready rules, the tests, the evidence.
  - Where: `GitHub › <app repo> › .agents/builder-resolve.md`
- **Access** (the owner).
  - Where: `GitHub › account › GitHub Apps › <your GitHub App> › Install App`: `<app repo>` in its repositories (`check.sh` asks GitHub as the App)
  - Where: `GitHub › account › Applications › Cursor`: `<app repo>` in the repository access, for the owner's own Cursor agents, not the loops (`check.sh` cannot read it)
