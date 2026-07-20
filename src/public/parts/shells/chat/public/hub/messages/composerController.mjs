/**
 * Hub 消息输入区与顶栏按钮控制。
 *
 * 禁用时绝不要用字符串型 data-i18n（会写 innerHTML → 污染 textarea.value）。
 * 仅在输入区可见的禁用态（只读频道 / 疑似移出）传 `{ placeholder }` 对象键。
 * inbox / discovery / friends idle 等 surface 会隐藏 `.input-area`，无需解释文案。
 */
import { store } from '../core/state.mjs'

const COMPOSER_TOOL_IDS = [
	'emoji-button',
	'upload-button',
	'voice-button',
	'photo-button',
	'sticker-button',
	'vote-button',
	'send-button',
	'composer-more-button',
]

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
		if (el) el.disabled = false
	}
	refreshHubHeaderButtons()
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
		if (el) el.disabled = true
	}
	refreshHubHeaderButtons()
}
