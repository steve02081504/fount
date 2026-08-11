/**
 * 【文件】public/hub/messages/messageContext.mjs
 * 【职责】主区消息操作上下文：重载、反应权限、渲染选项、反应绑定。
 */
import { store } from '../core/state.mjs'

import { setChannelMessageActionsContext } from './messageActionsState.mjs'
import { isTwoPartyCharDialogue } from './messageShared.mjs'
import { buildChannelRenderOpts } from './messageSurface.mjs'
import { wireMessageReactions } from './reactionWire.mjs'

/** 模块级频道重载（避免 messageRefresh ↔ callers 层层传 loadMessages）。
 * @returns {Promise<void>}
 */
export async function reloadChannel() {
	const { loadMessages } = await import('./messageRefresh.mjs')
	return loadMessages()
}

/**
 * 从 state.channelCaps 读取当前频道反应/管理权限（不再另发 /permissions）。
 * @returns {void}
 */
export function refreshReactionPerms() {
	if (!store.context.currentState || !store.context.currentGroupId || !store.context.currentChannelId) {
		store.messages.reactionRenderOpts = { viewerMemberId: 'local', canAddReactions: false, canManageMessages: false, canPinMessages: false }
		return
	}
	const viewerMemberId = store.context.currentState.viewerMemberPubKeyHash || 'local'
	const caps = store.context.currentState.channelCaps?.[store.context.currentChannelId] || {}
	store.messages.reactionRenderOpts = {
		viewerMemberId,
		canAddReactions: !!caps.canAddReactions,
		canManageMessages: !!caps.canManageMessages,
		canPinMessages: !!caps.canPinMessages,
	}
}

/** @returns {object} 消息渲染选项 */
export function messageRenderOpts() {
	return buildChannelRenderOpts({
		channelId: store.context.currentChannelId,
		reactions: store.messages.channelReactions,
		overrides: {
			alwaysVisibleActions: isTwoPartyCharDialogue(),
			canCreateThreads: !!store.context.currentState?.channelCaps?.[store.context.currentChannelId]?.canCreateThreads,
		},
	})
}

/** @returns {void} */
export function syncChannelActionsContext() {
	setChannelMessageActionsContext({
		groupId: store.context.currentGroupId,
		channelId: store.context.currentChannelId,
		messages: store.messages.channelMessages,
		reload: reloadChannel,
	}, 'main')
}

/**
 * @param {HTMLElement} container 消息列表容器
 * @returns {void}
 */
export function bindReactions(container) {
	wireMessageReactions(container, {
		groupId: store.context.currentGroupId,
		channelId: store.context.currentChannelId,
		messages: store.messages.channelMessages,
		reactions: store.messages.channelReactions,
		viewerMemberId: store.messages.reactionRenderOpts.viewerMemberId,
		canManageMessages: store.messages.reactionRenderOpts.canManageMessages,
		reload: reloadChannel,
	})
}
