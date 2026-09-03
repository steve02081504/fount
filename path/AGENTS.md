---
description: path CLI — entries, updates, Termux, CI smoke, Start-Process gotchas
globs: path/**
alwaysApply: false
---

# path CLI

Thin entries `path/fount.{ps1,sh}` dispatch to `path/src/cmd/<name>.*` via inline `Test-Path` + dot-source in `index.{ps1,sh}` — no early-passthrough branch in entries. Each cmd loads its own deps (`require`). `path/src/**/*.ps1` exports use `function script:` (esh-style explicit scope).

| Bootstrap | Use |
| --- | --- |
| `bootstrap_full` | Full install / runtime |
| `bootstrap_server` | Server path (uses background updates) |
| `require_mid` + `source_uninstall_hooks` | `remove` |

`fount init` (and first install) registers a non-Steam shortcut when Steam is present — skip otherwise. Windows launchers use `$FOUNT_DIR/fount.exe` (written if missing, gitignored); other platforms use `path/fount`. `fount geneexe [path]` still defaults to `./fount.exe` (cwd). `remove` unregisters this install only (level 85, before Deno uninstall). No `data/config.json` (except `remove`) is `ensure_fount_config` / `Ensure-FountConfig` then the original command — not `cmd_open`. Interactive first-run starts `:8930` (wait/install liveness) and opens `wait/install/?from=runner`; `FOUNT_INSTALL_WAIT=1` is exported and `:8930` stays up until that process exits (after the dispatched command). `cmd_open` opens `wait?cold_bootting=true` only when that flag is unset. Docker / `FOUNT_ACCEPT_EULA` skip the prompt and copy default config; refusing the EULA or running without a console removes the installation (`N` → `fount remove`). See [runner AGENTS](../src/runner/AGENTS.md). `fount.exe` compile / Steam registration traps (ps12exe, favicon, `shortcuts.vdf`): [docs/exe-notes.md](docs/exe-notes.md).

Same logic is isomorphic across `foo.{ps1,sh}`; platform-only code under `path/src/win/` or `unix/`. Shared helpers: `in_container`, `run_with_updates`, `trap_terminal_teardown` (optional extra cleanup function name), `handle_docker_passthrough`, `check_temp_guard`, `sed_escape`. Server liveness: pwsh uses `Test-FountRunning` (from `fount-pwsh`, IPC ping 16698, ~100ms fast-fail); sh uses `test_fount_running` (`unix/ipc`, same IPC ping via nc/socat). `cmd_default` (bare `fount`) uses it to skip `background keepalive` and go straight to `log` when the server is already listening; on probe failure (no module/nc) it falls back to starting keepalive. Deno-side port probe (test kernel): `src/scripts/listener.mjs`.

`remove` scans `**/*.uninstall.<level>.*` under `path/src`, highest level first; level `0` deletes the install tree.

## Package management (all platforms, no per-distro special cases)

Package-manager operations are unified across every entry (`path/fount`, `path/src/packages.sh` `install_with_manager`/`upgrade_with_manager`/`uninstall_package`, `src/runner/main.sh`, `src/runner/main.ps1`, `src/runner/npm/main.mjs`, `path/src/passthrough.ps1`, and the server via the `update-deno` cmd). Shared state lives in `FOUNT_PKG_STATE_DIR` (default `{TMPDIR||TEMP||/tmp}/fount/package`).

- **Ownership**: `pkg_owner_of` / `Get-FountPkgOwner` (bash: `packages.sh`; PowerShell: `pkg_common.ps1`) — given a realpath (`resolve_realpath` first for symlinks), returns `"<manager> <package>"` when dpkg/apt-get, pacman, rpm (dnf|yum|zypper), apk, brew (Cellar prefix), pkg or snap owns it; empty otherwise.
- **Lock**: same-named manager is never run concurrently — `pkg_lock_acquire`/`with_pkg_lock` (bash) and `Enter-FountPkgLock`/`Exit-FountPkgLock` (PowerShell) use an atomic `mkdir` lock dir with a pid file; stale locks (dead pid) are stolen; timeout `FOUNT_PKG_LOCK_TIMEOUT` (default 300s).
- **DB refresh throttle**: `pkg_db_refresh_needed`/`pkg_db_refresh_mark` — a manager's DB refresh (`apt-get update`, `dnf makecache`, …) runs at most once per `FOUNT_PKG_REFRESH_INTERVAL` (default 600s), checked inside the lock. Pacman is exempt: it installs/upgrades atomically with `pacman -Syu` (no standalone `-Sy`/`-Syy` — that is a partial-upgrade footgun).

**Single source of truth**: the POSIX package-manager function family (`pkg_lock_acquire`/`pkg_with_lock`/`pkg_db_refresh_*`/`install_package`) lives **readable** in `path/fount` between `# BEGIN/END FOUNT_PKG_MGR`; `node .esh/commands/sync-pkg-mgr.mjs` injects its **single compressed line** into every readme (`README.md` + `docs/readme/Readme.*.md`), the `sh_exec` bootstrap in `src/runner/npm/main.mjs` (JS-escaped), and the subfounts shell frontend `src/public/parts/shells/subfounts/public/src/pkg_mgr_block.mjs` (JS-escaped, template-literal export). Dry-run install blocks repeat the full compressed family (self-contained copy-paste). Edit the `path/fount` block, run the sync script, and the in-sync test in `path/test/runtime_update.test.mjs` enforces it.

`src/runner/main.sh` is a **bash** script (arrays / `local` / `[[ ]]`) and does **not** share this POSIX block — it keeps its own bash-flavored `install_package` + lock/refresh helpers (same behavior, no sync). `path/fount` must stay POSIX because `run.sh` runs it via `/bin/sh`.

The server's idle runtime update (`src/server/autoupdate.mjs`) invokes the standalone `path/src/update-deno.{sh,ps1}` directly by path (no cmd dispatch); it runs `install_deno` + `deno_upgrade`.

## Updates

- Sync: `update_fount_and_deno`. Background: `update_fount_and_deno_background` (after `data/installer/deno_upgraded`). `bootstrap_server` uses background; keepalive retries and exit-131 call sync before restart.
- Deno updates honor package ownership: a package-manager-owned runtime (any manager) is upgraded through that manager; a user-managed runtime self-updates via `deno upgrade`. Package-managed Deno cannot honor `.deno-version` pins — `deno_upgrade` warns (`deno.pinNotHonored`) and keeps the manager's version when it can't match.
- `fount update` is the sync CLI (also how PS Start-Job re-enters). Plain update refreshes only the current branch via one-shot `git_fetch_remote_branch` (does **not** expand `remote.origin.fetch` to `refs/heads/*`).
- `fount version` prints branch (or detached HEAD), HEAD sha, optional remote tip, and ahead/behind via the same one-shot fetch. Detached HEAD skips remote compare; `.noupdate` is noted when present.
- `fount update <branch>` — checkout + remove `.noupdate`; unknown names `ls-remote` once then one-shot fetch.
- `fount update <sha>` — detach + create `.noupdate`.
- `fount update pr/<n>` (also `pull/<n>`, `#<n>`, or a GitHub PR URL) — fetch `refs/pull/<n>/head` into `origin/pr/<n>`, detach, create `.noupdate`. Re-run to refresh the tip.
- `fount update <remote-url>` — point `origin` at that URL and check out its default branch (tracking it), clearing `.noupdate`; subsequent plain updates follow it. Detected before branch names via `git_is_remote_url` (http(s)/ssh/git/ftp/file URLs and scp-like `user@host:path`).
- If the current upstream is confirmed gone on origin (not a network error), fall back to tracking `master`.
- Git / bash / Deno-template traps: [docs/git-notes.md](docs/git-notes.md).

## Temporary deno version pin

A committed `.deno-version` at the repo root (single line, e.g. `pr 36606` / `canary` / `2.9.5`) temporarily pins the deno build.

- Path CLI: `deno_upgrade` (keepalive auto-repair + `fount test`) upgrades to the pinned spec, overriding the default channel; a package-managed Deno is upgraded via its manager instead (pin not honored).
- CI (`run_tests` / `verify_server` / `verify_shells`): `.github/workflows/scripts/resolve_deno_version.sh` resolves the pin at install time — a supported channel/semver/hash goes straight into `denoland/setup-deno`'s `deno-version`; a `pr N` spec (which setup-deno can't parse) installs `canary` then applies `deno upgrade` post-install.
- CI `polyglot_nop_tests` uses `install.sh` (latest-only), so it always applies the pin via `.github/workflows/scripts/apply_deno_version.sh` after install.

Missing/empty `.deno-version` → unchanged behavior: CI installs `canary`, keepalive pulls its default channel.

## Termux

- `unix/termux.sh`: locale + sensor. On Termux, `env.sh` `require unix/termux` then `termux_apply_android_lang` (before i18n) — Android locale → `LANG`, unset `LC_ALL`. `android_locale_to_lang` stops at singleton extensions (`u`/`t`/`x`/…) and keeps the first region only.
- `termux_ensure_sensor_api` installs `termux-api` for `termux-sensor` when missing on `fount logo` / `log` / `server`; tracked in `auto_installed_system_packages` for uninstall. Logo gravity: [imgs/icon_anime/AGENTS.md](../imgs/icon_anime/AGENTS.md).

## CI smoke

CI-only `path-cmd-smoke`: [docs/ci-smoke.md](docs/ci-smoke.md). Harness sets `FOUNT_ACCEPT_EULA=1` so first-run `ensure_fount_config` / `Ensure-FountConfig` copies default `config.json` and does not prompt. `test-fount` init → `remove` fails if output matches [remove-noise.patterns](CI/remove-noise.patterns). pwsh harnesses in `path/test` run on Linux CI — set `$LastExitCode` directly; do not call `cmd.exe`.

## ShellCheck

`path/**/*.sh` is linted in the path suite. Install / cache / non-ASCII filename trap: [docs/shellcheck-notes.md](docs/shellcheck-notes.md).

## Start-Process `-ArgumentList`

Always a **single string** (`Get-FountPs1ArgumentList` / `Get-WTfountCmd`), never a PowerShell array — nested/empty elements bind as `""` and throw. Spawn failure: `-ErrorAction Stop` + try/catch → `exit 1` (PS often still exits 0 after a displayed error).
