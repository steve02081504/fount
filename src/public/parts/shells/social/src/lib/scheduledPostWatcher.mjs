/**
 * 定时发帖 watcher（镜像 pollDeadlineWatcher）。
 */
import { getReplicaUsernamesProvider } from '../federation/follower_index_registry.mjs'
import { resolveSocialEntity } from '../federation/hosting.mjs'

import { listScheduledPosts, takeScheduledPost } from './scheduledPosts.mjs'

/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const scheduledTimers = new Map()

/**
 * @param {string} entityHash 作者
 * @param {string} scheduledId id
 * @returns {string} 调度键
 */
function scheduleKey(entityHash, scheduledId) {
	return `${entityHash.toLowerCase()}:${scheduledId}`
}

/**
 * @param {string} username replica
 * @param {string} entityHash 作者
 * @param {string} scheduledId id
 * @returns {Promise<void>}
 */
export async function fireScheduledPost(username, entityHash, scheduledId) {
	const owner = entityHash.toLowerCase()
	const row = takeScheduledPost(username, owner, scheduledId)
	if (!row) return
	const resolved = await resolveSocialEntity(owner, username)
	if (!resolved?.local || resolved.replicaUsername !== username) return
	const { getSocialClient } = await import('../api/index.mjs')
	const client = await getSocialClient(username, owner)
	const draft = { ...row.draft }
	delete draft.publishAt
	await client.post(draft)
}

/**
 * @param {string} username replica
 * @param {string} entityHash 作者
 * @param {object} row 定时项
 * @returns {void}
 */
export function scheduleOneScheduledPost(username, entityHash, row) {
	const owner = entityHash.toLowerCase()
	const key = scheduleKey(owner, row.scheduledId)
	if (scheduledTimers.has(key)) return
	const publishAt = Number(row.publishAt)
	if (!Number.isFinite(publishAt)) return
	if (publishAt <= Date.now()) {
		void fireScheduledPost(username, owner, row.scheduledId)
		return
	}
	const timeout = setTimeout(() => {
		scheduledTimers.delete(key)
		void fireScheduledPost(username, owner, row.scheduledId)
	}, publishAt - Date.now())
	scheduledTimers.set(key, timeout)
}

/**
 * @param {string} username replica
 * @param {string} entityHash 作者
 * @param {string} scheduledId id
 * @returns {void}
 */
export function cancelScheduledPostTimer(username, entityHash, scheduledId) {
	const key = scheduleKey(entityHash, scheduledId)
	const timer = scheduledTimers.get(key)
	if (!timer) return
	clearTimeout(timer)
	scheduledTimers.delete(key)
}

/**
 * @param {string} username replica
 * @param {string} entityHash 作者
 * @returns {void}
 */
export function scheduleEntityScheduledPosts(username, entityHash) {
	const owner = entityHash.toLowerCase()
	for (const row of listScheduledPosts(username, owner))
		scheduleOneScheduledPost(username, owner, row)
}

/**
 * 启动时为本实例全部 replica 的本地 entity 注册定时发帖。
 * @returns {Promise<void>}
 */
export async function bootstrapScheduledPostWatchers() {
	const listUsers = getReplicaUsernamesProvider()
	if (!listUsers) return
	const { getTimelineOwnerIndex } = await import('../timeline/ownerIndex.mjs')
	for (const username of listUsers()) {
		const owners = (await getTimelineOwnerIndex(username)).all
		for (const entityHash of owners) {
			const resolved = await resolveSocialEntity(entityHash, username)
			if (!resolved?.local || resolved.replicaUsername !== username) continue
			scheduleEntityScheduledPosts(username, entityHash)
		}
	}
}
