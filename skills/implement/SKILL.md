---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets. Follow the spec and ticket to the letter; do not improvise scope.

Use /tdd where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Commit at logical points using /commit. This is required, not optional. Never commit without presenting the commit message in chat and waiting for the user to reply approved. If nobody replies, stay waiting; do not commit.

Stop and ask the user whenever you are blocked, for any reason.

Output follows /clear-tone.
