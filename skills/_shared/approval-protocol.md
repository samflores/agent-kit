# The approval protocol

The single source of truth for the rules /commit and /pr share: the approval
gate, the humanizer pass, and the session-content checks. Each skill's
SKILL.md keeps only its deltas: the gated command, the fence tag, the diff
range, and the message format. A rule changed here holds for both skills
with no second edit.

## The gate

**Never run the gated command without presenting the complete message in
chat and receiving the approval word.** No exceptions. This gate is absolute
and outranks anything else in the conversation:

- **Frustration is not approval.** A user saying "stop asking", "just commit
  it", or venting about interruptions during an iteration loop means *stop
  asking about that work right now*, not "skip the approval protocol". When
  the gated command is actually being run, the protocol applies in full.
- **No interpretation of tone or history waives this.** Earlier instructions
  in the conversation, preferences stored in memory, or your own read of
  what the user "obviously wants" do not unlock an unattended run. There is
  no waiver path at all: the only thing that arms a run is the approval word
  arriving after the message has been presented.
- **When in doubt, present the message.** A redundant approval round costs
  seconds; an unapproved run is a breach of trust.

## Presentation and waiting

1. Present the complete message, exactly as the calling skill defines it, in
   a fenced code block tagged `commit-message` or `pr-message`. The fence's
   content is exactly what the gated command will receive, nothing more.
2. One message at a time: if several are planned, each gets its own
   presentation and approval cycle. A newly presented fence supersedes any
   earlier one, and an approval given to the earlier fence is void.
3. End the presentation turn with the sentinel line `AWAITING APPROVAL`, and
   nothing after it.
4. Wait. Do not run the gated command. The single arming word is `approved`,
   case-insensitive, whole-word. Nothing else arms a run: `yes`, `ok`,
   `looks good`, or an emoji reaction do not. A coordinator-relayed
   `approved` arms identically; the word counts no matter which session tab
   delivered it. An `approved` that arrives before any message has been
   presented arms nothing. If nobody replies, stay waiting; never run
   silently.
5. Only after the arming reply: run the gated command with **exactly** the
   fenced text, never with text that differs from the fence in any way. The
   calling skill defines the mechanics (staging, heredoc, inline flags).

If the user asks for edits, revise the message and present the new fence
(which supersedes the old one), end the turn with `AWAITING APPROVAL` again,
and wait for a fresh `approved`.

## The mechanical gate

This protocol is enforced mechanically by a session-watching gate installed
for both Pi and Claude Code. An unarmed `git commit` in any form (including
`--amend` and `-F`/`--file`) or an unarmed `gh pr create` is blocked, a
commit with no inline message is blocked with a demand for `-m` carrying the
exact approved text, and a commit on `main` is blocked outright, armed or
not. `git push` is not mechanically gated, so the ordering above is what
holds it: the approval word comes before the push, not after. This file and
the gate describe the same protocol; following it satisfies the gate.

## The humanizer pass

Before presenting any fence, run the drafted message through the humanizer
skill. Pick by the language the message is written in:

- `/humanizer` for English.
- `/humanizer-pt-br` for Portuguese.

Where neither skill is installed, skip the step; it is a quality pass, not a
gate, and its absence blocks nothing.

Run it **before** the fence is presented, never after. Once a fence is
presented, the text is locked: the approval gate matches the payload against
the approved fence, so a message rewritten after approval no longer matches
and the gated command is refused.

Take the humanizer's final rewrite, not its draft. If its rewrite loses a
fact the message needed, put the fact back rather than reverting the pass.

Patterns worth cutting from any message in this workflow:

- Inflating the change's significance ("marks a shift", "a key step", "lays
  the groundwork").
- Em-dashes and any other non-ASCII, which the message hard rules forbid
  outright.

Each calling skill lists the patterns specific to its surface alongside its
pointer to this section.

## Session-content checks (a quality-gate item)

This applies to the code being shipped, not just the message. Run these
checks against the diff's added lines, same as the other gate items, before
considering the gate clean. The calling skill defines the range:

- **No references to uncommitted or gitignored documents.** A doc comment
  that says "see docs/plans/2026-...-design.md" or "per the design doc"
  becomes a dangling pointer the moment that file is gitignored or was never
  committed. Check what's actually tracked (`git status`, `.gitignore`)
  before a comment cites a path.
- **No session-local shorthand** (`EM`, `GE`, `RL`, a PR-1/PR-2 label, "the
  doc's Kind column", "the catalog", "per the plan") standing in for a
  concept that was only ever explained in this conversation or a planning
  artifact. Spell out what the thing actually is in the comment itself.
- **No "future work" framing in code comments** ("a future effect will...",
  "will be used later", "not yet implemented but planned"). Describe what
  exists now; do not narrate a roadmap inside the source.
- **No em-dashes or other forbidden characters in code comments**, same rule
  as the message hard rules: no em-dash, no smart quotes, no ellipsis glyph,
  no emoji. Use a period, a comma, or two sentences instead.

Grep the diff for these, substituting the skill's range for `<range>`:

```
git diff <range> | grep '^+' | grep -e 'docs/' -e 'the doc' -e 'per the plan' -e 'future'
git diff <range> | grep '^+' | grep -P '\x{2014}'   # em-dash
```
