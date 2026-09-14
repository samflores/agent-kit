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
- The user replies with a message containing the word `approved`. An
  approval with nothing pending is a no-op; any other reply changes
  nothing.
- The gated command runs only when armed, only when its payload equals
  the fenced text after normalization (trailing whitespace per line and
  trailing blank lines stripped), and only off `main`. The arm is
  consumed on success; a blocked attempt keeps the arm so a corrected
  retry needs no fresh approval.

Gated commands, matched by a best-effort scan of the shell command
string:

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

Hooks have no auto-discovered directory, so the entry point stays in
this repo and is registered by absolute path in the user-scope
`~/.claude/settings.json` (user scope because the approval policy
applies machine-wide, not per project). The registration is a one-time
settings edit; the script is never copied.

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "node /home/samflores/Code/agent-kit/extensions/approval-gate/core.mjs stop" }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          { "type": "command", "command": "node /home/samflores/Code/agent-kit/extensions/approval-gate/core.mjs userpromptsubmit" }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "node /home/samflores/Code/agent-kit/extensions/approval-gate/core.mjs pretooluse" }
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
  back.
- `userpromptsubmit`: arms the pending fence when the prompt contains
  the approval word.
- `pretooluse`: matcher `Bash`; enforces on `tool_input.command`. A
  blocked command exits 2 with the reason on stderr, which Claude Code
  surfaces as the denial.

## Fallback

`AG_GATE_STRICT_FENCES=0` disables transcript fence scanning. The
approval word alone arms the gate, and an armed command with no fence on
record runs without a payload check (the fence-dependent checks, such as
the demand for `-m` with the exact text, are skipped with it). This is
the documented fallback for unreliable transcript parsing; strict
matching is the default and the safe mode.

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
