import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

import { channelArchivePath } from '../lib/paths.mjs'

import { loadArchiveManifest } from './index.mjs'
import { assertArchiveMonthFileMatchesManifest } from './monthDigest.mjs'
import { postSnapshotToMessageLine } from './postSnapshot.mjs'

/**
 * @param {string} filePath 归档 JSONL 路径
 * @returns {Promise<object[]>} PostSnapshot 列表
 */
async function readJsonlFile(filePath) {
	/** @type {object[]} */
	const rows = []
	const input = createReadStream(filePath, { encoding: 'utf8' })
	const lines = createInterface({ input, crlfDelay: Infinity })
	for await (const line of lines) {
		const trimmed = String(line).trim()
		if (!trimmed) continue
		rows.push(JSON.parse(trimmed))
	}
	return rows
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} month `YYYY-MM`
 * @returns {Promise<object[]>} PostSnapshot 列表
 */
export async function readArchiveMonth(username, groupId, channelId, month) {
	const manifest = await loadArchiveManifest(username, groupId)
	const check = await assertArchiveMonthFileMatchesManifest(username, groupId, channelId, month, manifest)
	if (!check.ok) return []
	return readJsonlFile(channelArchivePath(username, groupId, channelId, month))
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string[]} months 月份列表（升序）
 * @returns {Promise<object[]>} 消息行（Hub 形）
 */
export async function readArchiveAsMessageLines(username, groupId, channelId, months) {
	/** @type {object[]} */
	const rows = []
	for (const month of months) {
		const snaps = await readArchiveMonth(username, groupId, channelId, month)
		for (const snap of snaps)
			if (!snap.deleted) rows.push(postSnapshotToMessageLine(snap))
	}
	rows.sort((a, b) => {
		const wa = Number(a.hlc?.wall)
		const wb = Number(b.hlc?.wall)
		if (wa !== wb) return wa - wb
		return String(a.eventId).localeCompare(String(b.eventId), 'en')
	})
	return rows
}

/**
 * @param {object[]} lines 消息行
 * @param {string} beforeEventId 游标 eventId（不含）
 * @param {number} limit 条数上限
 * @returns {object[]} 分页结果
 */
export function sliceMessagesBefore(lines, beforeEventId, limit = 50) {
	if (!beforeEventId) return lines.slice(-limit)
	const idx = lines.findIndex(r => r.eventId === beforeEventId)
	if (idx <= 0) return []
	return lines.slice(Math.max(0, idx - limit), idx)
}
