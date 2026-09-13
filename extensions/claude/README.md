This directory will hold the Claude Code approval-gate adapter: a Node hook
script implementing the same protocol on the Claude Code side, per
`docs/research/approval-gate-mechanics.md` (its Claude Code section covers the
PreToolUse block, the UserPromptSubmit arming event, and session-keyed state
files under `~/.cache/approval-gate`). Claude Code loads hooks only from
settings files, with no auto-discovered hooks directory, so install decision:
the script stays in this repo and is registered by absolute path in the
user-scope `~/.claude/settings.json` (user scope because the approval policy
applies machine-wide, not per project); the registration is a one-time
settings edit made at cutover and the script is never copied. The adapter is
validated against the native install under `~/.local/share/claude/versions`;
the stale npm tree under `/usr/lib64/node_modules` is not a target.
