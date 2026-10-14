# Knowledge base index

This folder holds the design of aboveloop. All pages are in ASD-STE100 Simplified Technical English (the rules are in `entry`). The terms are in [L2-loops §0](spec/L2-loops.md#0-terms). The rules for levels, the graph and conflicts are in `entry` (knowledge-base).

- **`spec/`**: how it must work (the target), in three levels. The level is the start of the file name. A part that is not built yet has a ⬜ mark.
  - **L1**: why aboveloop exists, for whom, and the principles. Only the owner changes it. Every session reads it.
  - **L2**: the key decisions, each with its reasons (Why).
  - **L3**: the details of how it must work.

## Pages and what they build on

This table is the only dependency graph. "Builds on" names the pages that a page comes from, and the L1 items that it cites. A page builds only on pages of its own level or a higher level, with no loops. When you change a page, examine each page whose "Builds on" names it. A change of words only (a typo, a link) does not count.

| Page | What it holds | Builds on |
| --- | --- | --- |
| [spec/L1-foundation.md](spec/L1-foundation.md) | Who aboveloop is for, what it is. Principles P1–P6 (product) and E1–E5 (engineering) | — |
| [spec/L2-release.md](spec/L2-release.md) | A release is a tag; the order of `prerelease`; why the tag push is the only trigger; jobs on a schedule run the latest release; the changelog; what a release removes (§2.8); the project configuration `.agents/prerelease.md`; each project's release | L1-foundation (P1, P3, P4, P5, E1), L2-loop-untrusted-text (R15) |
| [spec/L2-plugin.md](spec/L2-plugin.md) | The plugin on the Mac, a clone in the cloud, `entry` as the only start, what is in the repo, versions, the release of aboveloop | L1-foundation (P3, P5), L2-release, L2-loops |
| [spec/L2-loops.md](spec/L2-loops.md) | The two levels: the inner builder loop and the outer dev loop. Terms, the overview charts; the dev loop: the briefing (a design that aboveloop does not implement), `start`, the graph of open work, when the owner acts; how the inner loop connects, the jobs, names | L1-foundation (P1, P2, P3, P4, P6, E4) |
| [spec/L2-loop-architecture.md](spec/L2-loop-architecture.md) | The platforms and why; routines: how each job starts | L1-foundation (P3, P6, E2, E3, E4), L2-loops, L2-release |
| [spec/L2-loop-untrusted-text.md](spec/L2-loop-untrusted-text.md) | Inputs I2–I3, harmful results H3–H5 and H7, requirements R1, R3, R5–R7, R13–R15, R17 and R19–R23, accepted risks A1–A4 | L1-foundation (P2, E1, E2), L2-loops |
| [spec/L2-loop-builder.md](spec/L2-loop-builder.md) | The builder loop: the life of an issue in two modes (semi-automatic, automatic), one text for explore and one for the code step; self-contained issues; the labels `explored` and `ready-for-auto-builder`; label families; the branch, PR and plan of an issue; what the automatic mode can change in the spec; the owner's part, with the two forms of the deep-verify before a spec review | L1-foundation (P1, P2, P3, P4, E1), L2-loops, L2-release, L2-loop-untrusted-text (R13, R15, R22, R23, A2, H4, H5) |
| [spec/L3-loop-builder.md](spec/L3-loop-builder.md) | `builder-resolve`: explore and implement; `explore.md` and `implement.md`, each one text that both modes read; the code step in both modes: the mode test and the differences of the modes (§1.3); B1 | L2-loop-builder, L2-loop-untrusted-text (R13–R15, R23) |
| [spec/L3-loop-components.md](spec/L3-loop-components.md) | Every component and where it is: global, and for each app | L2-loop-architecture, L2-loops, L2-loop-builder, L2-loop-untrusted-text (R5, R6) |
| [spec/L3-loop-workflow.md](spec/L3-loop-workflow.md) | The workflow `loop.yml`: steps, schedule, agents, prompt, cost, the owner's part, W4–W12 | L2-loop-architecture, L2-loops, L2-loop-untrusted-text (R1, R5, R7), L2-release |
