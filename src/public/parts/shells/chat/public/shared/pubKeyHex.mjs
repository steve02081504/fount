import { normalizeHex64 } from '../../../../../../scripts/p2p/hexIds.mjs'

/**
 *
 */
export {
	compareHex64Asc,
	HEX_ID_64,
	isHex64,
	isSignatureHex128,
	normalizeHex64,
	SIGNATURE_HEX_128,
} from '../../../../../../scripts/p2p/hexIds.mjs'

/** 公钥 / 成员 pubKeyHash（64 位小写 hex）。 */
export { HEX_ID_64 as PUB_KEY_HEX_64 } from '../../../../../../scripts/p2p/hexIds.mjs'

/** DAG 事件 id（与公钥哈希同格式）。 */
export { HEX_ID_64 as EVENT_ID_HEX } from '../../../../../../scripts/p2p/hexIds.mjs'

/**
 * @param {unknown} value 待校验值
 * @returns {string} 规范化 64 hex
 */
export function normalizePubKeyHex(value) {
	return normalizeHex64(value)
}
