/**
 * fount Agent 研究院首页：按生成的 index.json 渲染分类目录与文章卡片，
 * 支持按标题 / 摘要 / 标签实时搜索，标签可点击填入搜索。
 * 语言切换是全局状态：切到某语言写入 fount 偏好（localStorage），全站跟随。
 */
import { makeSearchable } from '../scripts/components/search.mjs'
import { geti18n, initTranslations, pickLocalizedSlice, setLanguage } from '../scripts/i18n/index.mjs'

import {
	articleMetaIn,
	articlePageUrl,
	blogLangs,
	loadIndex,
	mountLanguageMenu,
	mountThemeMenu,
	resolveBlogLang,
} from './blog.mjs'

const articleList = document.getElementById('article-list')
const articleSearch = document.getElementById('article-search')
const searchEmpty = document.getElementById('search-empty')
const themeMenu = document.getElementById('theme-menu')
const languageDropdown = document.getElementById('language-dropdown')
const languageMenu = document.getElementById('language-menu')

/** 当前博客索引。 @type {import('./blog.mjs').blogIndex | null} */
let index = null
/** 当前展示语言（全局状态）。 */
let currentLang = ''

/**
 * 切换全局语言：写入 fount 偏好后重渲染列表与语言菜单选中态。
 * @param {string} lang 语言 id
 * @returns {void}
 */
function switchLanguage(lang) {
	if (lang === currentLang) return
	currentLang = lang
	document.activeElement?.blur()
	setLanguage([lang]).then(() => {
		renderIndex()
		mountLanguageMenu(languageMenu, blogLangs(index), currentLang, switchLanguage)
	}).catch(console.error)
}

/**
 * 构建标签徽章列表（点击填入搜索框；文本来自 frontmatter，多语言文案由 user-content 跳过扫描）。
 * @param {import('./blog.mjs').blogArticleLangMeta} meta 展示语言的元数据
 * @returns {HTMLElement | null} 标签容器（无标签为 null）
 */
function buildTagBadges(meta) {
	if (!meta.tags.length) return null
	const container = document.createElement('div')
	container.className = 'flex flex-wrap items-center gap-1.5'
	for (const tag of meta.tags) {
		const badge = document.createElement('button')
		badge.type = 'button'
		badge.className = 'badge badge-secondary badge-sm blog-tag-badge'
		badge.textContent = tag
		badge.addEventListener('click', () => {
			articleSearch.value = tag
			articleSearch.dispatchEvent(new Event('input'))
			articleSearch.focus()
		})
		container.appendChild(badge)
	}
	return container
}

/**
 * 构建单张文章卡片（展示语言跟随全局 currentLang，文章缺该语言时回退首个可用语言）。
 * @param {import('./blog.mjs').blogArticleEntry} entry 文章条目
 * @returns {{entry: import('./blog.mjs').blogArticleEntry, card: HTMLElement, search: object}} 卡片及其搜索数据
 */
function buildArticleCard(entry) {
	const meta = articleMetaIn(entry, currentLang)
	const card = document.createElement('article')
	card.className = 'card bg-base-100 shadow blog-card'

	const body = document.createElement('div')
	body.className = 'card-body gap-3'

	const title = document.createElement('h3')
	title.className = 'card-title text-xl'
	const titleLink = document.createElement('a')
	titleLink.href = articlePageUrl(entry.id)
	titleLink.textContent = meta.title
	title.appendChild(titleLink)

	const summary = document.createElement('p')
	summary.className = 'text-sm opacity-75'
	summary.textContent = meta.summary

	const actions = document.createElement('div')
	actions.className = 'card-actions justify-between items-end flex-wrap gap-2'
	const badges = document.createElement('div')
	badges.className = 'flex flex-col items-start gap-2'
	const tagBadges = buildTagBadges(meta)
	if (tagBadges) badges.appendChild(tagBadges)
	actions.appendChild(badges)
	const read = document.createElement('a')
	read.className = 'btn btn-primary btn-outline btn-sm'
	read.href = articlePageUrl(entry.id)
	read.textContent = geti18n('blog.read')
	actions.appendChild(read)

	body.append(title, summary, actions)
	card.appendChild(body)
	return {
		entry,
		card,
		search: { title: meta.title, summary: meta.summary, tags: meta.tags },
	}
}

/**
 * 渲染分类目录与文章卡片，并接上搜索过滤。
 * @returns {void}
 */
function renderIndex() {
	const sections = []
	const cards = []
	for (const category of index.categories) {
		const articles = index.articles.filter(article => article.category === category.id)
		if (!articles.length) continue
		const section = document.createElement('section')
		section.className = 'flex flex-col gap-6'

		const heading = document.createElement('h2')
		heading.className = 'text-2xl font-bold'
		heading.textContent = pickLocalizedSlice(category.name, [currentLang]) || category.id
		heading.setAttribute('user-content', '')
		section.appendChild(heading)

		for (const entry of articles) {
			const card = buildArticleCard(entry)
			cards.push(card)
			section.appendChild(card.card)
		}
		sections.push({ category, section, cards: cards.slice(-articles.length) })
	}
	articleList.replaceChildren(...sections.map(({ section }) => section))

	makeSearchable({
		searchInput: articleSearch,
		data: cards,
		/**
		 * 搜索数据访问器：标题 / 摘要 / 标签。
		 * @param {{search: object}} card 卡片包装对象
		 * @returns {object} 参与匹配的文本
		 */
		dataAccessor: card => card.search,
		/**
		 * 过滤结果回调：切换卡片与分类目录的可见性，并同步空结果提示。
		 * @param {Array<object>} filtered 命中的卡片列表
		 * @returns {void}
		 */
		onUpdate: filtered => {
			const visible = new Set(filtered)
			for (const card of cards)
				card.card.classList.toggle('hidden', !visible.has(card))
			for (const { section, cards: sectionCards } of sections)
				section.classList.toggle('hidden', sectionCards.every(card => !visible.has(card)))
			searchEmpty.hidden = filtered.length > 0
		},
	})
}

await initTranslations('blog')
mountThemeMenu(themeMenu).catch(console.error)

index = await loadIndex().catch(error => {
	console.error('Failed to load blog index:', error)
	return null
})
if (!index?.articles?.length) {
	articleList.replaceChildren()
	const alert = document.createElement('div')
	alert.className = 'alert alert-error'
	alert.textContent = geti18n('blog.article.load_failed')
	articleList.appendChild(alert)
}
else {
	currentLang = resolveBlogLang(index)
	languageDropdown.hidden = false
	mountLanguageMenu(languageMenu, blogLangs(index), currentLang, switchLanguage)
	renderIndex()
}
