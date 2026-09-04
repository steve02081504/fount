/**
 * fount Agent 研究院文章页：拉取 markdown → fount 全量渲染 → 站内链接改写 → 语言切换 / 上下篇导航。
 */
import { geti18n, initTranslations, pickLocalizedSlice, setElementI18n, setLanguage } from '../../scripts/i18n/index.mjs'
import {
	articleMarkdownUrl,
	articleMetaIn,
	articlePageUrl,
	entryLangs,
	getArticleEntry,
	loadIndex,
	mountLanguageMenu,
	mountThemeMenu,
	resolveArticleLang,
	rewriteArticleLinks,
	stripArticleFrontmatter,
} from '../blog.mjs'

const statusBox = document.getElementById('article-status')
const errorBox = document.getElementById('article-error')
const errorText = document.getElementById('article-error-text')
const articleBody = document.getElementById('article-body')
const pager = document.getElementById('article-pager')
const themeMenu = document.getElementById('theme-menu')
const languageDropdown = document.getElementById('language-dropdown')
const languageMenu = document.getElementById('language-menu')
const articleSidebar = document.getElementById('article-sidebar')
const tocSection = document.getElementById('article-toc-section')
const tocList = document.getElementById('article-toc')
const articleNav = document.getElementById('article-nav')

/** 当前博客索引。 @type {import('../blog.mjs').blogIndex | null} */
let index = null
/** 当前文章条目。 @type {import('../blog.mjs').blogArticleEntry | null} */
let entry = null
/** 当前文章语言。 */
let currentLang = ''

/**
 * 显示错误面板（i18n 键 + 回研究院链接）。
 * @param {string} i18nKey 错误文案键
 * @returns {void}
 */
function showError(i18nKey) {
	statusBox.hidden = true
	articleBody.hidden = true
	pager.hidden = true
	articleSidebar.hidden = true
	setElementI18n(errorText, i18nKey)
	errorBox.hidden = false
}

/**
 * 依语言优先级拉取文章 markdown，返回正文与实际命中的语言。
 * @param {import('../blog.mjs').blogArticleEntry} articleEntry 文章条目
 * @param {string} lang 期望语言
 * @returns {Promise<{ text: string, lang: string }>} 正文与实际语言
 */
async function loadMarkdownText(articleEntry, lang) {
	const langs = entryLangs(articleEntry)
	const candidates = [lang, ...langs.filter(candidate => candidate !== lang)]
	let lastError = new Error('No readable language found')
	for (const candidate of candidates)
		try {
			const response = await fetch(articleMarkdownUrl(articleEntry.id, candidate))
			if (!response.ok) {
				lastError = new Error(`${response.status} ${response.url}`)
				continue
			}
			const text = await response.text()
			if (!text.trim()) {
				lastError = new Error(`empty ${response.url}`)
				continue
			}
			return { text, lang: candidate }
		}
		catch (error) {
			lastError = error
		}
	throw lastError
}

/**
 * 构建上一篇 / 下一篇链接。
 * @param {import('../blog.mjs').blogArticleEntry} target 目标文章
 * @param {string} lang 当前语言（目标不可用时就近回落）
 * @param {string} directionKey 方向文案 i18n 键
 * @param {boolean} isNext 是否为「下一篇」
 * @returns {HTMLElement} 链接元素
 */
function buildPagerLink(target, lang, directionKey, isNext) {
	const link = document.createElement('a')
	link.className = isNext ? 'blog-pager-link blog-pager-next' : 'blog-pager-link'
	link.href = articlePageUrl(target.id)
	const direction = document.createElement('span')
	direction.className = 'blog-pager-direction'
	direction.textContent = geti18n(directionKey)
	const title = document.createElement('span')
	title.className = 'blog-pager-title'
	title.textContent = articleMetaIn(target, lang).title
	link.append(direction, title)
	return link
}

/**
 * 渲染上下篇导航（index.json 顺序即阅读顺序）。
 * @returns {void}
 */
function renderPager() {
	if (!entry) return
	const orderedArticles = index.articles
	const pos = orderedArticles.indexOf(entry)
	const prev = pos > 0 ? orderedArticles[pos - 1] : null
	const next = pos >= 0 && pos < orderedArticles.length - 1 ? orderedArticles[pos + 1] : null
	pager.replaceChildren()
	if (!prev && !next) {
		pager.hidden = true
		return
	}
	if (prev) pager.appendChild(buildPagerLink(prev, currentLang, 'blog.article.prev', false))
	if (next) pager.appendChild(buildPagerLink(next, currentLang, 'blog.article.next', true))
	pager.hidden = false
}

/**
 * 为标题生成 GitHub 风格锚点 id（保留 CJK，标点去除，空白转连字符），保证唯一。
 * @param {string} text 标题文本
 * @param {Set<string>} used 已占用的 id 集合
 * @returns {string} 唯一锚点 id
 */
function headingSlug(text, used) {
	const base = text.trim().toLowerCase()
		.replace(/[^\p{L}\p{N}\s-]/gu, '')
		.replace(/[\s_]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '') || 'section'
	let slug = base
	for (let i = 1; used.has(slug); i++) slug = `${base}-${i}`
	used.add(slug)
	return slug
}

/**
 * 从渲染后的文章片段提取 h2/h3 构建侧边栏目录，并为标题补锚点 id。
 * 无小节（无 h2/h3）时隐藏目录区块。
 * @param {DocumentFragment} fragment 渲染后的文章片段
 * @returns {void}
 */
function buildToc(fragment) {
	const headings = fragment.querySelectorAll('h2, h3')
	tocList.replaceChildren()
	tocSection.hidden = !headings.length
	if (!headings.length) return
	const used = new Set()
	for (const heading of headings) {
		if (!heading.id) heading.id = headingSlug(heading.textContent, used)
		const li = document.createElement('li')
		const link = document.createElement('a')
		link.href = `#${heading.id}`
		link.textContent = heading.textContent
		link.className = heading.tagName === 'H3'
			? 'blog-toc-link blog-toc-h3'
			: 'blog-toc-link'
		li.appendChild(link)
		tocList.appendChild(li)
	}
}

/**
 * 依当前滚动位置把对应小节在目录中高亮（取最后一个已越过顶线的标题）。
 * @returns {void}
 */
function updateActiveToc() {
	tocSpyQueued = false
	const links = [...tocList.querySelectorAll('.blog-toc-link')]
	let active = links[0]
	for (const link of links) {
		const heading = document.getElementById(link.getAttribute('href').slice(1))
		if (heading && heading.getBoundingClientRect().top <= 100) active = link
	}
	for (const link of links)
		link.classList.toggle('blog-toc-active', link === active)
}

/** 目录滚动监听的解除函数。 @type {(() => void) | null} */
let disconnectTocSpy = null
/** 目录滚动更新是否已排入动画帧（rAF 节流）。 */
let tocSpyQueued = false

/**
 * 挂载侧边栏目录的滚动高亮（rAF 节流；语言切换重建时先解除旧监听）。
 * @returns {void}
 */
function mountTocSpy() {
	disconnectTocSpy?.()
	/**
	 * 滚动事件处理器（rAF 节流后更新目录高亮）。
	 * @returns {void}
	 */
	const onScroll = () => {
		if (tocSpyQueued) return
		tocSpyQueued = true
		requestAnimationFrame(updateActiveToc)
	}
	window.addEventListener('scroll', onScroll, { passive: true })
	/**
	 * 解除滚动监听。
	 * @returns {void}
	 */
	disconnectTocSpy = () => window.removeEventListener('scroll', onScroll)
	updateActiveToc()
}

/**
 * 渲染侧边栏「全部文章」导航（分类 → 文章；当前文章高亮）。
 * 分类名与文章标题跟随当前语言（文章缺该语言时回退首个可用语言）。
 * @returns {void}
 */
function renderArticleNav() {
	if (!index || !entry) return
	articleNav.replaceChildren()
	for (const category of index.categories) {
		const articles = index.articles.filter(article => article.category === category.id)
		if (!articles.length) continue
		const categoryItem = document.createElement('li')
		categoryItem.className = 'blog-nav-category'
		categoryItem.textContent = pickLocalizedSlice(category.name, [currentLang]) || category.id
		articleNav.appendChild(categoryItem)
		for (const target of articles) {
			const li = document.createElement('li')
			const link = document.createElement('a')
			link.className = 'blog-nav-link'
			link.href = articlePageUrl(target.id)
			link.textContent = articleMetaIn(target, currentLang).title
			if (target === entry) {
				link.classList.add('blog-nav-active')
				link.setAttribute('aria-current', 'page')
			}
			li.appendChild(link)
			articleNav.appendChild(li)
		}
	}
}

/**
 * 加载并渲染当前文章（语言切换时整体重跑）。
 * @returns {Promise<void>} 渲染完成
 */
async function showArticle() {
	statusBox.hidden = false
	errorBox.hidden = true
	articleBody.hidden = true
	pager.hidden = true

	try {
		const { text, lang } = await loadMarkdownText(entry, currentLang)
		currentLang = lang
		const { renderMarkdown } = await import('../../scripts/features/markdown/index.mjs')
		const fragment = await renderMarkdown(stripArticleFrontmatter(text), {}, { allowDangerousHtml: true })
		rewriteArticleLinks(fragment, index)
		buildToc(fragment)

		articleBody.replaceChildren(fragment)
		articleBody.lang = currentLang
		articleBody.dir = currentLang.startsWith('ar') ? 'rtl' : 'ltr'
		articleBody.hidden = false
		statusBox.hidden = true

		articleSidebar.hidden = false
		renderArticleNav()
		mountTocSpy()

		const heading = fragment.querySelector('h1')?.textContent.trim() || articleMetaIn(entry, currentLang).title
		document.title = `${heading} · ${geti18n('blog.title')}`

		mountLanguageMenu(languageMenu, entryLangs(entry), currentLang, selectedLang => {
			currentLang = selectedLang
			window.scrollTo({ top: 0 })
			setLanguage([selectedLang]).then(() => showArticle()).catch(console.error)
		})
		renderPager()
	}
	catch (error) {
		console.error('Failed to load article:', error)
		showError('blog.article.langs_unavailable')
	}
}

await initTranslations('blog')
mountThemeMenu(themeMenu).catch(console.error)

index = await loadIndex().catch(error => {
	console.error('Failed to load blog index:', error)
	return null
})
const params = new URLSearchParams(location.search)
entry = index ? getArticleEntry(index, params.get('article') || index.articles[0]?.id) : null

if (!index || !entry)
	showError(index ? 'blog.article.not_found' : 'blog.article.load_failed')
else {
	languageDropdown.hidden = false
	currentLang = resolveArticleLang(entry)
	await showArticle()
}
