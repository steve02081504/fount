/**
 * fount Agent 研究院（GitHub Pages 静态博客）共享逻辑：
 * index.json 加载（由 tools/generate_index.py 生成）、文章语言解析、
 * 主题 / 语言菜单、站内文章链接改写。
 */
import { setTheme, theme_now } from '../base.mjs'
import {
	geti18n_nowarn,
	getLocaleNames,
	loadPreferredLangs,
	matchLocale,
} from '../scripts/i18n/index.mjs'
import { applyThemeWithViewTransition } from '../scripts/theme/viewTransition.mjs'

/** index.json 的模块级缓存（Promise）。 */
let indexPromise = null

/** 文章间链接的匹配形式：纯 id、./id、../id，可带 #anchor。 */
const ARTICLE_LINK_RE = /^(?:\.\/|\.\.\/)?([a-z0-9][a-z0-9-]*)(#[^#]*)?$/i

/** 文章 markdown 头部 YAML frontmatter 匹配（与 tools/generate_index.py 的 FRONTMATTER_RE 同形）。 */
const FRONTMATTER_RE = /^---[ \t]*\r?\n(.*?)\r?\n---[ \t]*\r?\n?/s

/**
 * @typedef {object} blogArticleLangMeta
 * @property {string} title 标题
 * @property {string} summary 摘要
 * @property {string[]} tags 展示与搜索用标签
 */

/**
 * @typedef {object} blogArticleEntry
 * @property {string} id 文章 id（即 articles/ 下的目录名）
 * @property {string} category 所属目录（分类 id）
 * @property {number} order 分类内排序
 * @property {Record<string, blogArticleLangMeta>} langs 各语言元数据（键为 locale id，来自 md frontmatter）
 */

/**
 * @typedef {object} blogCategoryEntry
 * @property {string} id 分类 id
 * @property {number} order 排序
 * @property {Record<string, string>} name 各语言名称（来自 categories.json）
 */

/**
 * @typedef {object} blogIndex
 * @property {blogCategoryEntry[]} categories 分类目录（按 order 排序）
 * @property {blogArticleEntry[]} articles 全部文章（按分类与 order 排好的阅读顺序）
 */

/**
 * 拉取生成的 index.json（结果按 Promise 缓存）。
 * @returns {Promise<blogIndex>} 博客索引
 */
export function loadIndex() {
	indexPromise ??= fetch(new URL('index.json', import.meta.url)).then(res => {
		if (!res.ok) throw new Error(`Failed to load blog index: ${res.status}`)
		return res.json()
	})
	return indexPromise
}

/**
 * 按 id 取文章条目。
 * @param {blogIndex} index 博客索引
 * @param {string} id 文章 id
 * @returns {blogArticleEntry | undefined} 文章条目（不存在为 undefined）
 */
export function getArticleEntry(index, id) {
	return index.articles.find(article => article.id === id)
}

/**
 * 文章的可用语言 id 列表。
 * @param {blogArticleEntry} entry 文章条目
 * @returns {string[]} 语言 id 列表
 */
export function entryLangs(entry) {
	return Object.keys(entry.langs)
}

/**
 * 文章某语言的元数据（缺语言时回退首个可用语言）。
 * @param {blogArticleEntry} entry 文章条目
 * @param {string} lang 期望语言 id
 * @returns {blogArticleLangMeta} 元数据
 */
export function articleMetaIn(entry, lang) {
	return entry.langs[lang] ?? Object.values(entry.langs)[0]
}

/**
 * 文章页 URL（相对 blog 模块根解析，与当前页面路径无关）。
 * @param {string} id 文章 id
 * @param {string} lang 语言 id
 * @returns {string} 文章页 URL
 */
export function articlePageUrl(id, lang) {
	const url = new URL('article/', import.meta.url)
	url.searchParams.set('article', id)
	url.searchParams.set('lang', lang)
	return url.href
}

/**
 * 文章 markdown 的 URL（相对 blog 模块根解析）。
 * @param {string} id 文章 id
 * @param {string} lang 语言 id
 * @returns {string} markdown 文件 URL
 */
export function articleMarkdownUrl(id, lang) {
	return new URL(`articles/${encodeURIComponent(id)}/${encodeURIComponent(lang)}.md`, import.meta.url).href
}

/**
 * 用户首选语言候选（fount 偏好 + 浏览器语言）。
 * @returns {string[]} 语言候选列表
 */
export function preferredLangCandidates() {
	return [...loadPreferredLangs(), ...navigator.languages || [navigator.language]]
}

/**
 * 为文章选一个展示语言：`?lang=` 优先，其次用户偏好匹配，最后文章首个可用语言。
 * @param {blogArticleEntry} entry 文章条目
 * @returns {string} 语言 id
 */
export function resolveArticleLang(entry) {
	const requested = new URLSearchParams(location.search).get('lang')
	const langs = entryLangs(entry)
	if (requested && langs.includes(requested)) return requested
	return matchLocale(preferredLangCandidates(), langs) ?? langs[0]
}

/**
 * 主题显示名：daisyUI 内置主题走 `themeManage.themes.*` 文案，自定义主题显示原名。
 * @param {string} theme 主题名
 * @returns {string} 显示名
 */
function themeLabel(theme) {
	return geti18n_nowarn(`themeManage.themes.${theme}`) ?? theme
}

/**
 * 刷新菜单条目的选中态（daisyUI menu-active）。
 * @param {HTMLUListElement} menuUl 菜单容器
 * @param {Map<string, HTMLButtonElement>} buttons 主题名 → 按钮
 * @returns {void}
 */
function refreshMenuSelection(menuUl, buttons) {
	for (const [name, button] of buttons)
		button.classList.toggle('menu-active', (theme_now ?? '') === name)
	menuUl.dataset.current = theme_now ?? ''
}

/**
 * 构建主题菜单（auto + daisyUI 内置主题 + 用户自定义主题），点击经 View Transition 切换。
 * 自定义主题（localStorage 中有 CSS）始终可见、可回选，不会因缺内置键而出错。
 * @param {HTMLUListElement} menuUl 菜单容器（daisyUI menu <ul>）
 * @returns {Promise<void>} 构建完成
 */
export async function mountThemeMenu(menuUl) {
	menuUl.replaceChildren()
	const themes = [
		'auto',
		...await import('https://cdn.jsdelivr.net/npm/daisyui/functions/themeOrder.js')
			.then(m => m.default)
			.catch(() => ['dark', 'light']),
	]
	const customThemeName = localStorage.getItem('fountCustomThemeName')
	const customThemeCss = localStorage.getItem('fountCustomThemeCss')
	if (customThemeName && customThemeCss && !themes.includes(customThemeName))
		themes.push(customThemeName)

	const buttons = new Map()
	for (const theme of themes) {
		const li = document.createElement('li')
		const button = document.createElement('button')
		button.type = 'button'
		button.textContent = themeLabel(theme)
		button.addEventListener('click', async event => {
			// daisyUI 5 打开期间触发器 pointer-events:none，先移焦点收起菜单
			document.activeElement?.blur()
			await applyThemeWithViewTransition(event, () => setTheme(theme))
			refreshMenuSelection(menuUl, buttons)
		})
		li.appendChild(button)
		menuUl.appendChild(li)
		buttons.set(theme, button)
	}
	refreshMenuSelection(menuUl, buttons)
}

/**
 * 构建语言菜单（仅文章可用的语言；不支持的语言不显示）。
 * @param {HTMLUListElement} menuUl 菜单容器（daisyUI menu <ul>）
 * @param {string[]} langs 可用语言 id 列表
 * @param {string} currentLang 当前语言 id
 * @param {(lang: string) => void} onSelect 选择回调
 * @returns {void}
 */
export function mountLanguageMenu(menuUl, langs, currentLang, onSelect) {
	menuUl.replaceChildren()
	const names = getLocaleNames()
	for (const lang of langs) {
		const li = document.createElement('li')
		const button = document.createElement('button')
		button.type = 'button'
		button.textContent = names.get(lang) || lang
		button.classList.toggle('menu-active', lang === currentLang)
		button.addEventListener('click', () => {
			if (lang === currentLang) return
			document.activeElement?.blur()
			onSelect(lang)
		})
		li.appendChild(button)
		menuUl.appendChild(li)
	}
}

/**
 * 去掉文章 markdown 开头的 YAML frontmatter 块（展示元数据已由 index.json 承担，正文无需渲染它）。
 * 缺失 frontmatter 时原样返回。
 * @param {string} markdown 原始文章 markdown
 * @returns {string} 去掉 frontmatter 后的正文
 */
export function stripArticleFrontmatter(markdown) {
	return markdown.replace(FRONTMATTER_RE, '')
}

/**
 * 将文章内指向其他文章的相对链接改写为文章页 URL。
 * 约定写法：`[文字](article-id)` 或 `[文字](article-id#标题锚点)`。
 * 目标语言不可用时按当前语言就近回落。
 * @param {DocumentFragment} fragment 渲染后的文章片段
 * @param {blogIndex} index 博客索引
 * @param {string} currentLang 当前文章语言 id
 * @returns {void}
 */
export function rewriteArticleLinks(fragment, index, currentLang) {
	for (const a of fragment.querySelectorAll('a[href]')) {
		const match = ARTICLE_LINK_RE.exec(a.getAttribute('href') || '')
		if (!match) continue
		const entry = getArticleEntry(index, match[1])
		if (!entry) continue
		const langs = entryLangs(entry)
		const targetLang = langs.includes(currentLang)
			? currentLang
			: matchLocale([currentLang], langs) ?? langs[0]
		a.href = articlePageUrl(entry.id, targetLang) + (match[2] || '')
	}
}
