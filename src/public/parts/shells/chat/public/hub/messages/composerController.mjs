/**
 * Hub 消息输入区与顶栏按钮控制。
 */
import { hubStore } from '../core/state.mjs'

/** @returns {void} */
export function refreshHubHeaderButtons() {
	const filesButton = document.getElementById('hub-header-files-button')
	if (filesButton)
		if (hubStore.context.currentMode === 'groups' && hubStore.context.currentGroupId && hubStore.context.currentState?.isMember)
			filesButton.removeAttribute('hidden')
		else filesButton.setAttribute('hidden', '')

	const settingsButton = document.getElementById('hub-header-settings-button')
	if (settingsButton)
		if (hubStore.context.currentMode === 'groups' && hubStore.context.currentGroupId)
			settingsButton.removeAttribute('hidden')
		else settingsButton.setAttribute('hidden', '')
}

/** @returns {void} */
export function enableComposer() {
	const input = document.getElementById('hub-message-input')
	const channelName = hubStore.context.currentState?.channels?.[hubStore.context.currentChannelId]?.name || hubStore.context.currentChannelId || ''
	input.disabled = false
	input.dataset.channel = channelName
	input.removeAttribute('data-i18n')
	input.setAttribute('data-i18n', 'chat.hub.composer')
	for (const id of ['hub-emoji-button', 'hub-upload-button', 'hub-voice-button', 'hub-photo-button', 'hub-sticker-button', 'hub-vote-button', 'hub-send-button']) {
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
	for (const id of ['hub-emoji-button', 'hub-upload-button', 'hub-voice-button', 'hub-photo-button', 'hub-sticker-button', 'hub-vote-button', 'hub-send-button']) {
		const el = document.getElementById(id)
		if (el) el.disabled = true
	}
	refreshHubHeaderButtons()
}
