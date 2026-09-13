This directory will hold the pi approval-gate extension: an in-process
TypeScript extension that watches session messages for the approval word and
blocks unarmed `git commit` and `gh pr create` tool calls, per the protocol
pinned in `docs/research/approval-gate-mechanics.md` (its pi section covers
the `tool_call` event, `message_end`, and the `{ block, reason }` return
shape). Install decision: symlinked into `~/.config/pi/agent/extensions/`, this
machine's pi agent directory (`PI_CODING_AGENT_DIR`, exported globally in
the fish config, overrides pi's `~/.pi/agent` default), so the repo stays
the single source of truth and uninstall is removing the symlink.
