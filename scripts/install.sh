#!/usr/bin/env bash
# Install agent-kit skills by symlink into ~/.agents/skills.
#
# Symlinks every directory under skills/ in this repo. Never copies: the repo
# is the single source of truth and each installed skill points back at a
# commit. Idempotent: re-running reports already-installed skills and changes
# nothing. Refuses to touch any existing entry that is not a symlink into
# this repo, and exits nonzero when anything was refused. Removes nothing:
# retiring superseded skills is a separate, explicit step.

set -euo pipefail

repo_dir=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
skills_src="$repo_dir/skills"
skills_dst="${HOME:?HOME must be set}/.agents/skills"

shopt -s nullglob
skill_dirs=("$skills_src"/*/)
shopt -u nullglob

if (( ${#skill_dirs[@]} == 0 )); then
  printf 'no skill directories under %s; nothing to install\n' "$skills_src"
  exit 0
fi

mkdir -p "$skills_dst"

linked=0
relinked=0
kept=0
refused=0

for dir in "${skill_dirs[@]}"; do
  name=${dir%/}
  name=${name##*/}
  src="$skills_src/$name"
  dst="$skills_dst/$name"

  if [[ -e $dst || -L $dst ]]; then
    resolved=$(readlink -f -- "$dst" 2>/dev/null || true)
    if [[ $resolved == "$src" ]]; then
      printf 'already linked: %s\n' "$name"
      kept=$((kept + 1))
      continue
    fi
    if [[ -L $dst && $resolved == "$repo_dir"/* ]]; then
      old_target=$(readlink -- "$dst")
      ln -sfn -- "$src" "$dst"
      printf 'relinked: %s -> %s (was %s)\n' "$name" "$src" "$old_target"
      relinked=$((relinked + 1))
      continue
    fi
    printf 'refused: %s exists in %s and is not a symlink into this repo\n' \
      "$name" "$skills_dst" >&2
    refused=$((refused + 1))
    continue
  fi

  ln -s -- "$src" "$dst"
  printf 'linked: %s -> %s\n' "$name" "$src"
  linked=$((linked + 1))
done

printf 'done: %d linked, %d already linked, %d relinked, %d refused\n' \
  "$linked" "$kept" "$relinked" "$refused"
exit "$refused"
