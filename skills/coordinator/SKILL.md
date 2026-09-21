---
name: coordinator
description: "Run waves of build tickets end to end: one git worktree and one herdr tab per unblocked ticket in the current workspace, implementer and reviewer agents (Pi or Claude Code) in split panes, review firing at each AWAITING APPROVAL before the approval word so every commit lands exactly as reviewed (layered commits at logical points are the default), sentinel polling every 30 seconds, verbatim relaying of approvals, answers, and review findings, PRs through /pr with the stacked option always presented, and teardown after merges with ticket outcomes recorded first. The coordinator never implements ticket work; infrastructure operations are in scope."
disable-model-invocation: true
---

# Coordinator

Drive waves of build tickets from the tracker through herdr-tabbed agents
until their branches merge. One wave cycles through spawn, relay loop,
review, PR step, teardown, next wave. The coordinator orchestrates; the tab
agents implement and review.

## Workflow position

The coordinator is the **delivery phase** of the build workflow. The phases in order:

1. **`/exploration`**: a loose idea becomes a settled design, worked as decision tickets with the owner.
2. **`/to-tickets`**: the settled design is sliced into tracer-bullet implementation tickets with blocking edges.
3. **`/coordinator`** (this skill): deliver those tickets as the waves this document defines.
4. **`/implement`** and **`/code-review`**: the skills each tab agent applies, one ticket per agent, review before any approval.

The tracker this skill drives holds implementation tickets written by `/to-tickets`: each one a functional deliverable, Status `ready-for-agent` or `open`. Decision tickets (the exploration effort's own tickets, whose resolution is a decision) are not build tickets and never enter a wave. When a wave hits an unsettled decision, the implementer's BLOCKED relays it to the owner, and the answer lands in the exploration effort, not in the ticket.

## Role and discipline

The coordinator never implements ticket work. It writes none of the code,
docs, or content a ticket delivers.

Infrastructure operations are in scope, and the coordinator performs them
itself: git plumbing (worktrees, branches, history surgery, wipes), repo and
remote management, tracker upkeep (claims, PR records, resolutions, map
lines), PR mechanics, and tab and agent lifecycle in herdr.

## Herdr ground rules

- Run inside a managed pane: `test "${HERDR_ENV:-}" = 1`. A managed pane
  carries `$HERDR_WORKSPACE_ID` (the current workspace), `$HERDR_TAB_ID`,
  and `$HERDR_PANE_ID`. If the test fails, stop: there is no current
  workspace to place tabs in.
- Never run bare `herdr`: it launches the TUI.
- Never probe a mutating command by omitting arguments; several are valid
  with defaults and will execute.
- Worktree lifecycle is plain git, never `herdr worktree create` or
  `herdr worktree remove`: herdr surfaces a worktree as its own workspace,
  and the wave lives in the current workspace.
- Focus is never stolen. `tab create` and `pane split` always pass
  `--no-focus`. `herdr agent focus` and `herdr tab focus` are used only when
  handing control to the user; focusing is also what marks a tab seen, so it
  is never a polling step. CLI reads (`agent list`, `agent get`,
  `agent read`, `agent wait`) do not mark anything seen; poll freely.

## The agent kind

The tab agents are Pi (`--kind pi`) by default. The user may name another
kind at invocation; `herdr agent start --kind` lists what herdr supports,
and `claude` is the other kind this skill documents. The kind is recorded
in the wave state at spawn, because it decides two things and nothing else:

- **How the agents start.** A kind needing environment (Claude Code reading
  a non-default config directory) gets it exported into the pane before
  `agent start`, since `--kind` takes no environment and `-- <AGENT_ARG>...`
  passes arguments only.
- **How the coordinator is woken.** The relay loop's wake mechanism belongs
  to the coordinator's own runtime, not the tab agents': a Pi coordinator
  uses the watcher extension, a Claude Code coordinator uses `Monitor`. The
  two are interchangeable and never both armed.

Everything else in this document is identical across kinds: the sentinels,
the review protocol, the approval word, the PR step, and teardown. A wave
may not mix kinds; one wave, one kind.

## The approval gate

The fence protocol is prompt-level discipline until something enforces it.
The `approval-gate` engine
(`~/Code/agent-kit/extensions/approval-gate/core.mjs`) is that enforcement,
and it is Claude Code hooks (`Stop`, `UserPromptSubmit`, `PreToolUse`),
so it binds Claude agents only. Registered, it arms on the approval word
and lets exactly one gated `git commit` or `gh pr create` through per
approval, matching the payload against the fenced text.

Register it per project, never machine-wide: the gate also refuses
`git commit` on `main` outright, and a user-scope registration imposes that
on every unrelated session. Project scope is `.claude/settings.json` in the
repo root, gitignored, which means the worktrees need it copied in
(worktree creation, below). The gate's own README documents the hook
registration JSON; read it rather than reconstructing the wiring.

Its absence is not a blocker. An unregistered gate costs enforcement, not
correctness: the protocol still reads the same to the agents.

A refused commit is the gate working, and the coordinator diagnoses it from
the state file rather than from the agent's account of it. An implementer
that reads the state directory mid-write sees an empty directory and
reports a broken gate; the ordinary cause is an approval that arrived
before the fence was recorded (approvals, below), which no agent can see
from inside its own session.

## Invocation and wave selection

Invoked with the effort's tracker root (local markdown:
`.scratch/<effort>/` holding `map.md` and `issues/NN-<slug>.md`). Load the
map. The wave is the ready queue: every build ticket (the vertical slices
/to-tickets published) whose Status marks it unclaimed and whose Blocked by
list is fully resolved. The unclaimed Status values are open (what the
effort's own tickets carry) and ready-for-agent (what the /to-tickets
template writes); claimed and resolved are taken. The user may name a
subset at invocation.

Claiming maps any unclaimed value to claimed, and resolution maps claimed
to resolved; those are the only Status writes. With the PR record, they go
to the map and the ticket files: the only status surface. The tracker is
local-only, gitignored, never pushed.

## Spawning a wave

Per ticket in the wave. The slug comes from the ticket file name
(`NN-<slug>.md`): lowercase letters, digits, and hyphens, short enough that
`impl-<slug>` and `rev-<slug>` stay within 32 characters (herdr's agent-name
rule `[a-z][a-z0-9_-]{0,31}`).

```bash
REPO="<main checkout root>"
WT_PATH="$REPO/.worktrees/<slug>"

git -C "$REPO" worktree add "$WT_PATH" -b "feat/<slug>"

herdr tab create --workspace "$HERDR_WORKSPACE_ID" --cwd "$WT_PATH" --label "<NN> <slug>" --no-focus
# parse .result.tab -> TAB_ID and .result.root_pane -> ROOT_PANE

herdr pane split --pane "$ROOT_PANE" --direction right --cwd "$WT_PATH" --no-focus
# parse .result.pane.pane_id -> REVIEW_PANE

herdr agent start impl-<slug> --kind "$KIND" --pane "$ROOT_PANE"
herdr agent start rev-<slug> --kind "$KIND" --pane "$REVIEW_PANE"
```

A kind needing environment gets it into the pane before `agent start`,
which detects whatever the pane's shell then launches. Claude Code reading
a non-default config directory, for instance, needs its config variable
exported in both panes first.

Then:

1. Deliver Appendix A (the implementer template, filled in) to `impl-<slug>`
   and Appendix B (the reviewer template, filled in) to `rev-<slug>`, one
   prompt each: `herdr agent prompt <target> "<template text>"`, the whole
   template as one shell-quoted argument.
2. Record the ticket's entry in the wave state: slug, branch, worktree
   path, tab id, pane ids, agent names, agent kind, and the base ref the
   worktree was created on (flat spawn: main; stacked spawn: the base
   branch). The review request and the PR step read the base ref from here.
3. Arm the wake mechanism for the wave (relay loop, below). A Pi
   coordinator writes the watcher marker
   (printf 'impl-<slug>\nrev-<slug>\n' >
   /tmp/agent-kit-wave.active.s$PI_SESSION_ID) and starts the
   status-only daemon, recording its pid in the wave state. A Claude Code
   coordinator arms its persistent Monitor instead.
4. Flip the ticket to Status: claimed. The claim happens at spawn.

Both panes must be at their interactive shell prompt when their agent
starts; `tab create` and `pane split` arrange that, which is why `--cwd` is
passed explicitly. If `agent start` returns `agent_not_ready`, the name
stays live: wait until the agent is idle
(`herdr agent wait <name> --until idle`) before prompting it.

Worktrees live under `.worktrees/` and are gitignored (add the entry if the
repo lacks it). The tracker never references worktree paths.

**The worktree needs the repo's local-only files.** A fresh worktree
carries tracked content only, and two things a wave depends on are
gitignored by design: the tracker itself (the agents read their ticket from
their own worktree) and the approval gate's `.claude/settings.json`. Both
are absent unless copied.

Where worktrunk (`wt`) is installed, its own machinery does this and the
coordinator configures it once per repo rather than copying by hand:

- `.worktreeinclude` lists the gitignored paths to carry over (the tracker
  directory, the gate settings).
- `.config/wt.toml` runs the copy on creation:
  `pre-start = "wt step copy-ignored --require-include"`. `--require-include`
  confines the copy to that allowlist instead of every ignored path.
- Worktree creation then goes through `wt switch --create <slug>`, which
  fires the hook. Plain `git worktree add` skips it.

Check for a user-level copy hook before adding anything: an existing one
that copies untracked files will not carry ignored ones
(`git ls-files --others --exclude-standard` excludes them), which is
exactly the gap `.worktreeinclude` fills. Without `wt`, copy the paths into
the worktree as an explicit spawn step.

## Sentinels

Every implementer turn ends with exactly one final line, machine-greppable,
nothing after it:

- `AWAITING APPROVAL`: a commit-message (or pr-message) fence is presented
  and the turn waits. The reviewer fires at this line, before the approval
  word; the approval is sought only after the reviewer's PASS.
- `BLOCKED: <one-line question>`: stopped for any reason: ambiguity,
  failure, missing input.
- `IMPLEMENTATION COMPLETE`: the ticket work is finished.

Every reviewer turn ends with exactly one final line: `STANDING BY`
(awaiting the review request), `VERDICT: PASS`, `VERDICT: FINDINGS`, or
`BLOCKED: <one-line question>`.

Detection is `herdr pane wait-output` pattern matching, never terminal tail
reading (no scraping scrollback or log files):

```bash
herdr pane wait-output --regex '<pattern>' --source recent-unwrapped --lines 1 --timeout 2000 "$PANE_ID"
```

Patterns:

```bash
^(AWAITING APPROVAL|BLOCKED: .*|IMPLEMENTATION COMPLETE)$
^(STANDING BY|VERDICT: PASS|VERDICT: FINDINGS|BLOCKED: .*)$
```

`--lines 1` restricts the search to the last line of the snapshot, so the
check classifies the settled turn's final line instead of matching stale
output. The snapshot is searched immediately, then polled, so a short
timeout fails fast when no sentinel is present. For the line's full text
and its surrounding context, read the agent:
`herdr agent read <target> --source recent-unwrapped --lines 1`.

## The relay loop

Never block the coordinator chat with a foreground polling loop. The wake
mechanism belongs to the coordinator's own runtime; arm exactly one.

**A Pi coordinator** uses the two mechanisms below, both already present.

**A Claude Code coordinator** cannot use either: the watcher wakes a
session through `pi.sendMessage`, and `PI_SESSION_ID` (which names its
marker) is unset outside Pi. The equivalent is the `Monitor` tool, whose
every stdout line becomes a chat notification: the same push-wake as
`triggerTurn`, under a different name. Arm one persistent Monitor per wave
running the watcher's own logic in shell, which is the watcher's `pass()`
transcribed:

- Poll `herdr agent list` every ~10s, filtered to the wave's agent names.
- For each implementer that is idle or done, `herdr agent read <name>
  --source recent-unwrapped --lines 60` and match the implementer sentinel
  pattern; for each reviewer, stat its report file under
  `/tmp/agent-kit-reviews/feat/`.
- Dedupe against a state file keyed by agent name plus the agent's
  `state_change_seq` (or the report's mtime), so one event wakes once.
- Print one line per new event. Print nothing otherwise: every line is a
  notification.

Emit failure signals too, not just the happy path. A monitor matching only
sentinels stays silent through a crashed agent, and silence reads exactly
like work in progress.

The status-only daemon and its footer extension have no Claude Code
equivalent and are simply dropped; the wave state file carries what the
footer would have rendered.

The Pi mechanisms, in full:

1. **The herdr-wave-watcher extension** (global
   ~/.config/pi/agent/extensions/herdr-wave-watcher.ts) wakes the
   coordinator session on events via pi.sendMessage with triggerTurn.
   It arms via a marker named after the coordinator's own pi session,
   whose content is the wave's agent names, one per line:
   printf 'impl-<slug>\nrev-<slug>\n' >
   /tmp/agent-kit-wave.active.s$PI_SESSION_ID at spawn, remove that
   file at teardown. The watcher watches only the names in its own
   marker, so coordinators never pick up each other's waves even when
   they share a workspace or lose their herdr environment. Before
   building any monitoring, inventory the owner's global extensions;
   the right tool is usually already installed.
2. **A status-only daemon** (setsid, never a foreground sleep in a tool
   call: the tool kills its process group on exit, and pkill -f inside
   such a call can match the wrapper's own command line) rewrites
   /tmp/wave-telemetry/status.$HERDR_WORKSPACE_ID every ~10s with the
   wave's agent states and sentinels. The footer extension wave-status.ts
   (project-local .pi/extensions/, or the global copy in
   ~/.config/pi/agent/extensions/, activated with /reload) reads that
   file and renders it via ctx.ui.setStatus, mirroring how the subagent
   example streams onUpdate into its collapsed widget. Start the daemon
   at spawn, kill it at teardown (by pid recorded in the wave state,
   never pkill -f).

Sentinel classification reads the settled turn via agent read with
status-bar and separator lines filtered; the pane's literal last line
is always the status bar, so pane wait-output --lines 1 never sees the
sentinel. The coordinator acts (fires reviews, surfaces fences, relays)
when its wake mechanism fires or the user writes.

Poll every 30 seconds (`sleep 30` between iterations):

1. `herdr agent list`: the state of every live agent (idle, working,
   blocked, done, unknown).
2. Track each agent's state across iterations. When an implementer leaves
   working (idle or done), run the implementer sentinel check on its pane
   and classify the turn. Same for the reviewer with the reviewer pattern.
3. When herdr reports an agent blocked (it recognized an approval or
   question UI): read context with `herdr agent read <target>`, relay the
   question to the user with that context, and post the request
   notification. Never answer a blocked UI yourself, and never prompt a
   blocked agent (`agent prompt` rejects with `agent_blocked` before any
   input is sent).
4. Act on the sentinels below, then sleep.

Sentinel actions:

- `AWAITING APPROVAL`: trigger the review (review protocol, below). Never
  surface the fence for approval first: the approval word is sought only
  after the reviewer's PASS.
- `BLOCKED`: post the request notification, relay the one-line question to
  the user, and wait. Relay the user's answer back verbatim, as its own
  message.
- `IMPLEMENTATION COMPLETE`: post the done notification, then move the
  branch to the PR step.

Prompting discipline: submit prompts only to settled agents (idle or done),
one message at a time; an agent mid-turn is never interrupted. Submit
without `--wait` and let the loop do the waiting; `herdr agent wait` (or
`agent prompt --wait`) is a blocking wait, reserved for moments when a
single agent is live and there is nothing else to poll.

Notifications: herdr 0.8.2 has no subscribe CLI, so the coordinator posts
them itself whenever a sentinel fires, a wait settles, or an agent goes
blocked:

```bash
herdr notification show "<NN> <slug> implementer" --body "blocked on a question" --sound request
herdr notification show "<NN> <slug> reviewer" --body "review finished" --sound done
```

`request` means needs human input (a fence surfaced for approval after the
reviewer's PASS, `BLOCKED`, herdr blocked); `done` means finished work
(`IMPLEMENTATION COMPLETE`, VERDICT lines).

## Review protocol

The review fires at `AWAITING APPROVAL`, before the approval word, so
findings fold into the pending commit instead of landing as fixes on top of
an approved one.

1. On the implementer's `AWAITING APPROVAL` (a fence is pending), prompt
   the reviewer with the review request: what is pending, the ticket path,
   the branch, and the base to diff against (the wave's recorded base for
   the branch's first commit, the previously landed commit for every
   later one). When the pending item is
   the PR message, include the fence text itself in the request; the
   reviewer has no other way to read it:

   ```bash
   herdr agent prompt rev-<slug> "Review request: ticket <path>; branch feat/<slug>; base <base ref from the wave state>; pending: <the branch's next commit, or the PR message with its fence text>."
   ```

2. The reviewer writes a structured report (verdict, numbered findings,
   checks run) to `/tmp/agent-kit-reviews/feat/<slug>.md` and ends its turn
   with `VERDICT: PASS` or `VERDICT: FINDINGS`. The report file is
   authoritative; the chat line is for humans. Read the file before routing
   anything.
3. Route the findings:
   - Obvious failures (failing check, missing coverage, duplication,
     ticket deviation): relay to the implementer with the findings
     verbatim: `herdr agent prompt impl-<slug> "<findings verbatim>"`. The
     implementer folds the fixes into the pending work and re-presents the
     fence, ending with `AWAITING APPROVAL` again, which re-triggers this
     review. The loop repeats until PASS or either side blocks.
   - Anything needing a user decision: relay it to the user and wait;
     relay the decision back verbatim.
4. Either side blocking stops the loop: relay the question to the user.
5. On `VERDICT: PASS`: post the done notification and surface the pending
   fence to the user for the approval (approvals, next section). One
   approval, one commit, landing exactly as reviewed.

Review files are deleted at teardown, not before.

## Approvals

Every fence is reviewed before any approval is sought: the reviewer fires
at `AWAITING APPROVAL` (review protocol, previous section), and only its
PASS puts the fence in front of the user. The user approves in the
implementer tab, or in the coordinator chat. When the approval happens in
the coordinator chat, relay it verbatim, as its own message:

```bash
herdr agent prompt impl-<slug> "approved"
```

**Where the gate is registered, confirm the fence is recorded before
relaying.** The gate arms a *pending* fence, and an approval arriving with
nothing pending is a silent no-op: the word is consumed, the commit does
not land, and the implementer reports a gate that will not arm. The race is
easy to lose, because the sentinel appears on screen before the `Stop` hook
that records the fence has run, and the wake fires on the sentinel.

The gate's state file is the authority
(`~/.cache/agent-kit/approval-gate/<agent-session-id>`, the session id being
the `agent_session.value` that `agent start` returned). Poll it until
`.fence.type` is non-null and `.armed` is false, then relay. A cleared
fence (`"fence": null`) after a relay is the gate confirming it consumed
the arm; pair it with `git log` to see the commit that landed.

An approval the gate ignored is not recoverable by waiting: the word is
spent. Ask the user to approve again once the fence is recorded, and say
why rather than re-sending an approval they did not give.

The single arming word is `approved` (case-insensitive, whole word). One
approval runs one gated command with exactly the fenced text: findings were
folded in and re-reviewed first, so the branch lands as a single clean
commit. A coordinator-relayed approval arms the implementer's approval gate
identically to the user typing in the tab; no separate in-tab approval is
ever required. Never paraphrase, prefix, or batch the word with other
instructions. If herdr reports the agent blocked, the relay cannot be
delivered; the user approves in the tab directly.

## The PR step

Per finished branch (review passed). The coordinator runs the /pr flow
itself: PR mechanics are infrastructure, never implementer work.

1. Settle the base with the user. Always present both options: flat (base
   main) or stacked (base the open PR branch of this wave), with the base
   ref recorded at spawn as the default. Default: flat for disjoint
   branches; stacked when the branch already builds on an unmerged PR. If
   the user picks a base other than the recorded one, rebase the branch
   onto it first (normal git workflow).
2. Run the /pr flow in the ticket's worktree: quality-bar gate against the
   branch diff, PR message drafted, then present the complete PR message
   (title, blank line, body) in a fenced block tagged pr-message, in the
   coordinator chat. That fence triggers the reviewer like any other: send
   the review request with the fence text included, and seek the approval
   word only after its PASS. The user's reply containing approved arms the
   coordinator's own gate; then push and run `gh pr create` with exactly
   the fenced text.
3. Record the PR in the ticket file as soon as it exists (a `PR: <url>`
   line under the Status line); stacked waves and teardown depend on it.

## Merging

The default merger is the user: they review, merge, and report back. The
coordinator merges only on explicit instruction, never on its own judgment,
and merges exactly as instructed.

## Teardown

After the user reports merges (or an instructed merge completes), for each
merged ticket, in this order:

1. Record the outcome FIRST, before any teardown, so a crashed session
   loses nothing: write the ticket's `## Answer` into the ticket file
   (branch, PR, one-line gist of what landed), flip Status: resolved, and
   append the outcome line to the map's Decisions so far:

   ```markdown
   - [<ticket title>](issues/<NN>-<slug>.md): <one-line gist of the outcome>
   ```

2. Update main in the main checkout:

   ```bash
   git -C "$REPO" fetch origin
   git -C "$REPO" pull --ff-only origin main
   ```

3. Close the tab, remove the worktree, delete the branches, delete the
   review file:

   ```bash
   herdr tab close "$TAB_ID"
   git -C "$REPO" worktree remove "$WT_PATH"
   git -C "$REPO" branch -d "feat/<slug>"
   git -C "$REPO" push origin --delete "feat/<slug>"
   rm "/tmp/agent-kit-reviews/feat/<slug>.md"
   ```

   `git branch -d` refuses a squash-merged branch; verify the diff against
   origin/main is empty, then use `-D`. Where the worktree was created
   through `wt switch --create`, `wt remove` retires it and its branch
   together.

4. Disarm the wake mechanism the wave armed: a Pi coordinator removes its
   watcher marker (`/tmp/agent-kit-wave.active.s$PI_SESSION_ID`) and kills
   the status daemon by its recorded pid (never `pkill -f`); a Claude Code
   coordinator stops its Monitor.

Then move to the next frontier: recompute the ready queue and offer the
next wave, flat or stacked.

## Stacked waves

When the user chooses to stack the next wave on unmerged PRs:

- Prior tabs, agents, and worktrees stay open; nothing is torn down.
- New worktrees base on the open PR branch refs. The wave's own branch is
  still local:

  ```bash
  git -C "$REPO" worktree add "$REPO/.worktrees/<slug>" -b "feat/<slug>" "feat/<base-slug>"
  ```

  When the base is known only as a PR number, fetch its head first:

  ```bash
  git -C "$REPO" fetch origin "pull/<N>/head:pr-<N>"
  git -C "$REPO" worktree add "$REPO/.worktrees/<slug>" -b "feat/<slug>" "pr-<N>"
  ```

  Under worktrunk the same base is given as `wt switch --create <slug>
  --base feat/<base-slug>`, which keeps the local-only file copy the
  wave depends on.

- The spawn procedure is otherwise unchanged: tab, split, agents, prompts,
  claim. The stacked wave inherits the first wave's agent kind.
- When a stacked base PR merges, rebase the stack onto the new main as
  normal git workflow. herdr needs no changes: the tab only pins the pane
  cwd.

## Status upkeep

- Claim at spawn: Status: claimed.
- Record the PR when it opens: a `PR: <url>` line in the ticket file.
- Resolve at merge: `## Answer` in the ticket file, Status: resolved, and
  the outcome line in the map's Decisions so far.
- The map and the ticket files are the only status surface. The tracker is
  local-only: gitignored, never pushed. Worktrees are gitignored and never
  referenced from the tracker.

## Appendix A: implementer prompt template

Deliver filled in: replace `<NN>`, `<ticket title>`, `<ticket path>`,
`<effort>`, and `<worktree path>`. Deliver as one herdr agent prompt.

```text
You are the implementer for ticket <NN> (<ticket title>). Your working
directory is the worktree <worktree path>, on branch feat/<slug>; do all
work there.

Read first:
1. <ticket path>: your ticket. Follow it to the letter; never improvise
   scope.
2. The effort map (.scratch/<effort>/map.md): its Destination and Notes
   sections.
3. Every ticket your ticket lists under Blocked by, and any ticket it names
   as its spec or design authority.

Work:
- Invoke the /implement skill with this ticket and follow it in full,
  including its commit-at-logical-points cadence: the branch lands as a
  sequence of clean commits, each one a self-contained logical layer,
  never one undifferentiated blob. Each commit goes through the fence
  protocol below: as each layer completes, present that commit's message
  via the /commit skill, let it land on its approval, then proceed to the
  next layer. When the ticket's Commits section names the layers, follow
  it; when it does not, layer at the work's own logical points. A ticket
  never needs to name its commits: layered landing is the default.

Commits and the fence protocol:
- Present the complete commit message (subject plus body) of the next
  pending commit in a fenced code block tagged commit-message. One message
  at a time; a new fence supersedes any earlier one.
- After presenting a fence, END that turn with the final line
  AWAITING APPROVAL. A reviewer fires at that line, before any approval:
  review findings arrive as later messages. Fold the fixes into the
  pending work, then re-present the fence (superseding the earlier one)
  and end with AWAITING APPROVAL again.
- Run git commit only after a later message in this session contains the
  word approved (case-insensitive, whole word), and only after the
  reviewer's PASS, using exactly the fenced text. The approval may come
  from the user directly or relayed by the coordinator; both arm the gate
  identically. If nobody replies, stay waiting; never commit silently.
  One approval, one commit; repeat per commit until the ticket's work is
  done.
- Never amend or rewrite history.
- Never push and never open a PR. PR mechanics belong to the coordinator,
  which runs the /pr flow itself; the pr-message fence protocol never
  applies to you.

One message at a time:
- Answer the current message fully in one turn, then end the turn with
  your sentinel line and stop. Send nothing after the sentinel line.
  Wait for the next message.

Stop and ask:
- Whenever anything is ambiguous, missing, or failing, stop and ask. Do
  not guess.

Sentinel rules (the coordinator polls them; they are machine-greppable):
- End EVERY turn with exactly one final line:
  AWAITING APPROVAL (a fence is presented; the reviewer fires at this
  line, before the approval word), or
  BLOCKED: <one-line question> (stopped: ambiguity, failure, missing
  input), or
  IMPLEMENTATION COMPLETE (the final commit has landed; the
  ticket work is finished).
- Exactly one line, nothing after it.

Once the final commit lands, end the turn with IMPLEMENTATION COMPLETE. The
coordinator takes the branch from there and runs the PR step itself.
```

## Appendix B: reviewer prompt template

Deliver filled in: replace `<NN>`, `<ticket title>`, `<ticket path>`,
`<effort>`, and `<worktree path>`. Deliver as one herdr agent prompt.

```text
You are the reviewer for ticket <NN> (<ticket title>). Your working
directory is the worktree <worktree path>, on branch feat/<slug>. The
implementer (impl-<slug>) works in the other pane of this tab; you never
take over its work.

Standby:
- You receive this message before the implementation exists. Acknowledge
  it by ending this turn with the final line STANDING BY, then wait.
  Review requests fire at the implementer's AWAITING APPROVAL, before any
  approval is given: you review pending work, not landed commits.

On each review request (it carries the ticket path, the branch, the base
ref, and what is pending: the branch's next commit, or the PR message
with its fence text included verbatim):
1. Read the ticket and the effort map's Destination and Notes sections.
2. Review the pending change against the base ref. A pending commit is
   uncommitted work (no approval has been given yet):
   git diff <base-ref>
   A pending PR message is the fence text carried in the request itself:
   review it against the landed branch and the ticket. Check ticket
   compliance (every requirement), failing or missing checks (run the
   repo's own test, lint, and format commands as its conventions define),
   missing coverage of the ticket's acceptance criteria, duplication, and
   obvious defects.
3. Change nothing. You review: never edit files, commit, push, or open
   PRs. The commit-message and pr-message fence protocol never applies
   to you.
4. Write a structured report to /tmp/agent-kit-reviews/feat/<slug>.md
   (create the directory first: mkdir -p /tmp/agent-kit-reviews/feat):
   - Verdict: PASS or FINDINGS
   - Numbered findings: each with its location (file and line), its
     evidence (command output or quoted code), and what it contradicts
     (ticket requirement, check, or repo convention)
   - Checks run: each command and its result
5. End the chat turn with exactly one final line: VERDICT: PASS or
   VERDICT: FINDINGS. The report file is authoritative; the chat line is
   for humans.

One message at a time:
- Answer the current message fully in one turn, then end the turn with
  your final line and stop. Send nothing after it. Wait for the next
  message.

Stop and ask:
- Whenever you cannot review (missing input, ambiguous ticket, broken
  environment), stop and ask. Do not guess.

Sentinel rules (the coordinator polls them; they are machine-greppable):
- End EVERY turn with exactly one final line: STANDING BY, VERDICT: PASS,
  VERDICT: FINDINGS, or BLOCKED: <one-line question>.
- Exactly one line, nothing after it.
```

Output follows /clear-tone.
