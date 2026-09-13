# agent-kit

Versioned home of the personal agent workflow: the skill set that runs
multi-agent development on this machine, plus the approval-gate extension and
its adapters. Pi is the primary agent; Claude Code is the second agent; herdr
is the terminal multiplexer (workspace = project, tab = ticket, split panes =
implementer and reviewer); git worktrees give every ticket its own checkout.
Everything installed from this repo is a symlink back into it, never a copy:
the repo is the single source of truth and every installed piece points at a
commit.

## Layout

- `skills/`: one directory per skill, named after its slash command
- `extensions/pi/`: the pi approval-gate extension; its README records the
  install decision
- `extensions/claude/`: the Claude Code hook adapter; same
- `docs/research/`: research notes with every claim pinned to a verified
  source
- `scripts/install.sh`: the idempotent skill installer
- `.scratch/agent-kit/`: the plan, map, and ticket files that drive the build
  of this repo

The skill set, written by the tickets in `.scratch/agent-kit/issues/`:
`/clear-tone`, `/exploration`, `/to-tickets`, `/implement`, `/commit`, `/pr`,
`/interview`, `/coordinator`.

## The goal workflow

1. **Chart the work.** The user opens a coordinator agent session and runs
   `/exploration`. It produces a plan issue on the repo's tracker, turns open
   questions into decision tickets with blocking edges, and fires research
   subagents at chart time. It plans; it does not implement.
2. **Cut tickets.** `/to-tickets` converts the plan into vertical-slice
   tickets: each ticket delivers working user-facing behavior, foundation and
   feature in the same slice. Groundwork-only tickets are forbidden.
3. **Open a wave.** `/coordinator` takes the unblocked tickets. For each it
   creates a worktree and one herdr tab in the current workspace, splits the
   tab into an implementer pane and a reviewer pane, and starts an agent in
   each.
4. **Implement.** The implementer pane runs `/implement` with the ticket,
   follows it to the letter, and stops to ask when blocked. Commits happen at
   logical points through `/commit`: the message is presented in a fenced
   `commit-message` block and nothing is committed until the user replies with
   the approval word `approved`. The approval gate enforces this
   mechanically: an unarmed `git commit` (including `--amend`) or
   `gh pr create` is blocked with the protocol restated, commits on `main` are
   blocked outright, `git push` is never gated.
5. **Review.** When the implementer finishes, the coordinator relays the
   change to the reviewer pane. The reviewer reports findings, the coordinator
   routes them back to the implementer, and the loop repeats until the
   reviewer reports clean or either side blocks on a question only the user
   can answer, which the coordinator escalates.
6. **Open PRs.** `/pr` presents the PR text in a fenced `pr-message` block,
   waits for the approval word, then opens the pull request. The stacked
   option, basing the new PR on an open PR from this wave instead of `main`,
   is always presented.
7. **Tear down.** The user reviews, merges, and reports back. The coordinator
   then closes each merged ticket's tab and removes its worktree.
8. **Next wave.** When the user chooses, the next wave of tickets is stacked
   on the open PRs of the previous wave, so work continues while review and
   merge proceed in parallel.

## Installation

Skills: `scripts/install.sh` symlinks every `skills/<name>` directory into
`~/.agents/skills` and reports each action. It is idempotent (re-running
reports what is already linked) and refuses to touch any existing entry that
is not a symlink into this repo. It never removes anything; retiring
superseded skills is a separate, explicit step. Today `skills/` is empty, so
the installer is inert; it goes live as the skill tickets land.

Extensions, decided here and installed at cutover:

- pi: the extension is symlinked into `~/.config/pi/agent/extensions/`,
  this machine's pi agent directory (`PI_CODING_AGENT_DIR` is exported
  globally in the fish config, overriding pi's `~/.pi/agent` default).
  Uninstall is removing the symlink.
- Claude Code: hooks have no auto-discovered directory, so the hook script
  stays in this repo and is registered by absolute path in the user-scope
  `~/.claude/settings.json`. User scope because the approval policy applies
  machine-wide, not per project. The registration is a one-time settings edit
  made at cutover; the script itself is never copied.

Both adapters are specified in `docs/research/approval-gate-mechanics.md` and
built by the tickets in `.scratch/agent-kit/issues/`.
