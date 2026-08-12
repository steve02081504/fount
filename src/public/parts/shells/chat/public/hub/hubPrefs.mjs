/**
 * Hub 偏好设置壳：左侧导航切换翻译 / 联邦 P2P，共用 `#settings-modal`。
 */
import { renderTemplate } from '../src/templates.mjs'

import { closeOverlayModal, openOverlayModal } from './core/overlayModal.mjs'

/** @type {'translation' | 'federation' | null} */
let activeSection = null
/** @type {(() => string | null | undefined) | null} */
let activeGetGroupId = null
/** @type {number} */
let mountGeneration = 0

/**
 * @param {HTMLElement} nav 导航根
 * @param {string} section 当前分区
 * @param {{ focus?: boolean }} [options] 是否把焦点移到激活 tab
 * @returns {void}
 */
function markActiveNav(nav, section, options = {}) {
	/** @type {HTMLElement | null} */
	let activeButton = null
	for (const button of nav.querySelectorAll('[data-prefs-section]')) {
		if (!(button instanceof HTMLElement)) continue
		const active = button.getAttribute('data-prefs-section') === section
		button.classList.toggle('tab-active', active)
		button.setAttribute('aria-selected', active ? 'true' : 'false')
		button.tabIndex = active ? 0 : -1
		if (active) activeButton = button
	}
	if (options.focus) activeButton?.focus()
}

/**
 * @param {HTMLElement} panel 内容区
 * @param {HTMLElement} footer 底栏
 * @param {string} section 分区 id
 * @returns {Promise<void>}
 */
async function mountSection(panel, footer, section) {
	const generation = ++mountGeneration
	panel.replaceChildren()
	footer.replaceChildren()
	if (section === 'translation') {
		const { mountTranslationPrefsPanel } = await import('./translationPrefsDialog.mjs')
		if (generation !== mountGeneration) return
		await mountTranslationPrefsPanel(panel, footer)
		return
	}
	const { mountFederationPrefsPanel } = await import('./federation/federationModal.mjs')
	if (generation !== mountGeneration) return
	await mountFederationPrefsPanel(panel, footer, activeGetGroupId?.() || null)
}

/**
 * 打开 Hub 偏好设置（翻译 / 联邦 P2P）。
 * @param {{
 *   section?: 'translation' | 'federation'
 *   getGroupId?: () => string | null | undefined
 * }} [options] 初始分区与当前群
 * @returns {Promise<void>}
 */
export async function openHubPrefsModal(options = {}) {
	const section = options.section === 'federation' ? 'federation' : 'translation'
	activeGetGroupId = options.getGroupId || null
	const shell = await renderTemplate('hub/prefs/shell', {})
	openOverlayModal({
		titleKey: 'chat.hub.settingsModalTitle',
		subtitleKey: 'chat.hub.prefsSubtitle',
		body: shell,
		footer: '',
	})

	const body = document.getElementById('overlay-body')
	const nav = body?.querySelector('.prefs-nav')
	const panel = body?.querySelector('[data-prefs-panel]')
	const footer = body?.querySelector('[data-prefs-footer]')
	if (!(nav instanceof HTMLElement) || !(panel instanceof HTMLElement) || !(footer instanceof HTMLElement))
		return

	const tabs = Array.from(nav.querySelectorAll('[data-prefs-section]'))
		.filter(el => el instanceof HTMLElement)

	/**
	 * @param {string} next 分区 id
	 * @param {{ focus?: boolean }} [navOptions] 是否聚焦
	 * @returns {void}
	 */
	function selectSection(next, navOptions = {}) {
		if (!next || next === activeSection) {
			if (navOptions.focus) markActiveNav(nav, activeSection || next, { focus: true })
			return
		}
		activeSection = /** @type {'translation' | 'federation'} */ next
		markActiveNav(nav, activeSection, navOptions)
		void mountSection(panel, footer, activeSection)
	}

	nav.addEventListener('click', event => {
		const button = event.target instanceof Element
			? event.target.closest('[data-prefs-section]')
			: null
		const next = button?.getAttribute('data-prefs-section')
		if (next) selectSection(next)
	})

	nav.addEventListener('keydown', event => {
		const currentIndex = tabs.indexOf(/** @type {HTMLElement} */ document.activeElement)
		if (currentIndex < 0) return
		let nextIndex
		if (event.key === 'ArrowDown' || event.key === 'ArrowRight')
			nextIndex = (currentIndex + 1) % tabs.length
		else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft')
			nextIndex = (currentIndex - 1 + tabs.length) % tabs.length
		else if (event.key === 'Home') nextIndex = 0
		else if (event.key === 'End') nextIndex = tabs.length - 1
		else return
		event.preventDefault()
		const next = tabs[nextIndex].getAttribute('data-prefs-section')
		if (next) selectSection(next, { focus: true })
	})

	activeSection = null
	selectSection(section, { focus: true })
}

/**
 * 关闭偏好浮层（供分区内关闭按钮复用）。
 * @returns {void}
 */
export function closeHubPrefsModal() {
	closeOverlayModal()
}
