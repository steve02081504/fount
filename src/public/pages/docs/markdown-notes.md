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

## Unknown HTML tags

`remarkLiteralizeUnknownHtmlTags`（remark 阶段、`remarkRehype` 前）把正文里的未知 HTML 标签（`HTMLUnknownElement`，或未注册的自定义元素——本项目不注册任何自定义元素）从 raw HTML 降级为字面文本。否则它们会被当 HTML 吞掉：信任档渲染为空（推理正文里的 `<run-subagent>` / `<list-ai-sources/>` 会留空洞），未信任档被 `remarkRehype` 直接丢弃。已知标签（`details` / `summary` / `b` / `img` / `script` …）与代码节点（行内/围栏代码是 `code` 节点，不是 `html` 节点）不受影响，故不会二次转义 `` `Array<T>` ``。

## URL safety

`isSafeHtmlUrl` (Markdown sanitize + mediaRefs) rejects `javascript:` / `data:` and protocol-relative `//…`.

## CJK-friendly emphasis

CommonMark flanking assumes space-delimited text; a delimiter run closed by fullwidth punctuation immediately followed by a CJK character is not right-flanking, so `**…**` / `~~…~~` stay literal. `GetMarkdownConvertor` registers `remark-cjk-friendly` + `remark-cjk-friendly-gfm-strikethrough` **after** `remark-gfm` — order matters, the strikethrough extension must override GFM's `~~` tokenizer. Do not move them above `remark-gfm`.

## no-cors proxy

Authenticated streaming proxy (`/api/no-cors`) for embeds / OG. Forwards Range / conditional / Content-Type; inject upstream Cookie/Authorization via `No-Cors-*` prefix. `X-No-Cors-Final-Url` after redirects.
