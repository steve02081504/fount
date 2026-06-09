/**
 * 【文件】governance/joinPolicy.mjs
 * 【职责】统一校验 member_join 入群策略：开放、仅邀请码、PoW 质询、创世角色限制等，供本地 append 与联邦入站共用。
 * 【原理】读取物化 state.groupSettings.joinPolicy；invite 模式比对 inviteCode；pow 模式调用 stream verifyPowSolution；genesis 模式限制首几笔事件角色。失败则拒绝事件落盘。
 * 【数据结构】join 事件 content 含 inviteCode、powSolution；state.groupSettings.joinPolicy 字符串枚举。
 * 【关联】stream/groupWsRateLimit.mjs、inviteTickets.mjs、dag/append、room ingest。
 */
import { verifyPowSolution } from '../stream/groupWsHub.mjs'

/**
 * 统一校验 member_join 入群策略（本地 append 与联邦入站共用）。
 * @param {object} state 物化群状态
 * @param {{ type?: string, content?: object }} event DAG 事件
 * @param {string} replicaUsername replica 所有者（PoW 校验用）
 * @returns {void}
 */
export function validateJoinPolicy(state, event, replicaUsername) {
	if (event?.type !== 'member_join') return
	const content = event.content || {}
	if (content.memberKind === 'agent') return
	const joinPolicy = state.groupSettings?.joinPolicy || 'invite-only'
	const activeBefore = Object.values(state.members).filter(groupMember => groupMember?.status === 'active').length
	if (Array.isArray(content.roles)) {
		const allowExtraRoles = content.memberKind === 'agent' || activeBefore === 0
		if (!allowExtraRoles)
			throw new Error('member_join roles only allowed for genesis join')
		for (const roleId of content.roles) {
			if (roleId === '@everyone') continue
			if (!state.roles[roleId]) throw new Error(`member_join unknown role: ${roleId}`)
		}
	}
	if (joinPolicy === 'invite-only' && !content.inviteCode && activeBefore > 0)
		throw new Error('member_join requires inviteCode')
	if (joinPolicy === 'pow') {
		const powDifficulty = Number(state.groupSettings?.powDifficulty) || 0
		if (powDifficulty <= 0) throw new Error('pow joinPolicy requires powDifficulty >= 1')
		if (!verifyPowSolution(replicaUsername, state.groupId, powDifficulty, content.powSolution))
			throw new Error('invalid or expired pow solution')
	}
}
