# `fount.exe` compile & Steam registration notes

Rare concerns for `geneexe` / `New-FountExe` / Steam shortcuts. Day-to-day path CLI: [AGENTS.md](../AGENTS.md).

## `fount.exe` compile

- Native child TTY was broken by the old ps12exe host ([#59](https://github.com/steve02081504/ps12exe/issues/59), fixed): it wrapped the main function in `Out-String -Stream`, so Deno/Node children saw `isTTY=false` and `fount.exe logo` no-oped. Regression check after `fount geneexe`: `fount.exe logo` must hold the TUI in a real console. Do not add a `Start-Process -NoNewWindow` workaround.
- `New-FountExe` keeps its try/catch glued to the `ps12exe` call as a fallback: if ps12exe ever throws again, fount reports it via `Send-Ps12exeThrowIssue` and does **not** rethrow, so the optional compile cannot break `init` / `geneexe`. ps12exe now reports failure via `$LastExitCode` only and never throws ([#58](https://github.com/steve02081504/ps12exe/issues/58), fixed); `geneexe` still reads `$Error` / `$LastExitCode` back through `index.ps1`. Do not move `Send-Ps12exeThrowIssue` away from the call.
- Before compile, `Clear-FountExeOutput` deletes the output path if present, or renames it to `.old` when delete fails (e.g. self-overwrite while `fount.exe` is running).
- `geneexe` fails via `index.ps1` (`$Error.Count` / `$LastExitCode`). If `favicon.ico` is missing, `geneexe` calls `run shutdown` so init compiles the icon. Call the `run` function, not `fount shutdown`, so bootstrap cannot recurse into Steam registration.
- `$null` overrides a defaulted parameter (does not mean "use default") — `geneexe` only calls `New-FountExe` with a path when one was given.

## Steam shortcut

- `fount init` registers a non-Steam shortcut when Steam is present — skip otherwise. Registration swallows failures so `fount init` still succeeds.
- `shortcuts.vdf` is read/written in `path/src/steam_vdf.mjs` (no nonsteam); appid is `crc32(Exe+AppName)|0x80000000` so library art matches.

## `run.bat` / `path/fount.bat` argument forwarding

- Windows launchers reach the CLI through `run.bat` / `run.cmd` → `path/fount.bat`. The compiled `fount.exe` bypasses this chain (it invokes `path/src/index.ps1` in-process via `&`; see [runner AGENTS](../../src/runner/AGENTS.md)), but direct `run.bat` use still hits the traps. All forward the caller's `%*`, so these `cmd` traps apply — keep forwards out of blocks and use a direct `"%~dp0path\fount.bat" %*`:
  - `cmd /c "...fount.bat" %*` — a quoted (space-containing) arg makes `cmd /c` re-parse the line and swallow the command name (`'…\fount.bat" eval "1' is not recognized`).
  - `call "...fount.bat" %*` — `call` re-expands `%`, so `5 % 3` loses its `%`.
  - `%*` inside an `if ( … )` block — a `)` in the args closes the block early, so `console.log(1)` breaks.
  - `for %%i in (%*)` — a `)` in the args truncates the `for` set.
  - `shift` loops — `shift` also shifts `%0`, so `%~dp0` after the loop falls back to the cwd (capture `set "SCRIPT_DIR=%~dp0"` before it; seen in `esh` `opt/run.cmd`).
- Only the no-arg branch keeps `call ... open` (fixed args) and falls through to the `pause` / `exit /b`. Verified end-to-end: `fount eval "console.log('1+1')"`, `"5 % 3"`, `"true && false"`, `"[1,2,3].map(x => x * 2).join('-')"`.
