import {
	CKG_SCHEME,
	decryptWithChannelKey,
	encryptWithChannelKey,
} from '../../../../../../../scripts/p2p/channel_crypto.mjs'
import { recordPendingChannelDecrypt } from '../file_keys/buffer.mjs'

import { getChannelKeyHex, loadChannelKeysFile } from './store.mjs'

/** @type {Set<string>} */
export const CKG_ENCRYPT_EVENT_TYPES = new Set(['message', 'message_edit'])

/**
 * @param {unknown} content 事件 content
 * @returns {boolean} 是否为 ckg 密文
 */
export function isCkgEncryptedContent(content) {
	return content?.scheme === CKG_SCHEME
}

/**
 * @param {string} type 事件类型
 * @param {unknown} content 事件 content
 * @returns {void}
 */
export function assertFederatedCkgContent(type, content) {
	if (!CKG_ENCRYPT_EVENT_TYPES.has(type)) return
	if (!isCkgEncryptedContent(content))
		throw new Error(`federated ${type} requires ckg encrypted content`)
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {Promise<{ keyHex: string, generation: number } | null>} 当前代 K_ch
 */
async function resolveChannelKey(username, groupId, channelId) {
	const file = await loadChannelKeysFile(username, groupId)
	const ch = file.channels[channelId]
	if (!ch?.generations?.length) return null
	const generation = ch.current
	const row = ch.generations.find(g => g.gen === generation) || ch.generations.at(-1)
	if (!row?.keyHex) return null
	return { keyHex: row.keyHex, generation: row.gen }
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {object} plaintextContent 明文 content
 * @returns {Promise<object>} ckg 加密信封（展平为 content）
 */
export async function encryptEventContent(username, groupId, channelId, plaintextContent) {
	if (!plaintextContent) return plaintextContent
	const resolved = await resolveChannelKey(username, groupId, channelId)
	if (!resolved) throw new Error(`no channel key for ${channelId}`)
	return encryptWithChannelKey(
		JSON.stringify(plaintextContent),
		resolved.keyHex,
		channelId,
		resolved.generation,
	)
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {object} signPayload 待签名载荷
 * @returns {Promise<object>} wire 用加密后载荷
 */
export async function encryptSignedEventForWire(username, groupId, signPayload) {
	if (!signPayload || !CKG_ENCRYPT_EVENT_TYPES.has(signPayload.type)) return signPayload
	const channelId = signPayload.channelId || 'default'
	const content = await encryptEventContent(username, groupId, channelId, signPayload.content)
	return { ...signPayload, content }
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {object} line 消息行
 * @returns {Promise<object>} wire 加密行
 */
export async function encryptMessageLineForWire(username, groupId, channelId, line) {
	if (!line?.content) return line
	const content = await encryptEventContent(username, groupId, channelId, line.content)
	return { ...line, content }
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {unknown} content 事件 content
 * @returns {Promise<{ ok: boolean, content: object | null, generation?: number }>} 解密结果
 */
export async function decryptEventContent(username, groupId, channelId, content) {
	if (!isCkgEncryptedContent(content)) return { ok: true, content }
	const gen = Number(content.generation)
	const keyHex = await getChannelKeyHex(username, groupId, channelId, gen)
	if (!keyHex) {
		recordPendingChannelDecrypt(username, groupId, gen)
		return { ok: false, generation: gen, content: null }
	}
	const decryptedText = decryptWithChannelKey(content, keyHex, channelId)
	if (decryptedText == null) {
		recordPendingChannelDecrypt(username, groupId, gen)
		return { ok: false, generation: gen, content: null }
	}
	try {
		return { ok: true, content: JSON.parse(decryptedText) }
	}
	catch {
		recordPendingChannelDecrypt(username, groupId, gen)
		return { ok: false, generation: gen, content: null }
	}
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {object[]} lines 消息行列表
 * @returns {Promise<object[]>} 解密后行列表
 */
export async function decryptChannelMessageLines(username, groupId, channelId, lines) {
	if (!lines?.length) return lines || []
	return Promise.all(lines.map(async line => {
		if (!line?.content || !isCkgEncryptedContent(line.content)) return line
		const result = await decryptEventContent(username, groupId, channelId, line.content)
		if (result.ok) return { ...line, content: result.content }
		return {
			...line,
			content: {
				decryptFailed: true,
				pendingGeneration: result.generation ?? null,
			},
		}
	}))
}
