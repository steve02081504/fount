/**
 * 联邦 push（part_timeline_put）接纳：已关注或共同群成员。
 * pull（syncFollowingTimelines）已按关注拉取，不经此门。
 */
import { join } from 'node:path'

import { parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'

import { safeReadJson } from '../../../chat/src/chat/lib/fsSafe.mjs'
import { shellChatRoot } from '../../../chat/src/chat/lib/paths.mjs'
import { listUserGroups } from '../../../chat/src/chat/lib/userGroups.mjs'
import { resolveOperatorEntityHashForUser as resolveOperatorEntityHash } from '../../../chat/src/entity/identity.mjs'
import { loadFollowingForActor } from '../following.mjs'

import { listLocalAgentEntities } from './hosting.mjs'

/**
 * 本机 operator + agent 是否关注目标（含自关注）。
 * @param {string} username replica
 * @param {string} entityHash 时间线 owner
 * @returns {Promise<boolean>} 是否在关注并集中
 */
async function isFollowedByLocalEntities(username, entityHash) {
	const target = entityHash.toLowerCase()
	const actors = []
	const operator = await resolveOperatorEntityHash(username)
	if (operator) actors.push(operator.toLowerCase())
	for (const { entityHash: agent } of listLocalAgentEntities(username))
		actors.push(agent.toLowerCase())
	for (const actor of actors) {
		const { following } = await loadFollowingForActor(username, actor)
		if (following.some(hash => hash === target)) return true
	}
	return false
}

/**
 * 本机任一群快照中是否有该实体活跃成员（共同群）。
 * @param {string} username replica
 * @param {string} entityHash 远端实体
 * @returns {Promise<boolean>} 是否共群
 */
async function isCoGroupMember(username, entityHash) {
	const target = entityHash.toLowerCase()
	const root = shellChatRoot(username)
	for (const groupId of await listUserGroups(username)) {
		const snapshot = await safeReadJson(join(root, 'groups', groupId, 'snapshot.json'))
		const members = snapshot?.members_record?.members || {}
		for (const row of Object.values(members)) {
			if (String(row?.entityHash || '').toLowerCase() !== target) continue
			if (row?.status === 'active') return true
		}
	}
	return false
}

/**
 * push 是否接纳该时间线 owner（关注 ∪ 共群；denylist/信誉仍由 ingest 链处理）。
 * @param {string} username replica
 * @param {string} entityHash 时间线 owner
 * @returns {Promise<boolean>} 是否接纳
 */
export async function isRemoteTimelinePushAdmitted(username, entityHash) {
	const parsed = parseEntityHash(entityHash)
	if (!parsed) return false
	if (await isFollowedByLocalEntities(username, parsed.entityHash)) return true
	if (await isCoGroupMember(username, parsed.entityHash)) return true
	return false
}
