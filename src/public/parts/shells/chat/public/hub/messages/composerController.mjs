/**
 * Hub 消息输入区与顶栏按钮控制。
 *
 * 禁用时绝不要用字符串型 data-i18n（会写 innerHTML → 污染 textarea.value）。
 * 仅在输入区可见的禁用态（只读频道 / 疑似移出）传 `{ placeholder }` 对象键。
 * inbox / discovery / friends idle 等 surface 会隐藏 `.input-area`，无需解释文案。
 */
import { onThemeChange } from '../../../../../scripts/theme/index.mjs'
import { store } from '../core/state.mjs'

const COMPOSER_TOOL_IDS = [
	'emoji-button',
	'upload-button',
	'voice-button',
	'photo-button',
	'vote-button',
	'send-button',
	'composer-more-button',
]

// 主题切换会改变排版与间距，缓存的单行高度随之失效，需在下次对齐计算前清掉。
onThemeChange(() => {
	const input = document.getElementById('message-input')
	if (input) delete input.dataset.singleLineHeight
})

/**
 * 计算文本框单行高度（含 padding），作为判断多行的阈值。
 * @param {HTMLTextAreaElement} input 消息输入框
 * @returns {number} 单行高度
 */
function getSingleLineHeight(input) {
	const cached = input.dataset.singleLineHeight
	if (cached) return Number(cached)
	const probe = input.cloneNode()
	probe.value = 'M'
	probe.removeAttribute('id')
	probe.removeAttribute('name')
	const computedStyle = getComputedStyle(input)
	for (const prop of ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right', 'border-top-width', 'border-bottom-width', 'box-sizing'])
		probe.style.setProperty(prop, computedStyle.getPropertyValue(prop))
	probe.style.height = 'auto'
	probe.style.position = 'fixed'
	probe.style.left = '-9999px'
	probe.style.top = '0'
	probe.style.visibility = 'hidden'
	probe.tabIndex = -1
	input.parentNode.appendChild(probe)
	const height = probe.scrollHeight
	probe.remove()
	input.dataset.singleLineHeight = String(height)
	return height
}

/**
 * 根据输入框行高切换主行对齐方式：单行居中，多行贴底。
 * @returns {void}
 */
export function syncComposerAlignment() {
	const row = document.getElementById('composer-main-row')
	const input = document.getElementById('message-input')
	const threshold = getSingleLineHeight(input)
	if (threshold <= 0) return
	row.classList.toggle('is-multiline', input.scrollHeight > threshold + 1)
}

/**
 * 启用/禁用 composer 工具控件（button 用 disabled；details/summary 用 inert + aria-disabled）。
 * @param {HTMLElement} el 控件
 * @param {boolean} enabled 是否可用
 * @returns {void}
 */
function setComposerToolEnabled(el, enabled) {
	if (el instanceof HTMLButtonElement || el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
		el.disabled = !enabled
		return
	}
	if (el.tagName !== 'SUMMARY') return
	el.toggleAttribute('aria-disabled', !enabled)
	el.classList.toggle('btn-disabled', !enabled)
	const details = el.closest('details')
	if (!(details instanceof HTMLDetailsElement)) return
	if (enabled) details.removeAttribute('inert')
	else {
		details.open = false
		details.setAttribute('inert', '')
	}
}

/** @returns {void} */
export function refreshHubHeaderButtons() {
	const hasConversation = !!(store.context.currentGroupId && store.context.currentChannelId)
	document.body.dataset.surface = hasConversation ? 'conversation' : store.context.currentMode

	const filesVisible = store.context.currentMode === 'groups' && store.context.currentGroupId && store.context.currentState?.isMember

	const filesButton = document.getElementById('header-files-button')
	if (filesButton)
		if (filesVisible) filesButton.removeAttribute('hidden')
		else filesButton.setAttribute('hidden', '')

	document.getElementById('overflow-files')?.toggleAttribute('hidden', !filesVisible)

	const callButton = document.getElementById('header-call-button')
	if (callButton) {
		const channelType = store.context.currentState?.channels?.[store.context.currentChannelId]?.type || 'text'
		const show = store.context.currentMode === 'groups'
			&& store.context.currentGroupId
			&& store.context.currentChannelId
			&& store.context.currentState?.isMember
			&& (channelType === 'text' || channelType === 'streaming')
		if (show) {
			callButton.removeAttribute('hidden')
			void import('../call.mjs').then(m => m.refreshCallStatusBadge())
		}
		else callButton.setAttribute('hidden', '')
	}
}

/** @returns {void} */
export function enableComposer() {
	const input = document.getElementById('message-input')
	const channelName = store.context.currentState?.channels?.[store.context.currentChannelId]?.name || store.context.currentChannelId || ''
	input.disabled = false
	input.dataset.channel = channelName
	input.dataset.i18n = 'chat.hub.composer'
	for (const id of COMPOSER_TOOL_IDS) {
		const el = document.getElementById(id)
		if (el) setComposerToolEnabled(el, true)
	}
	refreshHubHeaderButtons()
	syncComposerAlignment()
}

/**
 * 禁用输入区。不改动 textarea.value（草稿 / 草稿污染均由此避免）。
 * @param {string} [placeholderI18nKey] 可见禁用态的 `{ placeholder }` i18n 键；隐藏 surface 勿传
 * @returns {void}
 */
export function disableComposer(placeholderI18nKey) {
	const input = document.getElementById('message-input')
	input.disabled = true
	delete input.dataset.channel
	if (placeholderI18nKey)
		input.dataset.i18n = placeholderI18nKey
	else {
		input.removeAttribute('data-i18n')
		input.removeAttribute('placeholder')
	}
	for (const id of COMPOSER_TOOL_IDS) {
		const el = document.getElementById(id)
		if (el) setComposerToolEnabled(el, false)
	}
	refreshHubHeaderButtons()
}
