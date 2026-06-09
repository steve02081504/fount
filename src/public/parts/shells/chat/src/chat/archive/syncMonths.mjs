/**
 * 按 manifest 补拉缺失冷归档月份（信誉仲裁）。
 */
import { readFile } from 'node:fs/promises'

import { channelArchivePath } from '../lib/paths.mjs'

import { loadArchiveManifest } from './index.mjs'

const DEFAULT_CONCURRENCY = 3

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @returns {Promise<Array<{ channelId: string, utcMonth: string }>>} 缺失月份列表
 */
export async function listMissingArchiveMonths(username, groupId) {
	const manifest = await loadArchiveManifest(username, groupId)
	/** @type {Array<{ channelId: string, utcMonth: string }>} */
	const missing = []
	for (const [channelId, meta] of Object.entries(manifest.channels || {})) 
		for (const utcMonth of meta.months || []) 
			try {
				await readFile(channelArchivePath(username, groupId, channelId, utcMonth), 'utf8')
			}
			catch {
				missing.push({ channelId, utcMonth })
			}
		
	
	return missing.sort((a, b) => a.utcMonth.localeCompare(b.utcMonth))
}

/**
 * @param {Array<{ channelId: string, utcMonth: string }>} items 待拉项
 * @param {string} priorityMonth 优先月份
 * @returns {Array<{ channelId: string, utcMonth: string }>} 排序后的列表
 */
export function sortMissingArchiveMonths(items, priorityMonth = '') {
	const priority = priorityMonth.trim()
	if (!priority) return items
	return [
		...items.filter(row => row.utcMonth === priority),
		...items.filter(row => row.utcMonth !== priority),
	]
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {object} slot 联邦槽
 * @param {{ priorityMonth?: string, concurrency?: number }} [opts] 选项
 * @returns {Promise<{ pulled: number, incomplete: number }>} 拉取统计
 */
export async function syncMissingArchiveMonths(username, groupId, slot, opts = {}) {
	if (!slot) return { pulled: 0, incomplete: 0 }
	const { loadGroupSyncState } = await import('../federation/syncState.mjs')
	const sync = await loadGroupSyncState(username, groupId)
	const priorityMonth = opts.priorityMonth || sync.offlineStartUtcMonth
	let missing = await listMissingArchiveMonths(username, groupId)
	if (!missing.length) return { pulled: 0, incomplete: 0 }
	missing = sortMissingArchiveMonths(missing, priorityMonth)

	const { pullArchiveMonthQuorum } = await import('../federation/archiveMonthPull.mjs')
	const concurrency = Math.max(1, Math.min(8, Number(opts.concurrency) || DEFAULT_CONCURRENCY))
	let pulled = 0
	let incomplete = 0
	let nextIndex = 0

	/** @returns {Promise<void>} */
	const worker = async () => {
		for (;;) {
			const itemIndex = nextIndex++
			if (itemIndex >= missing.length) return
			const { channelId, utcMonth } = missing[itemIndex]
			const { applied } = await pullArchiveMonthQuorum(username, groupId, slot, channelId, utcMonth)
			if (applied) pulled++
			else incomplete++
		}
	}

	await Promise.all(Array.from({ length: Math.min(concurrency, missing.length) }, () => worker()))
	return { pulled, incomplete }
}
