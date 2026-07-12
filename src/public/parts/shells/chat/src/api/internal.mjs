import { parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { isHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'

import { getState } from '../chat/dag/materialize.mjs'
import { memberEntityHash } from '../chat/lib/entity.mjs'
import { resolveMemberKey } from '../group/access.mjs'

/**
 * @typedef {{
 *   username: string,
 *   actor: { kind: 'user'|'agent', entityHash: string, charname?: string },
 * }} ChatApiContext
 */

const MEMBERS_PAGE_SIZE = 500

/**
 * @param {object} state 物化群状态
 * @param {string} entityHash 128 hex
 * @returns {string | null} 成员键
 */
export function resolveMemberKeyByEntityHash(state, entityHash) {
	const hash = String(entityHash || '').trim().toLowerCase()
	for (const [key, member] of Object.entries(state.members || {})) 
		if (memberEntityHash(member)?.toLowerCase() === hash) return key
	
	return resolveMemberKey(state, hash)
}

/**
 * @param {object} state 物化群状态
 * @param {string} entityHash 128 hex
 * @returns {string | null} 活跃成员键
 */
export function resolveActiveMemberKeyByEntityHash(state, entityHash) {
	const key = resolveMemberKeyByEntityHash(state, entityHash)
	return key && state.members[key]?.status === 'active' ? key : null
}

/**
 * @param {ChatApiContext} ctx API 上下文
 * @param {string} groupId 群 ID
 * @returns {Promise<object>} 物化 state
 */
export async function loadGroupState(ctx, groupId) {
	const { state } = await getState(ctx.username, groupId)
	return state
}

/**
 * @param {object} state 物化群状态
 * @param {{ page?: number }} [opts] 分页
 * @returns {{ members: [string, object][], page: number, pageCount: number }} 分页切片
 */
export function paginateActiveMembers(state, opts = {}) {
	const page = Math.max(0, Number(opts.page) || 0)
	const activeMembers = Object.entries(state.members || {}).filter(([, member]) => member?.status === 'active')
	const pageCount = Math.max(1, Math.ceil(activeMembers.length / MEMBERS_PAGE_SIZE))
	const slice = activeMembers.slice(page * MEMBERS_PAGE_SIZE, (page + 1) * MEMBERS_PAGE_SIZE)
	return { members: slice, page, pageCount }
}

/**
 * @param {string} entityHash 对端 entityHash
 * @returns {string} 64 hex 对端 pubKeyHash
 */
export function peerPubKeyFromEntityHash(entityHash) {
	const parsed = parseEntityHash(entityHash)
	if (!parsed || !isHex64(parsed.subjectHash))
		throw new Error('entityHash must resolve to a user pubKeyHash for DM')
	return parsed.subjectHash
}

/**
 * @param {string | object} reply 回复载荷
 * @returns {object} channel message content
 */
export function normalizeReplyContent(reply) {
	if (typeof reply === 'string')
		return { type: 'text', content: reply }
	if (reply && typeof reply === 'object') {
		if (reply.type) return reply
		const text = reply.text ?? reply.content
		if (text != null) return { type: 'text', content: String(text) }
	}
	throw new Error('reply must be a string or content object')
}
