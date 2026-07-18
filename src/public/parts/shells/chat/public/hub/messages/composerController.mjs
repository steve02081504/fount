/**
 * Hub 消息输入区与顶栏按钮控制。
 *
 * 禁用时绝不要用字符串型 data-i18n（会写 innerHTML → 污染 textarea.value）。
 * 仅在输入区可见的禁用态（只读频道 / 疑似移出）传 `{ placeholder }` 对象键。
 * inbox / discovery / friends idle 等 surface 会隐藏 `.hub-input-area`，无需解释文案。
 */
import { hubStore } from '../core/state.mjs'

const COMPOSER_TOOL_IDS = [
	'hub-emoji-button',
	'hub-upload-button',
	'hub-voice-button',
	'hub-photo-button',
	'hub-sticker-button',
	'hub-vote-button',
	'hub-send-button',
	'hub-composer-more-button',
]

/** @returns {void} */
export function refreshHubHeaderButtons() {
	const hasConversation = !!(hubStore.context.currentGroupId && hubStore.context.currentChannelId)
	document.body.dataset.hubSurface = hasConversation ? 'conversation' : hubStore.context.currentMode

	const filesVisible = hubStore.context.currentMode === 'groups' && hubStore.context.currentGroupId && hubStore.context.currentState?.isMember

	const filesButton = document.getElementById('hub-header-files-button')
	if (filesButton)
		if (filesVisible) filesButton.removeAttribute('hidden')
		else filesButton.setAttribute('hidden', '')

	document.getElementById('hub-overflow-files')?.toggleAttribute('hidden', !filesVisible)

	const callButton = document.getElementById('hub-header-call-button')
	if (callButton) {
		const channelType = hubStore.context.currentState?.channels?.[hubStore.context.currentChannelId]?.type || 'text'
		const show = hubStore.context.currentMode === 'groups'
			&& hubStore.context.currentGroupId
			&& hubStore.context.currentChannelId
			&& hubStore.context.currentState?.isMember
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
	const input = document.getElementById('hub-message-input')
	const channelName = hubStore.context.currentState?.channels?.[hubStore.context.currentChannelId]?.name || hubStore.context.currentChannelId || ''
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
	const input = document.getElementById('hub-message-input')
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
