# Host keep-awake during `fount test`

Day-to-day pointer: [AGENTS.md](../AGENTS.md) Operator tools.

`path/fount.ps1` / `fount.sh` wrap Deno so long runs do not sleep the host.

## Windows

- `SetThreadExecutionState` on the pwsh wrapper.
- On AC power, lid close → Do nothing, archived in `data/test/state/keep_awake.json` (PID holders; last live holder restores; dead PIDs pruned).
- Hard-kill leaves an orphan archive — recovered by any later `fount test` `finally` or `fount clean`.

## Unix

- `caffeinate -w $$` / `systemd-inhibit` wrapping deno.

## Opt out

`FOUNT_TEST_ALLOW_SLEEP=1` — still clears an orphan lid archive on exit.

Sleep-interrupt detect + retry lives in [resource-scheduling.md](resource-scheduling.md) (idle / duration / sleep watchdog).
