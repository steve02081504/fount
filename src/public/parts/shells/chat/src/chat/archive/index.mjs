import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { writeJsonAtomicSynced } from '../../../../../../../scripts/p2p/dag/storage.mjs'
import { withAsyncMutex } from '../../../../../../../scripts/p2p/utils/async_mutex.mjs'
import { archiveManifestPath, channelArchivePath } from '../lib/paths.mjs'

import { archiveMonthKey } from './settings.mjs'

/**
 * @param {string} groupId 群 ID
 * @returns {string} manifest 互斥键
 */
function archiveManifestMutexKey(groupId) {
	return `archive-manifest:${groupId}`
}

/**
 * @param {string} groupId 群 ID
 * @param {() => Promise<T>} fn 临界区
 * @returns {Promise<T>} mutator 返回值
 * @template T
 */
function withArchiveManifestMutex(groupId, fn) {
	return withAsyncMutex(archiveManifestMutexKey(groupId), fn)
}

/**
 * 是否存在已知冷归档联邦缺口（`coverage` 中 `complete: false`）。
 * @param {{ coverage?: Record<string, { complete?: boolean }> } | null | undefined} manifest manifest
 * @returns {boolean} 无缺口时为 true（含新群/空 coverage）
 */
export function isArchiveCoverageComplete(manifest) {
	const coverage = manifest?.coverage || {}
	return !Object.values(coverage).some(row => row?.complete === false)
}

/**
 * @param {object | null} raw 磁盘 manifest
 * @returns {object} 规范化 manifest
 */
function normalizeManifest(raw) {
	const coverage = raw?.coverage || {}
	const out = {
		channels: raw?.channels || {},
		archivedEventIds: raw?.archivedEventIds || {},
		monthDigests: raw?.monthDigests || {},
		coverage,
		archive_coverage_complete: isArchiveCoverageComplete({ coverage }),
	}
	return out
}

/**
 * @param {object} manifest archive manifest
 * @returns {object} 联邦同步用精简 manifest（无正文真相，仅索引 hint）
 */
export function wireArchiveManifestForFederation(manifest) {
	return {
		channels: manifest.channels,
		monthDigests: manifest.monthDigests,
		coverage: manifest.coverage,
		archive_coverage_complete: manifest.archive_coverage_complete === true,
	}
}

/**
 * 合并远端 manifest 的月份列表（union hint），不写 archivedEventIds / monthDigests。
 * @param {object} local 本地 manifest
 * @param {object | null | undefined} remote 远端片段
 * @returns {object} 合并后的 manifest（可变副本）
 */
export function mergeArchiveMonthHintsFromRemote(local, remote) {
	if (!remote) return local
	const merged = {
		...local,
		channels: { ...local.channels },
		coverage: { ...local.coverage, ...remote.coverage || {} },
		archive_coverage_complete: remote.archive_coverage_complete === true
			|| local.archive_coverage_complete === true,
	}
	for (const [channelId, meta] of Object.entries(remote.channels || {})) {
		const months = meta?.months || []
		if (!merged.channels[channelId]) merged.channels[channelId] = { months: [] }
		const set = new Set(merged.channels[channelId].months || [])
		for (const month of months) {
			const m = String(month).trim()
			if (/^\d{4}-\d{2}$/u.test(m)) set.add(m)
		}
		merged.channels[channelId].months = [...set].sort((a, b) => a.localeCompare(b, 'en'))
	}
	return merged
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @returns {Promise<object>} manifest
 */
async function loadArchiveManifestUnlocked(username, groupId) {
	const path = archiveManifestPath(username, groupId)
	try {
		return normalizeManifest(JSON.parse(await readFile(path, 'utf8')))
	}
	catch (err) {
		if (err?.code !== 'ENOENT') throw err
		return normalizeManifest(null)
	}
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @returns {Promise<object>} manifest
 */
export async function loadArchiveManifest(username, groupId) {
	return withArchiveManifestMutex(groupId, () => loadArchiveManifestUnlocked(username, groupId))
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {object} manifest manifest
 * @returns {Promise<void>} 无返回值
 */
async function saveArchiveManifestUnlocked(username, groupId, manifest) {
	await writeJsonAtomicSynced(archiveManifestPath(username, groupId), normalizeManifest(manifest))
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {object} manifest manifest
 * @returns {Promise<void>} 无返回值
 */
export async function saveArchiveManifest(username, groupId, manifest) {
	return withArchiveManifestMutex(groupId, () => saveArchiveManifestUnlocked(username, groupId, manifest))
}

/**
 * 在 manifest 互斥下读-改-写，避免 R-M-W 丢失更新。
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {(manifest: object) => Promise<T>} mutator 接收可变 manifest
 * @returns {Promise<T>} mutator 返回值
 * @template T
 */
export async function mutateArchiveManifest(username, groupId, mutator) {
	return withArchiveManifestMutex(groupId, async () => {
		const manifest = await loadArchiveManifestUnlocked(username, groupId)
		const result = await mutator(manifest)
		await saveArchiveManifestUnlocked(username, groupId, manifest)
		return result
	})
}

/**
 * @param {object} manifest manifest
 * @param {string} channelId 频道 ID
 * @param {string} eventId 事件 id
 * @returns {boolean} 是否已归档
 */
export function isEventArchivedInManifest(manifest, channelId, eventId) {
	const ch = manifest.archivedEventIds?.[channelId]
	return ch ? Object.prototype.hasOwnProperty.call(ch, eventId) : false
}

/**
 * @param {object} manifest archive manifest
 * @returns {Set<string>} 已归档 message eventId
 */
export function archivedMessageIdSet(manifest) {
	const set = new Set()
	for (const ch of Object.values(manifest.archivedEventIds || {}))
		for (const eventId of Object.keys(ch)) set.add(eventId)
	return set
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {object[]} snapshots PostSnapshot 列表
 * @returns {Promise<number>} 新写入条数
 */
export async function appendPostSnapshotsToArchive(username, groupId, channelId, snapshots) {
	if (!snapshots?.length) return 0
	return mutateArchiveManifest(username, groupId, async manifest => {
		if (!manifest.archivedEventIds[channelId]) manifest.archivedEventIds[channelId] = {}
		if (!manifest.channels[channelId]) manifest.channels[channelId] = { months: [] }
		const chMeta = manifest.channels[channelId]
		/** @type {Map<string, object[]>} */
		const byMonth = new Map()
		let added = 0
		for (const snap of snapshots) {
			const eventId = String(snap.eventId).trim()
			if (!eventId || isEventArchivedInManifest(manifest, channelId, eventId)) continue
			const wall = Number(snap.hlc?.wall)
			if (!Number.isFinite(wall)) continue
			const month = archiveMonthKey(wall)
			if (!byMonth.has(month)) byMonth.set(month, [])
			byMonth.get(month).push(snap)
			manifest.archivedEventIds[channelId][eventId] = month
			added++
			if (!chMeta.months.includes(month)) chMeta.months.push(month)
		}
		const {
			archiveAppendMonotonic,
			canonicalArchiveMonthLine,
			digestArchiveMonthFile,
			extendRollingMonthDigest,
			expectedMonthDigest,
			readArchiveMonthMaxEventId,
		} = await import('./monthDigest.mjs')
		for (const [month, rows] of byMonth) {
			const path = channelArchivePath(username, groupId, channelId, month)
			await mkdir(dirname(path), { recursive: true })
			const sorted = [...rows].sort((a, b) =>
				String(a.eventId).localeCompare(String(b.eventId), 'en'),
			)
			const maxOnDisk = await readArchiveMonthMaxEventId(path)
			const block = sorted.map(snap => canonicalArchiveMonthLine(snap)).join('\n') + '\n'
			await appendFile(path, block, 'utf8')
			let digest
			if (archiveAppendMonotonic(maxOnDisk, sorted)) {
				const prevDigest = expectedMonthDigest(manifest, channelId, month)
				digest = extendRollingMonthDigest(prevDigest || '', sorted)
			}
			else {
				const { digest: full } = await digestArchiveMonthFile(path)
				digest = full
			}
			if (digest) {
				if (!manifest.monthDigests) manifest.monthDigests = {}
				if (!manifest.monthDigests[channelId]) manifest.monthDigests[channelId] = {}
				manifest.monthDigests[channelId][month] = digest
			}
		}
		return added
	})
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @returns {Promise<Array<{ channelId: string, month: string, path: string }>>} 归档文件列表
 */
export async function listArchiveFiles(username, groupId) {
	const manifest = await loadArchiveManifest(username, groupId)
	/** @type {Array<{ channelId: string, month: string, path: string }>} */
	const out = []
	for (const [channelId, meta] of Object.entries(manifest.channels || {}))
		for (const month of meta.months || [])
			out.push({
				channelId,
				month,
				path: channelArchivePath(username, groupId, channelId, month),
			})

	return out
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} beforeMonth 删除此月之前（不含）的归档，`YYYY-MM`
 * @returns {Promise<{ deletedFiles: number, droppedIds: number }>} 统计
 */
export async function deleteArchivesBeforeMonth(username, groupId, beforeMonth) {
	return mutateArchiveManifest(username, groupId, async manifest => {
		const { unlink } = await import('node:fs/promises')
		let deletedFiles = 0
		let droppedIds = 0
		for (const [channelId, meta] of Object.entries(manifest.channels || {})) {
			const keepMonths = (meta.months || []).filter(m => m >= beforeMonth)
			const dropMonths = new Set((meta.months || []).filter(m => m < beforeMonth))
			for (const month of dropMonths)
				try {
					await unlink(channelArchivePath(username, groupId, channelId, month))
					deletedFiles++
				}
				catch { /* missing */ }

			meta.months = keepMonths.sort()
			const idMap = manifest.archivedEventIds[channelId] || {}
			for (const [eventId, month] of Object.entries(idMap))
				if (dropMonths.has(month)) {
					delete idMap[eventId]
					droppedIds++
				}

		}
		return { deletedFiles, droppedIds }
	})
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @returns {Promise<Array<{ channelId: string, month: string, bytes: number }>>} 各文件大小
 */
export async function summarizeArchiveStorage(username, groupId) {
	const { stat } = await import('node:fs/promises')
	const files = await listArchiveFiles(username, groupId)
	const out = []
	for (const row of files)
		try {
			const st = await stat(row.path)
			out.push({ channelId: row.channelId, month: row.month, bytes: st.size })
		}
		catch { /* gone */ }

	return out
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {Promise<string[]>} 已有月份列表
 */
export async function listArchiveMonthsForChannel(username, groupId, channelId) {
	const manifest = await loadArchiveManifest(username, groupId)
	return [...manifest.channels?.[channelId]?.months || []].sort()
}

/**
 * 合并远端 manifest 月份 hint（互斥 R-M-W）。
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {object | null | undefined} remote 远端片段
 * @returns {Promise<void>}
 */
export async function mergeRemoteArchiveManifestHints(username, groupId, remote) {
	return mutateArchiveManifest(username, groupId, manifest => {
		Object.assign(manifest, mergeArchiveMonthHintsFromRemote(manifest, remote))
	})
}
