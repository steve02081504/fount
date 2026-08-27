/**
 * 【文件】dm/labels.mjs
 * 【职责】由双方公钥 hex 确定性派生 DM 会话标签与房间标签前缀（§14）。
 * 【原理】normalize 后字典序 low/high；sha256(`${low}:${high}`) → dmSessionTag；前缀取前 16 hex。
 * 【数据结构】{ low, high, dmSessionTag, dmRoomLabelPrefix }。
 * 【关联】dm/index findDmGroupBySessionTag、group_meta_update；hexIds PUB_KEY_HEX_64。
 */
import { createHash } from 'node:crypto'

import { HEX_ID_64 as PUB_KEY_HEX_64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'

/**
 * 两方公钥字典序 → DM 会话标签（§14）。
 * @param {string} aHex 公钥 hex
 * @param {string} bHex 公钥 hex
 * @returns {{ low: string, high: string, dmSessionTag: string, dmRoomLabelPrefix: string }} DM 会话标签
 */
export function computeDmRoomLabelFromPubKeys(aHex, bHex) {
	if (!PUB_KEY_HEX_64.test(aHex) || !PUB_KEY_HEX_64.test(bHex))
		throw new Error('invalid pub key hex for DM label')
	const [low, high] = aHex < bHex ? [aHex, bHex] : [bHex, aHex]
	const dmSessionTag = createHash('sha256').update(`${low}:${high}`, 'utf8').digest('hex')
	return {
		low,
		high,
		dmSessionTag,
		dmRoomLabelPrefix: dmSessionTag.slice(0, 16),
	}
}
