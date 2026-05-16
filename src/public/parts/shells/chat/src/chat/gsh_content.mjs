/**
 * DAG 消息体 GSH 加解密（§11）：`message` / `message_append` / `message_edit` 的 `content` 以密文入联邦。
 */

import { decryptMessage, encryptMessage } from '../../../../../../scripts/p2p/gsh.mjs'

import { getCurrentH, getHByGeneration, initGroupH } from './gsh_store.mjs'

/** 须加密的 DAG 事件类型 */
export const GSH_ENCRYPT_EVENT_TYPES = new Set(['message', 'message_append', 'message_edit'])

/**
 * @param {unknown} content 事件 content
 * @returns {boolean} 是否为 GSH 密文信封
 */
export function isGshEncryptedContent(content) {
	return !!(content && typeof content === 'object' && /** @type {object} */ content.gsh?.scheme === 'gsh')
}

/**
 * @param {string} username 本地用户
 * @param {string} groupId 群 ID
 * @returns {Promise<{ h: string, generation: number }>} 当前群 H 与代数
 */
async function ensureGroupH(username, groupId) {
	const cur = await getCurrentH(username, groupId)
	if (cur) return cur
	return initGroupH(username, groupId)
}

/**
 * 将明文 content 对象加密为 `{ gsh: { scheme, generation, iv, ciphertext, authTag } }`。
 * @param {string} username 本地用户
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID（KDF 盐）
 * @param {object} plaintextContent 明文载荷
 * @returns {Promise<object>} 密文 content
 */
export async function encryptEventContent(username, groupId, channelId, plaintextContent) {
	if (!plaintextContent || typeof plaintextContent !== 'object') return plaintextContent
	if (isGshEncryptedContent(plaintextContent)) return plaintextContent
	const { h, generation } = await ensureGroupH(username, groupId)
	const gsh = encryptMessage(JSON.stringify(plaintextContent), h, channelId, generation)
	return { gsh }
}

/**
 * 解密 GSH 信封为明文 content 对象；失败时保留信封并标注 `_gshDecryptFailed`。
 * @param {string} username 本地用户
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {unknown} content 可能为密文或明文
 * @returns {Promise<object>} 明文 content（或带失败标记的对象）
 */
export async function decryptEventContent(username, groupId, channelId, content) {
	if (!content || typeof content !== 'object') return /** @type {object} */ content || {}
	if (!isGshEncryptedContent(content)) return /** @type {object} */ content

	const env = /** @type {{ gsh: { scheme: string, generation?: number } }} */ content
	const gen = typeof env.gsh.generation === 'number' ? env.gsh.generation : null
	let H = gen != null ? await getHByGeneration(username, groupId, gen) : null
	if (!H) {
		const cur = await getCurrentH(username, groupId)
		H = cur?.h ?? null
	}
	if (!H)
		return {
			.../** @type {object} */ content,
			_gshDecryptFailed: true,
			_gshPendingGeneration: gen,
		}

	const plain = decryptMessage(env.gsh, H, channelId)
	if (plain == null)
		return {
			.../** @type {object} */ content,
			_gshDecryptFailed: true,
			_gshPendingGeneration: gen,
		}

	try {
		return JSON.parse(plain)
	}
	catch {
		return { text: plain }
	}
}

/**
 * 批量解密频道消息 JSONL 行（就地替换 `content`）。
 * @param {string} username 本地用户
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {object[]} lines 消息行
 * @returns {Promise<object[]>} 解密后的消息行数组
 */
export async function decryptChannelMessageLines(username, groupId, channelId, lines) {
	if (!Array.isArray(lines) || !lines.length) return lines || []
	return Promise.all(lines.map(async line => {
		if (!line || typeof line !== 'object') return line
		const c = line.content
		if (!c || typeof c !== 'object') return line
		const next = await decryptEventContent(username, groupId, channelId, c)
		return { ...line, content: next }
	}))
}
