/**
 * 【文件】federation/pendingRelay.mjs
 * 【职责】物化 ACL 未就绪时暂缓联邦中继的事件持久队列（§2.1），checkpoint/成员快照就绪后批量刷出。
 * 【原理】enqueuePendingRelay 追加 sanitize 后事件到 pending_relay.jsonl；flushPendingRelay 逐条调用 publish 闭包，失败行写回文件。与 acl.shouldDeferFederatedRelay 配对使用，本地落盘仍可进行。
 * 【数据结构】pending_relay.jsonl 行与 events.jsonl 同形的签名事件；刷出返回成功条数。
 * 【关联】acl.mjs、index.mjs publishSignedEventToFederation、lib/paths.mjs pendingRelayPath、dag/storage readJsonl。
 */
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import { appendJsonlSynced, readJsonl } from '../../../../../../../scripts/p2p/dag/storage.mjs'
import { sanitizeFederatedEvent } from '../events/wire.mjs'
import { pendingRelayPath } from '../lib/paths.mjs'

/**
 * 无物化 ACL 时暂缓中继的事件队列（§2.1）；checkpoint 就绪后刷出。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {object} signPayload 签名事件
 * @returns {Promise<void>}
 */
export async function enqueuePendingRelay(username, groupId, signPayload) {
	if (!signPayload?.id) return
	const pendingRelayFilePath = pendingRelayPath(username, groupId)
	await mkdir(dirname(pendingRelayFilePath), { recursive: true })
	await appendJsonlSynced(pendingRelayFilePath, sanitizeFederatedEvent(signPayload))
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {(ev: object) => Promise<void>} publish 单条中继闭包
 * @returns {Promise<number>} 成功刷出条数
 */
export async function flushPendingRelay(username, groupId, publish) {
	const pendingRelayFilePath = pendingRelayPath(username, groupId)
	const pendingEvents = await readJsonl(pendingRelayFilePath, { sanitize: sanitizeFederatedEvent })
	if (!pendingEvents.length) return 0
	const { writeFile, unlink } = await import('node:fs/promises')
	await writeFile(pendingRelayFilePath, '', 'utf8')
	let flushedCount = 0
	for (const pendingEvent of pendingEvents)
		try {
			await publish(pendingEvent)
			flushedCount++
		}
		catch (publishError) {
			console.error('federation: pending relay flush failed', publishError)
			await appendJsonlSynced(pendingRelayFilePath, pendingEvent)
		}

	try {
		const unflushedEvents = await readJsonl(pendingRelayFilePath, { sanitize: sanitizeFederatedEvent })
		if (!unflushedEvents.length) await unlink(pendingRelayFilePath)
	}
	catch (error) {
		console.warn('federation: pending relay cleanup failed', error)
	}
	return flushedCount
}
