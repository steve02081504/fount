/**
 * 【文件】public/hub/messages/actions/forward.mjs
 * 【职责】消息转发对话框。
 */
import { showToastI18n } from '../../../../../../scripts/features/toast.mjs'
import { geti18n } from '../../../../../../scripts/i18n/index.mjs'
import { sendGroupMessage } from '../../../src/api/groupChannel.mjs'
import { getGroupState } from '../../../src/api/groupCore.mjs'
import { store } from '../../core/state.mjs'
import { getMessageText } from '../render/text.mjs'

/**
 * 弹出转发对话框，选择目标群+频道后发送。
 * @param {HTMLElement} button 被点击按钮
 * @param {object} channelMessage 原消息
 * @param {object} actions 操作上下文
 * @returns {Promise<boolean>} 是否已处理
 */
export async function handleForward(button, channelMessage, actions) {
	const { groupId, channelId } = actions
	const eventId = button.dataset.eventId?.trim()
	if (!eventId) return true

	const sidebarGroups = store.sidebar.groups || []
	if (!sidebarGroups.length) {
		showToastI18n('info', 'chat.hub.forwardDialog.selectGroup')
		return true
	}

	const titleLabel = geti18n('chat.hub.forwardDialog.title') || 'Forward message'
	const selectGroupLabel = geti18n('chat.hub.forwardDialog.selectGroup') || 'Select group'
	const selectChannelLabel = geti18n('chat.hub.forwardDialog.selectChannel') || 'Select channel'
	const confirmLabel = geti18n('chat.hub.forwardDialog.confirm') || 'Forward'
	const cancelLabel = geti18n('chat.hub.forwardDialog.cancel') || 'Cancel'

	const dialog = document.createElement('dialog')
	dialog.className = 'modal'
	dialog.innerHTML = `
		<div class="modal-box">
			<h3 class="font-bold text-lg mb-3">${titleLabel}</h3>
			<label class="form-control w-full mb-2">
				<span class="label-text">${selectGroupLabel}</span>
				<select id="fwd-group-select" class="select select-bordered w-full"></select>
			</label>
			<label class="form-control w-full mb-4">
				<span class="label-text">${selectChannelLabel}</span>
				<select id="fwd-channel-select" class="select select-bordered w-full"></select>
			</label>
			<div class="flex justify-end gap-2">
				<button type="button" data-cancel class="btn btn-ghost">${cancelLabel}</button>
				<button type="button" data-confirm class="btn btn-primary">${confirmLabel}</button>
			</div>
		</div>
		<form method="dialog" class="modal-backdrop"><button></button></form>
	`
	document.body.appendChild(dialog)

	const groupSelect = dialog.querySelector('#fwd-group-select')
	const channelSelect = dialog.querySelector('#fwd-channel-select')

	for (const group of sidebarGroups) {
		const opt = document.createElement('option')
		opt.value = group.groupId || group.id || ''
		opt.textContent = group.groupName || group.name || opt.value
		groupSelect?.appendChild(opt)
	}

	/** @returns {Promise<void>} 刷新频道选项 */
	const updateChannels = async () => {
		if (!channelSelect) return
		channelSelect.innerHTML = ''
		const selGroupId = groupSelect?.value
		if (!selGroupId) return
		try {
			const state = await getGroupState(selGroupId)
			const chs = state?.channels || {}
			for (const [chId, ch] of Object.entries(chs)) {
				if (ch.type && ch.type !== 'text') continue
				const opt = document.createElement('option')
				opt.value = chId
				opt.textContent = ch.name || chId
				channelSelect.appendChild(opt)
			}
		}
		catch { /* empty */ }
	}

	groupSelect?.addEventListener('change', () => { void updateChannels() })
	await updateChannels()

	dialog.querySelector('[data-cancel]')?.addEventListener('click', () => dialog.close())
	dialog.querySelector('[data-confirm]')?.addEventListener('click', async () => {
		const targetGroupId = groupSelect?.value
		const targetChannelId = channelSelect?.value
		if (!targetGroupId || !targetChannelId) return
		dialog.close()
		try {
			const text = getMessageText(channelMessage)
			const senderName = channelMessage.content?.displayName
				|| String(channelMessage.sender || '').slice(0, 8)
				|| '?'
			const { formatMessageRunUri, wrapProtocolHttpsUrl } = await import('../../../shared/runUri.mjs')
			const shareUrl = groupId && channelId && eventId
				? wrapProtocolHttpsUrl(formatMessageRunUri(groupId, channelId, eventId))
				: ''
			await sendGroupMessage(targetGroupId, targetChannelId, {
				type: 'text',
				content: text,
				locale: channelMessage.content?.locale || navigator.language,
				forwardedFrom: {
					groupId: groupId || '',
					channelId: channelId || '',
					eventId: eventId || '',
					senderName,
					shareUrl,
				},
			})
			showToastI18n('success', 'chat.hub.forwardDialog.success')
		}
		catch (error) {
			showToastI18n('error', 'chat.hub.forwardDialog.failed', { error: error?.message || String(error) })
		}
	})

	dialog.addEventListener('close', () => { dialog.remove() })
	dialog.showModal()
	return true
}
