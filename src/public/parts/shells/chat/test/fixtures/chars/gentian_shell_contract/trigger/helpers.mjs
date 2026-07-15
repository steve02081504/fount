import { getChatClient } from 'fount/public/parts/shells/chat/src/api/client.mjs'
import { isCaredBy } from 'fount/public/parts/shells/chat/src/chat/lib/care.mjs'

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
 * @returns {string | undefined} 桥接作者 entityHash
 */
function bridgeAuthorHash(event) {
	const msg = event.message
	const ext = msg?.extension?.bridge
		|| (msg?.content && typeof msg.content === 'object' ? msg.content.extension?.bridge : undefined)
	return ext?.authorEntityHash ? String(ext.authorEntityHash).toLowerCase() : undefined
}

/**
 * @param {object} event OnMessage 事件
 * @param {string} selfHash 自身 hash
 * @param {string} operatorHash operator hash
 * @returns {Promise<{ authorHash: string, isFromOwner: boolean, client: object, message: object }>} 消息上下文
 */
export async function resolveMessageContext(event, selfHash, operatorHash) {
	const username = event.chatReplyRequest.username
	const client = await getChatClient(username, selfHash)
	const message = await client.messageFrom(event)
	const author = await message.author()
	const authorHash = bridgeAuthorHash(event) || String(author.entityHash || '').toLowerCase()
	const isFromOwner = !!(operatorHash && authorHash === operatorHash
		|| operatorHash && await isCaredBy(username, selfHash, authorHash))
	return { authorHash, isFromOwner, client, message }
}
