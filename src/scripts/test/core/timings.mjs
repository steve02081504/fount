/**
 * 按 manifest 持久化 suite 上次成功耗时（data/test/timings/）。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { timingFilePath } from './paths.mjs'

/**
 * 单个 suite 成功耗时条目。
 * @typedef {{ durationMs: number, recordedAt: string }} TimingItem
 */

/**
 * 持久化的耗时记录结构。
 * @typedef {object} TimingRecord
 * @property {Record<string, TimingItem>} items suite 名 -> 耗时
 */

/**
 * 读取 manifest 耗时记录。
 * @param {string} repoRoot 仓库根
 * @param {string} manifestId manifest id
 * @returns {Promise<TimingRecord>} 耗时记录；不存在时返回空 items
 */
export async function readTimings(repoRoot, manifestId) {
	const path = timingFilePath(repoRoot, manifestId)
	let raw
	try {
		raw = await readFile(path, 'utf8')
	}
	catch (error) {
		if (error?.code === 'ENOENT') return { items: {} }
		throw error
	}
	const data = JSON.parse(raw)
	if (!data.items || typeof data.items !== 'object')
		throw new Error(`invalid timing record for ${manifestId}: missing items object`)
	return { items: data.items }
}

/**
 * 写入 manifest 耗时记录。
 * @param {string} repoRoot 仓库根
 * @param {string} manifestId manifest id
 * @param {TimingRecord} record 耗时记录
 * @returns {Promise<void>}
 */
export async function writeTimings(repoRoot, manifestId, record) {
	const path = timingFilePath(repoRoot, manifestId)
	await mkdir(join(path, '..'), { recursive: true })
	await writeFile(path, `${JSON.stringify(record, null, '\t')}\n`, 'utf8')
}

/**
 * 为选定 suite 列表预加载各 manifest 耗时记录。
 * @param {string} repoRoot 仓库根
 * @param {import('./manifest.mjs').SuiteDef[]} suites 选定 suite
 * @returns {Promise<Map<string, TimingRecord>>} manifestId -> 耗时记录
 */
export async function loadTimingsForSuites(repoRoot, suites) {
	const manifestIds = [...new Set(suites.map(suite => suite.manifestId))]
	const map = new Map()
	await Promise.all(manifestIds.map(async manifestId => {
		map.set(manifestId, await readTimings(repoRoot, manifestId))
	}))
	return map
}

/**
 * 更新单个 suite 的成功耗时（内存记录）。
 * @param {TimingRecord} record 耗时记录
 * @param {string} suiteName suite 名
 * @param {number} durationMs 成功耗时毫秒
 * @returns {TimingRecord} 更新后的记录
 */
export function recordSuiteSuccessTiming(record, suiteName, durationMs) {
	return {
		items: {
			...record.items,
			[suiteName]: {
				durationMs,
				recordedAt: new Date().toISOString(),
			},
		},
	}
}
