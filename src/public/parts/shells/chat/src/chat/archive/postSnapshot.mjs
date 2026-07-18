/**
 * 帖子终态快照（冷归档 / Hub 深历史）。
 */
import { isHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'

import { getPartDetails } from '../../../../../../../server/parts_loader.mjs'
import { channelMessageContentObject } from '../../../public/shared/channelContent.mjs'
import { mergeChannelMessagesForDisplay } from '../../../public/shared/messageMerge.mjs'
import { memberEntityHash } from '../../entity/member.mjs'
import { getProfile } from '../../entity/profile.mjs'
import { resolveActiveAgentMemberKeyByCharname } from '../../group/access.mjs'
import { decryptEventContent } from '../channel_keys/content.mjs'

import { overlayPinsForChannel } from './hotPostsIndex.mjs'

/**
 * 角色消息展示快照：查 agent 成员 + 角色 part，不用 sender（宿主人类）profile。
 * @param {object} state 物化群状态
 * @param {string} charId 角色 part 名
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @returns {Promise<{ name: string, avatar: string | null }>} 展示快照
 */
async function resolveCharDisplaySnapshot(state, charId, username, groupId) {
	const charname = String(charId).trim()
	const agentKey = resolveActiveAgentMemberKeyByCharname(state, charname)
	const agent = agentKey ? state.members[agentKey] : null
	let name = ''
	let avatar = null

	const owner = String(agent?.ownerUsername || username).trim()
	const entityHash = agent ? memberEntityHash(agent) : null
	if (entityHash)
		try {
			const profile = await getProfile(entityHash, username, { groupId })
			if (profile?.name) name = String(profile.name).trim()
			const { displayProfileAvatar } = await import('../../../public/shared/hashAvatar.mjs')
			avatar = displayProfileAvatar(profile) || null
		}
		catch { /* profile miss */ }

	if (!name)
		try {
			const { info } = await getPartDetails(owner, `chars/${charname}`) || {}
			if (info?.name) name = String(info.name).trim()
		}
		catch { /* part miss */ }

	if (!name) name = charname
	return { name, avatar }
}

/**
 * @param {object} state 物化群状态
 * @param {object} row 展示行（含 sender/charId/content）
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @returns {Promise<{ name: string, avatar: string | null }>} 展示快照
 */
export async function resolveDisplaySnapshot(state, row, username, groupId) {
	const charId = row.charId ? String(row.charId).trim() : null
	if (charId)
		return resolveCharDisplaySnapshot(state, charId, username, groupId)

	const sender = String(row.sender || '').trim().toLowerCase()
	const member = sender ? state.members?.[sender] : null
	let name = member?.displayName?.trim() || ''
	let avatar = null
	const entityHash = member ? memberEntityHash(member) : null
	if (entityHash)
		try {
			const profile = await getProfile(entityHash, username, { groupId })
			if (profile?.name) name = String(profile.name).trim()
			const { displayProfileAvatar } = await import('../../../public/shared/hashAvatar.mjs')
			avatar = displayProfileAvatar(profile) || null
		}
		catch { /* profile miss */ }

	if (!name && isHex64(sender)) name = `${sender.slice(0, 8)}…${sender.slice(-4)}`
	if (!name) name = '?'
	return { name, avatar }
}

/**
 * @param {object} overlay messageOverlay
 * @param {string} eventId 消息 id
 * @returns {object[]} 反应列表
 */
export function reactionsForMessage(overlay, eventId) {
	/** @type {Map<string, { emoji: string, voters: Array<{ pubKeyHash: string, at: number | null }> }>} */
	const byEmoji = new Map()
	const raw = overlay?.reactions
	if (!raw) return []
	const entries = raw instanceof Map ? raw.entries() : Object.entries(raw)
	for (const [key, voters] of entries) {
		const [targetId, emoji] = String(key).split(':')
		if (targetId !== eventId || !emoji) continue
		const row = byEmoji.get(emoji) || { emoji, voters: [] }
		for (const pubKeyHash of voters)
			row.voters.push({ pubKeyHash: String(pubKeyHash).toLowerCase(), at: null })
		byEmoji.set(emoji, row)
	}
	return [...byEmoji.values()]
}

/**
 * @param {object} row 合并后的 message 行
 * @param {object} state 物化状态
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @returns {Promise<object>} PostSnapshot
 */
export async function buildPostSnapshotFromRow(row, state, username, groupId) {
	const eventId = String(row.eventId).trim()
	const channelId = String(row.channelId || 'default').trim()
	const display = await resolveDisplaySnapshot(state, row, username, groupId)
	const content = row.content ? channelMessageContentObject(row.content) : null
	const pins = overlayPinsForChannel(state.messageOverlay, channelId)
	const prevIds = Array.isArray(row.prev_event_ids)
		? [...row.prev_event_ids].map(id => String(id).trim().toLowerCase()).filter(isHex64)
		: undefined
	const sender = row.sender ? String(row.sender).trim().toLowerCase() : null
	let sourceEntityHash = null
	if (row.charId) {
		const agentKey = resolveActiveAgentMemberKeyByCharname(state, String(row.charId).trim())
		sourceEntityHash = agentKey ? memberEntityHash(state.members[agentKey]) : null
	}
	else if (sender && state.members?.[sender])
		sourceEntityHash = memberEntityHash(state.members[sender])

	return {
		eventId,
		channelId,
		hlc: row.hlc,
		timestamp: row.timestamp,
		sender: row.sender,
		...sourceEntityHash ? { sourceEntityHash } : {},
		charId: row.charId ?? null,
		display,
		content,
		...row.decryptView ? { decryptView: row.decryptView } : {},
		reactions: reactionsForMessage(state.messageOverlay, eventId),
		pinned: pins.includes(eventId),
		deleted: state.messageOverlay?.deletedIds?.has(eventId) || false,
		...prevIds?.length ? { prev_event_ids: prevIds } : {},
	}
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {object} row 合并后的 message 行
 * @returns {Promise<{ content: object | null, decryptView?: object }>} 归档用正文
 */
async function resolveArchiveMessageContent(username, groupId, channelId, row) {
	if (row.decryptView?.failed)
		return { content: null, decryptView: row.decryptView }
	const result = await decryptEventContent(username, groupId, channelId, row.content)
	if (result.ok && result.content?.type)
		return { content: result.content }
	return {
		content: null,
		decryptView: {
			failed: true,
			...result.generation != null ? { pendingGeneration: result.generation } : {},
		},
	}
}

/**
 * 从频道 messages 行 + overlay 构建 PostSnapshot 列表。
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {object[]} lines 原始 JSONL 行
 * @param {object} state 物化状态
 * @returns {Promise<object[]>} PostSnapshot 列表
 */
export async function buildPostSnapshotsFromLines(username, groupId, channelId, lines, state) {
	const merged = mergeChannelMessagesForDisplay(lines)
	const out = []
	for (const row of merged) {
		if (row.type !== 'message') continue
		const resolved = await resolveArchiveMessageContent(username, groupId, channelId, row)
		out.push(await buildPostSnapshotFromRow({
			...row,
			content: resolved.content,
			decryptView: resolved.decryptView ?? row.decryptView,
		}, state, username, groupId))
	}
	return out
}

/**
 * PostSnapshot → Hub/API 消息行。
 * @param {object} snap PostSnapshot
 * @returns {object} 消息行
 */
export function postSnapshotToMessageLine(snap) {
	return {
		eventId: snap.eventId,
		type: 'message',
		channelId: snap.channelId,
		sender: snap.sender,
		charId: snap.charId,
		timestamp: snap.timestamp,
		hlc: snap.hlc,
		content: snap.content,
		...snap.decryptView ? { decryptView: snap.decryptView } : {},
		...Array.isArray(snap.prev_event_ids) && snap.prev_event_ids.length
			? { prev_event_ids: snap.prev_event_ids }
			: {},
		extension: {
			reactions: snap.reactions,
			display: snap.display,
			archived: true,
		},
	}
}
