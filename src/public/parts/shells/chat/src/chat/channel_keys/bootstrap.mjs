import { wrapChannelKey } from '../../../../../../../scripts/p2p/channel_crypto.mjs'
import { HEX_ID_64 as PUB_KEY_HEX_64, normalizeHex64 } from '../../../../../../../scripts/p2p/hexIds.mjs'

import { listChannelViewerPubKeys } from './rotate.mjs'
import { loadChannelKeysFile } from './store.mjs'

/**
 * 为新成员授予各可见频道的“当前 K_ch”：用本机持有的当前密钥，按新成员公钥即时重新封装一份。
 *
 * 新成员从不出现在历史轮换事件的 wraps 里，因此不能回放历史 wrap；只能由已持钥成员把当前密钥转封给他。
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} recipientEdPubKeyHex 接收方 Ed25519 公钥 hex（用于 HPKE 封装）
 * @param {string} recipientPubKeyHash 接收方 pubKeyHash（用于频道可见性校验）
 * @param {object} state 响应方物化群状态（用于判定接收方能查看哪些频道）
 * @returns {Promise<Record<string, { generation: number, wrap: object }>>} 频道 → 当前密钥 wrap
 */
export async function collectChannelKeyWrapsForRecipient(username, groupId, recipientEdPubKeyHex, recipientPubKeyHash, state) {
	const edPubHex = String(recipientEdPubKeyHex || '').trim().toLowerCase()
	if (!PUB_KEY_HEX_64.test(edPubHex)) return {}
	const recipient = normalizeHex64(recipientPubKeyHash)
	const file = await loadChannelKeysFile(username, groupId)
	/** @type {Record<string, { generation: number, wrap: object }>} */
	const out = {}
	for (const [channelId, ch] of Object.entries(file.channels)) {
		if (!ch?.generations?.length) continue
		if (recipient && state && !listChannelViewerPubKeys(state, channelId).includes(recipient)) continue
		const row = ch.generations.find(g => g.gen === ch.current) || ch.generations.at(-1)
		if (!row?.keyHex) continue
		out[channelId] = { generation: row.gen, wrap: wrapChannelKey(row.keyHex, edPubHex) }
	}
	return out
}
