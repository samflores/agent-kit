# Approval gate

The approval-gate engine plus the Claude Code hook entry point. The gate
watches a session's conversation for a proposed commit or PR message
presented in a fenced code block tagged `commit-message` or `pr-message`,
arms when the user replies with the single word `approved`
(case-insensitive, whole word), and lets exactly one matching gated
command through per approval.

## Files

- `core.mjs`: the Claude Code hook entry point. One process per hook
  event, invoked as `node core.mjs <event>` with the event's stdin JSON.
- `lib.mjs`: the platform-neutral core: fence parsing, normalization and
  hashing, the arming state machine, command classification, the shell
  tokenizer behind payload extraction, and the session state store. It
  is a plain importable module, not tied to the hook entry point.

## Protocol

- The assistant presents the complete message in one fenced block: a
  commit message as subject plus body, a PR message as title, blank
  line, body. One message at a time; a newly presented fence supersedes
  any pending or armed one.
- The user replies with a message containing the word `approved`. A bare
  approval with nothing pending is a no-op; any other reply changes
  nothing.
- An approval may also carry the approved text in a fenced block. With
  nothing pending the gate holds that text's hash, and the matching
  fence arms itself the moment it is recorded. This makes the relay
  order-independent: a coordinator can approve before the agent has
  presented. A held approval only ever arms the exact text it approved,
  so it can never authorize a message the user did not read.
- The gated command runs only when armed, only when its payload equals
  the fenced text after normalization (trailing whitespace per line and
  trailing blank lines stripped), and only off `main`. The arm is
  consumed on success; a blocked attempt keeps the arm so a corrected
  retry needs no fresh approval.

Gated commands, matched where a command can actually start: the start
of the string, just after a shell separator or subshell paren, or inside
the quoted argument of a wrapper that executes it (`sh -c`, `env`,
`sudo`, and friends). A command that merely mentions a gated invocation
in prose or in a quoted search pattern is not gated, so a coordinator
relaying instructions to an agent is not blocked by its own prompt
text:

- `git commit` in every form: `-m`/`--message` single or repeated
  (paragraphs joined by a blank line), the heredoc-inside-substitution
  form, `-F`/`--file` with a readable path or `-` with a heredoc on
  stdin, and `--amend` in all of those forms.
- `gh pr create` with `--title`/`-t` plus `--body`/`-b` or
  `--body-file`/`-F` (a readable path, or `-` with a heredoc). The
  payload compared against the fence is title, blank line, body.

Not gated: `git push`, `gh pr edit`, and every other command. Refused
outright: `git commit` on `main`, armed or not. Also refused: `git
commit` with no inline message (the editor path never opens), with a
reason demanding `-m` with the exact approved text. A payload the gate
cannot read statically (variable substitution, a missing file) is
refused as unverifiable.

## Claude Code registration

Hooks have no auto-discovered directory, so the engine is installed into
the Claude config it serves and registered there. Copy `core.mjs` and
`lib.mjs` into `<config-dir>/hooks/approval-gate/`, where `<config-dir>`
is `$CLAUDE_CONFIG_DIR` with `~/.claude` as the default, then register
the installed path by absolute path in that config's user-scope
`settings.json` (user scope because the approval policy applies
machine-wide, not per project). An engine update means copying the two
files over the installed ones; the registration keeps pointing at the
installed path.

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "node <config-dir>/hooks/approval-gate/core.mjs stop" }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          { "type": "command", "command": "node <config-dir>/hooks/approval-gate/core.mjs userpromptsubmit" }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "node <config-dir>/hooks/approval-gate/core.mjs pretooluse" }
        ]
      }
    ]
  }
}
```

Event wiring:

- `stop`: parses `transcript_path` for the latest assistant fence in
  the transcript entries not yet processed and records it as pending,
  superseding any earlier state. Claude Code fires Stop at the end of
  every assistant turn, which is when the fence has been fully written
  to the transcript. Fences in user entries are ignored, and entries
  already processed are never rescanned, so a consumed fence cannot come
  back. An unreadable transcript records `transcript_error` rather than
  returning silently, and a readable one with no fence still writes
  state: an absent state file therefore means the hooks never ran, not
  that the hook ran and saw nothing. Each write also records the
  session's `cwd`, so a coordinator can map a session id to the worktree
  that owns it.
- `userpromptsubmit`: arms the pending fence when the prompt contains
  the approval word. When the prompt also carries a fence and nothing is
  pending, the approved text's hash is held for the fence recorded next.
- `pretooluse`: matcher `Bash`; enforces on `tool_input.command`. A
  blocked command exits 2 with the reason on stderr, which Claude Code
  surfaces as the denial.

## No bypass

Every allowed command has its payload checked against a fence the user
approved. There is no mode, flag, or environment variable that skips
that check.

`AG_GATE_STRICT_FENCES=0` used to disable fence scanning and let the
approval word alone authorize any payload. That was a bypass rather than
a fallback: it turned the gate off from the environment, which anything
running under the hook can set. It has been removed. Setting the
variable now does nothing.

An armed state with no fence on record is refused, not allowed. Fence
scanning always runs.

## State

One JSON file per session under
`~/.cache/agent-kit/approval-gate/<session_id>`: fence type, the sha256
of the normalized fence text, the armed flag, the number of transcript
entries processed, and timestamps. The key is the `session_id` field of
the hook payload. Every core run first sweeps the directory and deletes
state files whose mtime is older than 14 days.

## Tests

```
node --test "extensions/approval-gate/test/*.test.mjs"
```

The suite covers fence parsing, normalization, the command classifier,
the shell tokenizer, payload extraction for every gated form, the state
transitions, the TTL sweep, and a full headless protocol cycle per
event, driven by fixture transcripts and canned stdin JSON.
