/**
 * 【文件】public/settings/nav.mjs
 * 【职责】群设置侧栏/顶栏分区导航状态机（active、ARIA、懒加载触发）。
 */

const LAZY_SECTIONS = {
	emojis: null,
	'channel-perms': null,
	audit: null,
}

/**
 * @param {Record<string, () => Promise<void>>} handlers 懒加载处理器
 * @returns {void}
 */
export function registerSettingsLazyHandlers(handlers) {
	Object.assign(LAZY_SECTIONS, handlers)
}

/**
 * @returns {HTMLElement[]} 当前可见导航项
 */
function visibleNavItems() {
	return Array.from(document.querySelectorAll('.settings-nav-item:not(.hidden)'))
}

/**
 * @param {string} section 分区 id
 * @returns {void}
 */
export function activateSection(section) {
	const items = Array.from(document.querySelectorAll('.settings-nav-item'))
	const target = items.find(item => item.dataset.section === section && !item.classList.contains('hidden'))
		|| visibleNavItems()[0]
	if (!target) return
	const nextSection = target.dataset.section
	for (const item of items) {
		const active = item === target
		item.classList.toggle('settings-nav-item-active', active)
		item.setAttribute('aria-selected', String(active))
		item.tabIndex = active ? 0 : -1
	}
	for (const panel of document.querySelectorAll('.settings-panel')) {
		const active = panel.id === `panel-${nextSection}`
		panel.classList.toggle('hidden', !active)
		panel.toggleAttribute('hidden', !active)
	}
	const lazy = LAZY_SECTIONS[nextSection]
	if (lazy) void lazy()
	target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
}

/**
 * @param {HTMLElement} nav 导航容器
 * @returns {void}
 */
export function wireSettingsNav(nav) {
	nav.addEventListener('click', event => {
		const item = event.target.closest('.settings-nav-item')
		if (!item || item.classList.contains('hidden') || !nav.contains(item)) return
		activateSection(item.dataset.section)
	})
	nav.addEventListener('keydown', event => {
		const items = visibleNavItems()
		const currentIndex = items.indexOf(document.activeElement)
		if (currentIndex < 0) return
		const vertical = window.matchMedia('(min-width: 769px)').matches
		let nextIndex
		if (event.key === (vertical ? 'ArrowDown' : 'ArrowRight'))
			nextIndex = (currentIndex + 1) % items.length
		else if (event.key === (vertical ? 'ArrowUp' : 'ArrowLeft'))
			nextIndex = (currentIndex - 1 + items.length) % items.length
		else if (event.key === 'Home') nextIndex = 0
		else if (event.key === 'End') nextIndex = items.length - 1
		else return
		event.preventDefault()
		items[nextIndex].focus()
		activateSection(items[nextIndex].dataset.section)
	})
}
