---
name: to-tickets
description: Break a plan, spec, or the current conversation into tracer-bullet tickets, each a functional deliverable that carries its change from foundation to user-facing behavior and declares its blocking edges, published to the configured tracker (edges as text in one file per ticket locally, or native blocking links on a real tracker).
disable-model-invocation: true
---

# To Tickets

Break a plan, spec, or conversation into a set of **tickets**: tracer-bullet vertical slices. Each ticket is a **functional deliverable**: it carries its change from foundation to user-facing behavior, and it declares the tickets that **block** it.

## Workflow position

To-tickets is the **slicing phase** of the build workflow. The phases in order:

1. **`/exploration`**: a loose idea becomes a settled design, worked as decision tickets with the owner.
2. **`/to-tickets`** (this skill): slice that settled design into the implementation tickets this section defines.
3. **`/coordinator`**: deliver the tickets as waves: one herdr tab and one git worktree per unblocked ticket, an implementer and a reviewer in split panes.
4. **`/implement`** and **`/code-review`**: the skills each tab agent applies, one ticket per agent, review before any approval.

The usual input is a settled exploration plan: its map plus its resolved decision tickets, which are the authority for every slice. This skill never makes or reopens decisions: an ambiguity or an unsettled question found while slicing goes back to the owner and the exploration effort, never decided here. Decision tickets and the tickets written here are different artifacts: decision tickets resolve decisions inside the exploration tracker; the tickets written here are the only kind a wave builds, and each one is delivered to a fresh agent in its own tab.

The issue tracker and triage label vocabulary should have been provided to you. If not, ask the user where tickets should be published (local files or a real tracker) and which labels apply, before drafting.

## Process

### 1. Gather context

Work from whatever is already in the conversation context. If the user passes a reference (a spec path, an issue number or URL) as an argument, fetch it and read its full body and comments.

### 2. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code. Ticket titles and descriptions should use the project's domain glossary vocabulary, and respect ADRs in the area you're touching.

Look for opportunities to prefactor the code to make the implementation easier. "Make the change easy, then make the easy change."

### 3. Draft vertical slices

Break the work into **tracer bullet** tickets.

<vertical-slice-rules>

- Each slice cuts a narrow but COMPLETE path through every layer (schema, API, UI, tests): vertical, NOT a horizontal slice of one layer
- Every ticket is a functional deliverable: it carries its change from foundation to user-facing behavior. Groundwork-only tickets are forbidden: no ticket stops at the foundation for a feature (the schema, the plumbing, the helper) and leaves the feature itself to a later ticket. Whenever possible the foundation and the user-facing feature that uses it land in the same ticket, sized to one session
- A completed slice is demoable or verifiable on its own
- Each slice is sized to fit in a single fresh context window
- Any prefactoring should be done first

</vertical-slice-rules>

The sanctioned deviations are the ones this section already carries: mechanical prefactoring done first, and wide refactors sequenced as expand-contract below.

Layers separate at **commit time, not ticket time**. A slice that carries real foundation weight still lands as one ticket, made through the **/commit** skill as a sequence of commits that each leave the build green.

**Nothing lands before something needs it. This holds inside a ticket exactly as it holds between tickets.** The same rule that forbids a groundwork-only ticket forbids a groundwork-only commit. A type, a token, a field, a table, or a helper arrives in the same commit as the code that reads it. A commit whose output has no consumer is dead code: it fails a `-D warnings` build, and no suppression fixes it, because the defect is the split, not the lint.

So a commit is separable only when it stands on its own: green, and with a consumer already present. Reachability, a migration that keeps existing callers working, a change to code that already has callers: those separate cleanly. A widget and the token it reads, a mode enum and the system that matches on it, a schema and its first query: those do not. When a layer cannot stand alone, it is not a separate commit.

Write the ticket's Commits line from that test, naming which layers are separable and which are not. Never write it as a generic foundation-then-behavior formula: that formula is what produces the dead-code commit. When no layer is separable, say the slice is one commit.

Give each ticket its **blocking edges**: the other tickets that must complete before it can start. A ticket with no blockers can start immediately.

**Wide refactors are the exception to vertical slicing.** A **wide refactor** is one mechanical change (rename a column, retype a shared symbol) whose **blast radius** fans across the whole codebase, so a single edit breaks thousands of call sites at once and no vertical slice can land green. Don't force it into a tracer bullet; sequence it as **expand-contract**. First expand: add the new form beside the old so nothing breaks. Then migrate the call sites over in batches sized by blast radius (per package, per directory), each batch its own ticket blocked by the expand, keeping CI green batch to batch because the old form still exists. Finally contract: delete the old form once no caller remains, in a ticket blocked by every migrate batch. When even the batches can't stay green alone, keep the sequence but let them share an integration branch that all block a final integrate-and-verify ticket; green is promised only there.

### 4. Quiz the user

Present the proposed breakdown as a numbered list. For each ticket, show:

- **Title**: short descriptive name
- **Blocked by**: which other tickets (if any) must complete first
- **What it delivers**: the end-to-end behavior this ticket makes work

Ask the user:

- Does the granularity feel right? (too coarse / too fine)
- Are the blocking edges correct: does each ticket only depend on tickets that genuinely gate it?
- Should any tickets be merged or split further?

Iterate until the user approves the breakdown.

### 5. Publish the tickets to the configured tracker

Publish the approved tickets. **How** depends on the configured tracker; the tickets are the same either way, only the shape of the blocking edges changes:

- **Local files**: write one file per ticket under `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01` in dependency order (blockers first). Each file's "Blocked by" lists the numbers/titles it depends on. Use the per-ticket file template below: one ticket per file, never a single combined file.
- **A real issue tracker (GitHub, Linear, ...)**: publish one issue per ticket in dependency order (blockers first) so each ticket's blocking edges can reference real identifiers. Use the platform's native blocking / sub-issue relationship where it has one; otherwise set each ticket's "Blocked by" to the blocking issues. Apply the `ready-for-agent` triage label unless instructed otherwise; the tickets are agent-grabbable by construction.

Work the **frontier**: any ticket whose blockers are all done. For a purely linear chain that means top to bottom.

Follow the repo's configured tracker location when it has one; the exploration effort's map names where its tracker lives, and the implementation tracker usually sits beside it (`docs/tickets/<effort>/` in repos that keep exploration under `docs/exploration/<effort>/`; `.scratch` is the default).

Do NOT close or modify any parent issue.

<local-ticket-template>

# <NN>: <Ticket title>

**What to build:** the end-to-end behavior this ticket makes work, from the user's perspective, not a layer-by-layer implementation list.

**Commits:** land this slice as commits that each stand on their own via /commit. Name which layers are separable and which are not, per the ticket's own work: nothing lands before something needs it. A slice with no separable layer is one commit.

**Blocked by:** the numbers/titles of the tickets that gate this one, or "None (can start immediately)".

**Status:** ready-for-agent

- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2

</local-ticket-template>

<issue-template>

## Parent

A reference to the parent issue on the tracker (if the source was an existing issue, otherwise omit this section).

## What to build

The end-to-end behavior this ticket makes work, from the user's perspective, not layer-by-layer implementation.

## Commits

Land this slice as commits that each stand on their own via /commit. Name which layers are separable and which are not, per the ticket's own work: nothing lands before something needs it. A slice with no separable layer is one commit.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Blocked by

- A reference to each blocking ticket, or "None (can start immediately)".

</issue-template>

In either form, avoid specific file paths or code snippets: they go stale fast. Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it and note briefly that it came from a prototype. Trim to the decision-rich parts, not a working demo, just the important bits.

Output follows /clear-tone.
