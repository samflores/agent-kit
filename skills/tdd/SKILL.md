---
name: tdd
description: Drive a code change with the strict TDD cycle: RED, GREEN, REFACTOR. Use when the user asks for TDD, says "write a failing test first", or asks to add a feature/fix a bug "with tests". Also use proactively when starting any non-trivial code change in a project that already has a test suite.
user_invocable: true
---

# tdd

Drive each change through one strict TDD cycle at a time. One small test, the smallest production change to make it green, refactor only if needed, then continue toward the agreed feature goal, chaining cycles autonomously and stopping only at completion, on a blocker, or before a meaningfully different decision.

## Never on main

Before the first cycle, check the branch. If you are on `main` (or the project's default branch), create one (`git checkout -b <descriptive-name>`) and tell the user the branch name. If you are already on a topic branch, stay on it: that branch is the one the work belongs to, and this skill never creates a second one.

If the user asks you to "do TDD on main", push back.

## The cycle

For each cycle, in order:

1. **RED: write ONE failing test.**
   - Pick the smallest behavior worth pinning down. Not "the whole feature", just one observable property.
   - Run it. Confirm it fails. If it passes, the test isn't testing the change you're about to make. Pick a different test or a different change.
   - If the test fails for the wrong reason (compile error, panic in setup), fix the test until it fails for the *right* reason.

2. **GREEN: write the smallest production code that makes the test pass.**
   - "Smallest" means: the least change that flips this one test from red to green. Hard-code a constant if that's enough. Resist the urge to also fix related issues you noticed.
   - Run the test. Confirm it passes.
   - Run the full suite. Confirm nothing else broke.

3. **REFACTOR: clean up, only if there's something to clean up.**
   - Did green leave duplication, a misleading name, a debug artifact (eprintln, env-var hooks added for debugging)? Remove it.
   - Don't refactor speculatively. If the code is fine, skip this step.
   - Run the full suite again after any refactor.

4. **Continue or stop.**
   - **Default: continue.** Chain cycles autonomously toward the agreed feature goal. The user opted into TDD because they want it driven through; pausing on every cycle is the wrong default.
   - **Stop and check in only when one of these holds**:
     - **Feature complete.** All behavior the user asked for is now pinned by tests. Name what was done and offer the natural next step (often a separate feature). Don't auto-continue into new scope.
     - **Blocker.** Compile failure you don't understand, test that won't go red for the right reason, ambiguous spec, missing context.
     - **Meaningfully different decision ahead.** The next cycle would commit to something the user might want to redirect:
       - A new design choice not implied by the original ask (new module, new public API, new abstraction layer).
       - Scope expansion beyond the agreed feature.
       - A surprise: discovered behavior, edge case, or constraint that changes what "done" looks like.
       - A risky operation (large refactor, dependency change, branch switch).
   - **Do NOT stop** for: the next obvious test in the same axis (negative-x, then negative-y, then right-edge, then bottom-edge), the next obvious step in a known plan, routine green/refactor transitions, or "while I'm here" judgement calls that are genuinely obvious.
   - When stopping mid-feature, name what was done, what's pending, and the specific question or surprise.
   - When the original ask spans many cycles, give a brief progress note every several cycles so the user can interrupt, but keep moving unless one of the stop conditions hits.

## Committing

This skill does not commit. A cycle ending green is a candidate commit point, not a commit.

Where the project has a commit skill or protocol, follow it and let it decide when and how anything lands. Where it does not, commit at points where the story stands alone, never mid-cycle, with the full suite green at each commit.

## Hard rules

- **Never write production code without a failing test that demands it.** "I know this needs to change" is not enough. Write the test, watch it fail, then change the code.
- **One test per cycle.** If you find yourself writing a second test "while I'm here", stop. That's the next cycle.
- **The test must fail for the reason you think it does.** Read the failure message. If a segfault is the only signal, dig until you understand why before writing the fix.
- **Don't fix unrelated bugs you discover mid-cycle.** Note them, finish the cycle, address them in their own cycle. The exception: if the discovered bug is *blocking* the current cycle from going green, fix it, but treat it as its own cycle (its own RED test if reachable).
- **Reverting is normal.** If green requires a fix that's larger than expected, revert the test, split the work, and start over with a smaller test.

## Anti-patterns to call out (yours and the user's)

- Writing the production change first, then writing a test that passes, is not TDD. That is test-after.
- Writing five tests up front, then implementing, is spec-first, not TDD. Each cycle is one test.
- Skipping the "watch it fail" step. The failure is evidence the test is doing work; without it, the test could be a no-op.
- "Refactoring" while green by adding new behavior. Refactor preserves behavior; new behavior is its own cycle.
- Treating discovered bugs as "not my problem". If you wrote the code or are working on it now, it's your problem. File or fix.

## When the user asks for "tests" but the change is a pure refactor

Pure refactors (no behavior change) don't have RED. The cycle is: existing tests are your safety net, change the code, full suite stays green. Say so explicitly; don't fake a RED step. If there's no test covering the area you're refactoring, the first cycle is to *add* a characterization test (which passes immediately) before touching the code.

## Handing off a series of cycles

This skill does not open PRs. When the cycles are done, the work is handed to whatever the project uses to land it.

What this skill owes that handoff: every commit individually green, the suite passing at each one rather than only at the tip. The rest of the pre-PR bar (warnings, linters, formatters, project review tools) belongs to the project's quality gate, which runs at that point rather than here.
