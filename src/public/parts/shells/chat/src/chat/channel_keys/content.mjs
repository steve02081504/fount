import {
	CKG_SCHEME,
	decryptWithChannelKey,
	encryptWithChannelKey,
} from 'npm:@steve02081504/fount-p2p/crypto/channel'

import { recordPendingChannelDecrypt } from '../file_keys/buffer.mjs'

import { getChannelKeyHex, loadChannelKeysFile } from './store.mjs'

/** @type {Set<string>} */
export const CKG_ENCRYPT_EVENT_TYPES = new Set(['message', 'message_edit'])

/**
 * ckg 信封自身的保留键；信封内除这些键以外的顶层键一律视为「保持明文的结构字段」。
 * @type {Set<string>}
 */
const CKG_ENVELOPE_KEYS = new Set(['scheme', 'channelId', 'generation', 'payload'])

/**
 * 各事件类型必须留在 content 顶层明文的结构/路由字段：联邦中继与入站鉴权依赖它们做权限判定，
 * 它们不是机密（整个事件由作者 Ed25519 签名保护），因此可在仅加密用户正文的同时保持可见。
 * @type {Record<string, string[]>}
 */
export const CKG_PLAINTEXT_CONTENT_FIELDS = {
	message: ['type', 'deadline', 'question', 'options'],
	message_edit: ['targetId'],
}

/**
 * @param {string} type 事件类型
 * @returns {string[]} 该类型保持明文的 content 字段名
 */
export function plaintextCkgContentFields(type) {
	return CKG_PLAINTEXT_CONTENT_FIELDS[type] || []
}

/**
 * @param {unknown} content 事件 content
 * @returns {boolean} 是否为 ckg 密文
 */
export function isCkgEncryptedContent(content) {
	return content?.scheme === CKG_SCHEME
}

/**
 * 将明文 content 拆为「保持明文的结构字段」与「待加密正文」两部分。
 * @param {object} content 明文 content
 * @param {string[]} plaintextFields 保持明文的字段名
 * @returns {{ clear: Record<string, unknown>, secret: Record<string, unknown> }} 拆分结果
 */
export function partitionCkgContentFields(content, plaintextFields = []) {
	const keep = new Set((plaintextFields || []).filter(field => !CKG_ENVELOPE_KEYS.has(field)))
	/** @type {Record<string, unknown>} */
	const clear = {}
	/** @type {Record<string, unknown>} */
	const secret = {}
	for (const [key, value] of Object.entries(content))
		if (keep.has(key)) clear[key] = value
		else secret[key] = value
	return { clear, secret }
}

/**
 * 从 ckg 信封中提取被保留为明文的结构字段（信封保留键以外的顶层键）。
 * @param {object} envelopeContent ckg 信封 content
 * @returns {Record<string, unknown>} 明文结构字段
 */
export function clearFieldsFromCkgEnvelope(envelopeContent) {
	/** @type {Record<string, unknown>} */
	const clear = {}
	for (const [key, value] of Object.entries(envelopeContent))
		if (!CKG_ENVELOPE_KEYS.has(key)) clear[key] = value
	return clear
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
 * @param {string[]} [plaintextFields] 保持明文的结构字段名（如 message_edit 的 targetId）
 * @returns {Promise<object>} ckg 加密信封（仅正文加密，明文结构字段平铺在顶层）
 */
export async function encryptEventContent(username, groupId, channelId, plaintextContent, plaintextFields = []) {
	if (!plaintextContent) return plaintextContent
	const resolved = await resolveChannelKey(username, groupId, channelId)
	if (!resolved) throw new Error(`no channel key for ${channelId}`)
	const { clear, secret } = partitionCkgContentFields(plaintextContent, plaintextFields)
	const envelope = encryptWithChannelKey(
		JSON.stringify(secret),
		resolved.keyHex,
		channelId,
		resolved.generation,
	)
	return { ...envelope, ...clear }
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
		// 明文结构字段（如 targetId）平铺在信封顶层，须与解密出的正文合并还原完整 content。
		return { ok: true, content: { ...clearFieldsFromCkgEnvelope(content), ...JSON.parse(decryptedText) } }
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
			content: null,
			decryptView: {
				failed: true,
				...result.generation != null ? { pendingGeneration: result.generation } : {},
			},
		}
	}))
}
