# Role Extensions for General Plugins

A role declares `interfaces.plugins`, which the host calls through `src/scripts/plugin_context.mjs`. Extensions belong to the role in the current request and do not mutate global plugin instances. Keep achievement IDs and statistics rules in the role.

```js
interfaces: {
  plugins: {
    async OnEvent(event, args) {
      if (event.status === 'succeeded') recordRoleStatistics(event)
    },
    GetServiceSource({ pluginName, serviceType }) {
      if (pluginName === 'web-browse' && serviceType === 'AI') return 'reader'
      if (pluginName === 'web-search' && serviceType === 'search') return mySearchSource
      // undefined: AI inherits args.ai_source; search uses the user's default source.
    },
    GetPrompt({ pluginName, ownerContext }) {
      return pluginName === 'file-operations' ? 'Role directory: /path/to/char' : undefined
    },
  },
}
```

## Events

The event shape is `{ id, pluginName, type, status?, tool?, call?, data?, error? }`:

- `activated`: a plugin that was actually assembled; emitted once per request before BeforeReply.
- `tool`: `started`, `succeeded`, `failed`, or `pending` for a call handled by the pipeline.
- `background`: asynchronous completion, timer expiry, or a browser/JS callback.

A tool call includes its tag, attributes, and body. Role-native handlers, internal content handlers, and calls skipped after a failure do not emit plugin tool events. A newly executed call gets a new ID; executing a tool again after regeneration is a new operation. Reusing the same inline-evaluation cache reuses the event ID and does not count twice. Streaming inline evaluation may happen before handler dispatch; `started` means handling began, not that this is a permission interception point. Observer exceptions are reported without changing the tool result.

Background registration returns `pending: true` and must not be counted as success. Producers pass `eventContext: args` and `meta: { pluginName, tool }` to `registerTask`; settlement notifies the role even if the result was consumed by `await`. Persistent notifications carry the same ID in `extension.pluginEvent`. Roles should persist counted IDs to avoid recounting historical notifications or notifications after a process restart.

Background events use the same append-log and shell-wakeup scheduling. Without a wake interface, the log is saved and the role receives the event when it next reads the channel. Timer and browser-origin flags are stored in `extension`; do not restore the concurrent direct-`GetReply` re-entry path.

## Service Sources and Owner Prompts

`GetServiceSource` can return a source instance, short name, or `serviceSources/<type>/<name>`. `undefined`/`null` inherits the default; an explicitly configured but missing source or invalid interface throws an error. Current consumers are AI for web-browse, search for web-search, and AI for sub-agent; an explicit `ai-source` on a sub-agent tag or batch takes precedence. Other plugins can use the same resolver to support more service types.

Gentian supports `pluginServiceSources: { 'web-browse': { AI: 'reader' }, 'web-search': { search: 'engine' } }` and retains the existing dedicated `AIsources['web-browse']` source. When unset, the host default applies.

code-execution, file-operations, and browser-integration use `getPluginOwnerPrompt`. The owner is taken from the role's self-signed `ownerEntityHash`; messages require trusted attribution and a matching author. Without verification, the prompt protects the owner's machine, files, privacy, and accounts. Role-added prompt text receives the same `ownerContext`. This guides the prompt and does not add an execution permission gate.

## Web and Code

`<web-browse summarize="false">` returns fetched Markdown as-is; by default it returns an AI summary. Automatic URL pre-reading loads metadata only, persists it through BeforeReply, and does not call AI.

Local run-js and inline-js share the request workspace, `chat_log`, `workdir`, and plugin JS context. Relative `fs` paths still resolve from the process directory; use `workdir` to construct an absolute path. fount-api prepares its key before generation, so JS variable injection is available in the first round.

`<wait-screen machine="0" monitor="0">1</wait-screen>` waits and then captures the target screen; the image is written to the tool log. The tool fails if there is no display environment or the monitor does not exist. Attachments use shared `file_object.mjs` to infer MIME from content and name, parse the HTTP Content-Disposition filename, and preserve the description.
