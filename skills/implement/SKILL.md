---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
---

Implement the work described by the user in the spec or tickets. Follow the spec and ticket to the letter; do not improvise scope.

Workflow position: this skill runs inside the **delivery phase** of the build workflow, on one implementation ticket that `/to-tickets` sliced from a settled `/exploration` plan, usually inside a `/coordinator` wave (one herdr tab, one worktree, one branch, one implementer). The authority chain is the ticket, then the effort map, then the exploration decisions behind it. Open questions are never decided here: stop and ask.

Drive every change to behavior through /tdd: the failing test first, then the smallest production change that makes it pass. This is required, not optional, and it does not depend on a seam being agreed in advance.

If you cannot follow /tdd for a given change, do not proceed without it and do not decide on your own that the change is exempt. Stop, report BLOCKED with the reason the cycle does not apply, and wait for the user to approve the exemption before writing the code.

You are already on the ticket's branch when /tdd runs, so it creates none; commits go through /commit below, one fence and one approval each.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Commit whenever the ticket reaches a new working state: a feature that works end-to-end, a test suite that passes after a meaningful change, a refactor that leaves the build green. Do not commit at every change; commit at milestones that represent real progress. Do not accumulate large diffs. This is required, not optional. Present each commit or PR message in full, in a fenced code block tagged commit-message or pr-message: the commit message as subject plus body, the PR message as title, blank line, body. One message at a time. Run the commit or PR creation using exactly the fenced text, and only after a later reply in this session contains the word approved. If nobody replies, stay waiting; do not commit.

Stop and ask the user whenever you are blocked, for any reason.

End every turn with exactly one final line, and nothing after it: AWAITING APPROVAL (a fence is presented and you are waiting on the approval word), BLOCKED: <one-line question> (stopped for any reason), or IMPLEMENTATION COMPLETE (ticket work done).

Output follows /clear-tone.
