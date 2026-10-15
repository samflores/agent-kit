---
name: worktree-setup
description: "Configure a repo so fresh git worktrees carry the local-only files work depends on: the gitignored paths a clone never sees (trackers, local tool settings, env files). Covers worktrunk (wt) configuration with .worktreeinclude and a copy-ignored pre-start hook, the user-level copy hook gap that silently skips ignored files, and the manual fallback where wt is absent. Run once per repo, before any worktree-based workflow depends on those files being present."
---

# worktree-setup

A fresh git worktree carries **tracked content only**. Anything gitignored is
absent, and that is usually the wrong default: a repo's local-only files are
often exactly what makes work in the worktree possible.

This is one-time repo setup. Run it before a worktree-based workflow depends
on those files, not per worktree.

## What goes missing

Inventory the gitignored paths that work in a worktree actually needs. The
recurring ones:

- **A local tracker or ticket directory**, when agents read their own ticket
  from their own worktree.
- **Tool settings that are gitignored by design**, such as local agent or
  hook settings, deliberately not committed because they are machine-local.
- **Environment files** the app or test suite reads.

A path that is tracked needs nothing here. The list is only ever the
gitignored ones.

## The user-level copy hook gap

Check for an existing copy hook before adding anything, and read what it
actually copies. A hook that copies **untracked** files will not carry
**ignored** ones: `git ls-files --others --exclude-standard` excludes
ignored paths by design, and that is the usual implementation.

This is the gap the allowlist below fills. An existing hook is not evidence
the problem is solved.

## With worktrunk (wt)

Where worktrunk is installed, its own machinery does the copy and the repo is
configured once:

- `.worktreeinclude` lists the gitignored paths to carry over, one per line.
- `.config/wt.toml` runs the copy on creation:

  ```toml
  pre-start = "wt step copy-ignored --require-include"
  ```

  `--require-include` confines the copy to that allowlist instead of sweeping
  every ignored path, which would drag in build output and dependency
  directories.

- Worktree creation then goes through `wt switch --create <slug>`, which
  fires the hook. Plain `git worktree add` skips it and produces a worktree
  missing the files.

Creating a worktree on a base other than the default branch takes the base
explicitly, and still fires the hook:

```bash
wt switch --create <slug> --base <base-branch>
```

`wt remove` retires a worktree and its branch together.

## Without worktrunk

Copy the allowlisted paths into the worktree as an explicit step immediately
after `git worktree add`, before any work starts in it. The paths are the
same inventory; only the mechanism differs.

## Verifying

After creating a worktree, confirm each allowlisted path is present in it.
A missing file surfaces later as a confusing failure inside the worktree
(a tool reporting no configuration, an agent unable to find its input)
rather than as an obvious setup error, so check at creation time.

Worktrees themselves live under a gitignored directory (`.worktrees/` is the
usual choice). Add that entry if the repo lacks it.
