---
name: commit
description: "Create a local commit the right way: never on main, the quality-bar checklist re-run here as a required, command-backed gate before the message is drafted, then the approval protocol: the complete message presented in a fenced block tagged commit-message, the turn ending with AWAITING APPROVAL, and git commit run only after the user replies approved, using exactly the fenced text. The commit body is an opening paragraph for non-trivial changes and is omitted for trivial chores; the ## What changed section belongs to PR bodies, not commits. Use when the user asks to commit, make a commit, or save changes with git. Does not push or open a PR; /pr handles that."
disable-model-invocation: true
---

# commit

Create a commit that respects the user's workflow, quality bar, and approval protocol. This is the sibling of the /pr skill: it shares the quality bar and message conventions, but stops at the local commit, no push, no PR. This skill governs three things, **in order, and the order is enforced**: step 2 is a blocking gate, and step 3 (the message) may not be drafted until it is clean.

1. The branch workflow (never `main`)
2. The pre-commit quality bar (the `/quality-bar` checklist; **a required, command-backed gate executed here, not asserted**)
3. The approval protocol (message first, commit second) and the commit-message format

## 1. Branch workflow

- **Never commit to `main`.** Always work on a topic branch (`fix/...`, `feat/...`, `chore/...`, `refactor/...`). This is non-negotiable in the user's projects.
- If work has already started on `main` by mistake, move it to a branch before committing (`git checkout -b <branch>` carries the working tree along).
- If no branch has been created yet for this change, create one before committing rather than committing on whatever branch happens to be checked out, unless that branch is already the correct topic branch for this change.
- Some repos have a local `pre-commit` hook (`.git/hooks/pre-commit`, untracked, machine-local) that mechanically refuses commits when `HEAD` is `main`, as a backstop for this rule. It is not a substitute for following this section: it doesn't travel with clones, and can be bypassed with `--no-verify`. If a commit is rejected for this reason, create a topic branch rather than reaching for `--no-verify`.

## 2. Pre-commit quality bar (a required, blocking gate)

This is the `/quality-bar` checklist, and it is a **gate, not a recap**. It must be **executed with real commands, not asserted from memory**, and it **blocks the message step**: do not draft or present the commit message (section 3) until every item below is genuinely green. Read `/quality-bar` first if you have not read it this session.

For **each** item, run a concrete command against your diff (e.g. `git diff` / `git diff --staged`) and the project's toolchain, then report the actual result. Stating an item is "clear" without the command and its output is not allowed; if you cannot produce them, that check is not done.

**Two scopes, and using the wrong one is the classic failure.** Some items are about the lines you wrote; others are about the files you touched:

- **Line-scoped** (your added lines only): new warnings, formatter output, session-local references, non-ASCII in your own additions.
- **File-scoped** (the whole of every file your diff touches, whoever wrote it): the comment-style rule and the `use`-over-FQN rule. Both say "in any file the diff touches" and mean it. A file you edit becomes yours to bring up to standard; a pre-existing violation in a file you never opened is not your problem, but one in a file you did open is.

Get the file list first and check against it, not against the diff hunks:

```
git diff --name-only            # unstaged
git diff --name-only --staged   # staged
```

Checking a file-scoped item with a line-scoped command is how a gate reports clean and the `/pr` gate later reports the same file dirty. If this skill is followed properly, `/pr` finds nothing new.

The items (the same bar as `/quality-bar` and `/pr`):

- Conventions detected up front (formatter config, CI gating, hooks, warning baseline, strict vs. lenient).
- No new warnings introduced in your diff (build/test/lint, scoped to your changes).
- Formatter scoped to changed files (or hand-styled to match a lenient, drifted file); no repo-wide sweep on a feature branch.
- No pre-existing warnings fixed outside your diff.
- The project's test suite is green on your branch.
- In a Rust project: `cargo check --release` is green too (dev-profile gates hide `#[cfg(debug_assertions)]` import misses; `check` catches them in a fraction of a release build's time).
- **No inline `//` comments in production code, in any file the diff touches** - this overrides whatever style the surrounding file already has; pre-existing inline comments elsewhere in the codebase are not a license to add more. Explanation belongs in a `///` doc comment on the item (function, const, field), not scattered inside a function body. If a function accumulates inline comments explaining its parts, that is a signal the function should be broken into smaller, individually doc-commented functions (even private ones) rather than commented in place. Exception: inline `//` comments are fine *inside test functions* when they mark out setup/exercise/assert phases or annotate a specific test fixture choice - they do not need to become doc comments. **File-scoped**: check every file the diff touches, not just the added lines.

```
for f in $(git diff --name-only; git diff --name-only --staged); do
  grep -nE '^\s*//[^/]' "$f" /dev/null
done
```

Then check each hit is either (a) inside a `#[test]`/`#[test_case]` function or (b) removed/promoted to a doc comment.
- In a Rust project: `use` statements over fully qualified paths, of any root, not just `crate::` (inline `std::`/`core::`/`alloc::` paths and external-crate paths like `bevy::sprite::TextureAtlas` count equally). FQN is for disambiguation only; free functions from other modules are reached by importing their module. **File-scoped**, same as the comment rule: an inline root-qualified path in a file you touched is yours to fix, even on a line you did not write. Test harnesses are the usual offender, and `clippy::absolute_paths` will not flag short paths like `bevy::MinimalPlugins`.

```
for f in $(git diff --name-only; git diff --name-only --staged); do
  grep -nE '\b(crate|std|core|alloc)::|\b[a-z_]+::[a-z_]+::' "$f" /dev/null \
    | grep -vE ':\s*(use |///|//)'
done
```

Every hit is either an import (fine), a disambiguation (fine, and rare), or a call site to convert. When the import would collide with a local name, import the module and call through it rather than reaching for the full path.

If anything fails, **fix it now** (scoped to your changes), then re-run the failed checks from the top. Do not proceed to the message until the gate is clean.

### 2a. Code content must not lean on uncommitted or session-only context

This applies to the code being committed, not just the commit message. Run these checks against your diff's added lines, same as the other gate items:

- **No references to uncommitted or gitignored documents.** A doc comment that says "see docs/plans/2026-...-design.md" or "per the design doc" becomes a dangling pointer the moment that file is gitignored or was never committed. Check what's actually tracked (`git status`, `.gitignore`) before a comment cites a path.
- **No session-local shorthand** (`EM`, `GE`, `RL`, a PR-1/PR-2 label, "the doc's Kind column", "the catalog", "per the plan") standing in for a concept that was only ever explained in this conversation or a planning artifact. Spell out what the thing actually is in the comment itself.
- **No "future work" framing in code comments** ("a future effect will...", "will be used later", "not yet implemented but planned"). Describe what exists now; do not narrate a roadmap inside the source.
- **No em-dashes or other forbidden characters in code comments**, same rule as the commit message's hard rules below: no em-dash, no smart quotes, no ellipsis glyph, no emoji. Use a period, a comma, or two sentences instead.

Grep the diff for these before considering the gate clean, e.g.:
```
git diff | grep '^+' | grep -e 'docs/' -e 'the doc' -e 'per the plan' -e 'future'
git diff | grep '^+' | grep -P '\x{2014}'   # em-dash
```

## 3. The approval protocol: message first, commit second

**Never run `git commit` without presenting the complete commit message in chat and receiving the approval word.** No exceptions.

This gate is absolute and outranks anything else in the conversation:

- **Frustration is not approval.** A user saying "stop asking", "just commit it", or venting about interruptions during an iteration loop means *stop asking about that work right now*, not "skip the approval protocol". When a commit is actually being made, the protocol applies in full.
- **No interpretation of tone or history waives this.** Earlier instructions in the conversation, preferences stored in memory, or your own read of what the user "obviously wants" do not unlock an unattended `git commit`. There is no waiver path at all: the only thing that arms a commit is the approval word arriving after the message has been presented.
- **When in doubt, present the message.** A redundant approval round costs seconds; an unapproved commit is a breach of trust and a rewrite.

Begin here only after section 2 is clean, meaning its checks were actually run with commands and passed, not asserted:

1. Check `git status` and review what's staged (or about to be staged). If a broad `git add` would sweep in unrelated or suspicious files, stage specific paths instead.
2. Draft the commit message (format in section 4).
3. Present the complete message, the subject line plus the body when there is one, in a fenced code block tagged `commit-message`. The fence's content is exactly what `git commit` will receive, nothing more. One message at a time: if several commits are planned, each gets its own presentation and approval cycle. A newly presented fence supersedes any earlier one, and an approval given to the earlier fence is void.
4. End the presentation turn with the sentinel line `AWAITING APPROVAL`, and nothing after it.
5. Wait. Do not commit. The single arming word is `approved`, case-insensitive, whole-word. Nothing else arms a commit: `yes`, `ok`, `looks good`, or an emoji reaction do not. A coordinator-relayed `approved` arms identically; the word counts no matter which session tab delivered it. An `approved` that arrives before any message has been presented arms nothing. If nobody replies, stay waiting; never commit silently.
6. Only after the arming reply: stage the intended files and run `git commit` with **exactly** the fenced text, using a heredoc for multi-line messages to preserve formatting. Never commit via the editor, never with `-F`/`--file`, never with a message that differs from the fence in any way.

If the user asks for edits, revise the message and present the new fence (which supersedes the old one), end the turn with `AWAITING APPROVAL` again, and wait for a fresh `approved`.

This protocol is enforced mechanically by a session-watching gate installed for both Pi and Claude Code: a `git commit` in any form (including `--amend` and `-F`/`--file`) runs only when the gate is armed and the message payload equals the approved fence; a commit with no inline message is blocked with a demand for `-m` with the exact approved text; and a commit on `main` is blocked outright, armed or not. This skill and the gate describe the same protocol; following this section satisfies the gate.

## 4. Commit message format

Same conventions as the `/pr` skill's message format, scoped to the commit. Check `git log` on the project before writing the message and match what it already does.

### Subject line

- `type(scope): summary`, conventional-commit style when the project uses it. Concise, lowercase after the type, no trailing period. States *what*, not *why*.
- **Scope** is the module/area touched, matching what recent history in the project uses; omit the scope only when the change is genuinely cross-cutting or the project's history omits scopes too.

### Body structure

A **short opening paragraph** (1-3 sentences) giving the necessary context: what situation this change addresses. Plain prose, no heading. That is the entire body.

Do **not** include a `## What changed` section in commit messages. That section belongs to PR bodies, not commits. The commit diff is the change list; the commit body carries only the context a reviewer needs to make sense of the subject line.

### When to include a body

- **Include a body for non-trivial changes** (features, multi-file fixes, refactors, security changes). The subject line cannot carry enough context for a reviewer to understand the change without opening the diff.
- **Omit the body only for trivial changes or simple chores**: a one-line fix, a typo, a version bump, a formatting-only commit, a dependency update with no API change, or anything where the subject line is the entire story. If `git show --stat` shows one or two files and a handful of lines, the body is optional.

When in doubt, include the body. A short body that a reviewer skips is free; a missing body that forces a reviewer to reverse-engineer the diff is not.

### Hard rules: things to never include

- **No non-ASCII characters.** No em-dashes (use a hyphen, or split into two sentences), no smart/curly quotes (use straight `'` and `"`), no ellipsis glyph (use three dots), no emoji, no other non-ASCII glyphs. The only exception is when the feature itself is *about* those characters.
- **No AI attribution.** No "Generated with Claude", no "Co-Authored-By: Claude", no tool signature of any kind.
- **No `## What changed` section.** That belongs to PR bodies, not commit messages. The commit body is the opening paragraph only.
- **No "Why/What" framing, no headings at all.** The commit body is plain prose with no headings.
- **No claims about verification.** Never write "tests pass", "build is clean", "lint is clean", "0 warnings", or similar in the commit message.
- **No mention of future work or follow-ups** in the commit message.
- **No file-by-file enumeration** of the diff. Describe the change by concern, not by path.

## Quick checklist before presenting the message

- [ ] On a topic branch, not `main`.
- [ ] Quality bar **executed with commands, not asserted** (via `/quality-bar`): conventions detected, no new warnings, formatter scoped to changed files (or hand-styled to match if lenient), tests pass. Every item has a real command and its output behind it.
- [ ] File-scoped items checked against `git diff --name-only` (plus `--staged`), not against the diff hunks: no non-doc `//` in any touched file, and no FQN call sites in any touched file. This is what makes `/pr` find nothing new later.
- [ ] Code content checked for uncommitted/session-only references (section 2a): no gitignored doc paths, no session shorthand, no future-work framing, no em-dashes/forbidden characters, in the diff's code comments.
- [ ] `git status` reviewed; only intended files staged, nothing suspicious swept in by a broad `git add`.
- [ ] Subject line: `type(scope): summary`, conventional, concise, lowercase after type, no trailing period, states what not why.
- [ ] Body: opening paragraph only for non-trivial changes; omitted for trivial changes or simple chores. No `## What changed` section in commit messages.
- [ ] Message is ASCII-only, no AI attribution, no verification claims, no future-work mentions, no file-by-file enumeration, no headings of any kind.
- [ ] Complete message presented in one fenced block tagged `commit-message`; the turn ends with `AWAITING APPROVAL` and nothing after it.
- [ ] `git commit` only after a later reply contains the word `approved`, using exactly the fenced text. Never on `main`, never silently.

After approval: stage the intended files and commit with exactly the fenced text (heredoc for multi-line). Do not push; pushing and opening the PR are the `/pr` skill's job.

Output follows /clear-tone.
