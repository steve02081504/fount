/**
 * 联邦 push（part_timeline_put）接纳：已关注 ∪ 共同群 ∪ 指向本机实体的 follow/unfollow。
 * pull（syncFollowingTimelines）已按关注拉取，不经此门。
 */
import { join } from 'node:path'

import { parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'

import { safeReadJson } from '../../../chat/src/chat/lib/fsSafe.mjs'
import { shellChatRoot } from '../../../chat/src/chat/lib/paths.mjs'
import { listUserGroups } from '../../../chat/src/chat/lib/userGroups.mjs'
import { resolveOperatorEntityHashForUser as resolveOperatorEntityHash } from '../../../chat/src/entity/identity.mjs'
import { loadFollowingForActor } from '../following.mjs'

import { listLocalAgentEntities, resolveSocialEntity } from './hosting.mjs'

/**
 * 本机 operator + agent 是否关注目标（含自关注）。
 * @param {string} username replica
 * @param {string} entityHash 时间线 owner
 * @returns {Promise<boolean>} 是否在关注并集中
 */
async function isFollowedByLocalEntities(username, entityHash) {
	const target = entityHash
	const actors = []
	const operator = await resolveOperatorEntityHash(username)
	if (operator) actors.push(operator)
	for (const { entityHash: agent } of listLocalAgentEntities(username))
		actors.push(agent)
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
	const target = entityHash
	const root = shellChatRoot(username)
	for (const groupId of await listUserGroups(username)) {
		const snapshot = await safeReadJson(join(root, 'groups', groupId, 'snapshot.json'))
		const members = snapshot?.members_record?.members || {}
		for (const row of Object.values(members)) {
			if (String(row?.entityHash || '') !== target) continue
			if (row?.status === 'active') return true
		}
	}
	return false
}

/**
 * follow/unfollow 指向本机托管实体时接纳（否则被关注方永远收不到反向关注图，pull 导出 followsOwner 恒假）。
 * @param {string} username replica
 * @param {object | null | undefined} event 入站事件
 * @returns {Promise<boolean>} 是否为本机被关注通知
 */
async function isFollowTargetingLocalEntity(username, event) {
	const type = event?.type
	if (type !== 'follow' && type !== 'unfollow') return false
	const target = event?.content?.targetEntityHash
	if (!parseEntityHash(target)) return false
	const resolved = await resolveSocialEntity(target)
	return Boolean(resolved?.local && resolved.replicaUsername === username)
}

/**
 * push 是否接纳该时间线 owner（关注 ∪ 共群 ∪ 本机被关注；denylist/信誉仍由 ingest 链处理）。
 * @param {string} username replica
 * @param {string} entityHash 时间线 owner
 * @param {object | null | undefined} [event] 入站事件（follow 目标判定）
 * @returns {Promise<boolean>} 是否接纳
 */
export async function isRemoteTimelinePushAdmitted(username, entityHash, event = null) {
	const parsed = parseEntityHash(entityHash)
	if (!parsed) return false
	if (await isFollowedByLocalEntities(username, parsed.entityHash)) return true
	if (await isCoGroupMember(username, parsed.entityHash)) return true
	if (await isFollowTargetingLocalEntity(username, event)) return true
	return false
}
