/**
 * 【文件】public/hub/privateGroup.mjs
 * 【职责】角色好友私聊 Hub 流程：进入/重启私聊、清空状态与聊天设置浮层入口。
 * 【原理】`enterPrivateGroup` 委托 `enterFriendChat`；`openGroupSettingsModal` 挂载聊天配置浮层。
 * 【数据结构】store.privateGroup 当前私聊 charname / groupId。
 * 【关联】charCard、chatConfig、friendBindings、messages/loadMessages、hashNav、friendChat。
 */
import { renderTemplate } from '../../../../scripts/features/template.mjs'
import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import { confirmI18n } from '../../../../scripts/i18n/index.mjs'
import { buildCharFriendBinding } from '../shared/friendBinding.mjs'
import { setGroupFriendBinding, unbindFriendGroup } from '../src/api/groupFriendBinding.mjs'

import { mountChatConfigPanel } from './chatConfig.mjs'
import { openOverlayModal, closeOverlayModal } from './core/overlayModal.mjs'
import { store } from './core/state.mjs'
import { friendBindingForGroup } from './friendBindings.mjs'
import { refreshStopGenerationButton } from './stream/index.mjs'

/**
 * 清理所有私聊状态。
 * @returns {void}
 */
export function clearPrivateGroupState() {
	const { privateGroup } = store
	privateGroup.groupId = null
	privateGroup.charname = null
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
	const { charAgentEntityHash } = await import('./entityResolve.mjs')
	const entityHash = await charAgentEntityHash(charname)
	if (!entityHash) {
		showToastI18n('error', 'chat.hub.noUsername')
		return
	}
	const { enterFriendChat } = await import('./friendChat.mjs')
	await enterFriendChat({
		forceNew: true,
		binding: buildCharFriendBinding(entityHash, charname),
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
	let binding = options.binding
	if (!binding) {
		const { charAgentEntityHash } = await import('./entityResolve.mjs')
		const entityHash = await charAgentEntityHash(charname)
		if (!entityHash) {
			showToastI18n('error', 'chat.hub.noUsername')
			return
		}
		binding = buildCharFriendBinding(entityHash, charname)
	}
	await enterFriendChat({
		groupId: options.groupId,
		forceNew: options.forceNew,
		binding,
	})
}

/**
 * 打开私聊设置浮层。
 * @param {string} groupId 会话组 ID
 * @returns {Promise<void>}
 */
export async function openGroupSettingsModal(groupId) {
	const charname = store.privateGroup.charname || '?'
	const friendBound = !!friendBindingForGroup(groupId)
	const settingsRoot = await renderTemplate('hub/chat/char_settings', {
		charname,
		groupId,
		logLength: store.messages.channelMessages.length,
		friendBound,
	})
	openOverlayModal({
		titleKey: 'chat.hub.charChatSettings',
		subtitleKey: 'chat.hub.charChatSubtitle',
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
		if (!confirmI18n('chat.hub.unbindFriendConfirm', { name: charname })) return
		try {
			const binding = friendBindingForGroup(groupId)
			await unbindFriendGroup(groupId, { charname: binding?.charname })
			const { loadGroups } = await import('./serverBar.mjs')
			await loadGroups()
			showToastI18n('success', 'chat.hub.unbindFriendOk')
			closeOverlayModal()
			clearPrivateGroupState()
			const { onEnterFriendChat } = await import('./friendChat.mjs')
			onEnterFriendChat(null)
		}
		catch (error) {
			showToastI18n('error', 'chat.hub.unbindFriendFailed', { error: error.message })
		}
	})
	document.getElementById('character-chat-delete')?.addEventListener('click', async () => {
		if (!confirmI18n('chat.hub.deleteSessionConfirm', { name: charname })) return
		try {
			const response = await fetch(
				`/api/parts/shells:chat/sessions/${encodeURIComponent(groupId)}`,
				{ method: 'DELETE', credentials: 'include' },
			)
			if (!response.ok) {
				const data = await response.json().catch(() => ({}))
				throw new Error(data.error || 'Session delete failed')
			}
			await response.json()
			showToastI18n('success', 'chat.hub.sessionDeleted')
			setTimeout(async () => {
				closeOverlayModal()
				clearPrivateGroupState()
				const { onEnterFriendChat } = await import('./friendChat.mjs')
				onEnterFriendChat(null)
			}, 600)
		}
		catch (error) {
			showToastI18n('error', 'chat.hub.sessionDeleteFailed', { error: error.message })
		}
	})
	void mountChatConfigPanel(groupId, store.privateGroup.channelId, { canEditWorldPlugins: true })
}
