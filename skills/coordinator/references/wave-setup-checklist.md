# Wave setup checklist

Every item here comes from a failure that cost a wave. Run the checklist at
spawn. Do not re-derive it.

## 1. The worktree

```bash
git -C "$REPO" worktree add "$ABSOLUTE_PATH" -b "<branch>" "<base>"
```

Give `worktree add` an ABSOLUTE path. With `-C "$REPO"` a relative path
resolves inside the repo and makes `repo/repo/.worktrees/...`.

## 2. The local-only files

A fresh worktree carries tracked content only. Copy these in:

```bash
cp -r "$REPO/.claude" "$WT/"          # the approval gate
mkdir -p "$WT/.scratch"
cp -r .scratch/<effort> "$WT/.scratch/"
```

Exclude them per worktree. The `.gitignore` of the main checkout does NOT
reach a worktree, because each worktree has its own copy of that tracked
file. Use the exclude file instead:

```bash
gd=$(git -C "$WT" rev-parse --git-path info/exclude)
for e in ".scratch/" ".claude/settings.json" ".worktrees/"; do
  grep -qxF "$e" "$gd" || printf '%s\n' "$e" >> "$gd"
done
```

Verify: `git -C "$WT" status --short` prints nothing.

## 3. Trust the mise configuration

An untrusted `.mise.toml` makes EVERY hook fail, which silently disables
the approval gate for the whole wave. The error appears in the pane as a
"Stop hook error", not as a gate error.

```bash
mise trust "$WT/.mise.toml"
mise trust "$REPO/.mise.toml"
mise trust "<monorepo root>/.mise.toml"
```

Verify from inside the worktree: `mise ls --current` exits 0.

## 4. Trust the directory for the hooks

Claude Code loads hooks from a project `.claude/settings.json` only in a
directory the user has trusted. A fresh worktree is a new directory, so it
is untrusted and its hooks never load. The symptom is NO state file at all
under `~/.cache/agent-kit/approval-gate/` for that session.

That symptom is now specific. A hook that runs always writes state, even
when it finds no fence and even when it cannot read its transcript (which
records `transcript_error`). So an absent file means the hooks never ran:
check trust and `.mise.toml`, not the gate.

Check ONLY after the agent's turn has settled. The Stop hook writes at the
end of a turn, so an absent state file proves nothing while the agent is
still working:

```bash
herdr agent get <impl> | grep agent_status   # must not be "working"
ls -t ~/.cache/agent-kit/approval-gate/ | head -3
```

A file with today's timestamp means the hooks loaded. No such file AFTER a
settled turn means they did not, and the wave has no gate.

Do not restart an agent on a mid-turn check. That mistake cost a session's
context in the ENG-7450 wave: the file appeared one minute later, and the
gate had been working the whole time. The Monitor already waits for a
settled turn; trust it instead of checking by hand.

Verify the hook itself runs from the worktree:

```bash
cd "$WT" && echo '{"session_id":"smoke","transcript_path":"/nonexistent"}' \
  | node ~/Code/agent-kit/extensions/approval-gate/core.mjs stop
```

Exit 0 means the script works. It does NOT prove the session loaded it.

## 5. The environment of the pane

`herdr agent start` takes no environment. Export first, then start:

```bash
herdr pane run "$PANE" "export CLAUDE_CONFIG_DIR=/home/samflores/.config/claude-stack"
herdr agent start "<name>" --kind claude --pane "$PANE"
```

`herdr pane send-text` and `herdr pane run` take POSITIONAL arguments, not
`--pane`.

## 6. The Monitor

Read `wake-mechanisms.md` and follow it. The working shape:

- `herdr agent read <name> --source recent-unwrapped --lines 60`, then
  filter. NOT `--lines 1`: the last line of a pane is always the status
  bar, so a sentinel never appears there.
- NOT `pane wait-output`: sentinels are indented, so `^` anchors miss them,
  and a wide window matches the prompt's own instruction text.
- Dedupe on the agent's `state_change_seq` from `herdr agent get`.
- Do NOT truncate the seen-file at start (`: > "$SEEN"`). A restart then
  replays every event. Use `touch`.
- Quote the agent list in the `for` loop, or word splitting reports every
  agent as unreachable.

On an `AWAITING APPROVAL`, relay the approval word together with the
approved fence text (section 8). Carrying the text makes the relay
order-independent, so there is no state file to poll first and no race to
lose against the agent's `Stop` hook.

## 7. The agent prompt

Put these in the implementer prompt. Each one cost a BLOCKED turn:

- The Edit and Write tools own every content change. The auto-mode
  preference for Bash does not apply to writes. Shell covers renames,
  moves and permission bits only.
- Exactly ONE fence per turn. The Stop hook records only the last fence it
  finds, so two fences desync the gate from the agent's latest message.
- The compose service mounts the MAIN checkout. Pass
  `-w /usr/src/app/.worktrees/<slug>` to every `docker compose run`, or the
  agent tests the wrong tree.
- A turn that reports a landed commit and names the next layer is NOT an
  `AWAITING APPROVAL` turn.

## 8. The approval relay

Relay the word and the approved text in one message. The gate binds the
approval to that exact text, so it arms whether or not the fence has been
recorded yet:

```bash
herdr agent prompt impl-<slug> "$(cat <<'OUTER'
approved

```commit-message
<the exact fence text the user approved>
```
OUTER
)"
```

The text must match the fence verbatim. An approval carrying different
text leaves the fence unarmed on purpose, so the gate never authorizes a
message the user did not read; re-read the fence and relay again.

A bare `approved` still needs the fence already on record, so relay the
word alone only when the state file shows one:

```bash
python3 -c "
import json;d=json.load(open('$HOME/.cache/agent-kit/approval-gate/<sid>'))
fe=d.get('fence');print(bool(fe) and not d.get('armed'))"
```

Reading the state file: `cwd` names the worktree that owns the session,
`transcript_error` means the hook ran but could not read its transcript,
and no file at all means the hooks never ran.
