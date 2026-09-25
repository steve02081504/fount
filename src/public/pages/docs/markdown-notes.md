# Markdown convertor notes

Day-to-day API: [AGENTS.md](../AGENTS.md) (`markdown.mjs` / `getConvertor` / `renderMarkdownAsString`).

## Trust tiers

- **trusted** (`allowDangerousHtml: true`): full HTML; `languageExecutors` may override `safeLanguageExecutors`.
- **safe**: early sanitize + Mermaid strict + `safeLanguageExecutors` only.

Both executor maps live in `convertor.mjs`. Do not wrap another shell-specific convertor on top.

## Mermaid IDs

`mermaid.render(id)` reuses/destroys any existing `#id` in the document. Never use a content-hash-only id (feed + detail / cache hits collide). Always `allocMermaidSvgId` on render, and `uniquifyMermaidSvgHtml` on cache hit before insert. If `render` returns a fragment without a root `<svg>`, wrap with `ensureMermaidSvgRoot` before `fromHtml` ([happy-dom#2182](https://github.com/capricorn86/happy-dom/issues/2182)).

## Mermaid edgeLabel theming

Flowchart edge labels use HTML (`foreignObject` → `.edgeLabel p` / `.labelBkg`), and Mermaid bakes `#id .edgeLabel p { background-color: <light> }` into the SVG. Overriding only `.edgeLabel rect` leaves a light label chip under theme text color — invisible in dark mode. `MERMAID_THEME_CSS` must set `background-color` + `color` on `.edgeLabel` / `p` / `span` / `.labelBkg` (and `fill` on any rect), with `!important`.

## Code block UI

Copy / download / execute must be a rehype plugin **after** `rehype-pretty-code`, touching only `figure[data-rehype-pretty-code-figure] > pre`.

Do not use Shiki `transformers.root` wrapping — it breaks inline `{:lang}` (expects `root>pre`). Plain `` `code` `` stays bare `<code>`; `` `code{:js}` `` → `span>code`. HTML `document.write` preview is trusted-only.

## ansi fence

```` ```ansi ```` is intercepted by `rehypeAnsiBlock` **before** `rehype-pretty-code` and replaced with `@steve02081504/ansi2html` output, so it never gets the pretty-code `markdown-code-block` wrapper. Two traps:

- Style it from the **global** `pre.markdown-ansi-block` selector, not `.markdown-body pre…` — shells that render markdown into their own container (code shell: `.code-message-body`) never add `.markdown-body`, so a scoped rule silently does not apply. Keep it aligned with the already-global `.markdown-code-block`.
- Use `white-space: normal`, **not** `pre`/`pre-wrap`: ansi2html encodes spaces as `&nbsp;` and line breaks as `<br/>`, so the container must not also preserve whitespace. ansi2html ≤0.0.0 additionally emitted a literal `\n` after `<br/>` and skipped CRLF, rendering one newline as 2–3 lines; fixed in 0.0.1 ([issue #1](https://github.com/steve02081504/ansi2html/issues/1)) — keep `normal` so the block is correct across versions.

## Unknown HTML tags

`remarkLiteralizeUnknownHtmlTags` (a remark plugin, before `remarkRehype`) downgrades unknown HTML tags in the body (`HTMLUnknownElement`, or custom elements not registered — this project registers none) from raw HTML to literal text. Otherwise they are swallowed as HTML: the trusted tier renders them as nothing (a `<run-subagent>` / `<list-ai-sources/>` in reasoning text leaves a hole), and the untrusted tier drops them outright in `remarkRehype`. Known tags (`details` / `summary` / `b` / `img` / `script` …) and code nodes (inline/fenced code are `code` nodes, not `html` nodes) are unaffected, so `` `Array<T>` `` is not double-escaped.

## URL safety

`isSafeHtmlUrl` (Markdown sanitize + mediaRefs) rejects `javascript:` / `data:` and protocol-relative `//…`.

## CJK-friendly emphasis

CommonMark flanking assumes space-delimited text; a delimiter run closed by fullwidth punctuation immediately followed by a CJK character is not right-flanking, so `**…**` / `~~…~~` stay literal. `GetMarkdownConvertor` registers `remark-cjk-friendly` + `remark-cjk-friendly-gfm-strikethrough` **after** `remark-gfm` — order matters, the strikethrough extension must override GFM's `~~` tokenizer. Do not move them above `remark-gfm`.

## no-cors proxy

Authenticated streaming proxy (`/api/no-cors`) for embeds / OG. Forwards Range / conditional / Content-Type; inject upstream Cookie/Authorization via `No-Cors-*` prefix. `X-No-Cors-Final-Url` after redirects.
