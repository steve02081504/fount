import { getChatClient } from 'fount/public/parts/shells/chat/src/api/client/index.mjs'
import { resolveTrustedOwnerContext } from 'fount/public/parts/shells/chat/src/entity/master.mjs'

/**
 * @param {object} message 消息行
 * @returns {string} 纯文本内容
 */
export function extractMessageText(message) {
	const raw = message?.content
	if (typeof raw === 'string') return raw.trim()
	if (raw?.type === 'text' && raw.content != null) return String(raw.content).trim()
	if (raw && typeof raw === 'object' && raw.content != null) return String(raw.content).trim()
	return String(raw ?? '').trim()
}

/**
 * @param {object} event OnMessage 事件
 * @param {string} selfHash 自身 hash
 * @param {string} [declaredOwnerHash] 声明主人（可选；缺省走 identity）
 * @returns {Promise<{ authorHash: string, isFromOwner: boolean, attribution: object, client: object, message: object }>} 消息上下文
 */
export async function resolveMessageContext(event, selfHash, declaredOwnerHash = null) {
	const username = event.chatReplyRequest.username
	const client = await getChatClient(username, selfHash)
	const message = await client.messageFrom(event)
	const author = await message.author()
	const authorHash = String(author?.entityHash || '').toLowerCase()
	const result = await resolveTrustedOwnerContext({
		username,
		agentEntityHash: selfHash,
		eventOrLine: event,
		authorEntityHash: authorHash || null,
	})
	const isFromOwner = declaredOwnerHash
		? result.isFromOwner && result.declaredOwnerEntityHash === String(declaredOwnerHash).toLowerCase()
		: result.isFromOwner
	return {
		authorHash: result.authorEntityHash || authorHash,
		isFromOwner,
		attribution: result.attribution,
		client,
		message,
	}
}
