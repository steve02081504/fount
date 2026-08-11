# path CI smoke

CI-only job `path-cmd-smoke` in `test_running.yaml` (not day-to-day). Day-to-day path CLI: [AGENTS.md](../AGENTS.md).

1. `.github/path-ci/install-hooks.sh` stubs `src/server/index.mjs` / `src/log_viewer/index.mjs`.
2. `run-smoke.{sh,ps1}` exercises `server` / `background` / `log` / `reboot` / `init`.
3. `FOUNT_CLICK` via child `smoke-fount-click.ps1` (`function script:` stubs — not `global:`). Windows → `Start-WTfountCmd` (powershell 5.1); non-Windows → bash passthrough (`index.sh` unsets `FOUNT_CLICK`).
4. `restore-hooks.sh` on exit. Same workflow also runs remote init → `remove` (`test-fount`).
