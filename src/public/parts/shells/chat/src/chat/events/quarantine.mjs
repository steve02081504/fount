/**
 * 【文件】`events/quarantine.mjs` — HLC 等异常事件的隔离区与重放。
 * 【职责】将无法立即入主 DAG 的签名事件写入 `quarantine.jsonl`；时钟恢复后批量重试入库。
 * 【原理】消息类 HLC 超 skew 时隔离而非丢弃；`replayQuarantinedEvents` 逐条调用 ingest，成功或 dup 则释放，仍失败则保留行。
 * 【数据结构】隔离行 `{ event, reason, quarantinedAt }`；`tryIngest` 返回与 `appendValidatedRemoteEvent` 相同的状态码。
 * 【关联】`events/hlcPolicy.mjs`、`remoteIngest.mjs`、`p2p/dag/storage.mjs`、`dag/groupLock.mjs`。
 */
import { appendJsonlSynced, readJsonl } from '../../../../../../../scripts/p2p/dag/storage.mjs'
import { sanitizeFederatedEvent } from '../events/wire.mjs'
import { quarantinePath } from '../lib/paths.mjs'

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {object} signPayload 完整签名事件
 * @param {string} reason 隔离原因
 * @returns {Promise<void>}
 */
export async function appendQuarantinedEvent(username, groupId, signPayload, reason) {
	await appendJsonlSynced(quarantinePath(username, groupId), {
		event: signPayload,
		reason,
		quarantinedAt: Date.now(),
	})
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {Promise<object[]>} 隔离行
 */
export async function readQuarantineRows(username, groupId) {
	return readJsonl(quarantinePath(username, groupId), { sanitize: sanitizeFederatedEvent })
}

/**
 * 重写隔离文件，仅保留仍未释放的行。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {object[]} rows 保留行
 * @returns {Promise<void>}
 */
async function writeQuarantineRows(username, groupId, rows) {
	const { mkdir, writeFile } = await import('node:fs/promises')
	const { dirname } = await import('node:path')
	const path = quarantinePath(username, groupId)
	await mkdir(dirname(path), { recursive: true })
	const body = rows.map(JSON.stringify).join('\n')
	await writeFile(path, body ? `${body}\n` : '', 'utf8')
}

/**
 * 尝试将隔离区事件重放进主 DAG（时钟/skew 恢复后）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {(ev: object) => Promise<'ok' | 'dup' | 'invalid' | 'quarantined'>} tryIngest 入库函数
 * @returns {Promise<{ released: number, remaining: number }>} 释放条数与剩余隔离条数
 */
export async function replayQuarantinedEvents(username, groupId, tryIngest) {
	const rows = await readQuarantineRows(username, groupId)
	if (!rows.length) return { released: 0, remaining: 0 }

	/** @type {object[]} */
	const keep = []
	let released = 0
	for (const row of rows) {
		const ev = row?.event
		if (!ev || typeof ev !== 'object') continue
		const status = await tryIngest(ev)
		if (status === 'ok' || status === 'dup') {
			released++
			continue
		}
		keep.push(row)
	}
	if (keep.length !== rows.length)
		await writeQuarantineRows(username, groupId, keep)
	return { released, remaining: keep.length }
}
