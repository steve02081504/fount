# Editor extensions

Install contributions in the **fount user directory**, for example
`data/users/<username>/.fount/editor.json`. This is the logged-in fount user's
directory, not the OS home directory or an opened workspace. Contributions apply
to that user's local and remote workspace files. Refresh the page after edits.

```json
{
  "version": 1,
  "languages": [
    {
      "id": "mydsl",
      "aliases": ["dsl"],
      "extensions": [".dsl"],
      "grammar": "editor/mydsl.tmLanguage.json",
      "configuration": {
        "comments": { "lineComment": "#" },
        "brackets": [["{", "}"], ["(", ")"]]
      },
      "formatter": "editor/mydsl.format.mjs"
    }
  ]
}
```

Grammar files use TextMate JSON (`scopeName`, `patterns`, optional `repository`)
and are loaded through the shared Shiki service. Custom aliases also work in
Markdown fences after the file editor has loaded the contributions. The example
below highlights the `hello` keyword:

```json
{
  "scopeName": "source.mydsl",
  "patterns": [{ "match": "\\bhello\\b", "name": "keyword.control.mydsl" }]
}
```

Formatters export a synchronous or asynchronous `format(document)` function
returning the complete formatted string:

```js
export function format({ text, language, path, tabSize, insertSpaces }) {
  return text.split('\n').map(line => line.trimEnd()).join('\n')
}
```

The document contains the source, language ID, workspace-relative file path
(prefixed with `/`) and Monaco's indentation options. Tabs stay literal tabs;
the editor passes `tabSize: 4` and `insertSpaces: false`. A formatter decides
which characters to return. Monaco applies formatting as an undoable edit and
discards results when the document changes during formatting.

Each invocation runs in a dedicated module Worker, cancelled with the Monaco
request and terminated after 10 seconds. Use self-contained modules or absolute
HTTPS imports, for example browser-compatible Prettier and its parser plugins;
relative imports do not resolve against the `.fount` directory. Modules have
browser Worker capabilities, including network access: install trusted code.
There is no Node API, shell launcher, VS Code extension host or VSIX loader.

`grammar` and `formatter` are optional. To add formatting for an existing
language, use its canonical Shiki ID (for example `yaml`) and omit `grammar`.
File suffix associations match without case and prefer the longest suffix.
Configurations support up to 64 unique lowercase language IDs. Asset paths
must stay inside the user directory: `.fount` itself is resolved first, so a
`.fount` symlink pointing outside the user directory is refused as well; each
asset is limited to 2 MiB. Invalid configuration shows an error while the
normal editor remains usable.

The editor uses Monaco's native context menu and formatting command
(`Shift+Alt+F`). Its built-in messages use the Monaco language pack selected by
fount's applied UI locale; the fount save action uses fount's own dictionary.
Switching the UI language updates existing native controls and action labels
through fount's language-change callbacks, retaining models and undo history.
The runtime and message bundles are paired at modern-monaco
0.4.2 / monaco-editor 0.55.1 because numeric message IDs must match.
