/**
 * Hub 偏好设置壳：左侧导航切换翻译 / 联邦 P2P，共用 `#settings-modal`。
 */
import { renderTemplate, usingTemplates } from '../../../../scripts/features/template.mjs'

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
 * @returns {void}
 */
function markActiveNav(nav, section) {
	for (const button of nav.querySelectorAll('[data-prefs-section]')) {
		const active = button.getAttribute('data-prefs-section') === section
		button.classList.toggle('prefs-nav-item--active', active)
		button.setAttribute('aria-selected', active ? 'true' : 'false')
	}
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
	activeGetGroupId = typeof options.getGroupId === 'function' ? options.getGroupId : null
	usingTemplates('/parts/shells:chat/src/templates')
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

	nav.addEventListener('click', event => {
		const button = event.target instanceof Element
			? event.target.closest('[data-prefs-section]')
			: null
		const next = button?.getAttribute('data-prefs-section')
		if (!next || next === activeSection) return
		activeSection = /** @type {'translation' | 'federation'} */ next
		markActiveNav(nav, activeSection)
		void mountSection(panel, footer, activeSection)
	})

	activeSection = section
	markActiveNav(nav, section)
	await mountSection(panel, footer, section)
}

/**
 * 关闭偏好浮层（供分区内关闭按钮复用）。
 * @returns {void}
 */
export function closeHubPrefsModal() {
	closeOverlayModal()
}
