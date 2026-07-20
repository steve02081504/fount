/**
 * 【文件】public/hub/stream/handlers/streamChunk.mjs
 * 【职责】WS `stream_chunk` 与 reputation_slash_alert。
 */
import { showToastI18n } from '../../../../../../scripts/features/toast.mjs'
import { appendStreamSlices } from '../volatileSlots.mjs'

/**
 * @param {object} wireMessage WS 载荷
 * @param {string} channelId 当前频道
 * @returns {Promise<boolean>} 是否已处理
 */
export async function handleVolatileStreamWire(wireMessage, channelId) {
	if (wireMessage.type === 'reputation_slash_alert') {
		const target = String(wireMessage.targetPubKeyHash || '').slice(0, 16)
		showToastI18n('warning', 'chat.hub.reputationSlashAlert', { target })
		return true
	}

	if (wireMessage.channelId && wireMessage.channelId !== channelId) return false
	if (wireMessage.type !== 'stream_chunk') return false

	const streamId = String(wireMessage.pendingStreamId || '')
	const { slices } = wireMessage
	if (!streamId || !Array.isArray(slices) || !slices.length) return true

	await appendStreamSlices(
		streamId,
		Number(wireMessage.chunkSeq ?? 0),
		slices,
		wireMessage.channelId || channelId,
	)
	return true
}
