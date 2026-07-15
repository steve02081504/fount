import path from 'node:path'

import { parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { writeJsonAtomic } from 'npm:@steve02081504/fount-p2p/dag/storage'
import { getNodeDir } from 'npm:@steve02081504/fount-p2p/node/instance'
import { withAsyncMutex } from 'npm:@steve02081504/fount-p2p/utils/async_mutex'
import { createLruMap } from 'npm:@steve02081504/fount-p2p/utils/lru'

import { resolveSocialEntity } from '../hosting.mjs'

import { getReplicaUsernamesProvider } from './registry.mjs'

const FOLLOWER_ENTRY_CACHE_MAX = 512
const BUCKET_HEX_PREFIX_LEN = 2

/** @typedef {{ replicaUsername: string, entityHash: string }} FollowerIndexEntry */

/** @type {ReturnType<typeof createLruMap<string, FollowerIndexEntry[]>>} */
const followerEntryCache = createLruMap(FOLLOWER_ENTRY_CACHE_MAX)

/**
 * @param {FollowerIndexEntry} row 索引行
 * @returns {string} 去重键
 */
function followerEntryKey(row) {
	return `${row.replicaUsername}\0${row.entityHash}`
}

/**
 * @param {string} target targetEntityHash
 * @param {() => Promise<void>} task 突变
 * @returns {Promise<void>}
 */
function queueFollowerIndexMutation(target, task) {
	return withAsyncMutex(`follower-index:${target}`, () => task().catch(err => {
		console.error('follower_index: mutation failed', err)
	}))
}

/**
 * @returns {string} follower 索引根目录
 */
function followerIndexDir() {
	return path.join(getNodeDir(), 'social', 'follower_index')
}

/**
 * @returns {string} 按 hash 前两字符分桶的目录
 */
function followerBucketsDir() {
	return path.join(followerIndexDir(), 'buckets')
}

/**
 * @param {string} targetEntityHash 128 hex
 * @returns {string} 分桶 id（hex 前缀）
 */
function followerBucketId(targetEntityHash) {
	return targetEntityHash.slice(0, BUCKET_HEX_PREFIX_LEN)
}

/**
 * @param {string} bucketId 分桶 id
 * @returns {string} 桶文件路径（多 target 合并为单 JSON，避免百万 inode）
 */
function followerBucketPath(bucketId) {
	return path.join(followerBucketsDir(), `${bucketId}.json`)
}

/**
 * @param {unknown} row 桶内条目
 * @returns {FollowerIndexEntry | null} 规范化 follower 行
 */
function normalizeFollowerEntry(row) {
	if (!row?.replicaUsername) return null
	return {
		replicaUsername: String(row.replicaUsername),
		entityHash: String(row.entityHash || '').trim().toLowerCase(),
	}
}

/**
 * @param {string} bucketId 分桶 id
 * @returns {Promise<Record<string, FollowerIndexEntry[]>>} target → follower 列表
 */
async function readFollowerBucket(bucketId) {
	const { readFile } = await import('node:fs/promises')
	try {
		const raw = JSON.parse(await readFile(followerBucketPath(bucketId), 'utf8'))
		/** @type {Record<string, FollowerIndexEntry[]>} */
		const bucket = {}
		for (const [target, rows] of Object.entries(raw)) {
			if (!Array.isArray(rows)) continue
			const list = rows.map(normalizeFollowerEntry).filter(Boolean)
			if (list.length) bucket[target] = list
		}
		return bucket
	}
	catch (err) {
		if (err?.code !== 'ENOENT') throw err
		return {}
	}
}

/**
 * @param {string} bucketId 分桶 id
 * @param {Record<string, FollowerIndexEntry[]>} bucket target → followers
 * @returns {Promise<void>}
 */
async function writeFollowerBucket(bucketId, bucket) {
	const { mkdir, unlink } = await import('node:fs/promises')
	const dir = followerBucketsDir()
	await mkdir(dir, { recursive: true })
	const keys = Object.keys(bucket)
	if (!keys.length) {
		try {
			await unlink(followerBucketPath(bucketId))
		}
		catch { /* missing */ }
		return
	}
	await writeJsonAtomic(followerBucketPath(bucketId), bucket)
}

/**
 * @param {FollowerIndexEntry[]} followers follower 列表
 * @returns {FollowerIndexEntry[]} 去重后列表
 */
function dedupeFollowerEntries(followers) {
	/** @type {Map<string, FollowerIndexEntry>} */
	const map = new Map()
	for (const row of followers) {
		const entry = normalizeFollowerEntry(row)
		if (!entry?.replicaUsername || !entry.entityHash) continue
		map.set(followerEntryKey(entry), entry)
	}
	return [...map.values()]
}

/**
 * @param {string} target 128 hex
 * @returns {Promise<FollowerIndexEntry[]>} 关注该 target 的本机 entity（缓存数组勿原地修改）
 */
async function readFollowerEntry(target) {
	const cached = followerEntryCache.get(target)
	if (cached) {
		followerEntryCache.touch(target, cached)
		return cached
	}
	const bucket = await readFollowerBucket(followerBucketId(target))
	const followers = bucket[target] ? [...bucket[target]] : []
	followerEntryCache.touch(target, followers)
	return followers
}

/**
 * @param {string} target 128 hex
 * @param {FollowerIndexEntry[]} followers follower 列表
 * @returns {Promise<void>}
 */
async function writeFollowerEntry(target, followers) {
	const bucketId = followerBucketId(target)
	const bucket = await readFollowerBucket(bucketId)
	const list = dedupeFollowerEntries(followers)
	if (!list.length) {
		delete bucket[target]
		followerEntryCache.delete(target)
	}
	else {
		bucket[target] = list
		followerEntryCache.touch(target, list)
	}
	await writeFollowerBucket(bucketId, bucket)
}

/**
 * follow/unfollow 后更新反向索引（本机 entity 时间线为真相源，此为查询投影）。
 * @param {string} username replica 登录名
 * @param {string} targetEntityHash 被关注实体
 * @param {boolean} follow true=关注
 * @param {string} followerEntityHash 关注者 entityHash
 * @returns {Promise<void>}
 */
export async function updateFollowerIndex(username, targetEntityHash, follow, followerEntityHash) {
	const target = targetEntityHash.toLowerCase()
	const follower = String(followerEntityHash || '').trim().toLowerCase()
	if (!follower) return
	await queueFollowerIndexMutation(target, async () => {
		const list = dedupeFollowerEntries(await readFollowerEntry(target))
		const key = followerEntryKey({ replicaUsername: username, entityHash: follower })
		if (follow) {
			if (!list.some(row => followerEntryKey(row) === key))
				list.push({ replicaUsername: username, entityHash: follower })
		}
		else {
			const next = list.filter(row => followerEntryKey(row) !== key)
			await writeFollowerEntry(target, next)
			return
		}
		await writeFollowerEntry(target, list)
	})
}

/**
 * 本机托管 entity 时间线 follow/unfollow 事件写入后更新反向索引投影。
 * @param {string} replicaUsername replica 登录名
 * @param {string} timelineOwnerEntityHash 时间线 owner
 * @param {object} event 签名事件
 * @returns {Promise<void>}
 */
export async function projectFollowerIndexFromTimelineEvent(replicaUsername, timelineOwnerEntityHash, event) {
	if (!['follow', 'unfollow'].includes(event.type)) return
	const owner = timelineOwnerEntityHash.toLowerCase()
	const resolved = await resolveSocialEntity(owner, replicaUsername)
	if (!resolved?.local || resolved.replicaUsername !== replicaUsername) return
	await updateFollowerIndex(
		replicaUsername,
		event.content.targetEntityHash.toLowerCase(),
		event.type === 'follow',
		owner,
	)
}

/**
 * 哪些本实例本机 entity 关注了 target（分桶 JSON + LRU，不常驻全量索引）。
 * @param {string} entityHash 被关注实体
 * @returns {Promise<FollowerIndexEntry[]>} replica + follower entityHash
 */
export async function listLocalFollowersOf(entityHash) {
	const target = entityHash.toLowerCase()
	if (!parseEntityHash(target)) return []
	return dedupeFollowerEntries(await readFollowerEntry(target))
}

/**
 * 冷启动：扫描本实例全部 replica 本地时间线 owner，重建 follower 投影（按 hash 前缀分桶）。
 * @returns {Promise<void>}
 */
export async function rebuildFollowerIndex() {
	const listUsers = getReplicaUsernamesProvider()
	if (!listUsers) return
	const { getTimelineOwnerIndex } = await import('../../timeline/ownerIndex.mjs')
	const { getTimelineMaterialized } = await import('../../timeline/materialize.mjs')
	/** @type {Record<string, Record<string, Map<string, FollowerIndexEntry>>>} */
	const scratch = {}
	for (const username of listUsers()) 
		for (const owner of (await getTimelineOwnerIndex(username)).all) {
			const resolved = await resolveSocialEntity(owner, username)
			if (!resolved?.local || resolved.replicaUsername !== username) continue
			const view = await getTimelineMaterialized(username, owner)
			for (const rawTarget of view.following) {
				const target = rawTarget.toLowerCase()
				if (!parseEntityHash(target) || target === owner) continue
				const bucketId = followerBucketId(target)
				scratch[bucketId] ??= {}
				scratch[bucketId][target] ??= new Map()
				const entry = { replicaUsername: username, entityHash: owner }
				scratch[bucketId][target].set(followerEntryKey(entry), entry)
			}
		}
	
	const { mkdir, readdir, unlink } = await import('node:fs/promises')
	const bucketsDir = followerBucketsDir()
	await mkdir(bucketsDir, { recursive: true })
	for (const name of await readdir(bucketsDir).catch(() => [])) {
	 if (!name.endsWith('.json')) continue
	 await unlink(path.join(bucketsDir, name)).catch(() => {})
	}
	followerEntryCache.clear()
	for (const [bucketId, targets] of Object.entries(scratch)) {
		/** @type {Record<string, FollowerIndexEntry[]>} */
		const bucket = {}
		for (const [target, map] of Object.entries(targets))
			bucket[target] = [...map.values()]
		await writeFollowerBucket(bucketId, bucket)
		for (const [target, list] of Object.entries(bucket))
			followerEntryCache.touch(target, list)
	}
}
