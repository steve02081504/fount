/**
 * 角色生成中的 Hub 流式预览：对 reply 快照做 diff，经签名 `stream_chunk` 广播并写入服务端短缓冲。
 */
import { createBufferedSyncPreviewUpdater } from '../../stream/bufferedUpdater.mjs'
import { generateDiff } from '../../stream/diff.mjs'
import { bufferStreamChunk } from '../stream/groupWsStreamBuffer.mjs'

import { broadcastSignedGroupVolatile } from './broadcast.mjs'

/**
 * @param {object} reply 角色中间回复
 * @returns {{ content: string, content_for_show: string, files: Array }} 用于 diff 的快照
 */
export function replyPreviewSnapshot(reply) {
	return {
		content: reply?.content ?? '',
		content_for_show: reply?.content_for_show ?? reply?.content ?? '',
		files: reply?.files ?? [],
	}
}

/**
 * @param {{ username: string, groupId: string, pendingStreamId: string, channelId: string, charId?: string }} opts 流上下文
 * @returns {{ update: (reply: object) => void }} 同步预览更新器
 */
export function createCharPreviewStream({ username, groupId, pendingStreamId, channelId, charId }) {
	let lastMessage = { content: '', content_for_show: '', files: [] }
	let chunkSeq = 0

	const update = createBufferedSyncPreviewUpdater(async reply => {
		const next = replyPreviewSnapshot(reply)
		const slices = generateDiff(lastMessage, next)
		if (!slices.length) return
		lastMessage = structuredClone(next)
		chunkSeq += 1
		const payload = {
			type: 'stream_chunk',
			channelId,
			pendingStreamId,
			chunkSeq,
			slices,
			charId,
		}
		await broadcastSignedGroupVolatile(username, groupId, payload)
		bufferStreamChunk(groupId, pendingStreamId, chunkSeq, slices)
	})

	return { update }
}
