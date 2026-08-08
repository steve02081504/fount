# ShellCheck for `path/**/*.sh`

Wired by `path/test/shellcheck.test.mjs` (same suite as path tests).

Resolve via `@steve02081504/exec` `where_command` / `execFile`: PATH first; if missing or older than GitHub `releases/latest`, download into `data/test/shellcheck/v*` (zip / `.tar.gz` via system `tar`, same asset layout as [vscode-shellcheck](https://github.com/vscode-shellcheck/vscode-shellcheck)) and try to overwrite a writable PATH binary. Latest tag is cached in `data/test/shellcheck/latest.json` (24h).

Non-ASCII entry names (`⛲.sh`, …) are copied to a temp ASCII path before lint — Windows ShellCheck crashes when printing those filenames.
