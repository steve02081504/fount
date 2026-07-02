/**
 * 【文件】group/localAuthz.mjs
 * 【职责】校验经 POST /events 提交的本地未签名授权类 DAG 事件载荷与批次。
 * 【原理】LOCAL_APPEND_AUTHZ_TYPES 白名单；reputation_slash/reset 校验目标活跃成员；peer_invite 校验 from/to 与可选 fileKeyWraps；已签名行跳过本地校验。
 * 【数据结构】事件 type/content、物化 state.members、LOCAL_APPEND_AUTHZ_TYPES Set。
 * 【关联】被 group/routes/dag.mjs 在批量追加前调用；依赖 access.mjs、scripts/p2p/blocklist。
 */
import { isPubKeyHashBlocked } from '../../../../../../scripts/p2p/denylist.mjs'
import { isSignedDagEventRow } from '../../../../../../scripts/p2p/wire_ingress.mjs'
import { getState } from '../chat/dag/materialize.mjs'

import { resolveActiveMemberKey, resolveActiveMemberKeyForLocalUser } from './access.mjs'

/** 仅允许通过 `POST .../events` 本地简体形追加的授权类 DAG 类型。 */
export const LOCAL_APPEND_AUTHZ_TYPES = new Set(['peer_invite', 'reputation_slash', 'reputation_reset'])

/**
 * @param {string} type 事件类型
 * @param {unknown} content 载荷
 * @param {string} callerPubKeyHash 调用方成员 pubKeyHash
 * @param {object} state 物化群状态
 * @returns {void}
 */
export function validateLocalAuthzPayload(type, content, callerPubKeyHash, state) {
	if (type === 'reputation_slash' || type === 'reputation_reset') {
		const targetPubKeyHash = content.targetPubKeyHash?.trim().toLowerCase()
		if (!targetPubKeyHash) throw new Error('targetPubKeyHash required')
		if (state.members[targetPubKeyHash]?.status !== 'active')
			throw new Error('target must be active member')
		if (type === 'reputation_slash' && targetPubKeyHash === callerPubKeyHash)
			throw new Error('cannot slash self')
		return
	}
	if (type === 'peer_invite') {
		const from = content.from?.trim().toLowerCase()
		const to = content.to?.trim().toLowerCase()
		if (from !== callerPubKeyHash) throw new Error('peer_invite from must match caller')
		if (!to || to === callerPubKeyHash) throw new Error('peer_invite requires distinct to')
		if (!resolveActiveMemberKey(state, from)) throw new Error('peer_invite from must be active member')
		if (content.fileKeyWraps !== undefined) {
			const grant = content.fileKeyWraps
			if (!Array.isArray(grant?.generations) || !grant.generations.length)
				throw new Error('peer_invite.fileKeyWraps must be a non-empty grant object or omitted (server injects)')
		}
	}
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {unknown[]} events 事件数组
 * @returns {Promise<void>}
 */
export async function validateLocalAuthzBatch(username, groupId, events) {
	const { state } = await getState(username, groupId)
	const memberKey = await resolveActiveMemberKeyForLocalUser(username, groupId, state)
	if (!memberKey) throw new Error('Not a member')
	for (const event of events) {
		if (isSignedDagEventRow(event)) continue
		const eventType = event.type
		if (!LOCAL_APPEND_AUTHZ_TYPES.has(eventType))
			throw new Error(`local unsigned append only for: ${[...LOCAL_APPEND_AUTHZ_TYPES].join(', ')} (or pass full signed remote events with id+signature)`)
		validateLocalAuthzPayload(eventType, event.content, memberKey, state)
		if (eventType === 'reputation_reset') {
			const targetPubKeyHash = event.content?.targetPubKeyHash?.trim().toLowerCase() || ''
			if (targetPubKeyHash && isPubKeyHashBlocked( targetPubKeyHash))
				throw new Error('reputation_reset ignored for locally blocked target')
		}
	}
}
