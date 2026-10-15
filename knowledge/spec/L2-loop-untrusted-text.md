# Untrusted text

> A risk analysis of text that a person other than the owner can write: the inputs (I codes), a chart for each harm (H codes) with its stops, the design requirements (R codes) with their status, and the accepted risks (A1–A4 and A6). It applies E1 and E2; the owner accepted the risk of H5 (A1), and the App key in the implement run (A6).

Marks: ✅ built · 🔶 partly built · ⬜ not built.

## Summary

- **Untrusted text is text that a person other than the owner can write.** It comes from two inputs: web pages (I2), and text on GitHub that quotes them (I3). The code and the files on `main` are trusted by rule, with two exceptions (§1).
- **Four harms can occur** (§2): noise on GitHub (H3), a bad change that reaches the users (H4), a leak of the keys of a repo (H5), and cost (H7). Each has a chart from the input to the harm, with the stops on its path, and a worst case.
- **The worst harm is H5: the keys of a repo leak.** On the path from an issue, explore (R13), the owner (when the project's Auto-ready rules do not include the issue) and implement (R14) can stop it. No agent of the loops can push a workflow file (R5). The owner accepted the risk that is left (A1).
- **Each agent gets the least access, and each skill examines what goes out** (§3: R5–R7, R21). The network stays open (A3).
- **The merge of the owner is the gate** (R15, P2). It is a rule of the skill: GitHub Free has no branch protection, and each project examines who pushed before its keys.
- **Limits on volume and money stop the cost** (R19). The owner accepts five risks (A1–A4 and A6, at the end of §3).

```mermaid
flowchart TB
  I2["I2 Web pages"] -->|a script of a project<br/>copies page text| I3["I3 Text on GitHub"]
  I2 --> EX
  I2 --> IM
  I3 --> EX["/builder<br/>explore"]
  I3 --> IM["/builder<br/>implement"]
  EX -->|wrong<br/>ready-for-auto-builder| IM
  EX --> H3["H3 Noise on GitHub"]
  IM --> H4["H4 A bad change<br/>reaches the users"]
  IM --> H5["H5 The keys of a repo leak"]
```

Read the chart from the top: an input, the agent that reads it, the harm that the agent can cause. Each harm has its own chart in §2, with the stops on the path. The cost (H7) can come from each agent.

## 1. The inputs

Untrusted text is text that a person other than the owner can write. An agent that reads it can do what the text tells it to do, if the agent does not see that the text contains instructions.

- **I2 Web pages.** Anybody who controls a page: the official site of an event, a source of a project's pipeline, a site that an issue names.
  - Who reads it: all agents can open web pages. The network policy of the cloud agents allows all addresses.
  - Explore and implement open them to research and to repair. A script of a project can copy page text into an issue, where it becomes I3.
  - The same open network lets an agent send what it holds to any address. R21 is the stop, and A3 is the risk that is left.
  - A page can hide text for agents, for example in white text or in a comment.
- **I3 Text on GitHub that quotes I2.** Issue bodies, comments, Explore sections and PR bodies.
  - Who writes it: the owner, the agents, and the scripts of a project. Only these can write in a private repo.
  - Why it is untrusted: a script can copy page text into an incident, and an agent copies untrusted text into what it writes.
  - The author does not make the text trusted. GitHub shows the author of an issue, a comment or a PR (`<your GitHub App>[bot]` for the agents in CI). But an agent copies untrusted text into what it writes.
  - The author of a commit does not show the agents in CI: implement's commits carry the owner's login (measured, L3-loop-workflow W8). Only the PR author and the pushers of the branch (GitHub's activity API) show the work of implement (R23).
  - The work of the implement run on the branch of an issue is I3 too: the code, the plan and the spec. Its plan stays I3 also after the plan is on `main`.
  - Two more readers read I3: an agent in a session of the owner (session explore, the session entry of `dev`, a session that continues a branch of the implement run), and `prerelease`.
  - A session has the owner's GitHub login and local keys. So its agent examines that work as data before it runs code or follows a plan from it (R23, A4). `prerelease` does not read issue text (L2-release §2.7).
  - The briefing ([L2-loop-dev §2](L2-loop-dev.md#2-the-briefing)) is a design that aboveloop does not implement. An implementation reads I3 too, and treats it as data (E1).

**Trusted text.** These are trusted:

- The code and files on `main`, with two exceptions:
  - A plan that the implement run wrote: it is I3 (R23).
  - The graph of open work `knowledge/plan/index.md`. It is on `main`, but a session uses it only for order and takes no instruction from it. Why: the agent writes it from issues and plans that can carry untrusted text (R23).
- The project's `.agents/*.md`.
- The skills of aboveloop.

They are trusted by rule (P2): an agent with write access can push `main`, and the push record finds a push that the owner did not make (R15).

## 2. The harmful results

Each chart starts at an input and ends at the harm. A diamond is a stop: the chain continues only on the "no" arrow. The R numbers are the requirements of §3.

#### H3 Noise on GitHub

```mermaid
flowchart LR
  A["I3 issue text"] --> G["explore<br/>does what the text says"]
  G --> H["H3 Wrong comments, labels,<br/>Explore sections,<br/>duplicates closed"]
  H --> O["The owner sees each change<br/>on GitHub"]
```

- **Worst case:**
  - A wrong `ready-for-auto-builder` costs one implement run and one PR. The number of PRs that wait at one time has a limit (R19).
  - A wrongly closed duplicate stays on GitHub, and the owner can open it again.
  - A wrong Explore section can hide a real problem until the owner reads the issue.
- **No stop prevents it.** The limit is R5: the token of explore cannot write code. Thus the damage stays on GitHub, where the owner sees it.
- No agent of the loops has a clone of the Cursor GitHub App. Each starts with no repos and clones with a token of the GitHub App of the loops, narrowed to its job. Only implement's token can write.

#### H4 A bad change reaches the users

```mermaid
flowchart LR
  A["I2 or I3"] --> M{"implement refuses<br/>the issue? (R14)"}
  M -->|yes| R["Refusal comment"]
  M -->|no| P["A PR with a bad change"]
  P --> O{"The owner merges? (R15)"}
  O -->|no| X["Stops"]
  O -->|yes| H["H4 Bad code on main"]
  M -.->|"pushes to main<br/>(no branch protection)"| H
  E["Explore writes a claim<br/>about data"] --> V{"The project's script<br/>confirms it with a trusted<br/>source? (R17)"}
  V -->|no| X2["Rejected"]
  V -->|yes| OK["Correct data goes live"]
```

- **Worst case:** the owner merges a PR whose fault the evidence does not show.
  - Or implement pushes to `main` directly, or merges its own PR through REST. Private repos on GitHub Free have no branch protection, so only the skill keeps implement on its own branch (R15, P2).
  - Its own token can write its project (Contents write; the merge endpoint needs only that).
- **A push of `main` or a tag also starts the project's own workflows that hold keys,** and they run the pushed code. Each such workflow examines who pushed before its keys (R15). For example:
  - A project releases from the owner's Mac, so a tag starts no workflow.
  - A project's jobs with keys on GitHub run on a schedule, by hand or on a pull request, not on a push. A job on a pull request runs the code of `main`.
  - A release workflow runs a job with no key first, and the release job runs only when it passes.
- **Data:** a project script that acts on text from an agent must examine it against a trusted source first (R17). With this rule, a false claim stops at the script.

#### H5 The keys of a repo leak

```mermaid
flowchart TB
  A["I3 Issue with page text<br/>(a script of the project copied it)"] --> E{"Explore sees<br/>instructions? (R13)"}
  E -->|yes| EN["Says so in Explore;<br/>no ready-for-auto-builder"]
  E -->|no| W{"ready-for-auto-builder:<br/>the project's Auto-ready rules,<br/>or the owner adds it?"}
  EN --> O{"The owner adds<br/>ready-for-auto-builder?"}
  O -->|no| X["Stops"]
  O -->|yes| M
  W -->|no| X
  E -.->|"misled: adds<br/>ready-for-auto-builder anyway"| M
  W -->|yes| M{"implement refuses<br/>the issue? (R14)"}
  P["I2 A page with instructions,<br/>read while it repairs an issue"] --> M
  M -->|yes| R["Refusal comment, stops"]
  M -->|no| PW{"Its token can push<br/>a workflow file? (R5)"}
  PW -->|no| X3["GitHub refuses the push;<br/>a push of main or a tag: see H4"]
  PW -.->|"yes: a clone of the<br/>Cursor GitHub App (A1)"| L["H5 GitHub runs that workflow at the push,<br/>with the repo secrets: the keys can<br/>leave before any PR or merge"]
```

- **What makes the last step possible.**
  - A repo secret reaches every workflow that runs in the repo, on any branch (not on forks).
  - A workflow runs from the branch that is pushed, at the push.
  - The Cursor GitHub App can write workflow files (measured: `workflows: write`). Only the owner's own Cursor cloud agents get its clones, not the agents of the loops.
  - GitHub environments that only `main` can use would close the path, but GitHub Free has them only for public repos.
- **No agent of the loops can push a workflow file.** The agents of the loops start with no repos and clone with narrowed tokens. Only implement's token can write, and it has no `workflows` permission (R5).
  - Measured: an agent with no repos has no GitHub credential, GitHub refuses a workflow file from a token with no `workflows`, and a read token clones and cannot push.
- **Two paths reach implement.** A third path needs no workflow file: see H4 (a push of `main` or a tag starts a workflow that already holds keys).
  - From an issue: explore is the first stop (R13). Explore's rule not to add `ready-for-auto-builder` is in the skill, not in code: the workflow does not examine who added the label (A2). The dotted arrow is this case. When the project's Auto-ready rules do not include the issue, the owner is a stop too.
  - From a web page, on an issue that the project makes Auto-ready (for example a pipeline incident): the owner is not on this path. The stops are explore and implement (R13, R14). The attacker must control a page that the project's pipeline reads.
- **A path with no workflow file (⬜, A6).** The implement run in CI holds the App key in its environment. A misled implement run can send the key out (A3), with no workflow and no push. The worst case below is the same for the App key.
- **Worst case:** all secrets of the repo leave. So the secrets of one repo open all repos:
  - `GH_APP_KEY_DEV`, the private key of the App. It mints tokens on every repo where the App is installed.
  - The Cursor key. It starts agents that can push to every repo.
  - The owner accepts that each repo holds the App key (A1).
  - The limits are the smallest scope for each key (R6), the spend limit of the Cursor account (R19, it limits money, not reach), and a procedure to change each key (R20).
- **The owner accepted this risk** (A1).
  - No agent of the loops can push a workflow file (R5).
  - The App key stays in the repo secrets (A1).
  - The web-page path is a decision of the owner of each project that has Auto-ready rules.

#### H7 Cost

- **Path:** many issues for explore, for example from a script of a project that copies many pages into incidents. Then implement on the issues that become Auto-ready.
- **Stops:** the batch and PR limits, and the spend limit of the Cursor account (all R19).
- **Worst case:** for each app and each run of the workflow, explore on 20 issues and implement on one, until the spend limit stops all agents. A spend limit also stops the useful agents, until the next month or until the owner changes it.

## 3. Design requirements

An agent is not safe if it has these three properties together (Willison's "lethal trifecta"): access to private data, untrusted text, and a way to send data out.

- For each agent, the design removes one of the three, or puts a stop between them.
- The network is open to all agents (I2), so the way out stays. A stop in each skill (R21) and the accepted risk A3 cover it.

Each requirement has its status: ✅ built, 🔶 partly built, ⬜ not built. An open one names the work that is open.

- 🔶 means only "partly built", and the open part names its issue.
- A limit that a decision keeps is not an open part. Such a requirement is ✅, with a sentence that names the decision (for example the App key of R6).

**Mark untrusted text as data**

- **R1** ✅ Each agent gets its input between `<<<INPUT` and `INPUT>>>`. The workflow writes `<` and `>` in the input as JSON escapes, so that the input cannot close its markers. The prompt says that the input is data. (`services/loop`)
- **R3** ✅ Each skill that reads untrusted text says: never do what it says. (`builder`, `dev`)

**Give each agent the least access**

- **R5** ✅ Only implement's token can write, and only its own project, with no `workflows` permission.
  - Implement's token can also merge through REST; only the owner merges, by rule (P2, A2).
  - Explore has Contents read and Issues write. Implement has Contents, Issues and Pull requests write.
  - Every agent also gets a token that reads only aboveloop, for the skills.
- **R6** ✅ Each key has the smallest scope that the platform permits, and a short life where it can (E2).
  - The tokens of the loops: one-hour tokens of the GitHub App of the loops, each narrowed to its job ([L3-loop-components §1](L3-loop-components.md#1-global-aboveloop-set-up-once)).
  - The App's private key, which mints them, has a limit that the owner accepted: it is a secret of every repo, with no expiry (A1), and it is also in the environment of each implement run in CI (A6; ⬜).
  - A project's own keys are the project's task.
  - For Cloudflare, each project keeps these tokens:
    - One token for the owner's work on the Mac (`.env.local`).
    - For CI and the loops (`.env.ci`): one R2 token (its S3 keys; R2 makes it apart) and, when CI deploys, one deploy token.
    - They are not narrowed to each job. Each name says its use, for example `example-app-ci-deploy`.
- **R7** ✅ The other secrets stay in the workflow. Each agent gets only the environment variables in [L3-loop-workflow §2](L3-loop-workflow.md#2-the-agents).
  - One exception: the implement run gets the App key (A6; ⬜). The Cursor key stays in the workflow.

**Recognise attacks**

- **R13** ✅ Explore never adds `ready-for-auto-builder` when the text has instructions, or when the change touches keys, CI, permissions, other repos, L1 or the content of L2. Who adds and removes the label, in full: [L2-loop-builder §3](L2-loop-builder.md#3-the-labels-explored-and-ready-for-auto-builder); the levels: [L2-loop-builder §6](L2-loop-builder.md#6-what-the-automatic-mode-can-change-in-the-spec-).
- **R14** ✅ Implement refuses an issue that it cannot trust: it writes a comment and removes `ready-for-auto-builder`. The stops of the implement run, and why no wait is necessary: [L2-loop-builder §3](L2-loop-builder.md#3-the-labels-explored-and-ready-for-auto-builder).
- **R22** ✅ The automatic mode changes only L3 and the words of L2; the rule files `AGENTS.md`, `.agents/*.md` and the rules in `skills/` count as L2. Why, and the owner's read of the spec diff before the merge: [L2-loop-builder §6](L2-loop-builder.md#6-what-the-automatic-mode-can-change-in-the-spec-).
- **R23** ✅ Before a session runs code or follows a plan that the implement run wrote, its agent examines the diff of that work as data: tests, scripts, `Makefile`, `package.json` scripts, CI, and the plan.
  - It stops on a change that the issue does not need, as R14 says, and tells the owner why.
  - The owner does not read the diff first (A4).

**Keep the owner at the gates**

- **R15** ✅ Only the owner merges a PR of the loops; the agent merges a small change ([L2-loop-builder §2.1](L2-loop-builder.md#21-where-issues-come-from)) when its checks pass (P2).
  - This is the rule of the skill. GitHub does not enforce it: private repos on GitHub Free have no branch protection.
  - This is a limit that a decision keeps: the owner accepts it, with the reasons that P2 names ([L1-foundation P2](L1-foundation.md#p2-the-owner-merges-every-pr-of-the-loops); A2).
  - The token of implement has Contents write on its project. So implement can push `main` and push its own merge commit.
  - A Cursor service account does not help. It is on the Enterprise plan only, and it pushes through the same App.
  - **The project examines it.** A workflow on each push records who pushed, and a job with keys stops when the code that it runs was not pushed by the owner. Each project with keys on `main` does this.
  - **aboveloop:** each `loop.yml` runs only the release that the release variable `RELEASE` of aboveloop names, when the tag of that name is still at the SHA of the variable and `main` reaches it ([L2-release §0](L2-release.md#0-terms), §2.3).
    - Only the owner's `gh` login on the Mac writes the variable, in `prerelease` after the push.
    - No token of the loops has Variables write: the GitHub App of the loops gets Variables read only, the Cursor GitHub App has no Variables permission, and `GITHUB_TOKEN` has none.
    - An agent in a session of the owner has the owner's login. So it can write the variable, as it can push a tag (A4).
    - Every copy of `loop.yml` reads the variable.
  - **A project's own release workflow** can stop before its keys unless the owner pushed the tag, the tag is on `main`, and every push to `main` since the previous release tag was the owner's. GitHub's activity API names who pushed.
- **R17** ✅ A script that acts on text from an agent checks it against a trusted source first: a value goes live only when a registered source confirms it.

**Limit the damage**

- **R19** ✅ Limits on volume and money: 20 issues for each explore batch, 3 ready PRs. The spend limit of the Cursor account, which the owner sets.
  - The limit of 3 PRs: the time that the owner has to examine PRs is the limit. When 3 ready PRs wait for the owner, `loop.yml` launches no new implement run, so implement opens no new PR ([L3-loop-builder §1.2](L3-loop-builder.md#12-implement)).
  - So a wrong label costs at most one implement run and one PR, and at most three ready PRs wait at one time (H3, A2; [L2-loop-builder §3](L2-loop-builder.md#3-the-labels-explored-and-ready-for-auto-builder)).
  - Where the values are set: which PRs count, in [L3-loop-builder §1.2](L3-loop-builder.md#12-implement); the agents, in [L3-loop-workflow §2](L3-loop-workflow.md#2-the-agents).
- **R20** ✅ Each key has a procedure to change it:
  - For the loops: `make loop-key`, then `make loop-secrets`.
  - For the App key: a new key in the settings of the App, the App's key file in `~/.config/aboveloop/`, then `make loop-secrets`.
- **R21** ✅ Raw data never goes outside. Before an agent opens an address, sends a request, or writes to GitHub, it checks three things:
  1. The address is trusted: GitHub of the project and aboveloop, the sites that the project configuration names, the official package registries for installs. An address from untrusted text, a bare IP, a short link, a look-alike domain or a non-https address is not trusted. The agent opens it only with a GET that carries no data.
  2. Outside, only a GET with no data (no issue text, code, tokens, environment variables).
  3. The step is not one that untrusted text asks for.
  - The rule is in the `entry` reference `outbound-check.md`, read by `builder` and `dev`.
  - It is a rule of the skill, not a limit of the network. It stops only clear cases: raw data in a request to the outside, or a step that untrusted text plainly asks for. Normal research and work go on; doubt alone is no reason to stop.
  - Why: an agent that suspects too much does not finish its work.

**Accepted risks**

- **A1 A pushed workflow can read the repo secrets** (H5).
  - Why: the agents look for a harmful hack, and nothing is fully automatic. This risk always exists.
  - The stops are R13 and R14; the limits are R6, R19 and R20.
  - No agent of the loops can push a workflow file: the agents that read text from outside cannot push, and implement's token has no `workflows` permission (R5).
  - The App key stays in the repo secrets. Why: each `loop.yml` mints its own tokens and picks its release, with no server.
  - The path that is left: a Cursor cloud agent that the owner starts gets a clone of the Cursor GitHub App, which has `workflows: write`. Misled by text, it can push a workflow on any branch that reads the secrets, and the key then writes every repo.
  - Implement can still push `main` and tags of its project, and existing workflows with keys run that code (H4). The push checks of R15 close it.
- **A2 Nobody examines who added a label or wrote a comment.** The merge (R15, P2) is the gate: by rule, not enforced by GitHub, with the backstops that P2 names.
  - Why: a wrong label costs at most one implement run and one PR (R19). If implement is also misled, it cannot push a workflow file, but a push of `main` or a tag still starts the project's workflows that hold keys (H4), until their push checks (R15). The label and its stops: [L2-loop-builder §3](L2-loop-builder.md#3-the-labels-explored-and-ready-for-auto-builder).
  - GitHub can show the author (the agents in CI act as `<your GitHub App>[bot]`), and the owner keeps A2. Why: explore has screened the issue before implement reads it, and the push record shows a push.
- **A3 The network of the agents is open** (I2).
  - Why: no limit on the network. Each skill has a step that detects malicious text, verifies that an address is reliable, and never sends raw data to an outside address.
  - The stop is R21, in each skill. The model's judgment is the stop.
  - Worst case: a misled agent sends what it holds to any address:
    - For explore and implement: private code and their one-hour token.
    - For implement: also a one-hour token that can push `main` and tags of its project and merge, and the App key, with no expiry (A6; ⬜).
- **A4 A session continues a branch that the implement run wrote** (I3, H5). The agent of the session examines that work as data before it runs anything from it (R23). The owner does not read it first.
  - Why: the builder agents use the latest models, and damage control limits the rest; the owner does not review all code.
  - The stops before it: explore does not hand such an issue to CI (R13), implement refuses it (R14), and the agent of the session examines the diff (R23).
  - Worst case: a change that all three miss runs on the owner's Mac with the owner's GitHub login and local keys.
- **A6 The implement run in CI holds the private key of the App** (⬜; H5).
  - What it holds: `GH_APP_KEY_DEV` and the App ID, in the environment of the run and of its subagents. Its token script mints a token narrowed to its repo and the permissions of implement, for one hour, when the current one runs out ([L3-loop-workflow §2](L3-loop-workflow.md#2-the-agents)). The script narrows each token, but the agent holds the key, so the narrowing is not a stop.
  - What a leak gives: tokens with every permission of the App on every repo where it is installed, until the owner makes a new key and deletes the old one (R20). The App has Contents write (push any branch, `main` and tags; merge), Issues and Pull requests write, and Variables read ([L3-loop-components §1](L3-loop-components.md#1-global-aboveloop-set-up-once)). So the private code and the issues of every installed repo can leave.
  - What a leak does not give: the App has no permission for workflows, administration or secrets. So no workflow file, no repo setting and no secret changes. A merge cannot be removed at the level of the App: GitHub puts the merge under Contents write, the same permission as a push. So "only the owner merges" stays a rule (R15, P2).
  - Why: a heavy spec in CI works longer than the hour of a token, and loses its work at the hour (L3-loop-workflow W13). The owner accepts the risk. The builder already has wide access on the owner's machine, and a fully automatic run has more risk; no known measure guarantees absolute safety, because the work needs the internet to write code. The examination of an issue before the work is the stop.
  - The stops: the examination of an issue before the work (explore R13, implement R14, and the owner when the project's Auto-ready rules do not include the issue), the network check of each skill (R21), and the limits of the App above.
  - The owner marks it as a known risk, to look for a better way later.
  - Not chosen: a long-lived personal token (it acts as a person, and a fine-grained one cannot act on another person's repo); a paid plan of GitHub (it needs the repos in an organization).
