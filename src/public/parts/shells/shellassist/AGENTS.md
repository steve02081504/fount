# ShellAssist factory

Characters should reuse `GetDefaultShellAssistInterface(charAPI, username, charname, options)` from `src/default_interface/main.mjs` instead of copying the shell history conversion, world prompt, or command plugin. Create the interface during the character's `Load`, after its identity and info are initialized.

- `options.requestExtension`: request metadata such as `{ source_purpose: 'shell-assist' }`. Each call receives a fresh shallow copy; keep nested values immutable or manage their ownership explicitly.
- `options.onResult(args, reply)`: awaited after `GetReply` resolves, including null/undefined replies, before mapping the shell response. Use for character statistics and activity tracking. It is not called when `GetReply` throws; hook errors propagate to the caller.
- The factory owns operator identity, conversation context, Markdown capabilities, mutable workdir memory, and command extraction. Terminal rendering remains in the shell's IPC handler.
- Recommended commands use `<recommend_command>`; both the top-level result and `extension.recommend_command` carry the extracted command.
