# path git / shell traps

Day-to-day update CLI: [../AGENTS.md](../AGENTS.md).

## Upstream tracking

`git_track_origin_branch` adds that single head to `remote.origin.fetch` and sets `branch.<name>.remote` / `merge`. Never use `git branch --set-upstream-to` alone — that fatals when the refspec is outside configured fetch (single-branch clones).

## `git_valid_branch_name` / bash `case`

Gates one-shot fetch/ls-remote. In bash `case` patterns, escape glob chars (`*\?*`, `*\**`) — do **not** quote them as `*'?'*` / `/'*|*'/'`; a dangling `'` makes `bash -n path/src/git.sh` fail and every sourced function vanish (`git_remote_branch_status: command not found`). Keep `@{` out of `case` arms (`[[ "$branch" == *'@{'* ]]`) — shellcheck SC1083 treats `{` in `*@{*` as literal. Regression: `fount test path:git --no-parallel`.

## Deno template literals → bash

Bash snippets inside Deno template literals: put ERE with `\+` / `\*` in `String.raw` + `JSON.stringify(...)` (eslint `no-useless-escape` flags those escapes in ordinary templates). Literal `\n` for `printf` needs `\\n` in the template source.
