/**
 *
 */
export const HEX_ID_64 = /^[\da-f]{64}$/u

/** 公钥 / 成员 pubKeyHash（64 位小写 hex）。 */
export const PUB_KEY_HEX_64 = HEX_ID_64

/** DAG 事件 id（与公钥哈希同格式）。 */
export const EVENT_ID_HEX = HEX_ID_64

/**
 * @param {unknown} value 原始字符串
 * @returns {string} trim + 去 0x + 小写
 */
export function normalizeHex64(value) {
	return String(value ?? '').trim().toLowerCase().replace(/^0x/iu, '')
}

/**
 * @param {unknown} value 待校验值
 * @returns {boolean} 是否为 64 位 hex
 */
export function isHex64(value) {
	return HEX_ID_64.test(normalizeHex64(value))
}

/**
 * 64 位 hex eventId 字典序比较（固定宽度 ASCII，不用 localeCompare）。
 * @param {unknown} a 左操作数
 * @param {unknown} b 右操作数
 * @returns {number} 排序比较结果
 */
export function compareHex64Asc(a, b) {
	const sa = normalizeHex64(a)
	const sb = normalizeHex64(b)
	return sa < sb ? -1 : sa > sb ? 1 : 0
}

/**
 * @param {unknown} value 待校验值
 * @returns {string} 规范化 64 hex
 */
export function normalizePubKeyHex(value) {
	return normalizeHex64(value)
}

/** 签名 hex（128 字符）。 */
export const SIGNATURE_HEX_128 = /^[\da-f]{128}$/u

/**
 * @param {unknown} value 待校验值
 * @returns {boolean} 是否为 128 位签名 hex
 */
export function isSignatureHex128(value) {
	return SIGNATURE_HEX_128.test(String(value ?? '').trim())
}
