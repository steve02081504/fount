import { viewerCanAddReactions, viewerCanManageMessages, viewerCanPinMessages } from '../../src/groupViewerPermissions.mjs'
import { activeCharPartNames } from '../core/domUtils.mjs'
import { hubStore } from '../core/state.mjs'

import { setChannelMessageActionsContext } from './messageActionsState.mjs'
import { isTwoPartyCharDialogue } from './messageShared.mjs'
import { wireMessageReactions } from './reactions.mjs'

/** 模块级频道重载（避免 messageRefresh ↔ callers 层层传 loadMessages）。 */
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
	const pinnedEventIds = hubStore.context.currentChannelId && hubStore.context.currentState?.pinsByChannel?.[hubStore.context.currentChannelId]
		? [...hubStore.context.currentState.pinsByChannel[hubStore.context.currentChannelId]]
		: []
	return {
		reactions: hubStore.messages.channelReactions,
		viewerMemberId: hubStore.messages.reactionRenderOpts.viewerMemberId,
		canAddReactions: hubStore.messages.reactionRenderOpts.canAddReactions,
		viewerPubKeyHash: hubStore.context.currentState?.viewerMemberPubKeyHash || null,
		viewerEntityHash: hubStore.viewer.viewerEntityHash || hubStore.viewer.operatorEntityHash || null,
		groupMembers: hubStore.context.currentState?.members || [],
		localCharIds: activeCharPartNames(),
		canManageMessages: hubStore.messages.reactionRenderOpts.canManageMessages,
		canPinMessages: hubStore.messages.reactionRenderOpts.canPinMessages,
		pinnedEventIds,
		alwaysVisibleActions: isTwoPartyCharDialogue(),
		canCreateThreads: !!hubStore.context.currentState?.channelCaps?.[hubStore.context.currentChannelId]?.canCreateThreads,
	}
}

/** @returns {void} */
export function syncChannelActionsContext() {
	setChannelMessageActionsContext({
		groupId: hubStore.context.currentGroupId,
		channelId: hubStore.context.currentChannelId,
		messages: hubStore.messages.channelMessages,
		reload: reloadChannel,
	})
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
