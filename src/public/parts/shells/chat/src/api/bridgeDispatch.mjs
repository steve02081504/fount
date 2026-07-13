import { requireBridgeOp } from '../chat/bridge/ops.mjs'

/**
 * @param {object} state 物化群状态
 * @returns {{ platform: string, platformChatId: string } | null} 桥接上下文
 */
function bridgeContext(state) {
	const bridge = state.groupSettings?.bridge
	if (!bridge?.platform || !bridge?.platformChatId) return null
	return { platform: bridge.platform, platformChatId: bridge.platformChatId }
}

/**
 * @param {import('./internal.mjs').ChatApiContext} ctx API 上下文
 * @param {string} groupId 群 ID
 * @param {object} state 物化群状态
 * @param {string} channelId 频道 ID
 * @returns {Promise<void>}
 */
export async function dispatchBridgeTyping(ctx, groupId, state, channelId) {
	const bridge = bridgeContext(state)
	if (!bridge) return
	await requireBridgeOp(ctx.username, state.groupSettings.bridge, 'sendTyping')({
		platformChatId: bridge.platformChatId,
		platformThreadId: channelId !== 'default' ? channelId : undefined,
	})
}

/**
 * @param {import('./internal.mjs').ChatApiContext} ctx API 上下文
 * @param {string} groupId 群 ID
 * @param {object} state 物化群状态
 * @returns {Promise<void>}
 */
export async function dispatchBridgeLeave(ctx, groupId, state) {
	const bridge = bridgeContext(state)
	if (!bridge) return
	await requireBridgeOp(ctx.username, state.groupSettings.bridge, 'leaveChat')({
		platformChatId: bridge.platformChatId,
	})
}

/**
 * @param {import('./internal.mjs').ChatApiContext} ctx API 上下文
 * @param {string} groupId 群 ID
 * @param {object} state 物化群状态
 * @param {string} targetMemberKey 成员键
 * @param {object} memberRow 成员行
 * @returns {Promise<void>}
 */
export async function dispatchBridgeMemberKick(ctx, groupId, state, targetMemberKey, memberRow) {
	const bridge = bridgeContext(state)
	if (!bridge) return
	const platformUserId = memberRow?.platformUserId || memberRow?.extension?.bridge?.platformUserId
	if (!platformUserId) throw new Error('bridge member kick requires platformUserId')
	await requireBridgeOp(ctx.username, state.groupSettings.bridge, 'kickMember')({
		platformChatId: bridge.platformChatId,
		platformUserId,
	})
}
