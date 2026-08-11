/**
 * 【文件】public/hub/privateGroup.mjs
 * 【职责】角色好友私聊 Hub 流程：进入/重启私聊、清空状态与聊天设置浮层入口。
 * 【原理】`enterPrivateGroup` 委托 `enterFriendChat`；`openGroupSettingsModal` 挂载聊天配置浮层。
 * 【数据结构】store.privateGroup 当前私聊 groupId / peerEntityHash。
 * 【关联】charCard、chatConfig、friendBindings、messages/loadMessages、hashNav、friendChat。
 */
import { renderTemplate } from '../../../../scripts/features/template.mjs'
import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import { confirmI18n } from '../../../../scripts/i18n/index.mjs'
import { charFriendBindingInput } from '../shared/friendBinding.mjs'
import { deleteSession } from '../src/endpoints/groupCore.mjs'
import { setGroupFriendBinding, unbindFriendGroup } from '../src/endpoints/groupFriendBinding.mjs'

import { mountChatConfigPanel } from './chatConfig.mjs'
import { openOverlayModal, closeOverlayModal } from './core/overlayModal.mjs'
import { store } from './core/state.mjs'
import { activePrivateCharPartName, friendBindingForGroup } from './friendBindings.mjs'
import { refreshStopGenerationButton } from './stream/index.mjs'

/**
 * 清理所有私聊状态。
 * @returns {void}
 */
export function clearPrivateGroupState() {
	const { privateGroup } = store
	privateGroup.groupId = null
	privateGroup.peerEntityHash = null
	privateGroup.channelId = 'default'
	refreshStopGenerationButton()
}

/**
 * 解绑旧群并新建与该角色的私聊会话。
 * @param {string} charname 角色名
 * @param {string} [previousGroupId] 待解绑的旧群 ID
 * @returns {Promise<void>}
 */
export async function restartPrivateGroup(charname, previousGroupId) {
	if (previousGroupId) {
		await setGroupFriendBinding(previousGroupId, null)
		const { loadGroups } = await import('./serverBar.mjs')
		await loadGroups()
	}
	if (store.privateGroup.groupId === previousGroupId)
		clearPrivateGroupState()
	const { enterFriendChat } = await import('./friendChat.mjs')
	await enterFriendChat({
		forceNew: true,
		binding: charFriendBindingInput(charname),
	})
}

/**
 * 进入与指定角色的好友私聊（统一走群频道会话）。
 * @param {string} charname 角色名
 * @param {{groupId?: string, forceNew?: boolean, binding?: import('../shared/friendBinding.mjs').FriendBinding}} [options] 选项
 * @returns {Promise<void>}
 */
export async function enterPrivateGroup(charname, options = {}) {
	if (!charname) return
	const { enterFriendChat } = await import('./friendChat.mjs')
	await enterFriendChat({
		groupId: options.groupId,
		forceNew: options.forceNew,
		binding: options.binding || charFriendBindingInput(charname),
	})
}

/**
 * 打开私聊设置浮层。
 * @param {string} groupId 会话组 ID
 * @returns {Promise<void>}
 */
export async function openGroupSettingsModal(groupId) {
	const charname = activePrivateCharPartName() || '?'
	const friendBound = !!friendBindingForGroup(groupId)
	const settingsRoot = await renderTemplate('hub/chat/char_settings', {
		charname,
		groupId,
		logLength: store.messages.channelMessages.length,
		friendBound,
	})
	openOverlayModal({
		titleKey: 'chat.hub.char.chat.settings',
		subtitleKey: 'chat.hub.char.chat.subtitle',
		subtitleParams: { name: charname },
		body: settingsRoot.querySelector('.char-settings-body'),
		footer: settingsRoot.querySelector('.char-settings-footer'),
	})
	document.getElementById('character-chat-close').addEventListener('click', closeOverlayModal)
	document.getElementById('character-chat-advanced').addEventListener('click', () => {
		window.open(
			`/parts/shells:chat/hub/#group:${encodeURIComponent(groupId)}:default`,
			'_blank',
			'noopener',
		)
	})
	document.getElementById('character-chat-unbind')?.addEventListener('click', async () => {
		if (!confirmI18n('chat.hub.unbindFriend.confirm', { name: charname })) return
		try {
			const binding = friendBindingForGroup(groupId)
			await unbindFriendGroup(groupId, { charname: binding?.charname })
			const { loadGroups } = await import('./serverBar.mjs')
			await loadGroups()
			showToastI18n('success', 'chat.hub.unbindFriend.ok')
			closeOverlayModal()
			clearPrivateGroupState()
			const { onEnterFriendChat } = await import('./friendChat.mjs')
			onEnterFriendChat(null)
		}
		catch (error) {
			showToastI18n('error', 'chat.hub.unbindFriend.failed', { error: error.message })
		}
	})
	document.getElementById('character-chat-delete')?.addEventListener('click', async () => {
		if (!confirmI18n('chat.hub.deleteSessionConfirm', { name: charname })) return
		try {
			await deleteSession(groupId)
			showToastI18n('success', 'chat.hub.session.deleted')
			setTimeout(async () => {
				closeOverlayModal()
				clearPrivateGroupState()
				const { onEnterFriendChat } = await import('./friendChat.mjs')
				onEnterFriendChat(null)
			}, 600)
		}
		catch (error) {
			showToastI18n('error', 'chat.hub.session.deleteFailed', { error: error.message })
		}
	})
	void mountChatConfigPanel(groupId, store.privateGroup.channelId, { canEditWorldPlugins: true })
}
