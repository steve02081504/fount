/**
 * 具名实体网络搜索：本地索引 + part_query(`entity_search`) 多跳 + 签名 profile 复核。
 */
import { isEntityHash128, parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { isWritableLocalEntity } from 'npm:@steve02081504/fount-p2p/node/identity'
import { getEntityStore } from 'npm:@steve02081504/fount-p2p/node/instance'
import { pickNodeScore } from 'npm:@steve02081504/fount-p2p/node/reputation_store'
import { getShellPartpath } from 'npm:@steve02081504/fount-p2p/registries/part_path'
import { queryNetwork } from 'npm:@steve02081504/fount-p2p/wire/part_query'

import { getAllUserNames } from '../../../../../../server/auth/index.mjs'

import { resolveOperatorEntityHashForUser } from './identity.mjs'
import {
	fetchAndCacheRemoteProfile,
	getProfile,
} from './profile.mjs'
import { listEntityIdentities } from './store.mjs'

/**
 *
 */
export const ENTITY_SEARCH_KIND = 'entity_search'

/**
 * @param {unknown} queryHandlerQuery part_query 入站 query
 * @returns {string} 规范化搜索词
 */
export function normalizeEntitySearchQuery(queryHandlerQuery) {
	const raw = typeof queryHandlerQuery === 'string'
		? queryHandlerQuery
		: queryHandlerQuery && typeof queryHandlerQuery === 'object'
			? String(/** @type {{ q?: unknown }} */queryHandlerQuery.q || '')
			: ''
	return raw.trim().toLowerCase()
}

/**
 * @param {object} profile skipPresentation profile
 * @returns {string} 展示名（任意 locale 的第一个 name）
 */
function profileDisplayName(profile) {
	const localized = profile?.localized || {}
	for (const slice of Object.values(localized)) {
		const name = String(slice?.name || '').trim()
		if (name) return name
	}
	return String(profile?.name || '').trim()
}

/**
 * @param {string} q 已小写的 query
 * @param {{ entityHash: string, handle?: string, name?: string }} row 候选
 * @returns {boolean} 是否匹配
 */
function rowMatchesQuery(q, row) {
	if (!q) return false
	const handle = String(row.handle || '').trim().toLowerCase()
	if (handle && (handle === q || handle.includes(q))) return true
	const name = String(row.name || '').trim().toLowerCase()
	return Boolean(name && name.includes(q))
}

/**
 * @param {string} username replica
 * @param {string} entityHash 实体
 * @returns {Promise<boolean>} social 是否隐藏探索
 */
async function isHiddenFromDiscovery(username, entityHash) {
	try {
		const { getTimelineMaterialized } = await import('../../social/src/timeline/materialize.mjs')
		const view = await getTimelineMaterialized(username, entityHash)
		return Boolean(view?.socialMeta?.hideFromDiscovery)
	}
	catch {
		return false
	}
}

/**
 * 本机应答：本机实体 profile + 已缓存远端 profile.json。
 * @param {{ replicaUsername?: string }} ctx 入站上下文
 * @param {unknown} query 查询体
 * @returns {Promise<object[]>} rows
 */
export async function localEntitySearchHandler(ctx, query) {
	const q = normalizeEntitySearchQuery(query)
	if (q.length < 2) return []

	const maxHits = 32
	/** @type {Map<string, { entityHash: string, handle: string, name: string }>} */
	const byHash = new Map()

	const usernames = ctx.replicaUsername
		? [ctx.replicaUsername]
		: getAllUserNames()

	for (const username of usernames) 
		for (const row of await listEntityIdentities(username)) {
			const entityHash = String(row.entityHash || '').toLowerCase()
			if (!isEntityHash128(entityHash) || byHash.has(entityHash)) continue
			if (await isHiddenFromDiscovery(username, entityHash)) continue
			const profile = await getProfile(entityHash, username, { skipPresentation: true })
			const handle = String(profile.handle || '').trim().toLowerCase()
			const name = profileDisplayName(profile)
			const candidate = { entityHash, handle, name }
			if (!rowMatchesQuery(q, candidate)) continue
			byHash.set(entityHash, candidate)
			if (byHash.size >= maxHits) return [...byHash.values()]
		}
	

	const store = getEntityStore()
	for (const entityHash of await store.listEntityHashes()) {
		if (byHash.has(entityHash) || !isEntityHash128(entityHash)) continue
		const onDisk = await store.readEntityJson(entityHash, 'profile.json')
		if (!onDisk) continue
		const handle = String(onDisk.handle || '').trim().toLowerCase()
		const name = profileDisplayName(onDisk)
		const candidate = { entityHash, handle, name }
		if (!rowMatchesQuery(q, candidate)) continue
		byHash.set(entityHash, candidate)
		if (byHash.size >= maxHits) break
	}

	return [...byHash.values()]
}

/**
 * @param {unknown} row 线索行
 * @returns {{ entityHash: string, handle: string, name: string } | null} 规范化行或 null
 */
function normalizeClueRow(row) {
	if (!row || typeof row !== 'object') return null
	const entityHash = String(/** @type {{ entityHash?: unknown }} */row.entityHash || '').toLowerCase()
	if (!isEntityHash128(entityHash)) return null
	return {
		entityHash,
		handle: String(/** @type {{ handle?: unknown }} */row.handle || '').trim().toLowerCase(),
		name: String(/** @type {{ name?: unknown }} */row.name || '').trim(),
	}
}

/**
 * @param {Array<() => Promise<T | null>>} tasks 任务工厂列表
 * @param {number} concurrency 并发上限
 * @returns {Promise<(T | null)[]>} 与 tasks 同序的结果
 * @template T
 */
async function mapPool(tasks, concurrency) {
	/** @type {(T | null)[]} */
	const out = new Array(tasks.length).fill(null)
	let next = 0
	const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
		while (next < tasks.length) {
			const index = next++
			out[index] = await tasks[index]()
		}
	})
	await Promise.all(workers)
	return out
}

/**
 * @param {string} username replica
 * @param {string} viewerEntityHash 观看者实体
 * @param {string} entityHash 目标
 * @returns {Promise<{ following: boolean, care: boolean, hasDm: boolean }>} 交互标志
 */
async function loadInteractionFlags(username, viewerEntityHash, entityHash) {
	let following = false
	let care = false
	let hasDm = false
	try {
		const { loadFollowingForActor } = await import('../../social/src/following.mjs')
		const set = await loadFollowingForActor(username, viewerEntityHash)
		following = set.has(entityHash)
	}
	catch { /* social 未装 */ }
	try {
		const { listCared } = await import('../chat/lib/care.mjs')
		const cared = await listCared(username, viewerEntityHash)
		care = cared.includes(entityHash)
	}
	catch { /* */ }
	try {
		const { enumerateJoinedFederatedGroups } = await import('../group/queries.mjs')
		const groups = await enumerateJoinedFederatedGroups(username, viewerEntityHash)
		hasDm = groups.some(g => {
			const binding = g.friendBinding
			return binding && String(binding.entityHash || '').toLowerCase() === entityHash
		})
	}
	catch { /* */ }
	return { following, care, hasDm }
}

/**
 * 发起端：网络搜实体 → EVFS 验签复核 → 信任排序。
 * @param {string} username replica
 * @param {string} q 搜索词
 * @param {{ viewerEntityHash?: string, ttl?: number, maxHits?: number, aliases?: Record<string, string> }} [options] 观看者与上限
 * @returns {Promise<{ query: string, entities: object[] }>} 排序后的实体列表
 */
export async function searchEntitiesNetwork(username, q, options = {}) {
	const query = String(q || '').trim()
	const normalized = query.toLowerCase()
	if (normalized.length < 2)
		return { query, entities: [] }

	const maxHits = Math.min(32, Math.max(1, Math.floor(Number(options.maxHits) || 20)))
	const partpath = getShellPartpath('chat')
	const clues = await queryNetwork(username, partpath, ENTITY_SEARCH_KIND, { q: normalized }, {
		ttl: options.ttl,
		maxHits,
		/**
		 * @param {unknown} row 行
		 * @returns {string} 去重键
		 */
		rowKey: row => String(/** @type {{ entityHash?: unknown }} */row?.entityHash || '').toLowerCase(),
	})

	/** @type {Map<string, { entityHash: string, handle: string, name: string }>} */
	const unique = new Map()
	for (const raw of clues) {
		const row = normalizeClueRow(raw)
		if (row) unique.set(row.entityHash, row)
	}

	let hideThreshold = -0.5
	try {
		const rep = await import('../../social/src/federation/reputation_social.mjs')
		hideThreshold = Number(rep.SOCIAL_REP_HIDE_THRESHOLD)
	}
	catch { /* social 未装 */ }

	const viewerEntityHash = options.viewerEntityHash
		|| await resolveOperatorEntityHashForUser(username)

	/** @type {Record<string, string>} */
	const aliases = { ...options.aliases || {} }
	if (!options.aliases && viewerEntityHash) 
		try {
			const { loadEntityShellData } = await import('../../../../../../server/setting_loader.mjs')
			const doc = loadEntityShellData(username, 'chat', viewerEntityHash, 'aliases')
			Object.assign(aliases, doc?.entities || {})
		}
		catch { /* */ }
	

	const verified = await mapPool([...unique.keys()].map(entityHash => async () => {
		const parsed = parseEntityHash(entityHash)
		if (!parsed) return null
		const score = pickNodeScore(parsed.nodeHash)
		if (Number(score) < hideThreshold) return null

		let profile
		if (isWritableLocalEntity(entityHash))
			profile = await getProfile(entityHash, username, { skipPresentation: true })
		else {
			profile = await fetchAndCacheRemoteProfile(username, entityHash)
			if (!profile) return null
		}

		const handle = String(profile.handle || '').trim().toLowerCase()
		const name = profileDisplayName(profile) || unique.get(entityHash)?.name || ''
		if (!rowMatchesQuery(normalized, { entityHash, handle, name })) return null

		const flags = viewerEntityHash
			? await loadInteractionFlags(username, viewerEntityHash, entityHash)
			: { following: false, care: false, hasDm: false }

		return {
			entityHash,
			handle,
			name,
			activePubKeyHex: profile.activePubKeyHex || '',
			keyGeneration: Number(profile.keyGeneration ?? 0) || 0,
			nodeHash: parsed.nodeHash,
			nodeScore: Number(score) || 0,
			alias: aliases[entityHash] || '',
			...flags,
		}
	}), 8)

	const entities = /** @type {object[]} */ verified.filter(Boolean)
	entities.sort((a, b) => {
		const aAlias = a.alias ? 1 : 0
		const bAlias = b.alias ? 1 : 0
		if (aAlias !== bAlias) return bAlias - aAlias
		const aExact = a.handle === normalized ? 1 : 0
		const bExact = b.handle === normalized ? 1 : 0
		if (aExact !== bExact) return bExact - aExact
		const aIx = (a.following ? 4 : 0) + (a.care ? 2 : 0) + (a.hasDm ? 1 : 0)
		const bIx = (b.following ? 4 : 0) + (b.care ? 2 : 0) + (b.hasDm ? 1 : 0)
		if (aIx !== bIx) return bIx - aIx
		if (a.nodeScore !== b.nodeScore) return b.nodeScore - a.nodeScore
		const aFuzzy = String(a.name).toLowerCase().includes(normalized) ? 1 : 0
		const bFuzzy = String(b.name).toLowerCase().includes(normalized) ? 1 : 0
		if (aFuzzy !== bFuzzy) return bFuzzy - aFuzzy
		return a.entityHash.localeCompare(b.entityHash)
	})

	return { query, entities: entities.slice(0, maxHits) }
}
