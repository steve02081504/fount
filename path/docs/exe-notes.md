# `fount.exe` compile & Steam registration notes

Rare concerns for `geneexe` / `New-FountExe` / Steam shortcuts. Day-to-day path CLI: [AGENTS.md](../AGENTS.md).

## `fount.exe` compile

- Native children of the compiled EXE lose console stdout ([ps12exe#59](https://github.com/steve02081504/ps12exe/issues/59)) — `fount.exe logo` exits with no TUI; do not work around in the runner.
- `New-FountExe` keeps try/catch glued to `ps12exe`: any throw is reported ([ps12exe#58](https://github.com/steve02081504/ps12exe/issues/58)) and **not** rethrown.
- Before compile, `Clear-FountExeOutput` deletes the output path if present, or renames it to `.old` when delete fails (e.g. self-overwrite while `fount.exe` is running).
- `geneexe` fails via `index.ps1` (`$Error.Count` / `$LastExitCode`). If `favicon.ico` is missing, `geneexe` calls `run shutdown` so init compiles the icon. Call the `run` function, not `fount shutdown`, so bootstrap cannot recurse into Steam registration.
- `$null` overrides a defaulted parameter (does not mean "use default") — `geneexe` only calls `New-FountExe` with a path when one was given.

## Steam shortcut

- `fount init` registers a non-Steam shortcut when Steam is present — skip otherwise. Registration swallows failures so `fount init` still succeeds.
- `shortcuts.vdf` is read/written in `path/src/steam_vdf.mjs` (no nonsteam); appid is `crc32(Exe+AppName)|0x80000000` so library art matches.
