# Upstream blockers affecting tests

Day-to-day: [AGENTS.md](../AGENTS.md). Do not work around these in fount or in the test — wait for the upstream fix, then bump and re-verify.

## `@homebridge/ciao` probe noise (`server:live` / `console_quiet`)

Default-start quiet assert fails when ciao probe retries log `[fount._http._tcp.local.] failed probing…` ([homebridge/ciao#72](https://github.com/homebridge/ciao/issues/72)).

`server:live` carries `skip_because` on that issue with `delay: 25h` (Deno npm install cooldown after the fix lands). Do not filter that string in the test or silence it in fount. Post-fix: wait out the delay, bump `npm:@homebridge/ciao`, drop the skip, re-run `server:live`, then any blocked shell frontends.
