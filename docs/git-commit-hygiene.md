# Git commit hygiene (fount)

Day-to-day rule: `type(scope): summary` with an English body, one line per paragraph; unrelated work goes into separate commits.

## Splitting a dirty worktree losslessly

Splitting an already-dirty worktree is lossless only if you can prove it: save `git diff` to a temp file first, then compare `git diff <base> HEAD | git hash-object --stdin` against it afterwards — an intended extra edit shows up as exactly that one file.

That saved diff never shows untracked files, so for a worktree that also has new files snapshot the whole thing before the first commit — `git add -A`, `git write-tree`, `git reset --quiet` (the index snapshot includes ignored-excluded untracked files and leaves the worktree untouched) — and require `git rev-parse HEAD^{tree}` to equal that hash once every batch is committed; a mismatch means a hunk was dropped or applied twice.

`git add -p` is interactive, so stage a partial file with `.esh/commands/stage_hunks.py` (`--list`, hunk numbers, or `--drop-added-line`), which rewrites only the index entry; when one hunk spans two commits, stage it whole in the earlier one and drop the later lines. Use `--drop-added-line <exact line>` rather than the older `--drop-line <prefix>`: the prefix form matches context and already-committed lines too, so it silently reverts a line that only looks the same.

To unstage a partly staged file, use `git restore --staged <path>` / `git reset -- <path>` — **`git checkout HEAD -- <path>` also overwrites the worktree file**, silently destroying the hunks you had not staged yet; capture that saved diff with raw bytes (`git diff > file`, never through a PowerShell pipeline that may re-encode it), because the saved copy is the only way back.

## Squashing a commit window into topic commits without rebasing

When days of work are interleaved across topics (a feature, its locale fill, unrelated chores), rebuild the range as topic commits from the *original final tree*, so the new window's tree hash equals the old HEAD's tree (`git diff <old-head> <new-head>` must be empty).

Verification method: flatten each topic's own commits in order into a temp index (`GIT_INDEX_FILE`, `read-tree` + `update-index --index-info` from `git ls-tree <commit> -- <path>`), `write-tree` per topic and compare the last tree against `HEAD^{tree}` before touching any ref. A file touched by two topics behind one base is the only real hazard: every path has to be written by the group that emits last with the final content, so assign each such path to its owner and drop it from the other groups (otherwise the later group silently reverts the newer half — check the assembled tree, not the intent). Then write `git commit-tree <tree> -p <prev>` per topic with the topic's last commit date, `update-ref refs/heads/<branch> <new> <old>`, and publish with `git push --force-with-lease=<branch>:<old>`; the old head survives in a backup ref.
