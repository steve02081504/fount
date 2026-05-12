import { readFile } from 'node:fs/promises'

import { keyPairFromSeed, pubKeyHash } from '../../../../../../scripts/p2p/crypto.mjs'

import { localEd25519SeedPath } from './paths.mjs'
import { serializeMessageContent } from './visibility.mjs'

/**
 * 判断目标频道是否启用 mailbox-ecdh。
 * @param {{ channels?: Record<string, { encryptionScheme?: string }> } | null | undefined} state 物化群状态
 * @param {string} channelId 频道 ID
 * @returns {boolean} 是否启用 mailbox-ecdh
 */
function isMailboxE2eChannel(state, channelId) {
	return state?.channels?.[channelId]?.encryptionScheme === 'mailbox-ecdh'
}

/**
 * 从物化成员表收集可用于 mailbox / visibility E2E 的接收方公钥列表。
 * @param {{ members?: Record<string, { pubKeyHex?: string }> } | null | undefined} state 物化群状态
 * @returns {{ recipientPubKeyHexes: string[], recipientPubKeyHashes: string[] }} 供 `serializeMessageContent` 的 context
 */
function collectRecipientSerializeContext(state) {
	/** @type {string[]} */
	const recipientPubKeyHexes = []
	/** @type {string[]} */
	const recipientPubKeyHashes = []
	for (const [hash, member] of Object.entries(state?.members ?? {})) {
		if (typeof member?.pubKeyHex !== 'string' || !member.pubKeyHex) continue
		recipientPubKeyHexes.push(member.pubKeyHex)
		recipientPubKeyHashes.push(hash)
	}
	return { recipientPubKeyHexes, recipientPubKeyHashes }
}

/**
 * 将 E2E 序列化结果合并进 DAG content：已加密或 pending 时绝不写入明文正文。
 * @param {object} content 原始 DAG content
 * @param {object} e2e `serializeMessageContent` 返回值
 * @returns {object} 写入 DAG 的 content
 */
function attachSerializedE2e(content, e2e) {
	if (!e2e || typeof e2e !== 'object') return content
	if (e2e.encrypted === true)
		return { ...content, text: '', e2e }
	return content
}

/**
 * 为 mailbox-ecdh 频道构造消息 E2E 载荷；对带 visibility 的非 mailbox 频道在持久化层不落明文正文。
 * @param {object} content 原始 DAG content
 * @param {string} text 明文正文
 * @param {{
 *   channels?: Record<string, { encryptionScheme?: string }>,
 *   members?: Record<string, { pubKeyHex?: string }>
 * } | null | undefined} state 物化群状态
 * @param {string} channelId 频道 ID
 * @returns {object} 写入 DAG 的 content
 */
export function applyMailboxE2EToDagContent(content, text, state, channelId) {
	const mailbox = isMailboxE2eChannel(state, channelId)
	const vis = content?.visibility
	if (!mailbox && !vis)
		return content

	const ctx = collectRecipientSerializeContext(state)

	if (mailbox) {
		const e2e = serializeMessageContent(text, { members: ctx.recipientPubKeyHashes }, ctx)
		return attachSerializedE2e(content, e2e)
	}

	const e2e = serializeMessageContent(text, vis, ctx)
	return attachSerializedE2e(content, e2e)
}

/**
 * 读取本机 Ed25519 种子并派生 mailbox 解密上下文。
 * @param {string} username 本地账户名
 * @param {string} groupId 群组 / 会话 ID
 * @returns {Promise<{ myPubKeyHash: string, mySecretKeyBytes: Uint8Array } | null>} 解密上下文
 */
export async function loadLocalMailboxDecryptContext(username, groupId) {
	try {
		const seed = await readFile(localEd25519SeedPath(username, groupId))
		if (seed.length !== 32) return null
		const mySecretKeyBytes = new Uint8Array(seed)
		const { publicKey } = keyPairFromSeed(mySecretKeyBytes)
		return {
			myPubKeyHash: pubKeyHash(publicKey),
			mySecretKeyBytes,
		}
	}
	catch {
		return null
	}
}
