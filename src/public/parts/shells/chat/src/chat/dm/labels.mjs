/**
 * 【文件】dm/labels.mjs
 * 【职责】由双方公钥 hex 确定性派生 DM 会话标签与房间标签前缀（§14）。
 * 【原理】normalize 后字典序 low/high；sha256(`${low}:${high}`) → dmSessionTag；前缀取前 16 hex。
 * 【数据结构】{ low, high, dmSessionTag, dmRoomLabelPrefix }。
 * 【关联】dm/index findDmGroupBySessionTag、group_meta_update；hexIds PUB_KEY_HEX_64。
 */
import { createHash } from 'node:crypto'

import { HEX_ID_64 as PUB_KEY_HEX_64, normalizeHex64 as normalizePubKeyHex } from '../../../../../../../scripts/p2p/hexIds.mjs'

/**
 * 两方公钥字典序 → DM 会话标签（§14）。
 * @param {string} aHex 公钥 hex
 * @param {string} bHex 公钥 hex
 * @returns {{ low: string, high: string, dmSessionTag: string, dmRoomLabelPrefix: string }} DM 会话标签
 */
export function computeDmRoomLabelFromPubKeys(aHex, bHex) {
	const a = normalizePubKeyHex(aHex)
	const b = normalizePubKeyHex(bHex)
	if (!PUB_KEY_HEX_64.test(a) || !PUB_KEY_HEX_64.test(b))
		throw new Error('invalid pub key hex for DM label')
	const [low, high] = a < b ? [a, b] : [b, a]
	const dmSessionTag = createHash('sha256').update(`${low}:${high}`, 'utf8').digest('hex')
	return {
		low,
		high,
		dmSessionTag,
		dmRoomLabelPrefix: dmSessionTag.slice(0, 16),
	}
}
