import { encodeEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { isHex64, normalizeHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { sha256TextHex } from 'npm:@steve02081504/fount-p2p/crypto'

import { resolveActiveMemberKeyForLocalUser } from '../../group/access.mjs'
import { getState } from '../dag/materialize.mjs'

import { memberEntityHash } from './entity.mjs'
import { groupKindFromState } from './notifyPrefs.mjs'

/**
 * ECDH DM 对端 entityHash（本机视角）。
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {object} state 物化群状态
 * @returns {Promise<string | undefined>} 对端 entityHash
 */
async function resolveBoundPeerEntityHash(username, groupId, state) {
	if (state.groupMeta?.dmKind !== 'ecdh') return undefined
	const localKey = (await resolveActiveMemberKeyForLocalUser(username, groupId, state))?.toLowerCase()
	for (const [memberKey, member] of Object.entries(state.members || {})) {
		if (member?.status !== 'active' || member.memberKind === 'agent') continue
		const key = String(memberKey).trim().toLowerCase()
		if (localKey && key === localKey) continue
		const hash = memberEntityHash(member)
		if (hash) return hash.toLowerCase()
	}
	const peerPub = normalizeHex64(state.groupMeta?.dmPeerPubKeyHex)
	const dmSessionTag = String(state.groupMeta?.dmSessionTag || '').trim().toLowerCase()
	if (!peerPub || !dmSessionTag) return undefined
	const { hashFromPubKeyHex } = await import('../../../public/shared/entityId.mjs')
	const subjectHash = await hashFromPubKeyHex(peerPub)
	const anchorNode = sha256TextHex(`fount:chat:dm-peer-anchor:${dmSessionTag}`)
	if (!isHex64(anchorNode) || !isHex64(subjectHash)) return undefined
	return encodeEntityHash(anchorNode, subjectHash).toLowerCase()
}

/**
 * @param {object} state 物化群状态
 * @returns {number} active 成员数
 */
function countActiveMembers(state) {
	return Object.values(state.members || {}).filter(member => member?.status === 'active').length
}

/**
 * 构建可序列化会话上下文（OnMessage / ChatClient 投影基座）。
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {Promise<{ group: object, channel: object }>} 群/频道投影
 */
export async function buildConversationContext(username, groupId, channelId) {
	const { state } = await getState(username, groupId)
	const kind = groupKindFromState(state)
	const isEcdhDm = state.groupMeta?.dmKind === 'ecdh'
	const channel = state.channels?.[channelId]
	return {
		group: {
			groupId,
			name: state.groupMeta?.name || groupId,
			kind,
			...isEcdhDm ? { boundPeerEntityHash: await resolveBoundPeerEntityHash(username, groupId, state) } : {},
			...state.groupSettings?.bridge ? { bridge: state.groupSettings.bridge } : {},
			memberCount: countActiveMembers(state),
		},
		channel: {
			channelId,
			name: channel?.name || channelId,
			kind: channel?.parentChannelId && channel?.parentEventId ? 'thread' : 'text',
		},
	}
}
