The Claude Code approval-gate surface ships at `extensions/approval-gate/`
(`core.mjs` is the hook entry point; its README carries the registration
snippet for `~/.claude/settings.json`). Claude Code loads hooks only from
settings files, with no auto-discovered hooks directory, so install
decision: the script stays in this repo and is registered by absolute path
in the user-scope `~/.claude/settings.json` (user scope because the
approval policy applies machine-wide, not per project); the registration
is a one-time settings edit made at cutover and the script is never
copied. The adapter is validated against the native install under
`~/.local/share/claude/versions`; the stale npm tree under
`/usr/lib64/node_modules` is not a target.
