/**
 * 【文件】federation/channelHistory.mjs
 * 【职责】经 Trystero channel_history_want/response 向联邦邻居拉取频道 JSONL 历史，并合并入本地频道消息存储。
 */
import { randomUUID } from 'node:crypto'

import { registerWireWait } from 'npm:@steve02081504/fount-p2p/wire/wait'

import { localNodeHash } from './dagDependencies.mjs'
import { signPullAttestation } from './pullAttestation.mjs'
import { EVENT_ID_HEX, pendingChannelHistory } from './registry.mjs'
import { parseChannelHistoryResponse } from './wireSchemas.mjs'

const CHANNEL_HISTORY_WAIT_MS = 2000

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} requestId 请求 id
 * @returns {string} 等待表键
 */
function channelHistoryWaitKey(username, groupId, channelId, requestId) {
	return `${username}:${groupId}:${channelId}:${requestId}`
}

/**
 * 向联邦邻居广播频道历史问询并等待应答。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {{ before?: string, limit?: number }} [options] 游标与条数
 * @returns {Promise<object[]>} 对端返回的消息行
 */
export async function requestChannelHistoryFromPeers(username, groupId, channelId, options = {}) {
	const { ensureFederationRoom } = await import('./room.mjs')
	const slot = await ensureFederationRoom(username, groupId)
	if (!slot?.send) return []

	const nodeHash = localNodeHash()
	const requestId = randomUUID()
	const key = channelHistoryWaitKey(username, groupId, channelId, requestId)
	const { promise } = registerWireWait(pendingChannelHistory, key, CHANNEL_HISTORY_WAIT_MS, () => [])

	const limit = Math.min(500, Math.max(1, Number(options.limit) || 50))
	const before = EVENT_ID_HEX.test(String(options.before || '')) ? options.before : null
	const attestation = await signPullAttestation(username, groupId, { requestId })
	try {
		slot.send('channel_history_want',{
			requestId,
			channelId,
			before,
			limit,
			requesterNodeHash: nodeHash,
			attestation,
		}, null)
	}
	catch (error) {
		console.error('federation: channel_history_want send failed', error)
		pendingChannelHistory.delete(key)
		return []
	}
	return promise
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {unknown} data `channel_history_response` 载荷
 * @returns {Promise<void>}
 */
export async function handleChannelHistoryResponse(username, groupId, data) {
	const parsed = parseChannelHistoryResponse(data, localNodeHash())
	if (!parsed) return

	const { requestId, channelId, messages } = parsed
	const pending = pendingChannelHistory.get(channelHistoryWaitKey(username, groupId, channelId, requestId))
	if (pending) pending.resolve(messages)

	if (messages.length) {
		const { mergeChannelHistoryRows } = await import('../dag/queries.mjs')
		await mergeChannelHistoryRows(username, groupId, channelId, messages)
	}
}
