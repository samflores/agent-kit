---
name: pr
description: "Open a pull request the right way: branch-based, the quality-bar checklist re-run here as a required, command-backed gate before the message is drafted, then the approval protocol: the complete message (title, blank line, body) presented in a fenced block tagged pr-message, the turn ending with AWAITING APPROVAL, and the push plus gh pr create only after the user replies approved, using exactly the fenced text. PR body is a short opening paragraph plus a ## What changed section grouped by concern, not by file. Use when opening a PR, writing a PR description or title, or preparing a change for review. The drafted title and body go through the humanizer skill before they are presented."
---

# pr

Open a pull request that respects the user's workflow, quality bar, and approval protocol. This skill governs four things, **in order, and the order is enforced**: step 2 is a blocking gate, and steps 3 and 4 (the message and the push) may not begin until it is clean.

1. The branch workflow (never `main`)
2. The pre-PR quality bar (the `/quality-bar` checklist; **a required, command-backed gate executed here, not asserted**)
3. The approval protocol (message first, push second)
4. The PR message format

## 1. Branch workflow

- **Never commit to or push to `main`.** Always work on a topic branch (`fix/...`, `feat/...`, `chore/...`, `refactor/...`). This is non-negotiable in the user's projects.
- Create the branch off the current integration branch (usually `main`), do the work, and open a PR at the end.
- If the work has already started on `main` by mistake, move it to a branch before committing (`git checkout -b <branch>` carries the working tree along).
- Some repos have a local `pre-commit` hook (`.git/hooks/pre-commit`, untracked, machine-local) that mechanically refuses commits when `HEAD` is `main`, as a backstop for this rule. It is not a substitute for following this section: it doesn't travel with clones, doesn't cover pushes, and can be bypassed with `--no-verify`. If a commit is rejected for this reason, create a topic branch rather than reaching for `--no-verify`.

## 2. Pre-PR quality bar (a required, blocking gate)

Execute the `/quality-bar` skill against the branch. It is a **gate, not a
recap**: every item needs a real command and its output behind it, and it
**blocks every later step**. Do not draft or present the PR message
(sections 3-4) until the gate is clean. The failure this guard exists to
stop: listing the items with "clear" beside each from memory, then jumping
straight to the message.

`/quality-bar` carries the full bar and the reasoning behind each item. Read
it there. What follows is only what is specific to opening a PR.

**Establish the base first.** A PR in a stack sits on the branch below it,
not on `main`. Ask or check (`gh pr list`) before assuming, then use that
base in every command here. Getting this wrong scopes the whole gate to the
wrong range.

**Two scopes, same as `/commit`.** Line-scoped items (new warnings,
formatter, session-local references, non-ASCII additions) check your added
lines. File-scoped items (comment style, `use` over FQN) check the whole of
every file the branch touches:

```
git diff --name-only <base>..HEAD
```

**If `/commit` was followed properly this gate finds nothing new.** It
covers a wider range, every commit on the branch rather than just the last
one, so a violation surfacing here means an earlier commit's gate used a
line-scoped command for a file-scoped item, or the branch carries commits
made before the rule was in force. Either way: fix it in a new commit on
top, never amend a commit that is already pushed or already has a PR
pointing at it.

The file-scoped greps:

```
for f in $(git diff --name-only <base>..HEAD); do
  grep -nE '^\s*//[^/]' "$f" /dev/null
done
```

Each hit is either inside a test function and meeting the narrowed test
exception (one line, a phase marker or a site-specific fixture choice, no
rationale narration, no text duplicated from another site), or removed. Code
blocks inside committed docs are prose, not production code.

```
for f in $(git diff --name-only <base>..HEAD); do
  grep -nE '\b(crate|std|core|alloc)::|\b[a-z_]+::[a-z_]+::' "$f" /dev/null \
    | grep -vE ':\s*(use |///|//)'
done
```

Every hit is an import (fine), a disambiguation (fine, and rare), or a call
site to convert.

If anything fails, **fix it now** (scoped to your changes), then re-run the
failed checks from the top. If you are unsure whether a check applies, run
it anyway and let the output decide.

### 2a. Code content must not lean on uncommitted or session-only context

This applies to the code being shipped in the PR, not just the PR message. Run these checks against your diff's added lines, same as the other gate items:

- **No references to uncommitted or gitignored documents.** A doc comment that says "see docs/plans/2026-...-design.md" or "per the design doc" becomes a dangling pointer once that file is gitignored or was never committed, and reviewers cannot follow it. Check what's actually tracked (`git status`, `.gitignore`) before a comment cites a path.
- **No session-local shorthand** (`EM`, `GE`, `RL`, a PR-1/PR-2 label, "the doc's Kind column", "the catalog", "per the plan") standing in for a concept that was only ever explained in this conversation or a planning artifact. Spell out what the thing actually is in the comment itself.
- **No "future work" framing in code comments** ("a future effect will...", "will be used later", "not yet implemented but planned"). Describe what exists now; do not narrate a roadmap inside the source.
- **No em-dashes or other forbidden characters in code comments**, same rule as the PR message's hard rules below: no em-dash, no smart quotes, no ellipsis glyph, no emoji. Use a period, a comma, or two sentences instead.

Grep the diff for these before considering the gate clean, e.g.:
```
git diff <base>..HEAD | grep '^+' | grep -e 'docs/' -e 'the doc' -e 'per the plan' -e 'future'
git diff <base>..HEAD | grep '^+' | grep -P '\x{2014}'   # em-dash
```

## 3. The approval protocol: message first, push second

**Never push the branch or run `gh pr create` without presenting the complete PR message in chat and receiving the approval word.** No exceptions.

This gate is absolute and outranks anything else in the conversation:

- **Frustration is not approval.** A user saying "stop asking", "just push it", or venting about interruptions means *stop asking about that work right now*, not "skip the approval protocol". When a PR is actually being opened, the protocol applies in full.
- **No interpretation of tone or history waives this.** Earlier instructions in the conversation, preferences stored in memory, or your own read of what the user "obviously wants" do not unlock an unattended push or `gh pr create`. There is no waiver path at all: the only thing that arms the PR creation is the approval word arriving after the message has been presented.
- **When in doubt, present the message.** A redundant approval round costs seconds; an unapproved PR is a breach of trust.

Begin here only after section 2 is clean, meaning its checks were actually run with commands and passed, not asserted:

1. Draft the PR **title** and **body** (format in section 4), then run the
   humanizer pass over them (section 4a) before presenting.
2. Present the complete message, the title, a blank line, then the body, in a fenced code block tagged `pr-message`. The fence's content is exactly what `gh pr create` will receive as title and body, nothing more. One message at a time; a newly presented fence supersedes any earlier one, and an approval given to the earlier fence is void.
3. End the presentation turn with the sentinel line `AWAITING APPROVAL`, and nothing after it.
4. Wait. Do not push and do not create the PR. The single arming word is `approved`, case-insensitive, whole-word. Nothing else arms the creation: `yes`, `ok`, `looks good`, or an emoji reaction do not. A coordinator-relayed `approved` arms identically; the word counts no matter which session tab delivered it. An `approved` that arrives before any message has been presented arms nothing. If nobody replies, stay waiting; never push or create the PR silently.
5. Only after the arming reply: `git push -u origin <branch>`, then `gh pr create --base <base> --head <branch>` with **exactly** the fenced title and body, passed inline (`--title`, `--body`, or a heredoc for the body to preserve formatting), never from a `--body-file`, and never with text that differs from the fence in any way. Post the PR URL.

If the user asks for edits, revise the message and present the new fence (which supersedes the old one), end the turn with `AWAITING APPROVAL` again, and wait for a fresh `approved`.

This protocol is enforced mechanically by a session-watching gate installed for both Pi and Claude Code: `gh pr create` runs only when the gate is armed and the title and body match the approved fence. `git push` is not mechanically gated, but the ordering here is not negotiable: the approval word comes before the push, not after.

## 4. PR message format

This is the part the user cares about most. Follow it exactly.

### Title

- Conventional-commit style when the project uses it (`fix(shared): ...`, `feat(authsrv): ...`, `chore: ...`, `docs: ...`).
- Concise, lowercase after the type, no trailing period.
- States *what*, not *why*.

### Body structure

Two parts, nothing else:

1. A **short opening paragraph** (1-3 sentences) giving the necessary context: what situation this change addresses. Plain prose, no heading.
2. A **`## What changed`** section: a summary of the substantive changes, grouped by **concern, not by file**, as a bulleted list or short prose. Describe what the change does and why it's structured that way; the PR diff already enumerates the files.

Do **not** use a `## Why` / `## What` split. The opening paragraph carries the why; `## What changed` carries the what. That is the entire structure.

### Line wrapping: the body is never hard-wrapped

The PR body is rendered as Markdown by GitHub, which reflows prose to the reader's viewport. Fixed-column line breaks (72, 80, or any other width) inside a paragraph are therefore defects: they shatter the paragraph into ragged fragments and break copy-paste and diffing of the body.

- Each paragraph of the body is **one line**: write the full sentence flow with no line breaks inside it, and let the viewer wrap it.
- A blank line separates paragraphs, exactly as in rendered Markdown.
- This applies to the PR body only. The title is one line by nature, and this rule says nothing about commit messages, which follow their own skill.

### Hard rules: things to never include

- **No non-ASCII characters.** Commit messages, the PR title, and the PR body must be plain ASCII. No em-dashes (use a regular hyphen `-`, or split into two sentences), no smart/curly quotes (use straight `'` and `"`), no ellipsis glyph (use three dots `...`), no emoji, no other non-ASCII glyphs. Favor natural ASCII punctuation. The only exception is when the feature itself is *about* those characters (e.g. localizing emoji rendering, or changing how the app handles em-dashes), in which case they're load-bearing, not decorative. Check before presenting.
- **No "Why/What" framing.** No `## Why` heading. No `## What` heading (the section is `## What changed`, and the why lives in the opening paragraph, not under a heading).
- **No claims about verification.** Never write "tests pass", "build is clean", "lint is clean", "0 warnings", "219 tests passing", "verified with ...", benchmark numbers, or anything in that family. A PR exists only when these are true; stating them is noise. The CI run is the source of truth, not the description.
- **No mention of future work, follow-ups, or "next PRs".** This PR is complete in itself. Do not write "in a follow-up", "next, we could", "not in this PR", "future work", or suggest a `chore/...` branch for later. The only exception is when the PR is *genuinely incomplete* and explicitly blocked on another piece of work. Then say so plainly and explain the dependency. Otherwise: the next PR is the next PR.
- **No file-by-file enumeration, and no pasted file contents.** Do not walk the diff listing individual file paths; the PR view already shows the changed files, and a per-file list just restates the diff in prose. Summarize by concern ("the dispatch codegen", "the SSR fallback", "the client submit interceptor"), not by path. No pasted contents either: no YAML, no code blocks copied from the diff, no config snippets. The body explains intent and structure, not the literal bytes or the file manifest.
- **No "Stack impact" / "reviewing advice" / meta-commentary** unless the user asks. The description is about the change, not about how to read it.

### Optional, only when true and load-bearing

- A note on scope when the diff is large but mechanical (e.g. "pure `cargo fmt` output, no semantic edits"): only when that fact is non-obvious and would otherwise confuse a reviewer. Keep it to one line in the opening paragraph.

### 4a. The humanizer pass

Before presenting any fence, run the drafted title and body through the
humanizer skill. Pick by the language the message is written in:

- `/humanizer` for English.
- `/humanizer-pt-br` for Portuguese.

Where neither skill is installed, skip the step; it is a quality pass, not a
gate, and its absence blocks nothing.

Run it **before** the fence is presented, never after. Once a fence is
presented, the text is locked: the approval gate matches the payload against
the approved fence, so a message rewritten after approval no longer matches
and `gh pr create` is refused.

The patterns worth cutting from a PR body specifically:

- Significance inflation ("marks a shift", "a key step", "lays the
  groundwork").
- `## What changed` bullets that walk the diff path by path instead of
  grouping by concern.
- Rule-of-three bullet lists padded to three items for symmetry.
- Generic positive closers ("this sets the project up well").
- Em-dashes and any other non-ASCII, which the hard rules below forbid
  outright.

Take the humanizer's final rewrite, not its draft. If its rewrite loses a
fact the body needed, put the fact back rather than reverting the pass.

## Quick checklist before presenting the message

- [ ] On a topic branch, not `main`.
- [ ] Base established (the branch below in a stack, not assumed to be `main`) and used in every gate command.
- [ ] Quality bar **executed with commands, not asserted** (via `/quality-bar`): conventions detected, no new warnings, formatter scoped to changed files (or hand-styled to match if lenient), tests pass. Every item has a real command and its output behind it.
- [ ] File-scoped items checked against `git diff --name-only <base>..HEAD`, not against the diff hunks: no non-doc `//` and no FQN call sites in any file the branch touches. Test inline comments, where they exist, are one-line phase or fixture markers only, with no rationale narration and no repetition across sites.
- [ ] Code content checked for uncommitted/session-only references (section 2a): no gitignored doc paths, no session shorthand, no future-work framing, no em-dashes/forbidden characters, in the diff's code comments.
- [ ] Title: conventional, concise, states what.
- [ ] Body: short context paragraph + `## What changed` only.
- [ ] Body paragraphs are one line each, no fixed-column hard-wrapping anywhere in the body.
- [ ] Humanizer pass run over the drafted title and body (`/humanizer`, or `/humanizer-pt-br` for Portuguese) before presenting, and its final rewrite taken.
- [ ] Commit messages and PR title/body are ASCII-only (no em-dashes, smart quotes, or emoji) unless the feature itself is about those characters.
- [ ] No verification claims, no future-work mentions, no pasted file contents, **no file-by-file enumeration in `## What changed` (group by concern)**, no Why/What framing.
- [ ] Complete message presented in one fenced block tagged `pr-message` (title, blank line, body); the turn ends with `AWAITING APPROVAL` and nothing after it.
- [ ] Push and `gh pr create` only after a later reply contains the word `approved`, using exactly the fenced text. Never on `main`, never silently.

After approval: `git push -u origin <branch>`, then `gh pr create --base <base> --head <branch>` with exactly the fenced title and body. Post the PR URL.

Output follows /clear-tone.
