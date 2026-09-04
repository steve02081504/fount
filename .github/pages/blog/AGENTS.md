# fount Agent Institute (GitHub Pages blog)

A static, GitHub Pages-hosted blog/wiki for fount's essays on agent design (the "Agent whitepaper" series). Lives under `.github/pages/blog/`; deployed by `.github/workflows/pages.yaml` (push to `master` with `.github/pages/**` changes).

- Index: `https://steve02081504.github.io/fount/blog/`
- Article: `https://steve02081504.github.io/fount/blog/article/?article=<id>`

## Layout

- `articles/<article-id>/<locale>.md` — the articles. One folder per article; one `<locale>.md` per translation. Locale ids must exist in `src/public/locales/list.csv` (e.g. `en-UK`, `zh-CN`); the file name **is** the locale id.
- `articles/<article-id>/meta.json` — per-article structural metadata (non-display): `category` (directory/section id) and `order` (position within the category) are the current keys; unknown keys pass through to `index.json` untouched. Reserved key: `langs`.
- `categories.json` — optional registry of section definitions: `{ "<category-id>": { "order": 1, "name": { "<locale>": "…" } } }`. Categories used by articles but absent here are appended automatically (raw id as the name). Only changes when a new section is invented.
- `tools/generate_index.py` — scans `articles/`, parses frontmatter + `meta.json`, validates, and writes `index.json`. Runs in the deploy workflow (fails the deploy on invalid content) and at local pages-server startup. Requires python3; uses PyYAML when available (stdlib subset parser as fallback).
- `index.json` — **generated artifact, never edit it** (gitignored). Runtime contract consumed by `blog.mjs`:
  `{ categories: [{ id, order, name: {locale: text} }], articles: [{ id, category, order, langs: { locale: { title, summary, tags } } }] }` — `articles` is the flat reading order (categories in order, then article `order`); the index page and prev/next pager follow it.
- `blog.mjs` — shared module: index loading, language resolution, theme menu, language menu, in-site link rewriting.
- `blog.css` — page chrome + article typography. Theme-var-only (`--color-*`, `--radius-*`, `--border`); never hardcode colors, radii, or px border widths (repo `theme_radius` / `theme_color` checks apply).
- `index.html` / `index.mjs` — article list page (category sections, tag badges, live search). `article/index.html` / `article/index.mjs` — article viewer.
- The article viewer's `main` uses a two-column layout: a sticky wiki-style sidebar (per-article table of contents with scroll-spy + an "All articles" index grouped by category, current article highlighted) next to the article card. Sidebar text (headings, titles) is `user-content`; the sidebar hides below `lg` and when the article has no `h2`/`h3`. The frontmatter block is stripped before rendering (`blog.mjs` `stripArticleFrontmatter()`); display metadata comes from `index.json`.
- Chrome strings live in the top-level `blog` section of `src/public/locales/zh-CN.json` (+ `en-UK.json`); other locales are synced by `update-locales.py` in CI (then hand-patch `emoji.json` — it must stay free of Han/kana/Cyrillic). Do not add `data-i18n` keys without adding them to both zh-CN and en-UK.

## Adding an article

1. Create `articles/<article-id>/` — kebab-case id, stable (it appears in URLs and as the link target from other articles).
2. Write `<locale>.md` per language. The file must start with a YAML frontmatter block (indent with **spaces** — YAML forbids tabs):

   ```md
   ---
   title: "Why fount Agents Are Not Chatbots"
   summary: "One-sentence teaser shown on index cards."
   tags:
     - agent
     - definition
   ---

   # Why fount Agents Are Not Chatbots
   ```

   Required: `title`, `summary` (strings), `tags` (list of strings, may be empty). Quote values containing `: `. Keep the frontmatter `title` in sync with the first `# heading`. Unknown frontmatter keys are ignored. No YAML frontmatter after the closing `---` rules; no `<script>` in articles.
3. Add `meta.json` to the folder: `{ "category": "<id>", "order": <int> }`. Use an existing category from `categories.json` when one fits; otherwise add the category there (order + localized names).
4. Done — no registry edits. The deploy workflow regenerates `index.json`; the local pages server regenerates it at startup.
5. Cross-link liberally: existing articles may now link to yours; add reciprocal links where it helps the reading flow.

## Linking between articles

Inside article markdown, links to sibling articles use the bare article id as the URL (optionally with a heading anchor):

```md
[an earlier chapter](llm-is-not-the-agent)
[the activation ladder](dont-put-everything-in-the-context#the-four-level-ladder)
```

`blog.mjs` `rewriteArticleLinks()` rewrites such `href`s (also `./id` / `../id` forms) to the article page URL, keeping the current language when the target has it, otherwise falling back via locale matching. Everything else (external URLs, `#same-page` anchors, paths that are not article ids) passes through untouched. The article viewer assigns GitHub-style slug ids to every `h2`/`h3` (CJK kept, spaces → hyphens, dedup with `-1`…), so `#heading-id` anchors resolve against those slugs.

The prev/next pager follows `meta.json` order, not prose: when inserting an article between existing ones, re-read its neighbours' endings — any "next chapter" / "previous chapter" phrasing must be updated to match the new flat order (prefer order-agnostic wording like "a later chapter" when the target is not the immediate pager neighbour).

The flat reading order is the series order: `reading-guide` first, then the theme categories in `categories.json` order (foundation → context → economics → safety), `building-fount-shell` last. New articles must slot into a theme category without breaking the argument chain their pager neighbours assume.

## Writing style (voice)

The essays are written to sound like a person, not a model. When adding or editing articles:

- **First person, real material.** Write as the builder of fount. Mine the repo for concrete anchors — real commit history, `docs/design/` + `docs/review/`, real plugin/part names, real incidents. Never invent anecdotes or numbers.
- **Limit formulaic devices.** 「不是X，而是Y」/ "not X but Y" constructions: at most a couple per essay, reserved for the thesis. Vary openings — never open by recapping the previous chapter. Do not end with a next-chapter announcement that restates the next essay's thesis; connect organically or just stop.
- **Break the template.** Not every essay needs a table, a mermaid diagram, and a limitations section. Safety essays are short and diagram-free; foundation essays are longer. Vary sentence and paragraph length.
- **Summaries are teasers, not thesis restatements.** Frontmatter `title` stays in sync with the first `#` heading; `summary` sells the essay in one sentence with voice.
- **Each language stands alone.** `en-UK.md` is idiomatic English prose, not a mirror translation of `zh-CN.md` — same argument, own rhythm.
- **No bilingual doubling.** Never write the same keyword or sentence once in each language (`策略（policy）`, a quote plus its translation, `（English sentence）` glosses). Technical terms appear once, as loanwords, in whatever language the article is written in. Same rule for figures and tables: a Chinese article's mermaid labels and table cells are Chinese.
- **Tags are a shared vocabulary.** zh-CN and en-UK tags map one to one onto the same canonical concepts (e.g. 安全/safety, 金丝雀/canary); don't let the two tag sets drift apart.
- **Real incidents are told first-person with specifics** — dates, names, what broke — and must be verifiable with the author or the repo.

## Language behavior

- Language state lives only in the fount stored preference (`fountUserPreferredLanguages` in localStorage) — no `?lang=` URL param. Resolution: fount stored preference + browser languages via locale matching → first available locale. Unreadable/missing files fall through the remaining locales in order.
- Both the index and the article page expose a language menu. The index menu lists `blogLangs` (union of all articles' locales); the article menu lists only the locales that actually exist for the current article. Switching writes the fount preference via `setLanguage`, so the index, the article body and the sidebar all follow; the index cards carry no per-language badges.
- The article `<article>` element carries `user-content` (the test watch locale scan must skip article text, which is intentionally multilingual); the language menus, category headings and tags are covered by `language-check-ignore` / `user-content` for the same reason.

## Search & tags

The index page search (`makeSearchable`) filters cards live against the displayed language's `title` + `summary` + `tags`. Tags render as badges; clicking one fills the search box. All tag/tag data comes from the md frontmatter — there is no search index to maintain.

## Theming

Pages import `setTheme` / `theme_now` from `.github/pages/base.mjs` (pages-level storage keys `fountTheme`, `fountCustomThemeName`, `fountCustomThemeCss`, `fountCustomThemeMjs`). The header theme menu offers `auto` + all daisyUI builtins (CDN `themeOrder.js`) + the user's custom theme when present in localStorage; switching runs through `applyThemeWithViewTransition`. A user with a custom theme must never see errors: `base.mjs` re-injects/removes the custom `<style>` on switch, and the menu falls back to the raw theme name when no `themeManage.themes.*` locale key exists.

Mermaid diagrams inherit the markdown pipeline's theme (node fills = `--color-base-200`, plus a baked `#id { fill:#333 }` on the svg root). `blog.css` gives them a contrasting panel (`svg[id^='mermaid-']`) so they stay visible on both themes and pass the watch svg-contrast scan — keep that rule if you restyle the article body.

## Testing & checks

- Playwright (pages server): `deno run --allow-scripts --allow-all -c ./deno.json ./.github/pages/test/frontend/run.mjs blog` — spec at `.github/pages/test/frontend/blog.spec.mjs`. The server generates `index.json` on start; run `python3 tools/generate_index.py` manually to validate content without a server.
- Affected repo checks: `html_meta` (full og meta set + `<main>` landmark in both HTML files, poetic og copy), `i18n_refs` / `i18n_keys` (locale keys), `theme_radius` / `theme_color`, `text_lf` (LF endings, single trailing newline — applies to article `.md` files too), `jsdoc_no_english` (Chinese JSDoc summaries in `.mjs`).
- After editing locale JSONs, keep zh-CN/en-UK value kinds in sync (string vs `{ "aria-label": … }` objects).
