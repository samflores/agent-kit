---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets. Follow the spec and ticket to the letter; do not improvise scope.

Workflow position: this skill runs inside the **delivery phase** of the build workflow, on one implementation ticket that `/to-tickets` sliced from a settled `/exploration` plan, usually inside a `/coordinator` wave (one herdr tab, one worktree, one branch, one implementer). The authority chain is the ticket, then the effort map, then the exploration decisions behind it. Open questions are never decided here: stop and ask.

Use /tdd where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Commit at logical points using /commit. This is required, not optional. Present each commit or PR message in full, in a fenced code block tagged commit-message or pr-message: the commit message as subject plus body, the PR message as title, blank line, body. One message at a time. Run the commit or PR creation using exactly the fenced text, and only after a later reply in this session contains the word approved. If nobody replies, stay waiting; do not commit.

Stop and ask the user whenever you are blocked, for any reason.

End every turn with exactly one final line, and nothing after it: AWAITING APPROVAL (a fence is presented and you are waiting on the approval word), BLOCKED: <one-line question> (stopped for any reason), or IMPLEMENTATION COMPLETE (ticket work done).

Output follows /clear-tone.
