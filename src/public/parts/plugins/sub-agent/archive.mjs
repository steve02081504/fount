/**
 * 【文件】src/public/parts/plugins/sub-agent/archive.mjs
 * 【职责】父代聊天档案：把父代最近 N 条 chat_log 投影为 JSON 写入临时文件，供子代理用文件工具自行检索；并在运行结束或超时后清理。
 * 【原理】档案目录固定为 `path.join(os.tmpdir(), 'fount-subagent-context')`，文件名为 `<runId>.json`；`projectArchiveEntries` 只保留 role/name/uid/time_stamp/content 五个字段，避免把文件 Buffer 等重对象写盘。
 *   无任何检索 API，子代理拿到的是路径 + 指引；运行结束删除该文件，启动时按 TTL 清理孤儿文件。
 * 【数据结构】投影条目 = `{ role, name, uid, time_stamp, content }`。
 * 【关联】runtime.mjs 在运行开始写、结束删；prompt.mjs 在开场 system 条目中给出路径；测试 test/pure/archive_projection.test.mjs（纯投影）与 test/integration/archive_io.test.mjs（I/O）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { ms } from '../../../../scripts/ms.mjs'

/** 档案默认保留时长（孤儿清理）。 */
export const ARCHIVE_TTL_MS = ms('2h')

/**
 * 把 chat_log 尾部投影为可序列化的精简条目。
 * @param {object[]} [chatLog] 原始聊天记录
 * @param {number} [limit] 保留条数（默认 50）
 * @returns {Array<{ role: string, name: string, uid: string, time_stamp: unknown, content: string }>} 投影条目
 */
export function projectArchiveEntries(chatLog, limit = 50) {
	if (!Array.isArray(chatLog) || !chatLog.length) return []
	const tail = limit > 0 ? chatLog.slice(-limit) : chatLog
	return tail.map(entry => ({
		role: entry?.role ?? 'system',
		name: entry?.name ?? '',
		uid: entry?.uid ?? '',
		time_stamp: entry?.time_stamp ?? null,
		content: entry?.content ?? '',
	}))
}

/**
 * 档案目录路径。
 * @returns {string} 目录路径
 */
export function archiveDirectory() {
	return path.join(os.tmpdir(), 'fount-subagent-context')
}

/**
 * 写入一份父代档案。
 * @param {string} runId 运行 id
 * @param {Array<object>} entries 投影条目
 * @returns {string} 写入的文件路径
 */
export function writeParentArchive(runId, entries) {
	const directory = archiveDirectory()
	fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
	const filePath = path.join(directory, `${runId}.json`)
	fs.writeFileSync(filePath, JSON.stringify({ runId, createdAt: Date.now(), entries }, null, '\t'), { mode: 0o600 })
	return filePath
}

/**
 * 删除一份父代档案（尽力而为）。
 * @param {string | null | undefined} filePath 档案路径
 * @returns {boolean} 是否删除
 */
export function removeParentArchive(filePath) {
	if (!filePath) return false
	try {
		fs.rmSync(filePath, { force: true })
		return true
	}
	catch {
		return false
	}
}

/**
 * 清理超过 TTL 的孤儿档案。
 * @param {number} [ttlMs] 保留时长
 * @param {number} [now] 当前时间
 * @returns {number} 清理的文件数
 */
export function cleanupExpiredArchives(ttlMs = ARCHIVE_TTL_MS, now = Date.now()) {
	const directory = archiveDirectory()
	let removed = 0
	let names
	try {
		names = fs.readdirSync(directory)
	}
	catch {
		return 0
	}
	for (const name of names) {
		if (!name.endsWith('.json')) continue
		const filePath = path.join(directory, name)
		try {
			const stat = fs.statSync(filePath)
			if (now - stat.mtimeMs > ttlMs) {
				fs.rmSync(filePath, { force: true })
				removed++
			}
		}
		catch { /* 忽略单个文件的 stat/删除失败 */ }
	}
	return removed
}
