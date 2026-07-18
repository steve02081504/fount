/**
 * 【文件】public/hub/messages/messageContext.mjs
 * 【职责】主区消息操作上下文：重载、反应权限、渲染选项、反应绑定。
 */
import { viewerCanAddReactions, viewerCanManageMessages, viewerCanPinMessages } from '../../src/groupViewerPermissions.mjs'
import { hubStore } from '../core/state.mjs'

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

/** @returns {Promise<void>} 刷新当前频道反应权限 */
export async function refreshReactionPerms() {
	if (!hubStore.context.currentState || !hubStore.context.currentGroupId || !hubStore.context.currentChannelId) {
		hubStore.messages.reactionRenderOpts = { viewerMemberId: 'local', canAddReactions: false, canManageMessages: false, canPinMessages: false }
		return
	}
	const viewerMemberId = hubStore.context.currentState.viewerMemberPubKeyHash || 'local'
	const [canAddReactions, canManageMessages, canPinMessages] = await Promise.all([
		viewerCanAddReactions(hubStore.context.currentState, hubStore.context.currentGroupId, hubStore.context.currentChannelId),
		viewerCanManageMessages(hubStore.context.currentState, hubStore.context.currentGroupId, hubStore.context.currentChannelId),
		viewerCanPinMessages(hubStore.context.currentState, hubStore.context.currentGroupId, hubStore.context.currentChannelId),
	])
	hubStore.messages.reactionRenderOpts = { viewerMemberId, canAddReactions, canManageMessages, canPinMessages }
}

/** @returns {object} 消息渲染选项 */
export function messageRenderOpts() {
	return buildChannelRenderOpts({
		channelId: hubStore.context.currentChannelId,
		reactions: hubStore.messages.channelReactions,
		overrides: {
			alwaysVisibleActions: isTwoPartyCharDialogue(),
			canCreateThreads: !!hubStore.context.currentState?.channelCaps?.[hubStore.context.currentChannelId]?.canCreateThreads,
		},
	})
}

/** @returns {void} */
export function syncChannelActionsContext() {
	setChannelMessageActionsContext({
		groupId: hubStore.context.currentGroupId,
		channelId: hubStore.context.currentChannelId,
		messages: hubStore.messages.channelMessages,
		reload: reloadChannel,
	}, 'main')
}

/**
 * @param {HTMLElement} container 消息列表容器
 * @returns {void}
 */
export function bindReactions(container) {
	wireMessageReactions(container, {
		groupId: hubStore.context.currentGroupId,
		channelId: hubStore.context.currentChannelId,
		messages: hubStore.messages.channelMessages,
		reactions: hubStore.messages.channelReactions,
		viewerMemberId: hubStore.messages.reactionRenderOpts.viewerMemberId,
		canManageMessages: hubStore.messages.reactionRenderOpts.canManageMessages,
		reload: reloadChannel,
	})
}
