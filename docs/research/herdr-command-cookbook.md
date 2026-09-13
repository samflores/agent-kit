# herdr command cookbook (herdr 0.8.2)

Cookbook for driving herdr from a coordinator agent that runs one herdr tab per
ticket, split into implementer and reviewer panes. Every command below was
verified against the installed binary's `--help` output (quoted verbatim under
each command). Anything not verifiable from the binary's own output or the two
fetched web docs is marked UNVERIFIED.

Sources used, in order of authority:

1. `~/.local/bin/herdr` 0.8.2 `--help` output for every command shown here
   (the binary is the authority).
2. `herdr --skill`, the agent skill file printed by the installed binary
   (defines seen/unseen semantics, naming rules, and caller-context env vars).
3. `herdr api schema --json`, the bundled API schema printed by the installed
   binary (defines agent states and response shapes).
4. https://herdr.dev/llms.txt and https://herdr.dev/agent-guide.md, fetched
   2026-02-13 with `curl --max-time 20`.

Version conflict to know about: the fetched `llms.txt` says "Current stable
release: 0.9.0" and links 0.9.0 documentation, while the installed binary is
0.8.2. Where the web docs and the binary disagree, this cookbook follows the
binary. No other conflicts were found between the two fetched docs and the
binary's help text, except one: the binary's `--skill` output lists
`herdr terminal` as a discovery command group, but 0.8.2 has no `terminal`
group (its groups are: api, channel, completion, config, integration, pane,
notification, agent, session, tab, workspace, worktree, per `herdr --help`).

Safety rules this cookbook assumes (all from the binary's own output):

- Never run bare `herdr`; per `herdr --help`: "Common commands: herdr  Launch
  or attach to the persistent session". It launches the TUI.
- Never probe a mutating command by omitting arguments. Commands such as
  `workspace create` are valid with defaults and will execute.
- Verify the caller is inside a managed pane first: `test "${HERDR_ENV:-}" = 1`
  (from `herdr --skill`).

---

## 1. Creating a tab in the current workspace

```
herdr tab create --workspace <WORKSPACE_ID> --cwd <PATH> --label <TEXT>
```

Exact help:

```
===== herdr tab create --help =====
Create a tab

Usage: herdr tab create [OPTIONS]

Options:
      --workspace <WORKSPACE_ID>
          

      --cwd <PATH>
          

      --label <TEXT>
          

      --env <KEY=VALUE>
          Set an environment variable for the launched process

      --focus
          

      --no-focus
```

Discovery of the current workspace id: herdr injects caller context into every
managed pane as environment variables. Observed live values in this session:

```
HERDR_WORKSPACE_ID=w6
HERDR_TAB_ID=w6:t2D
HERDR_PANE_ID=w6:p4Z
HERDR_SOCKET_PATH=/home/samflores/.config/herdr/herdr.sock
HERDR_BIN_PATH=/home/samflores/.local/bin/herdr
HERDR_ENV=1
```

`herdr --skill` documents the first three of these:

> Herdr injects the caller's context into each managed pane:
>
> ```bash
> printf '%s\n' "$HERDR_WORKSPACE_ID" "$HERDR_TAB_ID" "$HERDR_PANE_ID"
> ```

So the current-workspace invocation is:

```
herdr tab create --workspace "$HERDR_WORKSPACE_ID" --cwd "$PWD" --label "ticket-123"
```

ID shapes (from `herdr --skill`): workspace `w1`, tab `w1:t1`, pane `w1:p1`;
closed tab and pane IDs are not reused.

What it returns: `herdr --skill` says "`tab create` returns `.result.tab` and
`.result.root_pane`". Parse the tab id and root pane id from that JSON; the
root pane is the pane you split for the implementer/reviewer pair.

Related, same group (exact help excerpts):

```
===== herdr tab list --help =====
List tabs

Usage: herdr tab list [OPTIONS]

Options:
      --workspace <WORKSPACE_ID>

===== herdr tab get --help =====
Show a tab

Usage: herdr tab get <tab_id>
```

`tab list --workspace "$HERDR_WORKSPACE_ID"` is the non-environment fallback
for discovering tabs of the current workspace. To enumerate workspaces:
`herdr workspace list` (usage line: `Usage: herdr workspace list`).

## 2. Splitting a pane

```
herdr pane split --pane <PANE_ID> --direction right --no-focus
```

Exact help:

```
===== herdr pane split --help =====
Split a pane

Usage: herdr pane split [OPTIONS] [PANE_ID]

Arguments:
      [PANE_ID]
          

Options:
      --pane <ID>
          

      --current
          

      --direction <DIRECTION>
          [possible values: right, down]

      --ratio <FLOAT>
          

      --cwd <PATH>
          

      --env <KEY=VALUE>
          Set an environment variable for the launched process

      --right-click <TARGET>
          [possible values: herdr, pane]

      --focus
          

      --no-focus
```

Targeting: pass the pane id positionally (`[PANE_ID]`), via `--pane <ID>`, or
use `--current` to target the calling pane. `herdr --skill` recommends
`--current` for the calling pane and warns: "Omitting a target may use the
UI-focused pane, which can belong to the user or another client."

Direction choice via `pane layout`:

```
===== herdr pane layout --help =====
Show pane layout information

Usage: herdr pane layout [OPTIONS]

Options:
      --pane <ID>
          

      --current
```

`herdr --skill` gives the geometry rule:

> Otherwise inspect the caller pane:
>
> ```bash
> herdr pane layout --pane "$HERDR_PANE_ID"
> ```
>
> Split a wide pane to the right and a narrow or tall pane down. Avoid repeated
> same-direction splits that create unusably narrow columns or short rows.

Coordinator recipe for one ticket tab (from `herdr --skill`, adapted):

```
herdr pane split --current --direction right --cwd "$PWD" --no-focus
```

Read the new pane id from `.result.pane.pane_id` (`herdr --skill`: "`pane
split` returns the new pane as `.result.pane`"). Split the returned pane again
(`--pane <returned-pane-id> --direction down`) to get the reviewer pane. Always
pass `--cwd` explicitly: `herdr --skill` says to "explicitly preserve the
caller's working directory", and an agent start later needs the pane sitting at
a shell prompt in the right directory.

`--focus` / `--no-focus` exists on split; `herdr --skill`: "Use `--no-focus`
for background work unless the user asked to switch context."

## 3. Starting an agent (implementer or reviewer)

```
herdr agent start <NAME> --kind <KIND> --pane <ID> [-- <AGENT_ARG>...]
```

Exact help:

```
===== herdr agent start --help =====
Start a supported interactive agent in an existing pane

Usage: herdr agent start <NAME> --kind <KIND> --pane <ID> [OPTIONS] [-- [AGENT_ARG]...]

Arguments:
  <NAME>
          

  [AGENT_ARG]...
          

Options:
      --kind <KIND>
          Supported agent kind and canonical executable
          
          [possible values: pi, claude, codex, gemini, cursor, devin, agy, cline, omp, mastracode, opencode, copilot, kimi, kiro, droid, amp, grok, hermes, kilo, qodercli, qwen, maki, muse]

      --pane <ID>
          Existing pane at an interactive shell prompt

      --timeout <MS>
          Wait for interactive readiness (default: 30000; max: 300000)

The pane must be at its interactive shell prompt. Success means the expected agent was detected in the same terminal and is ready for input.

next: herdr agent prompt <TARGET> <TEXT> --wait
```

Full kinds list (0.8.2, quoted above): `pi, claude, codex, gemini, cursor,
devin, agy, cline, omp, mastracode, opencode, copilot, kimi, kiro, droid, amp,
grok, hermes, kilo, qodercli, qwen, maki, muse`.

Naming rules (from `herdr --skill`, the binary's own skill file):

> Names must match `[a-z][a-z0-9_-]{0,31}` and be unique among live agents. A
> name follows the current pane occupant and is cleared when that agent exits,
> is released, or is replaced.

Targets for all agent subcommands (from `herdr --skill`): "Agent commands
accept either a unique live agent name or the pane ID currently hosting that
agent. They do not accept terminal IDs or bare agent-kind labels."

Initial arguments go after `--` (usage line above: `[-- [AGENT_ARG]...]`),
example from `herdr --skill`:

```bash
herdr agent start reviewer --kind codex --pane <returned-pane-id> -- <agent-args...>
```

Readiness timeout: `--timeout <MS>`, default 30000 ms, max 300000 ms (help
text above). The bundled schema (`herdr api schema --json`,
`AgentStartParams.timeout_ms`) adds the lower bound: "Values must be greater
than 3000 and at most 300000."

Pane requirement: the `--pane` help text and the trailing paragraph above say
the pane must already exist and be "at its interactive shell prompt";
`herdr --skill` adds "agent start ... never creates, splits, or moves layout"
and that the shell must be in the foreground with no foreground command,
editor, or agent running. Startup failure mode, from `herdr --skill`:

> If the agent is blocked during startup, the command returns `agent_not_ready`
> immediately but keeps the name available for `agent read` and `agent
> send-keys`. Wait until the agent becomes idle before prompting it.

## 4. Prompting, reading, and waiting: the lifecycle surface

### agent prompt

```
===== herdr agent prompt --help =====
Submit a prompt to an agent

Usage: herdr agent prompt <TARGET> <TEXT> [OPTIONS]

Arguments:
  <TARGET>
          

  <TEXT>
          

Options:
      --wait
          Wait for the first matching state observed after submission

      --until <STATUS>
          State to match after --wait; repeat for more than one state
          
          [possible values: idle, working, blocked, done, unknown]

      --timeout <MS>
          Fail after this many milliseconds

If the agent is already blocked, submission is rejected with agent_blocked before any input is sent. When an accepted submission starts from another non-working state, --wait first requires an observed state change within 5000ms; otherwise it returns agent_prompt_stalled. A shorter --timeout returns timeout instead. It then matches idle, done, or blocked by default, or any exact --until state. It does not track turns: if the agent is already working, that active turn's completion may match. Without --timeout, the settled-state wait is indefinite.
```

### agent read

```
===== herdr agent read --help =====
Read agent terminal output

Usage: herdr agent read <TARGET> [OPTIONS]

Arguments:
  <TARGET>
          

Options:
      --source <SOURCE>
          Terminal snapshot source (default: recent)
          
          [possible values: visible, recent, recent-unwrapped, detection]

      --lines <N>
          

      --format <FORMAT>
          [possible values: text, ansi]

      --ansi
```

Source meanings (from `herdr --skill`): `visible` is the rendered viewport;
`recent` includes soft wraps; `recent-unwrapped` joins soft wraps and is
preferred for logs and transcripts; `detection` is the plain-text bottom-buffer
used for agent detection.

### agent wait

```
===== herdr agent wait --help =====
Wait until an agent reaches one of the requested states

Usage: herdr agent wait <TARGET> [OPTIONS]

Arguments:
  <TARGET>
          

Options:
      --until <STATUS>
          State to match; repeat for more than one state
          
          [possible values: idle, working, blocked, done, unknown]

      --timeout <MS>
          Fail after this many milliseconds

Without --until, matches idle, done, or blocked. Use --until unknown explicitly when needed. Without --timeout, waits indefinitely.
```

### Lifecycle states

`idle, working, blocked, done, unknown` (possible values above; the bundled
schema's `AgentStatus` enum is the same five). Semantics from `herdr --skill`:

> `idle` means the agent is ready for input and its tab has been seen in the
> focused Herdr UI. `done` is the same underlying idle state after unseen
> background work finishes. Focusing the tab or targeting the pane or agent
> with a focus command marks it seen. CLI reads do not mark it seen. `blocked`
> means Herdr recognized an approval or question UI. `unknown` means an agent
> is present but Herdr cannot classify it confidently; it does not prove
> completion.

What marks a tab as seen, restated: a focus action. `herdr tab focus`, `herdr
agent focus`, or otherwise focusing the tab in the UI. `agent read`, `agent
get`, `agent wait`, and `agent list` do NOT mark seen, so a coordinator can
poll freely without consuming the user's `done` signal.

Blocked detection: `agent wait <target> --until blocked` (or `agent prompt ...
--wait`, which matches `idle, done, or blocked by default`). A `blocked`
result means "Herdr recognized an approval or question UI" (skill quote
above). On `blocked`, `herdr --skill` says: "Inspect the blocked UI and ask the
user before answering it", using `agent get` / `agent read` to see the
question. `agent prompt` additionally refuses to type into a blocked agent
(`agent_blocked` rejection before any input is sent, help text above).

For diagnosing why a pane is classified the way it is, the fetched
agent-guide.md suggests `herdr agent explain <target> --json`; the 0.8.2
binary has the subcommand with those options (help below), but the guide is
written against a newer stable, so treat the flag pairing as verified against
help only:

```
===== herdr agent explain --help =====
Explain agent detection state

Usage: herdr agent explain [OPTIONS] [TARGET]

Arguments:
  [TARGET]
          

Options:
      --file <PATH>
          

      --agent <LABEL>
          

      --json
          

      --format <FORMAT>
          [possible values: text, json]

  -v, --verbose
```

Waiting for an already-running agent to request input, from `herdr --skill`:

```bash
herdr agent wait reviewer --until blocked --timeout 120000
```

Prompt pattern for coordinator work, from `herdr --skill`: "`--wait` is
enough: it waits for the first settled `idle`, `done`, or `blocked` state. Do
not repeat those defaults with `--until`."

```bash
herdr agent prompt implementer "Implement ticket-123 per docs/tickets/123.md" --wait --timeout 120000
```

## 5. Listing and inspecting agents

```
===== herdr agent list --help =====
List agents

Usage: herdr agent list


===== herdr agent get --help =====
Show an agent

Usage: herdr agent get <target>

Arguments:
  <target>
```

Both return JSON (skill: "Most control commands return JSON"). The result
shape is `AgentInfo` in the bundled schema (`herdr api schema --json`), whose
required fields are:

```
terminal_id, agent_status, workspace_id, tab_id, pane_id, focused, revision
```

plus optional `name`, `cwd`, `interactive_ready`, `launch_pending`,
`agent_session`, `state_labels`, `tokens`, and others. Mapping an agent to its
pane, tab, and workspace is therefore direct: read `pane_id`, `tab_id`, and
`workspace_id` off the `AgentInfo` object; no cross-referencing needed. `name`
is the live agent name to use as `<TARGET>` elsewhere.

Tab and workspace objects roll agent state up: the schema's `TabInfo` and
`WorkspaceInfo` each carry an `agent_status` field, so
`herdr tab list --workspace "$HERDR_WORKSPACE_ID"` shows which ticket tab has
an agent that is `blocked` or `done` without inspecting panes individually.

## 6. Focus commands

```
===== herdr agent focus --help =====
Focus an agent

Usage: herdr agent focus <target>

Arguments:
  <target>


===== herdr tab focus --help =====
Focus a tab

Usage: herdr tab focus <tab_id>

Arguments:
  <tab_id>


===== herdr pane focus --help =====
Focus a neighboring pane

Usage: herdr pane focus [OPTIONS] --direction <DIRECTION>

Options:
      --direction <DIRECTION>
          [possible values: left, right, up, down]

      --pane <ID>
          

      --current


===== herdr workspace focus --help =====
Focus a workspace

Usage: herdr workspace focus <workspace_id>

Arguments:
  <workspace_id>
```

Note the asymmetry: `tab focus` and `agent focus` take an id/name directly;
`pane focus` cannot target an arbitrary pane id, it focuses a neighbor of the
current (or `--pane <ID>`) pane by direction.

Coordinator guidance: focusing is also the seen-marker (section 4), so use
`agent focus <name>` deliberately, when handing control to the user, not as a
polling step. For all-day background coordination `herdr --skill` says:
"Use `--no-focus` for background work unless the user asked to switch context"
and "Keep the user's focus in the calling pane".

## 7. Teardown

Closing a ticket tab:

```
===== herdr tab close --help =====
Close a tab

Usage: herdr tab close <tab_id>

Arguments:
  <tab_id>
```

The tab command group is the only place tabs are removed (`herdr tab --help`
commands: `list, create, get, focus, rename, close`; there is no tab delete
distinct from close).

Removing a worktree checkout:

```
===== herdr worktree remove --help =====
Remove a worktree checkout

Usage: herdr worktree remove [OPTIONS]

Options:
      --workspace <ID>
          

      --force
          

      --trust-repository
```

Removal targets a workspace id, not a path: you remove a herdr worktree by its
workspace. The bundled schema's `WorktreeRemoveParams` confirms `workspace_id`
is the only required field (plus optional `force`, `trust_repository`).

Why `git worktree add` + `herdr tab create --cwd` is usually preferable for a
coordinator:

- `herdr worktree create` is described by its group as part of "Manage Git
  worktree-backed workspaces" (`herdr worktree --help`), and its sibling
  `worktree list` is "List worktree workspaces": in herdr's model a worktree
  checkout is surfaced as its own workspace. The schema's `WorktreeInfo`
  object also carries `open_workspace_id` (the workspace a worktree is opened
  as), and `WorkspaceInfo` carries a `worktree` object. A coordinator that
  wants everything inside the current workspace therefore gets extra
  workspaces it did not ask for.
- Whether `herdr worktree create` without `--workspace <ID>` always creates a
  brand-new workspace (vs. reusing the caller's) is UNVERIFIED: its `--help`
  says only "Create and open a Git worktree" and lists
  `--workspace <ID> --cwd <PATH> --branch <NAME> --base <REF> --path <PATH>
  --label <TEXT> --focus --no-focus --trust-repository`, with no prose about
  the default. The fetched llms.txt and agent-guide.md do not cover
  `worktree create` at all. Do not rely on either behavior; use the git route
  below if you need the tab inside the current workspace.
- Also note `--trust-repository` exists on all worktree subcommands, implying
  an untrusted-repository confirmation step that can block automation.

The fully verifiable alternative keeps the topology inside the current
workspace:

```bash
git -C "$REPO" worktree add "$WT_PATH" -b "agent/ticket-123"
herdr tab create --workspace "$HERDR_WORKSPACE_ID" --cwd "$WT_PATH" --label "ticket-123"
```

Then split and start agents in that tab per sections 2 and 3. Cleanup is the
reverse: `herdr tab close <tab_id>` then `git worktree remove "$WT_PATH"`
(plain git; outside herdr's surface).

## 8. Notifications

```
===== herdr notification show --help =====
Show a notification

Usage: herdr notification show [OPTIONS] <TITLE>

Arguments:
  <TITLE>
          

Options:
      --body <TEXT>
          

      --position <POSITION>
          [possible values: top-left, top-right, bottom-left, bottom-right]

      --sound <SOUND>
          [possible values: none, done, request]
```

The notification group has exactly one subcommand (`herdr notification --help`
lists only `show`); it posts a notification into the Herdr UI. There is no
subscribe/auto-notify command in 0.8.2's CLI: the coordinator surfaces
completion or blocked state itself, by calling `notification show` after its
own `agent wait` / `agent prompt --wait` observes the state, e.g.:

```
herdr notification show "ticket-123 implementer" --body "agent is blocked on a question" --sound request
herdr notification show "ticket-123 reviewer" --body "review finished" --sound done
```

The `done` and `request` sound names line up with the two states a coordinator
announces (finished, needs human input). Anything beyond that mapping (e.g.
which UI surface renders these, or whether sounds are configurable) is
UNVERIFIED from the sources gathered here.

## Closing: stacked worktrees and stacking on open PRs

`herdr worktree create` has a `--base <REF>` option:

```
      --base <REF>
```

(from `herdr worktree create --help`, quoted in section 7), so herdr-native
stacking on any ref is:

```
herdr worktree create --base <REF> --branch <NAME> --label <TEXT>
```

but per section 7 this lands in its own worktree-backed workspace, with the
UNVERIFIED default noted there.

The plain-git route for stacking the next wave on an unmerged PR branch, fully
inside the current workspace:

```bash
# wave 2 stacks on wave 1's open PR branch
git -C "$REPO" fetch origin pull/456/head:pr-456   # or: branch name of the open PR
git -C "$REPO" worktree add "$WT_PATH" -b "agent/ticket-789" "pr-456"
herdr tab create --workspace "$HERDR_WORKSPACE_ID" --cwd "$WT_PATH" --label "ticket-789"
```

`git worktree add <path> -b <new-branch> <base-ref>` creates the new branch
with its start point at the base ref, so the new worktree contains the open
PR's commits and the next ticket's work stacks on top. When the PR merges,
rebase the stack onto the new main as normal git workflow; herdr needs no
changes because the tab only pins the pane's cwd. This closing section's git
invocations are standard git, not taken from herdr's help; the herdr commands
around them are quoted in sections 1, 2, and 7.
