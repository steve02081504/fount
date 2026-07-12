import { normalizeHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'

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
} from 'npm:@steve02081504/fount-p2p/core/hexIds'

/** 公钥 / 成员 pubKeyHash（64 位小写 hex）。 */
export { HEX_ID_64 as PUB_KEY_HEX_64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'

/** DAG 事件 id（与公钥哈希同格式）。 */
export { HEX_ID_64 as EVENT_ID_HEX } from 'npm:@steve02081504/fount-p2p/core/hexIds'

/**
 * @param {unknown} value 待校验值
 * @returns {string} 规范化 64 hex
 */
export function normalizePubKeyHex(value) {
	return normalizeHex64(value)
}
