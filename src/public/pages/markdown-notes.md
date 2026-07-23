# Markdown convertor notes

Day-to-day API: [AGENTS.md](AGENTS.md) (`markdown.mjs` / `getConvertor` / `renderMarkdownAsString`).

## Trust tiers

- **trusted** (`allowDangerousHtml: true`): full HTML; `languageExecutors` may override `safeLanguageExecutors`.
- **safe**: early sanitize + Mermaid strict + `safeLanguageExecutors` only.

Both executor maps live in `convertor.mjs`. Do not wrap another shell-specific convertor on top.

## Mermaid IDs

`mermaid.render(id)` reuses/destroys any existing `#id` in the document. Never use a content-hash-only id: feed + post detail (or cache hits) will collide and leave an empty SVG shell. Always `allocMermaidSvgId` on render, and `uniquifyMermaidSvgHtml` on cache hit before insert. If `render` returns a fragment without a root `<svg>` (happy-dom + mermaid `securityLevel: 'strict'` → DOMPurify drops the svg wrapper; [happy-dom#2182](https://github.com/capricorn86/happy-dom/issues/2182)), wrap with `ensureMermaidSvgRoot` before `fromHtml`.

## Code block UI

Copy / download / execute must be a rehype plugin **after** `rehype-pretty-code`, touching only `figure[data-rehype-pretty-code-figure] > pre`.

Do not use Shiki `transformers.root` wrapping — it breaks inline `{:lang}` (expects `root>pre`). Plain `` `code` `` stays bare `<code>`; `` `code{:js}` `` → `span>code`. HTML `document.write` preview is trusted-only.

## URL safety

`isSafeHtmlUrl` (Markdown sanitize + mediaRefs) rejects `javascript:` / `data:` and protocol-relative `//…`.

## no-cors proxy

Authenticated streaming proxy (`/api/no-cors`) for embeds / OG. Forwards Range / conditional / Content-Type; inject upstream Cookie/Authorization via `No-Cors-*` prefix. `X-No-Cors-Final-Url` after redirects.
