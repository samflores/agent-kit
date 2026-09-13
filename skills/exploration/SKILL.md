---
name: exploration
description: Plan a huge chunk of work (more than one agent session can hold) as a shared plan of decision tickets on your issue tracker, and resolve them one at a time until the way to the goal is clear.
disable-model-invocation: true
---

A loose idea has arrived, too big for one agent session, and the details are not yet figured out: the way from here to the **goal** isn't visible yet. Exploration is about finding that way before anyone starts to build. This skill writes the way down as a **shared plan** on the repo's issue tracker, then works its **decision tickets** (questions whose resolution is a decision, not slices of a build to execute) one at a time until the way is clear.

The goal varies per effort, and naming it is the first act of planning: it shapes every ticket. It might be a spec to hand off and iterate on, a decision to lock before implementation starts, or a change made in place like a data-structure migration. The plan is domain-agnostic: engineering work, course content, whatever fits the shape.

## Plan, don't do

Exploration is **planning** by default: each ticket resolves a decision, and the plan is done when the way is clear, with nothing left to decide before someone goes and does the thing. The pull to just do the work is usually the signal you've reached the edge of the plan and it's time to hand off. An effort can override this in its **Notes**, carrying execution into the plan itself, but absent that, produce decisions, not deliverables.

## Refer by name

Every plan and ticket is an issue, so it has a **name**: its title. In everything the human reads (narration, the plan's Decisions-so-far), refer to it by that name, never by a bare id, number, or slug. A wall of `#42, #43, #44` is illegible; names read at a glance. The id and URL don't vanish; a name wraps its link, but they ride _inside_ the name, never stand in for it.

## The Plan

The plan is a single issue on this repo's issue tracker, labelled `exploration:plan`, the canonical artifact. Its tickets are child issues of the plan.

The plan is an **index**, not a store. It lists the decisions made and points at the tickets that hold their detail; a decision lives in exactly one place, its ticket, so the plan never restates it, only gists it and links.

**Where the plan, its child tickets, blocking, and ready-queue queries physically live is tracker-specific.**

- **Local markdown**: the plan is `.scratch/<effort>/map.md`, its tickets are files at `.scratch/<effort>/issues/NN-<slug>.md`, each carrying `Type:`, `Status:`, and `Blocked by:` lines. A ticket is unblocked when every listed blocker is resolved.
- **A real issue tracker**: native issues with the tracker's native blocking or sub-issue relationship.

If the repo has no tracker convention, ask the user which to use.

### The plan body

The whole plan at low resolution, loaded once per session. Open tickets are **not** listed: they are open child issues, found by query.

```markdown
## Goal

<what reaching the end of this plan looks like: the spec, decision, or change this effort is finding its way to. One or two lines; every session orients to it before choosing a ticket.>

## Notes

<domain; skills every session should consult; standing preferences for this effort>

## Decisions so far

<!-- the index: one line per closed ticket, enough to judge relevance, then zoom the link for the detail the ticket holds -->

- [<closed ticket title>](link): <one-line gist of the answer>

## Not yet specified

<!-- see "Open questions": in-scope questions you can't ticket yet; they graduate into tickets as decisions land -->

## Out of scope

<!-- see "Out of scope": work ruled beyond the goal; closed, never graduates -->
```

### Tickets

Each ticket is a **child issue** of the plan; the tracker's issue id is its identity. Its body is the question, sized to one 100K token agent session:

```markdown
## Question

<the decision or investigation this ticket resolves>
```

Each ticket carries an `exploration:<type>` label, one of `research`, `prototype`, `interview`, `task` (see [Ticket Types](#ticket-types)).

A session **claims** a ticket by assigning it to the dev driving the plan, **first**, before any work, so concurrent sessions skip it. That assignee _is_ the claim: an open, unassigned ticket is unclaimed.

Blocking uses the tracker's **native** dependency relationship: essential because it renders the ready queue _visually_ in the tracker's own UI, so the human sees what's takeable without opening the plan. Only a tracker that lacks native blocking falls back to a body convention. A ticket is **unblocked** when every ticket blocking it is closed; the **ready queue** is the open, unblocked, unclaimed tickets.

The answer isn't part of the body; it's recorded on resolution (see [Work the plan](#work-the-plan)). Assets created while resolving a ticket are linked from the issue, not pasted in.

## Ticket Types

Every ticket is either **HITL** (human in the loop, worked _with_ a human who speaks for themselves) or **AFK**, driven by the agent alone. A HITL ticket only resolves through that live exchange; the agent never stands in for the human's side of it (an interview agent that answers its own questions has broken this).

- **Research** (AFK): Reading documentation, third-party APIs, or local resources like knowledge bases to surface a fact a decision waits on. Resolved by a subagent that calls the Skill tool with "research". Use when knowledge outside the current working directory is required.
- **Prototype** (HITL): Raise the fidelity of the discussion by making a cheap, rough, concrete artifact to react to (an outline, a rough take, a stub, or UI/logic code) by calling the Skill tool with "prototype". Links the prototype as an asset. Use when "how should it look" or "how should it behave" is the key question.
- **Interview** (HITL): Conversation. The default case. Always call the Skill tool twice, for "interview" and "domain-modeling".
- **Task** (HITL or AFK): Manual work that must happen before a _decision_ can be made: nothing to decide, prototype, or research, but the discussion is blocked until it's done. Signing up for a service so its API can be judged, provisioning access, moving data so its shape can be seen. This is the one type that _does_ rather than decides, and it earns its place by unblocking a decision, not by delivering the goal. The agent drives it alone where it can (AFK); otherwise it hands the human a precise checklist (HITL). Resolved when the work is done; the answer records what was done and any resulting facts (credentials location, new URLs, row counts) later tickets depend on.

## Open questions

The plan is _deliberately_ incomplete: don't write down what you can't yet see. Beyond the live tickets lie the **open questions**: decisions and investigations you can tell are coming but can't yet pin down, because they hang on questions still open. Resolving a ticket sharpens the view ahead of it, graduating whatever's now specifiable into fresh tickets, one at a time, until the way to the goal is clear and no tickets remain.

The plan's **Not yet specified** section is where those open questions are written down: the suspected question, the area to revisit later. It's the un-ticketed space _toward_ the goal: everything here is in scope, just not sharp enough to ticket. Write as loosely or as fully as the view allows; it doubles as a signpost for collaborators reading where the effort is headed.

**Open question or ticket?** The test is whether you can state the question precisely now, _not_ whether you can answer it now.

- **Ticket when** the question is already sharp, even if it's blocked and you can't act on it yet.
- **Not yet specified when** you can't yet phrase it that sharply. Don't pre-slice an open question into ticket-sized pieces: it's coarser than a ticket, and one may graduate into several tickets, or none, once the questions it hangs on are settled.

**Not yet specified** excludes what's already decided (Decisions so far), what's already a live ticket, and what's out of scope (the next section).

## Out of scope

Open questions only ever gather _toward_ the goal. The goal fixes the scope, so work beyond it is **out of scope**: it isn't an open question, and it doesn't belong in **Not yet specified**. It gets its own **Out of scope** section on the plan: work you've consciously ruled out of _this_ effort. Scope, not sharpness, lands it here.

Out-of-scope work never graduates (the work stops at the goal), so it returns only if the goal is redrawn, and then as a fresh effort, not a resumption.

Ruling something out of scope is a scoping act, not a step on the way. When a ticket that already exists turns out to sit past the goal (mis-scoped in while planning, or exposed by a resolution), **close it** (a closed ticket is unambiguously out of the ready queue) and leave one line in the **Out of scope** section: the gist plus why it's out of scope, linking the closed ticket. It stays out of **Decisions so far**, which records the decisions actually made; a scope boundary isn't one of them.

## Invocation

Two modes. Either way, **never resolve more than one ticket per session**, with the exception of research tickets.

### Plan the work

User invokes with a loose idea.

1. **Name the goal.** Call the Skill tool twice, for "interview" and "domain-modeling", to pin down what this plan is finding its way to: the spec, decision, or change. The goal fixes the scope, so it's settled first.
2. **Surface the open decisions.** Interview again, **breadth-first** this time: fan out across the whole space rather than deep on any one thread, surfacing the open decisions and the first steps takeable now. **If this surfaces no open questions** (the way to the goal is already clear, the whole job small enough for one session), you don't need a plan. Stop and ask the user how they'd like to proceed.
3. **Create the plan** (label `exploration:plan`): Goal and Notes filled in, Decisions-so-far empty, the open questions sketched into **Not yet specified**.
4. **Create the tickets you can specify now** as child issues of the plan, then wire blocking edges in a **second pass** (issues need ids before they can reference each other). Wiring sorts them into the ready queue and the blocked; everything you can't yet specify stays in the open questions: the **Not yet specified** section.
5. **Fire the research subagents.** For each `research` ticket you just created, spin up a subagent that calls the Skill tool with "research" to resolve it in parallel, capturing its findings on a throwaway `research/<name>` branch with a context pointer from the ticket.
6. Stop: planning is one session's work; it hand-resolves nothing.

### Work the plan

User invokes with a plan (URL or number). A ticket is **optional**: without one, you pick the next decision, not the user.

1. Load the **plan**: the low-res view, not every ticket body.
2. Choose the ticket. If the user named one, use it. Otherwise take the first ticket from the ready queue, in order. **Claim it**: assign it to yourself before any work.
3. Resolve it. **Zoom as needed**: fetch the full body of any related or closed ticket on demand; call the Skill tool for whichever skills the `## Notes` block names. If in doubt, call the Skill tool twice, for "interview" and "domain-modeling".
4. Record the resolution: post the answer as a **resolution comment**, **close** the issue, and **append a context pointer** to the plan's Decisions-so-far.
5. Add newly-surfaced tickets (create-then-wire); graduate any open questions the answer has made specifiable, clearing each graduated entry from **Not yet specified** so it lives only as its new ticket. If the answer reveals that a ticket (this one or another) sits beyond the goal, **rule it out of scope** rather than resolving it on the way. If the decision invalidates other parts of the plan, update or delete those tickets.

The user may run unblocked tickets in parallel, so expect other sessions to be editing the tracker concurrently.

Output follows /clear-tone.
