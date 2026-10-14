---
name: quality-bar
description: "The project-aware quality bar for code you write. Invoke before implementing a plan or feature and again before committing: detect the project's formatter, linter, CI, and hook conventions, match them, and scope cleanup to your changes. Never impose strictness the project lacks, never sweep untouched code, never introduce new warnings."
---

# quality-bar

The project-aware quality bar for code you write. The goal is to **match the project, not impose your own conventions**: detect what it already enforces, match it, and scope cleanup to your changes. Never impose strictness the project doesn't have, and never sweep untouched code.

**Invoke this skill twice:**

1. **Before you start implementing** a plan or feature, to detect conventions and establish the bar up front. This is the point: clear the bar as you write, so the work is never "good enough to PR but needs a cleanup pass."
2. **Re-check before committing** (and again when the `/pr` skill runs), as a confirmation that nothing regressed.

This skill governs the bar only. It does **not** touch branching, PR messages, or the approval gate; those live in the `/pr` skill.

## 1. Detect conventions before starting work

Before writing code, check what the project actually enforces:

- **Formatter config**: `.rustfmt.toml`; `.rubocop.yml`; `.prettierrc` / `prettier.config.*`; `eslint.config.*` with formatting rules; `pyproject.toml` with `[tool.black]` / `[tool.ruff]`.
- **CI gating**: scan `.github/workflows/`, `.gitlab-ci.yml`, etc. for fmt / lint / typecheck steps that break the build.
- **Pre-commit hooks**: `.husky/`, `lefthook.yml`, `.pre-commit-config.yaml`, `lint-staged` in `package.json`.
- **Warning baseline**: run the linter on the integration branch and note the count. If the project ships with N existing warnings and CI is green, it tolerates that baseline; you are not responsible for clearing it.

This tells you whether the project is **strict** (CI gates fmt + warnings) or **lenient** (formatter optional, warnings tolerated). Do this detection once, up front, and reuse it for every change in the feature.

## 2. Apply the bar, scoped to your changes

- **Never introduce new warnings** in code you write or modify. Your diff must not regress the linter on your own lines, regardless of the project's strictness.
- **Format only the files you modified**, not the whole repo. Most tools take paths: `rubocop -A <files>`, `prettier --write <files>`, `eslint --fix <files>`, `black <files>`, `ruff format <files>`, `rustfmt --edition <ed> <files>`. (`cargo fmt` with no args walks the whole workspace; if the tree is drifted, scope with the path-taking variant to avoid a noisy sweep. If CI enforces workspace-wide fmt and the tree is already clean, `cargo fmt` is a no-op outside your file.)
- **If a file you touched is heavily drifted and the project is lenient**, hand-style your additions to match the file's existing style instead of running the formatter; running it would flood the diff with unrelated changes.
- **Don't fix pre-existing warnings outside your diff.** Unrelated warnings on lines you didn't change belong in a separate cleanup PR, not this one.
- **If the project is strict**, match the bar fully on your changes; CI defines the scope it checks.
- **Tests pass.** The project's test suite must be green on your branch.

If the project has no formatter or linter configured, skip that step. Don't invent one.

### Comments

Project-aware, like the rest of the bar: detect the codebase's commenting style and match it.

- **Detect first.** Skim the files in your area of the change and the surrounding code. Is it clean of inline comments (idiomatic Rust, most modern JS), or does it use them freely (kernel C, hardware/crypto code, files with bit-layout or register maps)? Some linters flag them (`rubocop Style/InlineComment`, eslint `no-inline-comments`); check the config too.
- **Default to no inline comments.** This is the user's preference. Prefer names, structure, and tests to carry meaning. A comment that paraphrases the code is noise.
- **If the file or domain uses inline comments idiomatically**, match that; for example, a register map, a bit-packing layout, a non-obvious math identity, or `// SAFETY:` blocks a linter requires. These are load-bearing and stay.
- **For item-level explanation**, use a **documentation comment** (`///` in Rust, docstrings, JSDoc) on the item it describes, not a `//` aside inside a function body.
- **Doc comments document the API, not your reasoning.** A `///` / docstring / JSDoc describes what the item is and how to use it. Keep design rationale, threat-model prose, "why I picked this approach", and roadmap or staging narration out of doc comments: that is internal thinking, not API documentation. If the why matters, it goes in the commit message, not the source.
- **Test functions get the same bar, narrowed.** An inline `//` comment inside a test is acceptable only when it is one line, marks a setup/exercise/assert phase boundary, or names a fixture choice specific to that site. It never narrates a rationale or restates why the production code behaves as it does: that is the commit message's job. The same sentence pasted at several sites is duplication, blocked always. Doc comments on test helpers state what the helper builds, never the reasoning trail that produced it; stretching a `///` onto a helper to carry the rationale an inline comment could not is the same violation wearing a different marker.
- **Comments and doc comments are ASCII-only.** No em-dash (use a hyphen, or split into two sentences), no smart or curly quotes, no section sign, no ellipsis glyph (use three dots), no math symbols like set intersection. The ASCII bar that applies to commit messages applies to source text too; the only exception is a glyph that is load-bearing to the feature itself.
- **Never reference paths that are not tracked in the repo.** A comment citing `docs/plans/foo.md` dangles when that path is gitignored; a source reader cannot open it. Before naming a file path in a comment, confirm it is tracked (`git ls-files <path>`). Describe the concept instead of citing an external doc, and if a citation is unavoidable, cite only a tracked file.
- **No process labels in comments or section markers.** TDD cycle numbers, stage numbers, sprint or PR numbers, and other build-process artifacts carry no meaning for a reader of the code. Section dividers and group headers, when you use them, describe the code they sit over and match the surrounding files' divider style; they never describe the process that produced the code.
- **When in doubt, leave it out.**

### Language-specific conventions

Apply the section matching the language of the files you touched. These all express the same underlying rule: match the idiom the project/language already uses for referencing external code, don't restate origins at every call site, adapted to each language's mechanism.

#### Rust

- **Prefer `use` over fully qualified paths.** Bring items in with a `use` statement and reference them unqualified, instead of repeating the path at the call site. This covers *any* fully qualified path and *any* root: crate-root-relative (`crate::path::Thing`), absolute extern (`std::collections::HashMap`, `core::mem::size_of`), or another workspace/external crate named in full (`libsys::carve::CarveSet`, `bevy::sprite::TextureAtlas`). Idiomatic Rust keeps call sites short; the origin belongs in the import list, not restated at every use.
- **Free functions from other modules: import the module.** A fully qualified call path at the use site (`crate::traits::compose_attack_effects(...)`, `std::mem::size_of`, `libsys::cap_copy(...)`) is never the form to ship. Import the module and call through it (`use crate::traits;` ... `traits::compose_attack_effects(...)`), or import the function itself where that matches the project's existing convention. Types are never called through a module path: always `use` the type.
- **Reach for a fully qualified path only for disambiguation:** when a plain `use` would be ambiguous. The canonical case is two items sharing a name in the same file, such as `std::result::Result` next to `anyhow::Result`, or the project's own `Action` next to a dependency's `Action`; keep one unqualified and qualify (or alias via `as`) the other. A `use` that would shadow or collide with an existing import counts too. Absent a collision, use `use`, including for items referenced exactly once; a single-use import is not a cost.
- **This bar is broader than `clippy::absolute_paths`.** That lint (and any pre-commit hook that gates it) only flags paths past a segment threshold and only certain root kinds, so shorter paths like `std::fmt::Write` or `libsys::cap_copy` pass through unflagged. It is not a substitute for reading the diff. Grep the diff for a leading root segment (`crate::`, `std::`, `core::`, `alloc::`, or an external/workspace crate name) and convert it to a `use` (or an imported-module call, for free functions) unless it is a disambiguation case.

#### Ruby

- **Prefer bare constant/class references over fully qualified ones**, unless the project's namespacing forces it. Inside `module Foo; class Bar; end; end`, code inside that namespace refers to sibling constants unqualified; don't write `Foo::Baz` from within `Foo::Bar` when `Baz` resolves the same way. Reach for the qualified form only when two constants share a name in scope (`ActiveRecord::Base` next to a local `Base`) or when referencing a top-level constant from deep inside a nested namespace where the short name would instead resolve to a same-named sibling (use `::Baz` or the full path to disambiguate).
- **Require/autoload, don't inline a full path at every call site.** If a class is reached for repeatedly in a file, pull it in via the project's loading convention (Zeitwerk autoload, an explicit `require`/`require_relative` at the top) rather than writing out a long `A::B::C::Klass` chain inline each time. Rails/Zeitwerk apps typically need no `require` at all; match what the surrounding files already do.
- **Respect the project's style guide for symbols vs. strings, hash syntax, and frozen string literals.** Check for a `.rubocop.yml` (or inherited shared config, e.g. `rubocop-shopify`, `rubocop-rails`) before assuming a default; a project pinned to old-style hash rockets or explicit `# frozen_string_literal: true` magic comments should keep that, not be "modernized" as a side effect of your change.
- **Avoid `send`/`instance_variable_get`/monkey-patching core classes** to work around encapsulation unless the surrounding code already relies on that pattern (some DSLs and test helpers do). These bypass the type/method-visibility contract the same way a Rust fully-qualified-path workaround bypasses `use`; prefer the public API.
- **Match existing service/model conventions** (e.g. `ApplicationService`, PORO command objects, `ActiveModel::Model` for form objects) instead of introducing a new pattern for a single class. Consistency here is the Ruby analogue of the Rust "don't impose your own conventions" rule.

#### JavaScript / TypeScript

- **Prefer named imports over deep or repeated inline paths.** Import a symbol once at the top of the file (`import { Thing } from '../lib/thing'`) rather than reaching it via a long relative or namespaced path inline (`require('../../../lib/thing').Thing` repeated at each use, or `import * as lib from './lib'` followed by `lib.deep.nested.Thing` everywhere). This is the JS/TS analogue of the Rust `use`-over-fully-qualified-path rule: the origin belongs in the import list, not restated at every call site.
- **Use the module boundary the project has already chosen.** Don't mix `require`/`module.exports` into an otherwise all-ESM (`import`/`export`) codebase, or vice versa, just because it's convenient for your change.
- **Respect existing type strictness.** If `tsconfig.json` has `strict: true` (or specific flags like `noImplicitAny`, `strictNullChecks`), don't introduce `any` or non-null assertions (`!`) to route around it in code you write; if the file already leans on `any` throughout, don't unilaterally tighten just your lines in a way that fights the rest of the file's typing.
- **Prefer `import type` / type-only imports** (when the project's TS config or lint rules distinguish them, e.g. `verbatimModuleSyntax`, `@typescript-eslint/consistent-type-imports`) for symbols used only as types, matching whatever the rest of the codebase does.
- **Don't reach for fully qualified global paths** (`window.foo`, `globalThis.bar`) when a module-scoped import of the same symbol is available and is what the rest of the file uses. Fully qualified access is fine when it's the idiom for that environment (e.g. `process.env.X` in Node, or genuinely global browser APIs like `window.location`) or needed to disambiguate from a shadowing local of the same name.
- **Match existing patterns for exports.** Don't switch a file from named exports to a default export (or vice versa) as a side effect of adding one function.

## Quick checklist before committing

- [ ] Conventions detected up front: formatter config, CI gating, hooks, warning baseline (strict vs. lenient).
- [ ] No new warnings introduced in your diff; formatter scoped to changed files (or hand-styled to match if the file is lenient and drifted).
- [ ] No pre-existing warnings fixed outside your diff.
- [ ] The project's test suite is green on your branch.
- [ ] In a Rust project: `cargo check --release` is green too. Dev-profile gates compile with `debug_assertions` on, which hides an entire class of miss: an import accidentally sitting under a `#[cfg(debug_assertions)]` attribute compiles fine in every dev check and fails only in release. Run it before drafting any commit message; a full release *build* is not required, `check` catches the same errors in a fraction of the time.
- [ ] Comment style matches the codebase (default: no inline comments; doc comments for item-level explanation). Test inline comments, where they exist, are one-line phase or fixture markers only, with no rationale narration and no repetition across sites.
- [ ] In a Rust project: `use` over fully qualified paths, for types and functions alike (`crate::`, `std::`/`core::`/`alloc::`, or external/workspace-crate roots like `anyhow::`, `bevy::`). FQN is acceptable only for disambiguation (`std::Result` vs `anyhow::Result`, a project `Action` vs a dependency `Action`); free functions from other modules are reached by importing their module, never by a full inline path. `clippy::absolute_paths` only catches long paths, so grep the diff for any root segment; don't rely on the lint.
- [ ] In a Ruby project: bare constants within their own namespace, not re-qualified; classes reached via the project's autoload/require convention, not inlined long paths; hash/symbol/frozen-string style and service/model patterns match the surrounding code and any `.rubocop.yml`.
- [ ] In a JS/TS project: named imports at the top of the file over deep or repeated inline paths; module boundary (ESM vs CJS) matches the file; no `any`/non-null assertions introduced where `tsconfig.json` strictness would otherwise catch them; type-only imports used where the project distinguishes them.
- [ ] Comments document the API (what + how), not implementation reasoning; ASCII-only; no references to untracked paths (`git ls-files <path>`); no process labels (TDD cycles, stage numbers) in section markers. Grep the diff for non-ASCII (`grep -nP "[^\x00-\x7f]"`) and for `docs/`/spec citations.
