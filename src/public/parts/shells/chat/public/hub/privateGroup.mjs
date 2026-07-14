/**
 * 【文件】public/hub/privateGroup.mjs
 * 【职责】角色好友私聊 Hub 流程：进入/重启私聊、清空状态与聊天设置浮层入口。
 * 【原理】`initPrivateGroup` 注入 composer 启停/滚底回调；`enterPrivateGroup` 委托 `enterFriendChat`；`openGroupSettingsModal` 挂载聊天配置浮层。
 * 【数据结构】hubStore.privateGroup 回调引用与当前私聊 charname。
 * 【关联】charCard、chatConfig、friendBindings、messages/loadMessages、hashNav、groupApi。
 */
import { renderTemplate } from '../../../../scripts/features/template.mjs'
import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import { confirmI18n } from '../../../../scripts/i18n/index.mjs'
import { buildCharFriendBinding } from '../shared/friendBinding.mjs'
import { setGroupFriendBinding, unbindFriendGroup } from '../src/api/groupFriendBinding.mjs'

import { initCharCard } from './charCard.mjs'
import { mountChatConfigPanel } from './chatConfig.mjs'
import { resetChatGestures } from './chatGestures.mjs'
import { openOverlayModal, closeOverlayModal } from './core/overlayModal.mjs'
import { hubStore } from './core/state.mjs'
import { friendBindingForGroup } from './friendBindings.mjs'

/**
 * 注入 Hub 私聊 UI 回调。
 * @param {object} callbacks 回调集合
 * @param {() => void} callbacks.enableComposer 启用输入区
 * @param {() => void} callbacks.disableComposer 禁用输入区
 * @param {() => void} callbacks.scrollToBottom 滚到底部
 * @param {(root: HTMLElement) => void} callbacks.applyAvatarsTo 刷新头像
 * @param {(charname: string|null) => void} callbacks.onEnterPrivateGroup 进入/退出私聊
 * @returns {void}
 */
export function initPrivateGroup({
	enableComposer,
	disableComposer,
	scrollToBottom,
	applyAvatarsTo,
	onEnterPrivateGroup,
}) {
	const { privateGroup } = hubStore
	privateGroup.enableComposer = enableComposer
	privateGroup.disableComposer = disableComposer
	privateGroup.scrollToBottom = scrollToBottom
	privateGroup.applyAvatarsTo = applyAvatarsTo
	privateGroup.onEnterPrivateGroup = onEnterPrivateGroup
	/** @returns {string|null} 当前用户名 */
	const getViewerDisplayName = () => hubStore.viewer.viewerDisplayName
	/** @param {string} charName 角色名 */
	const onCharCardEnter = charName => { void enterPrivateGroup(charName) }
	initCharCard({ applyAvatarsTo, getViewerDisplayName, onEnterPrivateGroup: onCharCardEnter })
	resetChatGestures()
}

/**
 * 注册刷新停止生成按钮的回调函数。
 * @param {(() => void)|null} fn 回调
 * @returns {void}
 */
export function setRefreshStopGenerationButton(fn) {
	hubStore.privateGroup.refreshStopGenerationButton = fn
}

/**
 * 清理所有私聊状态。
 * @returns {void}
 */
export function clearPrivateGroupState() {
	const { privateGroup } = hubStore
	privateGroup.groupId = null
	privateGroup.charname = null
	privateGroup.peerEntityHash = null
	privateGroup.channelId = 'default'
	privateGroup.refreshStopGenerationButton?.()
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
	if (hubStore.privateGroup.groupId === previousGroupId)
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
 * @param {{groupId?: string, forceNew?: boolean, binding?: import('../shared/friendBinding.mjs').FriendBinding}} [opts] 选项
 * @returns {Promise<void>}
 */
export async function enterPrivateGroup(charname, opts = {}) {
	if (!charname) return
	const { enterFriendChat } = await import('./friendChat.mjs')
	let binding = opts.binding
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
		groupId: opts.groupId,
		forceNew: opts.forceNew,
		binding,
	})
}

/**
 * 打开私聊设置浮层。
 * @param {string} groupId 会话组 ID
 * @returns {Promise<void>}
 */
export async function openGroupSettingsModal(groupId) {
	const charname = hubStore.privateGroup.charname || '?'
	const friendBound = !!friendBindingForGroup(groupId)
	const settingsRoot = await renderTemplate('hub/chat/char_settings', {
		charname,
		groupId,
		logLength: hubStore.messages.channelMessages.length,
		friendBound,
	})
	openOverlayModal({
		titleKey: 'chat.hub.charChatSettings',
		subtitleKey: 'chat.hub.charChatSubtitle',
		subtitleParams: { name: charname },
		body: settingsRoot.querySelector('.char-settings-body'),
		footer: settingsRoot.querySelector('.char-settings-footer'),
	})
	document.getElementById('hub-character-chat-close').addEventListener('click', closeOverlayModal)
	document.getElementById('hub-character-chat-advanced').addEventListener('click', () => {
		window.open(
			`/parts/shells:chat/hub/#group:${encodeURIComponent(groupId)}:default`,
			'_blank',
			'noopener',
		)
	})
	document.getElementById('hub-character-chat-unbind')?.addEventListener('click', async () => {
		if (!confirmI18n('chat.hub.unbindFriendConfirm', { name: charname })) return
		try {
			const binding = friendBindingForGroup(groupId)
			await unbindFriendGroup(groupId, { charname: binding?.charname })
			const { loadGroups } = await import('./serverBar.mjs')
			await loadGroups()
			showToastI18n('success', 'chat.hub.unbindFriendOk')
			closeOverlayModal()
			clearPrivateGroupState()
			hubStore.privateGroup.onEnterPrivateGroup(null)
		}
		catch (error) {
			showToastI18n('error', 'chat.hub.unbindFriendFailed', { error: error.message })
		}
	})
	document.getElementById('hub-character-chat-delete')?.addEventListener('click', async () => {
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
			setTimeout(() => {
				closeOverlayModal()
				clearPrivateGroupState()
				hubStore.privateGroup.onEnterPrivateGroup(null)
			}, 600)
		}
		catch (error) {
			showToastI18n('error', 'chat.hub.sessionDeleteFailed', { error: error.message })
		}
	})
	void mountChatConfigPanel(groupId, hubStore.privateGroup.channelId, { canEditWorldPlugins: true })
}
