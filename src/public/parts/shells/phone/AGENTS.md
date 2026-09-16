---
description: Phone shell — Android device bridge. WS device protocol, HTTP endpoints, Android client contract, and deferred work. Pull when changing shells/phone or the fount-app client.
globs: src/public/parts/shells/phone/**
alwaysApply: false
---

# Phone Shell

Bridges Android devices into fount. The server owns no device capability itself: everything comes from one or more `fount-app` clients that connect over WebSocket. Devices are tracked per user in memory (`src/api.mjs`), keyed by the `deviceId` the client reports at hello.

Sibling docs: [shells conventions](../AGENTS.md). Human-facing design notes live in the fount-app repo (`docs/phone-agent-design.md`).

## Files

- `main.mjs` — default export with `Load({ router })`; also exposes `interfaces.invokes.IPCInvokeHandler(username, data)` so other parts can run a command on a device.
- `src/api.mjs` — `UserDeviceManager`: device registry, pending-request correlation, live context store. Exports `getUserManager`, `handleConnection`, `listDevices`, `getState`, `getFrame`, `execOnDevice`.
- `src/endpoints.mjs` — routes; all under `/api/parts/shells:phone` and `/ws/parts/shells:phone`.
- `test/pure/api.test.mjs` — device manager unit tests.
- `public/llms.txt` — Chinese, user/agent-facing API summary.

Backend imports from `src/*.mjs` use **5** `../` to reach `src/scripts` and `src/server`.

## WebSocket protocol (`/ws/parts/shells:phone/device`)

Auth: `sec-websocket-protocol: <apiKey>` (the router echoes it), `?fount-apikey=<apiKey>`, or a `fount-apikey` cookie. Note `try_auth_request` only reads the API key from the subprotocol header for WS requests — `Authorization: Bearer` is HTTP-only.

Client → server:

```jsonc
{ "type":"hello", "payload":{ "deviceId":"uuid","name":"Pixel 8","androidVersion":35,
  "capabilities":["accessibility","screenshot","eval:java"] } }
{ "type":"response", "requestId":"…", "isError":false, "payload":{ "result":"…","stdout":"…","durationMs":123 } }
{ "type":"context", "kind":"screen", "payload":{ "ts":0,"package":"…","activity":"…","text":"…","uiTree":{ },"screenshot":"base64" } }
{ "type":"context", "kind":"camera", "facing":"front", "payload":{ "ts":0,"frame":"base64" } }
{ "type":"event", "event":"notification", "payload":{ "pkg":"…","title":"…","text":"…" } }
{ "type":"assist", "assistId":"uuid", "payload":{ "query":"…","context":{ } } }
```

Server → client:

```jsonc
{ "type":"hello_ok", "payload":{ "username":"steve","deviceId":"uuid" } }
{ "type":"cmd", "requestId":"…", "tool":"eval",
  "args":{ "language":"java","source":"…","timeoutMs":15000,"persist":null } }
{ "type":"assist_start"|"assist_delta"|"assist_done"|"assist_error", "assistId":"…", … }
```

Notes:

- `context` / `event` are only accepted after `hello`; before that the active `deviceId` is unknown and they are dropped.
- Context is capped in memory (3 screen frames, 3 frames per camera facing, 50 notifications). `state` returns the newest screen text and frame counts; `frame` returns the newest raw image per `kind`.
- `cmd` is only sent to a device whose socket is OPEN; the pending entry is keyed by `requestId` and rejected on timeout, on `isError`, and on device disconnect.
- `assist` (phone-initiated conversation) currently answers `assist_error`; wake-driven chat is unimplemented.

## HTTP endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/api/parts/shells:phone/devices` | `{ devices: [...] }` summaries |
| GET | `/api/parts/shells:phone/state` | `?deviceId=`; screen text + frame counts + recent notifications; `screenshot` replaced with `"<omitted>"` |
| GET | `/api/parts/shells:phone/frame` | `?deviceId=&kind=screen\|front\|back`; returns `image/jpeg` bytes, 404 when no frame |
| POST | `/api/parts/shells:phone/exec` | body `{ deviceId?, language?, source, timeoutMs?, persist? }`; funnels into a WS `cmd` |

Failures use `throw httpError(code, message)` — 400 for a missing `source`, 404 for an offline/unknown device or a missing frame.

## Android client contract

The client must:

1. Connect with the API key, then send `hello` before anything else.
2. Answer every `cmd` with a `response` carrying the same `requestId`.
3. Report `isError: true` with `{ error }` for compile/run failures instead of fabricating a result.
4. Keep the socket alive (heartbeat) and reconnect with the same `deviceId`; stale entries are swept 1h after disconnect.

## Verification

No live server needed: `deno test --allow-all --allow-scripts -c ./deno.json ./src/public/parts/shells/phone/test/pure/` and `deno lint -c ./deno.json src/public/parts/shells/phone`. After changes, also run the standard pure scanners (`scanTextLf`, `scanMsLiteral`, `scanI18nKeyStructure`, `scanAgentsMdEnglish`) and the module-graph probe `probeShellPart({ partPath: 'shells/phone' })` (`src/scripts/test/shellLoadProbe.mjs`).

## Not implemented yet

- `assist` flow (wake → `chatReplyRequest` → streamed reply): build the request like `shells/code/src/request.mjs`, prepend the live context as a system log, stream deltas back.
- `plugins/phone` tool surface (`<phone-eval>`, `<phone-context>`, `<phone-frame>`, `<phone-call>`) and `GetPrompt` context injection.
- Frontend page (`public/index.html`) + Playwright smoke — API-only for now.
