import { readFile } from 'node:fs/promises'

import { keyPairFromSeed, pubKeyHash } from '../../../../../../scripts/p2p/crypto.mjs'

import { localEd25519SeedPath } from './paths.mjs'
import { serializeMessageContent } from './visibility.mjs'

/**
 * 判断目标频道是否启用 mailbox-ecdh。
 * @param {{ channels?: Map<string, { encryptionScheme?: string }> } | null | undefined} state 物化群状态
 * @param {string} channelId 频道 ID
 * @returns {boolean} 是否启用 mailbox-ecdh
 */
function isMailboxE2eChannel(state, channelId) {
	return state?.channels?.get?.(channelId)?.encryptionScheme === 'mailbox-ecdh'
}

/**
 * 为 mailbox-ecdh 频道构造消息 E2E 载荷；不满足条件时保持明文。
 * @param {object} content 原始 DAG content
 * @param {string} text 明文正文
 * @param {{ channels?: Map<string, { encryptionScheme?: string }>, members?: Map<string, { pubKeyHex?: string }> } | null | undefined} state 物化群状态
 * @param {string} channelId 频道 ID
 * @returns {object} 写入 DAG 的 content
 */
export function applyMailboxE2EToDagContent(content, text, state, channelId) {
	if (!isMailboxE2eChannel(state, channelId))
		return content

	/** @type {string[]} */
	const recipientPubKeyHexes = []
	/** @type {string[]} */
	const recipientPubKeyHashes = []
	for (const [hash, member] of state?.members || []) {
		if (typeof member?.pubKeyHex !== 'string' || !member.pubKeyHex) continue
		recipientPubKeyHexes.push(member.pubKeyHex)
		recipientPubKeyHashes.push(hash)
	}

	const e2e = serializeMessageContent(text, { members: recipientPubKeyHashes }, {
		recipientPubKeyHexes,
		recipientPubKeyHashes,
	})
	if (!e2e.encrypted)
		return { ...content, text, e2e }
	return { ...content, text: '', e2e }
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
