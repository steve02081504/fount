/**
 * gist 列表页：加载全部 gist，渲染卡片（标题 / 来源 / 安全等级 / 更新时间）。
 */
import { handleError } from '/scripts/features/errorHandlers.mjs'
import { initTranslations } from '/scripts/i18n/index.mjs'
import { applyTheme } from '/scripts/theme/index.mjs'

import { listGists } from './src/endpoints.mjs'

const VIEW_URL = '/parts/shells:gist/view'
const EDIT_URL = '/parts/shells:gist/edit.html'

/** 来源类型 → i18n 键。 */
const SOURCE_I18N = {
	chat: 'gist.source.chat',
	social: 'gist.source.social',
	code: 'gist.source.code',
	'md-drop': 'gist.source.md-drop',
}

/**
 * 构建徽标元素（i18n 键经 data-i18n 动态翻译）。
 * @param {string} i18nKey - 翻译键。
 * @param {string} extraClass - 额外样式类。
 * @returns {HTMLSpanElement} 徽标元素。
 */
function badge(i18nKey, extraClass) {
	const element = document.createElement('span')
	element.className = `gist-badge ${extraClass}`.trim()
	element.dataset.i18n = i18nKey
	return element
}

/**
 * 来源徽标：未知类型回退为「手动创建」。
 * @param {{type?: string} | null} source - gist 来源。
 * @returns {HTMLSpanElement} 来源徽标。
 */
function sourceBadge(source) {
	const key = source?.type && SOURCE_I18N[source.type] ? SOURCE_I18N[source.type] : 'gist.source.manual'
	return badge(key, 'gist-badge-source')
}

/**
 * 安全等级徽标：secure 用成功色，trusted 用警示色。
 * @param {string} level - 'secure' | 'trusted'。
 * @returns {HTMLSpanElement} 安全等级徽标。
 */
function securityBadge(level) {
	const key = level === 'secure' ? 'gist.security.secure' : 'gist.security.trusted'
	const extraClass = level === 'secure' ? 'gist-badge-secure' : 'gist-badge-trusted'
	return badge(key, extraClass)
}

/**
 * 本地化时间显示。
 * @param {number} timestamp - 毫秒时间戳。
 * @returns {string} 本地化时间文本。
 */
function formatDate(timestamp) {
	const date = new Date(timestamp)
	if (Number.isNaN(date.getTime())) return ''
	return date.toLocaleString()
}

/**
 * 渲染列表（空态或卡片），卡片点击跳查看页。
 * @param {Array<object>} gists - gist 摘要列表。
 * @returns {void}
 */
function renderList(gists) {
	const list = document.getElementById('gist-list')
	list.replaceChildren()
	if (!gists.length) {
		const empty = document.createElement('div')
		empty.className = 'gist-empty-state'
		empty.dataset.i18n = 'gist.list.empty'
		list.appendChild(empty)
		return
	}
	for (const gist of gists) {
		const card = document.createElement('a')
		card.className = 'gist-card flex flex-col gap-1.5'
		card.href = `${VIEW_URL}?id=${encodeURIComponent(gist.id)}`

		const title = document.createElement('div')
		title.className = 'gist-card-title'
		title.textContent = gist.title || ''
		title.setAttribute('user-content', '')
		card.appendChild(title)

		const meta = document.createElement('div')
		meta.className = 'gist-card-meta flex flex-wrap items-center gap-1.5'
		meta.appendChild(sourceBadge(gist.source))
		meta.appendChild(securityBadge(gist.securityLevel))
		const timeLabel = document.createElement('span')
		timeLabel.dataset.i18n = 'gist.list.updatedAt'
		meta.appendChild(timeLabel)
		const time = document.createElement('span')
		time.className = 'gist-card-time'
		time.textContent = formatDate(gist.updatedAt)
		time.setAttribute('user-content', '')
		meta.appendChild(time)
		card.appendChild(meta)

		list.appendChild(card)
	}
}

/**
 * 重新加载并渲染列表。
 * @returns {Promise<void>} 渲染完成。
 */
async function render() {
	renderList(await listGists())
}

/**
 * 页面初始化：应用主题、初始化 i18n、绑定新建按钮并加载列表。
 * @returns {Promise<void>} 初始化完成。
 */
async function boot() {
	await initTranslations('gist')
	document.getElementById('new-gist-button').addEventListener('click', () => { location.href = EDIT_URL })
	await render()
}

applyTheme()

boot().catch(handleError('gist.error.generic'))
