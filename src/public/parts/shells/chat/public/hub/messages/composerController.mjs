/**
 * Hub 消息输入区与顶栏按钮控制。
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
	input.removeAttribute('data-i18n')
	input.setAttribute('data-i18n', 'chat.hub.composer')
	for (const id of COMPOSER_TOOL_IDS) {
		const el = document.getElementById(id)
		if (el) el.disabled = false
	}
	refreshHubHeaderButtons()
}

/**
 * @param {string} [i18nKey] placeholder 的 i18n 键
 * @returns {void}
 */
export function disableComposer(i18nKey = 'chat.hub.composerDisabled') {
	const input = document.getElementById('hub-message-input')
	input.disabled = true
	input.dataset.i18n = i18nKey
	delete input.dataset.channel
	for (const id of COMPOSER_TOOL_IDS) {
		const el = document.getElementById(id)
		if (el) el.disabled = true
	}
	refreshHubHeaderButtons()
}
